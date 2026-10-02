# Testing

[Back to the documentation index](index.md)

When running your test suite, it's helpful to know that the experimental results always match. To help with testing,
experiments can throw a `MismatchError` whenever a candidate mismatches. Only do this in your test suite!

## `raiseOnMismatches`

Set the static property on your experiment class, for example in your test setup file:

```ts
import { MyExperiment } from "../src/my-experiment";

MyExperiment.raiseOnMismatches = true;
```

The static value is inherited by subclasses (unless a subclass sets its own). You can also set it per experiment
instance, which takes precedence over the class value:

```ts
const experiment = new MyExperiment<number>("widget-permissions");
experiment.raiseOnMismatches = true; // or false, to opt this one experiment out
experiment.shouldRaiseOnMismatches(); // true
```

`shouldRaiseOnMismatches()` returns the instance value when it is set, and the class value otherwise.

When raising is enabled and a run has unignored mismatches, the run throws a `MismatchError` **after** publishing:

```ts
import { MismatchError } from "@mhvelplund/scientist";

try {
  run<string>("widget-permissions", (e) => {
    e.use(() => "control");
    e.try(() => "candidate");
  });
} catch (error) {
  if (error instanceof MismatchError) {
    error.experimentName; // "widget-permissions"
    error.result; // the Result, see "Publishing results"
  }
}
```

Its `message` is a readable report of every observation (cleaned values, or the error and its stack):

```text
experiment 'widget-permissions' observations mismatched:
control:
  { admin: true }
candidate:
  [Error: not implemented]
    at ...
```

`MismatchError` is an ordinary `Error`, so a `catch` in the code under test can swallow it. Make sure your code doesn't
catch errors indiscriminately around experiments, or assert on published results instead.

## Custom mismatch errors: `raiseWith`

To throw a custom error instead of `MismatchError`, pass a class to `raiseWith`. It is constructed with
`(experimentName, result)`. Subclassing `MismatchError` is the easiest way; override `formatMessage(summary)` (or
`formatObservation(observation)`) to customize the message:

```ts
import { MismatchError } from "@mhvelplund/scientist";

class DiffMismatchError<T> extends MismatchError<T> {
  override formatMessage(summary: string): string {
    const control = this.result.control;
    const diffs = this.result.candidates
      .map((candidate) => diff(control?.value, candidate.value))
      .join("\n");
    return `There was a mismatch! Here's the diff:\n${diffs}`;
  }
}

run<Report>("widget-permissions", (e) => {
  e.use(() => Report.find(id));
  e.try(() => new ReportService().fetch(id));

  e.raiseWith(DiffMismatchError);
});
```

This allows for pre-processing of mismatch error messages. The message is built lazily, when it is first read.

## Providing fake timing data

If you're writing tests that depend on specific timing values, you can provide canned durations using
`fabricateDurationsForTestingPurposes`, and Scientist will report these in `Observation#duration` and
`Observation#cpuTime` instead of the actual execution times.

```ts
run<number>("absolutely-nothing-suspicious-happening-here", (e) => {
  e.use(() => compute()); // "control"
  e.try(() => compute2()); // "candidate"
  e.fabricateDurationsForTestingPurposes({
    control: { duration: 1.0, cpuTime: 0.9 },
    candidate: { duration: 0.5, cpuTime: 0.4 },
  });
});
```

The argument is an object keyed by behavior name. Each entry is either:

- `{ duration, cpuTime }` (the Ruby-style key `cpu_time` is accepted too); a missing CPU time is reported as `0`, or
- a plain number, used as the duration, with a CPU time of `0`.

By default the names are `"control"` and `"candidate"`; if you use [named candidates](multiple-candidates.md), use
matching names here. Behaviors without an entry report their real timings.

*This probably won't come up in normal usage. It's here to make it easier to test code that extends Scientist.*

## Deterministic execution order

Behaviors run in random order. If a test depends on the order, override the protected `shuffle` method in a test-only
subclass:

```ts
class OrderedExperiment<T> extends MyExperiment<T> {
  protected override shuffle(names: string[]): string[] {
    return names; // registration order
  }
}
```
