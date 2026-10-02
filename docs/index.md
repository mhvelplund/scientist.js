# scientist documentation

`@mhvelplund/scientist` is a TypeScript/JavaScript port of GitHub's [Scientist](https://github.com/github/scientist), a
library for carefully refactoring critical paths. You wrap the existing code (the **control**) and the new code (one or
more **candidates**) in an experiment. The experiment always returns what the control returns, but behind the scenes it
also runs the candidates, compares their results to the control, times everything, and publishes the findings so that
you can find out, with production data and production load, whether the new code behaves like the old code.

```ts
import { Scientist } from "@mhvelplund/scientist";

const allowed = Scientist.run<boolean>("widget-permissions", (e) => {
  e.use(() => model.checkUser(user).valid); // old way
  e.try(() => user.can("read", model)); // new way
});
```

New to the library? Read [Getting started](getting-started.md), then [Custom experiments](custom-experiments.md): until
you register your own experiment class, the default experiment never runs candidates and publishes nothing.

## Contents

| Page                                                | What it covers                                                                                        |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| [Getting started](getting-started.md)               | `use`/`try`, `run`, the `science` helpers, the `Scientist` base class, `withScience`, `Scientist.run` |
| [Custom experiments](custom-experiments.md)         | Subclassing `Experiment`: `enabled`, `publish`, `raised`, `Experiment.setDefault`, percentage ramp-up |
| [Comparing results](comparing-results.md)           | `compare`, `compareErrors` and the rules of `defaultEquals`                                           |
| [Adding context](context.md)                        | `context` and `defaultScientistContext`                                                               |
| [Before and after run](before-and-after-run.md)     | Expensive setup with `beforeRun`, inspecting results with `afterRun`                                  |
| [Cleaning values](cleaning-values.md)               | `clean`, `cleanedValue` and `cleaner`                                                                 |
| [Ignoring mismatches](ignoring-mismatches.md)       | `ignore`, and ignoring results entirely                                                               |
| [Enabling and `runIf`](enabling-and-run-if.md)      | When an experiment runs: `enabled`, `runIf`, `shouldExperimentRun`                                    |
| [Publishing results](publishing-results.md)         | The `Result` and `Observation` objects and an example publisher                                       |
| [Testing](testing.md)                               | `raiseOnMismatches`, `raiseWith`, custom `MismatchError`s, fake durations                             |
| [Error handling](error-handling.md)                 | Errors in behaviors, errors in callbacks, `raised` and `Observation.rescues`                          |
| [Multiple candidates](multiple-candidates.md)       | Named candidates, and experiments without a control                                                   |
| [Async experiments](async.md)                       | `runAsync` / `scienceAsync`, and the pitfalls of promises in sync runs                                |
| [JavaScript usage](javascript-usage.md)             | Using the library from plain CommonJS and ESM, JSDoc typing                                           |
| [Designing an experiment](designing-experiments.md) | What is safe to experiment on, noise and error rates, finishing an experiment                         |
| [Differences from Ruby](differences-from-ruby.md)   | Naming map and every deliberate behavioral difference                                                 |

## API at a glance

| Export                                                               | Kind           | Purpose                                                                                           |
|----------------------------------------------------------------------|----------------|---------------------------------------------------------------------------------------------------|
| `Experiment<T>`                                                      | abstract class | Base class for experiments; implement `enabled()` and `publish(result)`                           |
| `DefaultExperiment` (alias `Default`)                                | class          | The fallback experiment: never enabled, publishes nothing                                         |
| `Result<T>`                                                          | class          | What an experiment run produced, passed to `publish`                                              |
| `Observation<T>`                                                     | class          | What one behavior did: value or exception, duration, CPU time                                     |
| `run` / `science`                                                    | function       | Create an experiment with the default class, configure it, run it                                 |
| `runAsync` / `scienceAsync`                                          | function       | The same, awaiting promises                                                                       |
| `Scientist`                                                          | class          | Base class adding `science` / `scienceAsync` methods; also `Scientist.run` / `Scientist.runAsync` |
| `withScience(Base)`                                                  | mixin          | Adds the same methods to a class that already extends something                                   |
| `defaultEquals`                                                      | function       | The default value comparison                                                                      |
| `MismatchError`                                                      | error          | Thrown on mismatches when `raiseOnMismatches` is enabled                                          |
| `BadBehaviorError`, `BehaviorMissingError`, `BehaviorNotUniqueError` | errors         | Misconfigured behaviors                                                                           |
| `NoValueError`                                                       | error          | Kept for parity with Ruby; not thrown by the library                                              |

Every example in these pages has an executable counterpart in
[`test/docs-examples.test.ts`](../test/docs-examples.test.ts).
