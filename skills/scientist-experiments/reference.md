# `@mhvelplund/scientist` reference

## Exports

```ts
import {
  Experiment, // abstract base: implement enabled() and publish()
  DefaultExperiment, // never enabled, never publishes (alias: Default)
  Scientist, // base class with this.science / this.scienceAsync, plus static run / runAsync
  withScience, // mixin: class X extends withScience(Base)
  run, runAsync, science, scienceAsync, // standalone runners (science === run)
  Observation, Result, defaultEquals,
  MismatchError, BadBehaviorError, BehaviorMissingError, BehaviorNotUniqueError, NoValueError,
  type RaisedOperation, type RunOptions, type Comparator, type ErrorComparator,
} from "@mhvelplund/scientist";
```

The Ruby names `BadBehavior`, `BehaviorMissing`, `BehaviorNotUnique` and `NoValue` are exported as aliases.

## Experiment statics and lifecycle

- `Experiment.setDefault(Klass)` registers the default class. `Experiment.setDefault(null)` restores
  `DefaultExperiment`.
- `Experiment.create(name)` creates an instance of the default class. If you write a custom constructor, keep `name`
  as its first parameter.
- `run(name?)` / `runAsync(name?)` runs the named behavior as the control (default `"control"`) and returns its value.
- Once it has run, the experiment is frozen: `use`, `try` and `context(data)` throw `TypeError`. Reading with
  `context()` still works.
- `shouldExperimentRun()` and `runIfBlockAllows()` expose the run decision. Both are sync.
- `experiment.behaviors` is a read-only `Map` of name to function, in registration order.
- `experiment.cleaner` and `experiment.cleanValue(v)` expose the cleaner.

Order of a run: check whether the experiment runs (at least 2 behaviors, then `enabled()`, then `runIf`) → `beforeRun` →
run behaviors in shuffled order → compare each candidate with the control → `ignore` callbacks for mismatches →
`afterRun(result)` → `publish(result)` → throw `MismatchError` if `raiseOnMismatches` and there are unignored
mismatches → return the control's value, or re-throw the control's error.

## Result

| Member | Meaning |
|---|---|
| `experiment`, `experimentName`, `context` | Which experiment ran, with what context |
| `observations` | Every observation, in execution order |
| `control` | Observation of the behavior that was run as the control (`Observation \| undefined`) |
| `candidates` | All other observations |
| `mismatchedObservations` | Candidates that didn't match and weren't ignored |
| `ignoredObservations` | Candidates that didn't match but were ignored |
| `matched()` | No mismatches **and** nothing ignored |
| `mismatched()` | At least one unignored mismatch |
| `ignored()` | At least one ignored mismatch |

## Observation

| Member | Meaning |
|---|---|
| `name` | `"control"`, `"candidate"` or the name passed to `try` |
| `value` | Return value (resolved value in async runs), when it didn't throw |
| `raised` | `true` if it threw or rejected (a boolean property, not a method) |
| `exception` | The thrown value |
| `cleanedValue` | `value` passed through the cleaner (a getter, recomputed on each read; `null`/`undefined` pass through) |
| `duration` | Wall time in **seconds** |
| `cpuTime` | Process CPU time in seconds; `0` in browsers. Approximate in async runs |
| `equivalentTo(other, comparator?, errorComparator?)` | Same comparison logic the experiment uses |

`Observation.rescues = (error) => boolean` is a global predicate. Errors it rejects are not captured; they propagate
straight out of the run. The default captures everything.

## `raised(operation, error)`

The default re-throws. Override it to log and continue. It must be synchronous.

| Operation | Source | After `raised` returns |
|---|---|---|
| `"clean"` | `clean` callback | the raw value is used |
| `"compare"` | `compare` / `compareErrors` | the candidate counts as mismatched |
| `"enabled"` | `enabled()` | only the control runs |
| `"ignore"` | an `ignore` callback | that callback counts as not ignoring |
| `"publish"` | `publish()`, including an async rejection | the run continues |
| `"run_if"` | `runIf` callback (snake_case, for Ruby parity) | only the control runs |

Errors in `beforeRun` and `afterRun` are **not** routed to `raised`. They propagate to the caller. Configuration errors
(`BehaviorMissingError`, `BehaviorNotUniqueError`, `TypeError`) are thrown directly. `BadBehaviorError` and its
subclasses expose `experiment` and `behaviorName`.

## `defaultEquals(a, b)`

- Primitives: `===`. `NaN !== NaN`, and `1 !== "1"`.
- An object with an `equals(other)` method is compared with it.
- Arrays, typed arrays, plain and null-prototype objects, `Map`, `Set`, `Date` and `RegExp` are compared deeply. Both
  sides need the same prototype. Cycles are handled.
- Every other object is compared by identity.
- `compare` is only used when neither side threw. `compareErrors` receives `undefined` for the side that didn't throw.

## Multiple candidates and control-less experiments

```ts
run<boolean>("widget-permissions", (e) => {
  e.use(() => oldCheck());
  e.try("api", () => viaApi());
  e.try("sql", () => viaSql());
}); // publishers should iterate result.candidates, not just [0]

// No control: pick which candidate plays the control
run<string>(
  "various-ways",
  (e) => {
    e.try("first-way", () => firstWay());
    e.try("second-way", () => secondWay());
  },
  { run: "first-way" },
);
```

## Testing helpers

- `Klass.raiseOnMismatches = true` (static, inherited by subclasses) or `instance.raiseOnMismatches = true|false`
  (overrides the class). `shouldRaiseOnMismatches()` returns the effective value.
- `MismatchError` has `experimentName`, `result` and a lazily built `message`. Subclass it and override
  `formatMessage(summary)` or `formatObservation(observation)`, then pass the class to `e.raiseWith(MyError)`. It is
  constructed as `new MyError(experimentName, result)`.
- `e.fabricateDurationsForTestingPurposes({ control: { duration: 1, cpuTime: 0.9 }, candidate: 0.5 })` sets fixed
  timings. Keys are behavior names. A bare number sets only the duration.
- Override `protected shuffle(names: string[]): string[]` for a deterministic order.

## Ruby → JS names

`science "x" do |e|` → `this.science("x", (e) => {...})` · `Scientist.run "x"` → `Scientist.run("x", ...)` ·
`enabled?` → `enabled()` · `run_if` → `runIf` · `before_run`/`after_run` → `beforeRun`/`afterRun` ·
`compare_errors` → `compareErrors` · `raise_with` → `raiseWith` · `raise_on_mismatches` → `raiseOnMismatches` ·
`result.matched?` → `result.matched()` · `result.mismatched` (array) → `result.mismatchedObservations` ·
`observation.raised?` → `observation.raised` · `cpu_time` → `cpuTime` · `cleaned_value` → `cleanedValue` ·
`Scientist::Experiment.set_default` → `Experiment.setDefault` · `Scientist::Experiment.new(name)` →
`Experiment.create(name)` · `default_scientist_context` → `defaultScientistContext()` · `science "x", run: "y"` →
`science("x", fn, { run: "y" })`.
