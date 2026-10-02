# Enabling experiments and `runIf`

[Back to the documentation index](index.md)

An experiment only runs its candidates when **all** of the following hold; otherwise only the requested behavior (the
control, by default) runs, its value is returned and nothing is published:

1. At least two behaviors are registered (a control and at least one candidate).
2. The experiment class's `enabled()` method returns a truthy value.
3. The `runIf` callback, if any, returns a truthy value.

`enabled()` is the global switch implemented by your experiment class, typically backed by a feature flag or percentage;
see [Custom experiments](custom-experiments.md#ramping-up-experiments).

## Per-call conditions: `runIf`

Sometimes you don't want an experiment to run for a particular call. Say, disabling a new code path for anyone who isn't
staff. You can disable an experiment by setting a `runIf` callback. If it returns false, the experiment merely returns
the control value. Otherwise, it defers to the experiment's `enabled()` method.

```ts
class DashboardController extends Scientist {
  dashboardItems(): Item[] {
    return this.science<Item[]>("dashboard-items", (e) => {
      // only run this experiment for staff members
      e.runIf(() => this.currentUser.staff);
      e.use(() => this.legacyItems());
      e.try(() => this.newItems());
    });
  }
}
```

Note the order: `enabled()` is checked first, and `runIf` is only called when `enabled()` returned true. Calling `runIf`
again replaces the previous callback.

## Errors

- If `enabled()` throws, the error goes to `raised("enabled", error)` and the experiment doesn't run.
- If the `runIf` callback throws, the error goes to `raised("run_if", error)` and the experiment doesn't run.

## Asking the experiment

Two methods expose the decision, mostly for custom runners and tests:

```ts
const e = new MyExperiment<number>("x");
e.use(() => 1);
e.shouldExperimentRun(); // false: only one behavior
e.try(() => 1);
e.shouldExperimentRun(); // true (MyExperiment is always enabled)
e.runIf(() => false);
e.runIfBlockAllows(); // false
e.shouldExperimentRun(); // false
```

Both are synchronous and evaluate the callbacks each time they are called.

## Truthiness

As everywhere in this port, results of `enabled`, `runIf`, `compare` and `ignore` are interpreted with JavaScript
truthiness: `0`, `""` and `NaN` count as false, which is not the case in Ruby. Return real booleans to stay clear of
surprises.
