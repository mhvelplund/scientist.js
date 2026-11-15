---
name: scientist-experiments
description: Use when refactoring or replacing a critical code path in TypeScript or JavaScript and the old and new implementations should be compared on production data, or when code imports `@mhvelplund/scientist` (Experiment, Scientist, run, runAsync, science, withScience, use/try, publish, MismatchError). Also use for "GitHub Scientist for Node", control vs candidate, shadow-running new code, or experiment mismatches.
---

# Scientist experiments with `@mhvelplund/scientist`

`@mhvelplund/scientist` is a TypeScript port of GitHub's Ruby [Scientist](https://github.com/github/scientist). You wrap
the existing code (the **control**, `use`) and the new code (the **candidate**, `try`) in an experiment. The caller
always gets the control's return value, or the control's thrown error. Behind the scenes the experiment also runs the
candidate, compares the two results, times both, and hands everything to your `publish` method.

Install with `npm install @mhvelplund/scientist`. It has no runtime dependencies, ships ESM, CJS and type declarations,
and needs Node 20 or newer.

## The one setup step everyone misses

**Nothing happens until you register an experiment class.** The built-in `DefaultExperiment` is never enabled and
publishes nothing, so out of the box candidates never run. Subclassing `Experiment` does not register it either (Ruby
auto-registers; this port does not). Do this once, at application start-up:

```ts
import {
  Experiment,
  type RaisedOperation,
  type Result,
} from "@mhvelplund/scientist";

export class AppExperiment<T = unknown> extends Experiment<T> {
  // Required. Runs on every call, so keep it cheap (cache flag lookups).
  enabled(): boolean {
    return flags.percentFor(this.name) > Math.random() * 100;
  }

  // Required. Sync or async.
  publish(result: Result<T>): void {
    metrics.increment(
      `science.${this.name}.${result.matched() ? "matched" : result.ignored() ? "ignored" : "mismatched"}`,
    );
    metrics.timing(`science.${this.name}.control`, result.control?.duration); // seconds
    for (const c of result.candidates)
      metrics.timing(`science.${this.name}.${c.name}`, c.duration);
    if (result.mismatched()) {
      logger.warn("science mismatch", {
        experiment: this.name,
        context: result.context,
        control: result.control?.raised
          ? String(result.control.exception)
          : result.control?.cleanedValue,
        candidates: result.mismatchedObservations.map((o) => ({
          name: o.name,
          value: o.raised ? String(o.exception) : o.cleanedValue,
        })),
      });
    }
  }

  // Strongly recommended in production. The default re-throws, which crashes the caller
  // when publish/compare/clean/ignore/enabled/runIf fails.
  override raised(operation: RaisedOperation, error: unknown): void {
    logger.error(`science failure in ${this.name}: ${operation}`, error);
  }
}

Experiment.setDefault(AppExperiment);
```

In TypeScript, `enabled` and `publish` are abstract. In plain JavaScript, forgetting either one fails at run time.

## Running an experiment

```ts
import { run, runAsync } from "@mhvelplund/scientist";

const allowed = run<boolean>("widget-permissions", (e) => {
  e.context({ userId: user.id }); // shows up as result.context
  e.use(() => legacyCheck(user)); // control: always runs, its value is returned
  e.try(() => newCheck(user)); // candidate: errors are captured, never reach the caller
});

// Any behavior returns a promise? Use the async variant and await it.
const profile = await runAsync<Profile>("load-profile", (e) => {
  e.use(() => db.loadProfile(id));
  e.try(() => profileService.get(id));
});
```

| Style                         | Sync                                                                                               | Async                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Standalone function           | `run(name, configure, options?)` (alias `science`)                                                 | `runAsync(...)` (alias `scienceAsync`) |
| Static                        | `Scientist.run(...)`                                                                               | `Scientist.runAsync(...)`              |
| Class extending `Scientist`   | `this.science(...)`                                                                                | `this.scienceAsync(...)`               |
| Class that already has a base | `class Repo extends withScience(BaseRepo)`, then `this.science(...)`                               | `this.scienceAsync(...)`               |
| Manual                        | `const e = Experiment.create(name)` or `new AppExperiment(name)`, then `e.use`, `e.try`, `e.run()` | `await e.runAsync()`                   |

`Scientist` subclasses and `withScience` classes can override `defaultScientistContext()` to add context to every
experiment they run.

## Configuring the experiment (`e.` inside `configure`)

| Method                                                                                   | Purpose                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `use(fn)`                                                                                | The control. Registered as `"control"`.                                                                   |
| `try(fn)` / `try("name", fn)`                                                            | A candidate. An unnamed one is `"candidate"`. Duplicate names throw `BehaviorNotUniqueError`.             |
| `context(obj)`                                                                           | Merge data into the context (read it with `context()`).                                                   |
| `compare((control, candidate) => boolean)`                                               | Custom equality for values. The default is `defaultEquals`, a deep structural comparison.                 |
| `compareErrors((controlErr, candidateErr) => boolean)`                                   | Custom equality when either side threw. By default both must throw with the same prototype and `message`. |
| `ignore((control, candidate) => boolean)`                                                | Mark a known mismatch as ignored. Can be called more than once; it only runs for mismatches.              |
| `clean((value) => summary)`                                                              | Shrink values for publishing (`observation.cleanedValue`). Not used for comparing. Must be sync.          |
| `runIf(() => boolean)`                                                                   | Per-call gate, checked after `enabled()`.                                                                 |
| `beforeRun(fn)`                                                                          | Expensive setup that only runs if the candidates will run.                                                |
| `afterRun((result) => ...)`                                                              | Inspect the result before `publish`.                                                                      |
| `raiseWith(ErrorClass)`                                                                  | Custom mismatch error (see Testing).                                                                      |
| `fabricateDurationsForTestingPurposes({ control: {duration, cpuTime}, candidate: 0.5 })` | Fixed timings for tests.                                                                                  |

`use` and `try` take **functions**, not values: `e.use(() => compute())`, never `e.use(compute())`.

When the candidates run: there are at least two behaviors, **and** `enabled()` is truthy, **and** `runIf` (if set) is
truthy. Otherwise only the control runs and nothing is published. Behaviors run one after another, never concurrently,
in random order.

## Choosing sync or async

- **If any behavior returns a promise, use `runAsync`, `scienceAsync` or `e.runAsync()`.** A sync `run` does not await.
  It would compare two `Promise` objects, which always mismatch, and a rejected candidate would become an unhandled
  rejection.
- In `runAsync`, every hook may be async: `enabled`, `runIf`, `beforeRun`, `compare`, `compareErrors`, `ignore`,
  `afterRun` and `publish`.
- In a sync `run`, a hook that returns a promise throws a `TypeError`. That error is routed like an error thrown by
  the hook. The exception is `publish`: an async `publish` is fire-and-forget, and a rejection goes to
  `raised("publish")`.
- `clean` and `raised` must always be synchronous.

## What to wrap

- **Only wrap code without side effects**: reads, calculations, permission checks, rendering. The candidate may not run
  at all, may run before the control, and its result is thrown away. Never wrap writes, emails, payments or anything
  that mutates shared state.
- If a behavior mutates its input, give the candidate its own copy, made in `beforeRun` (for example with
  `structuredClone`).
- Candidates add their full run time to the caller's latency. Ramp up through `enabled()` and add your own timeouts
  inside async candidates.
- To measure background noise, first run an experiment where `use` and `try` both call the old code, then swap in the
  real candidate.
- Class instances without an `equals(other)` method are compared **by identity** by `defaultEquals`, so they always
  mismatch. Add `equals`, map both sides to plain data, or use `compare`.

## Testing

Turn mismatches into failures only in test setup:

```ts
import { MismatchError } from "@mhvelplund/scientist";
import { AppExperiment } from "../src/app-experiment";

AppExperiment.raiseOnMismatches = true; // static, inherited by subclasses
// or per instance: experiment.raiseOnMismatches = true;

try {
  doTheThing();
} catch (error) {
  if (error instanceof MismatchError) {
    console.log(error.experimentName, error.message); // the message lists every observation
  }
}
```

`MismatchError` is thrown **after** `publish`. It is an ordinary `Error`, so a broad `catch` in the code under test will
swallow it. For a deterministic order, override `protected shuffle(names) { return names; }` in a test subclass.

## Common mistakes

| Mistake                                          | Symptom                                                  | Fix                                                    |
| ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| No `Experiment.setDefault(...)`                  | Candidate never runs, nothing published                  | Register your class at start-up                        |
| `run` with async behaviors                       | Every run mismatches, unhandled rejections               | `runAsync` / `scienceAsync` and `await`                |
| Async `compare`/`ignore`/`runIf` in a sync `run` | `TypeError` routed to `raised`                           | Make it sync, or switch to `runAsync`                  |
| Default `raised` in production                   | A broken publisher or comparator throws in user requests | Override `raised` to log and continue                  |
| Comparing class instances                        | Always mismatched                                        | `equals()` method, or `compare`                        |
| Passing a value to `use`/`try`                   | `TypeError`                                              | Pass a function                                        |
| Calling `use`/`try`/`context(data)` after `run`  | `TypeError` (the experiment is frozen)                   | Create a new experiment per call                       |
| `run("name")` for an unregistered behavior       | `BehaviorMissingError`                                   | Register that behavior, or use the default `"control"` |
| Returning `0`/`""` from `enabled`/`compare`      | Treated as false (JS truthiness, unlike Ruby)            | Return real booleans                                   |
| Wrapping a write                                 | Double writes, corrupted data                            | Experiment on reads only                               |

## More detail

See [reference.md](./reference.md) for the `Result` and `Observation` fields, `raised` operations, error classes,
`defaultEquals` rules, multiple and control-less candidates, and Ruby-to-JS name mapping. The package's full docs are
at https://github.com/mhvelplund/scientist.js/tree/main/docs.
