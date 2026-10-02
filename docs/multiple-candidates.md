# Multiple candidates

[Back to the documentation index](index.md)

## Trying more than one thing

It's not usually a good idea to try more than one alternative simultaneously. Behavior isn't guaranteed to be isolated,
and reporting and visualization get quite a bit harder. Still, it's sometimes useful.

To try more than one alternative at once, give names to some `try` callbacks:

```ts
class MyWidget extends Scientist {
  allows(user: User): boolean {
    return this.science<boolean>("widget-permissions", (e) => {
      e.use(() => model.checkUser(user).valid); // old way

      e.try("api", () => user.can("read", model)); // new service API
      e.try("raw-sql", () => user.canSql("read", model)); // raw query
    });
  }
}
```

When the experiment runs, all behaviors run (in random order) and each candidate observation is compared with the
control in turn. `result.candidates` holds all of them and `result.mismatchedObservations` the ones that didn't match.
Publishers that only look at `result.candidates[0]` should be updated to handle several.

An unnamed `try` is named `"candidate"`; `use` registers `"control"`. `experiment.behaviors` is a read-only `Map` of the
registered behaviors, in registration order.

## No control, just candidates

Define the candidates with named `try` callbacks, omit `use`, and pass a candidate name to `run`. That behavior then
plays the part of the control: its value is returned, and the others are compared to it.

In Ruby the experiment's constructor takes a configuration block. In JavaScript you configure the experiment first, then
run it:

```ts
const experiment = new MyExperiment<string>("various-ways");
experiment.try("first-way", () => firstWay());
experiment.try("second-way", () => secondWay());

experiment.run("second-way");
```

The `science` helpers, `run` and `Scientist.run` know this trick too, via the `run` option:

```ts
const value = run<string>(
  "various-ways",
  (e) => {
    e.try("first-way", () => firstWay());
    e.try("second-way", () => secondWay());
  },
  { run: "first-way" },
);
```

Running a name that was never registered throws `BehaviorMissingError`. When fabricating durations (see
[Testing](testing.md)), use the names you gave the behaviors.
