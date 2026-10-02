# Designing an experiment

[Back to the documentation index](index.md)

## What to experiment on

Because `enabled()` and `runIf` decide when a candidate runs, it's impossible to guarantee that it will run every time.
Candidates may also run before or after the control, and their results are thrown away. For these reasons, Scientist is
only safe for wrapping code that **doesn't change data**: reads, calculations, permission checks, rendering, and so on.

What has worked well for the original authors: modify both the existing and the new system together everywhere writes
happen, and verify the results at read time with an experiment. `raiseOnMismatches` (see [Testing](testing.md)) helps
ensure the correct data was written during tests, and reviewing published mismatches helps find situations you
overlooked with production data at run time. When writing to and reading from two systems, it's also useful to write
some data reconciliation scripts to verify and clean up production data alongside any running experiments.

## Noise and error rates

Behaviors run one after another, in random order. Any data your code depends on may change between the first and the
second behavior, which can produce a mismatch between the control and the candidate that has nothing to do with your
change (a [false positive mismatch](https://en.wikipedia.org/wiki/Type_I_and_type_II_errors)).

To calibrate your expectations for this kind of background noise, consider starting with an experiment in which both
`use` and `try` call the *control* code. Whatever mismatch rate that experiment reports is caused by the environment,
not by the new code. Then introduce the real candidate and compare.

```ts
// Step 1: measure the noise
run<Item[]>("dashboard-items", (e) => {
  e.use(() => legacyItems());
  e.try(() => legacyItems());
});

// Step 2: the real experiment
run<Item[]>("dashboard-items", (e) => {
  e.use(() => legacyItems());
  e.try(() => newItems());
});
```

This is even more pronounced in [async experiments](async.md), where a lot of other work can happen between one behavior
settling and the next starting.

## Finishing an experiment

As your candidate behavior converges on the control, you'll start thinking about removing the experiment and using the
new behavior.

- If there are any `ignore` callbacks, the candidate behavior is *guaranteed* to be different. If that is unacceptable,
  remove the ignore callbacks and resolve any ongoing mismatches until the observations match perfectly every time.
- When removing a read-side experiment, it's a good idea to keep any write-side duplication between the old and the new
  system in place until well after the new behavior has been in production, in case you need to roll back.

## Other advice

- Keep `enabled()` cheap; it runs on every call. See
  [Ramping up experiments](custom-experiments.md#ramping-up-experiments).
- Candidates add their full run time to the caller's latency. Start at a low percentage.
- Handle errors in `raised` instead of re-throwing in production (see [Error handling](error-handling.md)).
- Trying [several candidates](multiple-candidates.md) at once is possible but makes analysis harder.
