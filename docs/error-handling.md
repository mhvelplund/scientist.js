# Error handling

[Back to the documentation index](index.md)

## In behaviors (control and candidates)

Scientist catches and records *everything* thrown by a `use` or `try` callback (or, in `runAsync`, every rejection). The
thrown value is stored in the observation's `exception`, and `raised` is set to `true`:

```ts
run<number>("candidate-throws", (e) => {
  e.use(() => 1);
  e.try(() => {
    throw new Error("candidate failed");
  });
}); // returns 1; the published candidate observation has raised === true
```

After publishing, a run returns the control's value, or **re-throws the control's error**, so the calling code sees
exactly what it would have seen without the experiment. Errors thrown by candidates never reach the caller (unless
`raiseOnMismatches` turns the resulting mismatch into a `MismatchError`, see [Testing](testing.md)).

### Narrowing what is captured: `Observation.rescues`

Ruby Scientist rescues `Exception` by default and lets you narrow it with `Scientist::Observation::RESCUES`. In
JavaScript, anything can be thrown, so the hook is a predicate. Values for which it returns `false` are not captured:
they propagate straight out of the run.

```ts
import { Observation } from "@mhvelplund/scientist";

// default: capture everything
Observation.rescues = () => true;

// let a particular error class escape
Observation.rescues = (error) => !(error instanceof FatalError);
```

This is a global setting.

### Timeouts

If you're introducing a candidate that could possibly take too long, use caution. While Scientist catches all errors
that occur in the candidate, it *does not* protect you from slowness or timeouts: candidates run inline, one after
another, and the caller waits for all of them. This risk can be reduced by running the experiment on a low percentage
(see [Ramping up experiments](custom-experiments.md#ramping-up-experiments)), or by adding your own timeout inside the
candidate in async code.

## In Scientist callbacks: `raised`

If an error is thrown within one of Scientist's internal operations, like `publish`, `compare`, or `clean`, the
experiment's `raised(operation, error)` method is called with the name of the operation that failed and the error. The
default behavior is to re-throw the error. Since this halts the experiment (and your request) entirely, it's often a
better idea to handle the error and continue:

```ts
class MyExperiment<T = unknown> extends Experiment<T> {
  // ...
  raised(operation: RaisedOperation, error: unknown): void {
    errorTracker.track(`science failure in ${this.name}: ${operation}`, error);
  }
}
```

The operations that may be handled here are:

| Operation   | Thrown by                                             | What happens after `raised` returns               |
|-------------|-------------------------------------------------------|---------------------------------------------------|
| `"clean"`   | a `clean` callback                                    | the uncleaned value is used                       |
| `"compare"` | a `compare` or `compareErrors` callback               | the candidate counts as mismatched                |
| `"enabled"` | the `enabled()` method                                | the experiment doesn't run; only the control does |
| `"ignore"`  | an `ignore` callback                                  | that callback counts as not ignoring              |
| `"publish"` | the `publish()` method (including an async rejection) | the run continues normally                        |
| `"run_if"`  | a `runIf` callback                                    | the experiment doesn't run; only the control does |

`raised` must be synchronous. Errors from `beforeRun` and `afterRun` are not routed to `raised`; they propagate to the
caller.

In a synchronous `run`, a callback that returns a promise produces a `TypeError` that is handled exactly like an error
thrown by that callback (see [Async](async.md)).

## Configuration errors

These are thrown directly, never captured or routed to `raised`:

| Error                    | When                                                                                                                                |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `BehaviorMissingError`   | `run(name)` was called for a behavior that was never registered (by default `"control"`)                                            |
| `BehaviorNotUniqueError` | `use` or `try` was called twice with the same name                                                                                  |
| `TypeError`              | `use`/`try` was passed something that isn't a function; a behavior was added, or the context was modified, after the experiment ran |

`BehaviorMissingError` and `BehaviorNotUniqueError` extend `BadBehaviorError`, which exposes `experiment` and
`behaviorName`. The aliases `BadBehavior`, `BehaviorMissing`, `BehaviorNotUnique` and `NoValue` match the Ruby constant
names.
