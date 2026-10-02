# Async experiments

[Back to the documentation index](index.md)

Ruby has no promises, so this page has no Ruby counterpart. Much JavaScript code is asynchronous, so every way of
running an experiment has an async twin:

| Synchronous                                                | Asynchronous                          |
|------------------------------------------------------------|---------------------------------------|
| `experiment.run(name?)`                                    | `experiment.runAsync(name?)`          |
| `run(name, configure, options?)` / `science(...)`          | `runAsync(...)` / `scienceAsync(...)` |
| `Scientist.run(...)`                                       | `Scientist.runAsync(...)`             |
| `this.science(...)` on `Scientist` / `withScience` classes | `this.scienceAsync(...)`              |

```ts
import { runAsync } from "@mhvelplund/scientist";

const user = await runAsync<User>("fetch-user", (e) => {
  e.use(() => db.findUser(id)); // returns a Promise<User>
  e.try(() => userService.fetch(id)); // returns a Promise<User>
  e.compare(async (control, candidate) => control.login === candidate.login);
});
```

## Semantics of `runAsync`

- **Behaviors run sequentially, never concurrently.** Each behavior is called and awaited before the next one starts, in
  random order, just like the synchronous version. This keeps behaviors isolated from each other and makes timings
  meaningful, at the cost of the caller waiting for the sum of all behaviors. (Run time for the caller is therefore
  roughly control + candidates.)
- A behavior's resolved value becomes the observation's `value`; a rejection is captured like a thrown error.
- `duration` covers the time from calling the behavior until its promise settles.
- Every hook is awaited when it returns a promise: `enabled`, `runIf`, `beforeRun`, `compare`, `compareErrors`,
  `ignore`, `afterRun` and `publish`. The configuration callback passed to `runAsync` / `scienceAsync` may be `async`
  too.
- The returned promise resolves with the control's value, or rejects with the control's error, or with a `MismatchError`
  (see [Testing](testing.md)).

### What must stay synchronous

- **`clean`**: `cleanedValue` is a getter, so the cleaner must return the cleaned value directly.
- **`raised`**: it is called synchronously and its return value is ignored. Kick off async error reporting from it if
  you must, but handle that promise yourself.

## Pitfalls of promises in a synchronous `run`

`run()` never awaits anything. That makes it fast and predictable, but promises behave differently there:

- **Async behaviors are not awaited.** The observations hold *promise objects*, and two distinct promises are never
  equal, so every run reports a mismatch, and a rejected candidate promise becomes an unhandled rejection. If any
  behavior is async, use `runAsync`.

  ```ts
  // Wrong: compares two Promise objects, always mismatches
  const value = run<Promise<number>>("oops", (e) => {
    e.use(async () => 1);
    e.try(async () => 1);
  });
  ```

- **Async hooks are rejected.** If `enabled`, `runIf`, `beforeRun`, `afterRun`, `compare`, `compareErrors` or `ignore`
  returns a promise during a synchronous run, the experiment throws a `TypeError` instead of silently treating the
  promise as "true". That error is handled exactly as if the hook had thrown it: `compare`/`compareErrors` errors go to
  `raised("compare")`, `ignore` to `raised("ignore")`, `runIf` to `raised("run_if")`, `enabled` to `raised("enabled")`,
  and `beforeRun`/`afterRun` errors propagate to the caller.
- **An async `publish` is fire-and-forget.** The run doesn't wait for it to finish. If its promise rejects, the
  rejection is routed to `raised("publish", error)`. This makes it safe to use the same experiment class, with an async
  `publish`, for both sync and async runs.

## CPU time in async code

`cpuTime` is process CPU time measured around the behavior. While a behavior awaits, other work on the event loop may
run, and its CPU time is counted too. Treat `cpuTime` in async experiments as a rough indicator. In browsers it is
always `0`.
