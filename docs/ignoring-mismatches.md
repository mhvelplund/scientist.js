# Ignoring mismatches

[Back to the documentation index](index.md)

During the early stages of an experiment, it's possible that some of your code will always generate a mismatch for
reasons you know and understand but haven't yet fixed. Instead of these known cases always showing up as mismatches in
your metrics or analysis, you can tell an experiment whether or not to ignore a mismatch using the `ignore` method. You
may register more than one callback if needed:

```ts
function isAdmin(user: User): boolean {
  return run<boolean>("widget-permissions", (e) => {
    e.use(() => model.checkUser(user).admin);
    e.try(() => user.can("admin", model));

    e.ignore(() => user.staff); // user is staff, always an admin in the new system
    e.ignore((control, candidate) => {
      // new system doesn't handle unconfirmed users yet:
      return Boolean(control && !candidate && !user.confirmedEmail);
    });
  });
}
```

Ignore callbacks receive the control **value** and the candidate **value** (not the observations). When a behavior
threw, its value is `undefined`. The callbacks are tried in registration order; the first one to return a truthy value
wins.

The ignore callbacks are only called if the observations don't match. Unless a `compareErrors` comparator is defined,
two cases are considered mismatches: a) one behavior throwing and the other not, b) both throwing errors with different
classes or messages.

An ignored candidate is moved from `result.mismatchedObservations` to `result.ignoredObservations`. For such a result:

```ts
result.matched(); // false: something didn't match
result.mismatched(); // false: but no mismatch is left unexplained
result.ignored(); // true
```

If an ignore callback throws, the error goes to `raised("ignore", error)` and that callback counts as "not ignored". In
`runAsync` ignore callbacks may be `async`.

## Breaking the rules: ignoring results entirely

Science is useful even when all you care about is the timing data, or even whether or not a new code path blew up. If
you can incrementally control how often an experiment runs via your `enabled()` method, you can use it to silently and
carefully test new code paths and ignore the results altogether. You can do this with `ignore(() => true)` or, for
greater efficiency, `compare(() => true)`:

```ts
run<number>("timing-only", (e) => {
  e.use(() => legacyComputation());
  e.try(() => newComputation());
  e.compare(() => true);
});
```

This will still report a mismatch if a behavior throws (the comparator isn't consulted when one side threw), but it
disregards the values entirely.

Keep in mind when [finishing an experiment](designing-experiments.md#finishing-an-experiment) that any ignore callback
means the candidate behavior is *guaranteed* to be different.
