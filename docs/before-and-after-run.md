# Before and after run

[Back to the documentation index](index.md)

## Expensive setup: `beforeRun`

If an experiment requires expensive setup that should only happen when the experiment is actually going to run (that is,
it is enabled, `runIf` allows it and there is at least one candidate), define it with `beforeRun`:

```ts
// Code under test modifies this in place. We want to copy it for the
// candidate code, but only when needed:
const valueForOriginalCode = bigObject;
let valueForNewCode: BigObject | undefined;

run<Report>("expensive-but-worthwhile", (e) => {
  e.beforeRun(() => {
    valueForNewCode = structuredClone(bigObject);
  });
  e.use(() => originalCode(valueForOriginalCode));
  e.try(() => newCode(valueForNewCode!));
});
```

When the experiment doesn't run, `beforeRun` is not called and only the control executes.

## Inspecting the result: `afterRun`

`afterRun` is called with the `Result` after all behaviors ran and were compared, and before `publish`:

```ts
run<number>("after", (e) => {
  e.use(() => legacyTotal());
  e.try(() => newTotal());
  e.afterRun((result) => {
    if (result.mismatched()) metrics.increment("totals.mismatch");
  });
});
```

Calling `beforeRun` or `afterRun` again replaces the previous callback. Errors thrown by either are **not** routed to
`raised`: they propagate out of `run`, as in Ruby. In `runAsync` both callbacks may be `async` and are awaited; in a
synchronous `run`, returning a promise from them throws a `TypeError` (see [Async](async.md)).
