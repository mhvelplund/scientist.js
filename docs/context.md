# Adding context

[Back to the documentation index](index.md)

Results aren't very useful without some way to identify them. Use the `context` method to add to or retrieve the context
for an experiment:

```ts
run<boolean>("widget-permissions", (e) => {
  e.context({ user: user.id });

  e.use(() => model.checkUser(user).valid);
  e.try(() => user.can("read", model));
});
```

`context(data)` merges a plain object of extra data into the experiment's context (like `Object.assign`) and returns the
whole context; `context()` with no argument just returns it. The data is available in `publish` as `this.context()` or
`result.context`.

Once the experiment has run, its context is frozen: reading still works, but merging more data throws a `TypeError`.

## Default context: `defaultScientistContext`

If you're using the `science` helper a lot in a class, you can provide a default context by overriding
`defaultScientistContext()`. It is merged in before your configuration callback runs, so the callback can add to or
override it:

```ts
import { Scientist } from "@mhvelplund/scientist";

class MyWidget extends Scientist {
  allows(user: User): boolean {
    return this.science<boolean>("widget-permissions", (e) => {
      e.context({ user: user.id });

      e.use(() => model.checkUser(user).valid);
      e.try(() => user.can("read", model));
    });
  }

  destroy(): void {
    this.science<void>("widget-destruction", (e) => {
      e.use(() => this.oldScaryDestroy());
      e.try(() => this.newSafeDestroy());
    });
  }

  override defaultScientistContext(): Record<string, unknown> {
    return { widget: this.id };
  }
}
```

The `widget-permissions` and `widget-destruction` experiments will both have a `widget` key in their contexts.
`withScience` classes support the same override. The standalone `run` / `science` functions and `Scientist.run` have no
default context.

Note that `widget-destruction` is a poor experiment in real life, because it changes data; see
[Designing an experiment](designing-experiments.md).
