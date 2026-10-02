# Getting started

[Back to the documentation index](index.md)

## Control and candidate

Let's pretend you're changing the way you handle permissions in a large web app. Tests can help guide your refactoring,
but you really want to compare the current and refactored behaviors under load.

```ts
import { DefaultExperiment } from "@mhvelplund/scientist";

class MyWidget {
  allows(user: User): boolean {
    const experiment = new DefaultExperiment<boolean>("widget-permissions");
    experiment.use(() => model.checkUser(user).valid); // old way
    experiment.try(() => user.can("read", model)); // new way

    return experiment.run();
  }
}
```

Wrap a `use` callback around the code's original behavior, and wrap `try` around the new behavior. `experiment.run()`
will always return whatever the `use` callback returns (and if it throws, `run()` throws the same error), but it does a
bunch of stuff behind the scenes:

- It decides whether or not to run the `try` callback,
- Randomizes the order in which `use` and `try` callbacks are run,
- Measures the wall time and CPU time of all behaviors, in seconds,
- Compares the result of `try` to the result of `use`,
- Swallows and records errors thrown in the `try` callback, and
- Publishes all this information.

The `use` callback is called the **control**. The `try` callback is called the **candidate**. Both are plain functions
taking no arguments; passing anything else throws a `TypeError`. Each behavior name may only be registered once
(`BehaviorNotUniqueError`), and running an experiment without a control throws `BehaviorMissingError`.

If you don't declare any `try` callbacks, none of the Scientist machinery is invoked and the control value is always
returned.

> **Nothing happens yet.** `DefaultExperiment` is never enabled and publishes nothing, so in the example above only the
> control runs. To actually run candidates and see results, write your own experiment class and register it with
> `Experiment.setDefault`; see [Custom experiments](custom-experiments.md).

## The `science` helpers

Creating an experiment by hand is wordy. The `run` function (also exported as `science`, and available as
`Scientist.run`) creates an experiment with the default experiment class, passes it to your configuration callback, and
runs it:

```ts
import { run } from "@mhvelplund/scientist";

const allowed = run<boolean>("widget-permissions", (e) => {
  e.use(() => model.checkUser(user).valid); // old way
  e.try(() => user.can("read", model)); // new way
}); // returns the control value
```

The type parameter is the type of value your behaviors return. The optional third argument, `{ run: "name" }`, selects
which behavior's value is returned; see [Multiple candidates](multiple-candidates.md).

## The `Scientist` base class

In Ruby you `include Scientist` to get a `science` method. In TypeScript, extend `Scientist`:

```ts
import { Scientist } from "@mhvelplund/scientist";

class MyWidget extends Scientist {
  allows(user: User): boolean {
    return this.science<boolean>("widget-permissions", (e) => {
      e.use(() => model.checkUser(user).valid); // old way
      e.try(() => user.can("read", model)); // new way
    }); // returns the control value
  }
}
```

The `science` method behaves like the `run` function, but first merges `this.defaultScientistContext()` into the
experiment's context (see [Adding context](context.md)). There is also `this.scienceAsync(...)` for asynchronous
behaviors (see [Async](async.md)).

## `withScience` for classes that already extend something

JavaScript classes have a single superclass. If your class already extends something, use the `withScience` mixin to add
the same `science`, `scienceAsync` and `defaultScientistContext` methods:

```ts
import { withScience } from "@mhvelplund/scientist";

class UserRepository extends withScience(BaseRepository) {
  count(): number {
    return this.science<number>("user-count", (e) => {
      e.use(() => this.legacyCount());
      e.try(() => this.newCount());
    });
  }
}
```

## Without a base class

If you need to use Scientist somewhere you can't (or don't want to) extend a class, call `Scientist.run`, or import the
`run` / `science` functions directly. They are the same function:

```ts
import { Scientist } from "@mhvelplund/scientist";

Scientist.run<boolean>("widget-permissions", (e) => {
  e.use(() => model.checkUser(user).valid);
  e.try(() => user.can("read", model));
});
```

`Scientist.runAsync`, `runAsync` and `scienceAsync` are the asynchronous equivalents.

## Next steps

- [Custom experiments](custom-experiments.md): make experiments actually run and publish.
- [Comparing results](comparing-results.md): control how values are compared.
- [Designing an experiment](designing-experiments.md): what is safe to put under experiment.
