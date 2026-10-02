# Cleaning values

[Back to the documentation index](index.md)

Sometimes you don't want to store the full value for later analysis. For example, an experiment may return `User`
instances, but when researching a mismatch, all you care about is the logins. You can define how to clean these values
in an experiment:

```ts
class MyWidget extends Scientist {
  users(): User[] {
    return this.science<User[]>("users", (e) => {
      e.use(() => User.all());
      e.try(() => UserService.list());

      e.clean((users) => users.map((u) => u.login).sort());
    });
  }
}
```

The cleaned value is available on observations in the published result:

```ts
class MyExperiment<T = unknown> extends Experiment<T> {
  // ...
  publish(result: Result<T>): void {
    result.control?.value; // [User alice, User bob, User carol]
    result.control?.cleanedValue; // ["alice", "bob", "carol"]
  }
}
```

Details:

- `cleanedValue` is a getter that calls the cleaner each time it is read. `null` and `undefined` values are returned as
  they are, without calling the cleaner.
- The cleaner must be synchronous, even in `runAsync`.
- If the cleaner throws, the error goes to `raised("clean", error)` and the raw value is used instead.
- Calling `clean` again replaces the previous cleaner. The currently configured cleaner is available as
  `experiment.cleaner`, and `experiment.cleanValue(value)` applies it. *(This probably won't come up in normal usage,
  but comes in handy if you're writing, say, a custom experiment runner that provides default cleaners.)*
- `MismatchError` messages show cleaned values.

The cleaner is **not** used for comparison. In the following example it is not possible to remove the `compare` callback
without the experiment mismatching:

```ts
run<number[]>("user-ids", (e) => {
  e.use(() => [1, 2, 3]);
  e.try(() => [1, 3, 2]);
  e.clean((value) => [...value].sort());
  e.compare((a, b) => defaultEquals([...a].sort(), [...b].sort()));
});
```
