# Custom experiments

[Back to the documentation index](index.md)

The examples in [Getting started](getting-started.md) will run, but they're not really *doing* anything: the candidates
don't run yet and none of the results get published. Replace the default experiment implementation to control execution
and reporting.

## Subclassing `Experiment`

`Experiment<T>` is an abstract class. A subclass must implement `enabled()` and `publish(result)`, and usually overrides
`raised(operation, error)`:

```ts
import { Experiment, type RaisedOperation, type Result } from "@mhvelplund/scientist";

export class MyExperiment<T = unknown> extends Experiment<T> {
  enabled(): boolean {
    // see "Ramping up experiments" below
    return true;
  }

  raised(operation: RaisedOperation, error: unknown): void {
    // see "Error handling"
    console.error(`Operation '${operation}' failed with error`, error);
    super.raised(operation, error); // will re-throw
  }

  publish(result: Result<T>): void {
    // see "Publishing results"
    console.log(result);
  }
}
```

The constructor takes the experiment's name (`new MyExperiment("widget-permissions")`), which is available as
`this.name`. If you add your own constructor, keep `name` as the first parameter so that `Experiment.create` can
instantiate the class.

## Registering the default: `Experiment.setDefault`

The `science` helpers, `run`, `Scientist.run` and `Experiment.create(name)` instantiate the *default* experiment class.
Out of the box that is `DefaultExperiment`, which is never enabled and publishes nothing. Register your class once, at
application start-up:

```ts
import { Experiment } from "@mhvelplund/scientist";
import { MyExperiment } from "./my-experiment";

Experiment.setDefault(MyExperiment);

Experiment.create("anything"); // a MyExperiment
Experiment.setDefault(null); // back to DefaultExperiment
```

Unlike Ruby, where including `Scientist::Experiment` in a class registers it automatically, subclassing `Experiment`
does **not** register anything: you must call `Experiment.setDefault`.

You can also skip the default entirely and instantiate your class directly:

```ts
const experiment = new MyExperiment<boolean>("widget-permissions");
experiment.use(() => model.checkUser(user).valid);
experiment.try(() => user.can("read", model));
experiment.run();
```

## Ramping up experiments

As a scientist, you know it's always important to be able to turn your experiment off, lest it run amok and result in
villagers with pitchforks on your doorstep. `enabled()` decides, on every run, whether candidates run at all. A simple
percentage ramp-up:

```ts
import { Experiment, type Result } from "@mhvelplund/scientist";

class RampedExperiment<T = unknown> extends Experiment<T> {
  percentEnabled = 100;

  enabled(): boolean {
    return this.percentEnabled > 0 && Math.random() * 100 < this.percentEnabled;
  }

  publish(result: Result<T>): void {
    // ...
  }
}
```

In practice you would look the percentage up by `this.name` in a feature-flag service or configuration store. This code
runs for every experiment, every time, so be sensitive about its performance: cache flags in memory, per request, or
both.

When `enabled()` returns false (or anything falsy), only the control runs, and its value is returned. Nothing is
published. In `runAsync`, `enabled()` may return a promise.

If `enabled()` throws, the error is passed to `raised("enabled", error)` and the experiment does not run. See
[Enabling and `runIf`](enabling-and-run-if.md) for per-call conditions.

## `raised`

When one of your callbacks (`enabled`, `runIf`, `compare`, `ignore`, `clean`, `publish`) throws, the experiment calls
`raised(operation, error)`. The default implementation re-throws the error, which aborts the experiment and propagates
to the caller. Since that halts your application code too, it's often a better idea to record the error and carry on:

```ts
class MyExperiment<T = unknown> extends Experiment<T> {
  // ...
  raised(operation: RaisedOperation, error: unknown): void {
    errorTracker.track(`science failure in ${this.name}: ${operation}`, error);
  }
}
```

`raised` must be synchronous. See [Error handling](error-handling.md) for the full list of operations.

## Other things you can override

- `shuffle(names)` (protected) decides the execution order. The default is a random shuffle; override it for a
  deterministic order in tests.
- `static raiseOnMismatches` / instance `raiseOnMismatches`: see [Testing](testing.md).
