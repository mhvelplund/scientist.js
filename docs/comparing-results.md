# Comparing results

[Back to the documentation index](index.md)

Every candidate is compared to the control. A candidate that doesn't match (and isn't
[ignored](ignoring-mismatches.md)) ends up in `result.mismatchedObservations`.

## The default comparison: `defaultEquals`

Ruby Scientist compares values with `==`. JavaScript has no such operator for structures, so values are compared with
the exported `defaultEquals(a, b)`, which approximates Ruby's `==`:

- Primitives are compared with `===`. Like Ruby, `NaN` is not equal to `NaN`, and `1` is not equal to `"1"`.
- An object that has an `equals(other)` method is compared with it.
- Arrays, typed arrays, plain objects (and `Object.create(null)` objects), `Map`, `Set`, `Date` and `RegExp` are
  compared structurally (deeply). Both sides must have the same prototype. Cycles are handled.
- Any other object, such as an instance of your own class without `equals`, is compared by identity.

```ts
import { defaultEquals } from "@mhvelplund/scientist";

defaultEquals({ a: [1, 2] }, { a: [1, 2] }); // true
defaultEquals(new Set([1, 2]), new Set([2, 1])); // true
defaultEquals(new Date(0), new Date(0)); // true
defaultEquals(Number.NaN, Number.NaN); // false

class Point {
  constructor(readonly x: number, readonly y: number) {}
}
defaultEquals(new Point(1, 2), new Point(1, 2)); // false: different instances

class Money {
  constructor(readonly cents: number) {}
  equals(other: unknown): boolean {
    return other instanceof Money && other.cents === this.cents;
  }
}
defaultEquals(new Money(5), new Money(5)); // true: uses equals()
```

## Custom comparison: `compare`

To override the comparison, use `compare` to define how to compare observed values. The callback receives the control
value first, then the candidate value:

```ts
class MyWidget extends Scientist {
  users(): User[] {
    return this.science<User[]>("users", (e) => {
      e.use(() => User.all()); // returns User instances
      e.try(() => UserService.list()); // returns UserService.User instances

      e.compare(
        (control, candidate) =>
          control.map((u) => u.login).join() === candidate.map((u) => u.login).join(),
      );
    });
  }
}
```

`compare` is only used when neither behavior threw. Calling it again replaces the previous comparator. If the comparator
throws, the error goes to `raised("compare", error)` and the candidate counts as a mismatch. In `runAsync` the
comparator may be `async`; in a synchronous `run` it must not return a promise (see [Async](async.md)).

## Comparing errors: `compareErrors`

If either the control or the candidate throws, Scientist by default considers them equivalent only if **both** threw,
the thrown values have the same class (prototype) and the same `message`. To override this behavior, use
`compareErrors`. It receives the control's error and the candidate's error; one of them is `undefined` when only the
other behavior threw.

```ts
const sameClassAndMessage = (control: unknown, candidate: unknown) =>
  control instanceof Error &&
  candidate instanceof Error &&
  control.constructor === candidate.constructor &&
  control.message === candidate.message;

const knownRewording = (control: unknown, candidate: unknown) =>
  control instanceof TypeError &&
  candidate instanceof TypeError &&
  control.message.startsWith("Input has invalid characters") &&
  candidate.message.startsWith("Invalid characters in input");

const slug = run<string>("slug-from-login", (e) => {
  e.use(() => User.slugFromLogin(login)); // returns a string or throws TypeError
  e.try(() => UserService.slugFromLogin(login)); // returns a string or throws TypeError

  e.compareErrors(
    (control, candidate) =>
      sameClassAndMessage(control, candidate) || knownRewording(control, candidate),
  );
});
```

Remember that if the control throws, `run` re-throws that error after publishing, exactly as the original code would
have.

## Comparing observations directly

`Observation#equivalentTo(other, comparator?, errorComparator?)` and `Experiment#observationsAreEquivalent(a, b)` expose
the same logic, which is handy in custom publishers and tests:

```ts
result.control?.equivalentTo(result.candidates[0]); // true or false
```
