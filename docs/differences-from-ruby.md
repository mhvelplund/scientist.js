# Differences from Ruby Scientist

[Back to the documentation index](index.md)

This port follows the behavior of [github/scientist](https://github.com/github/scientist) as closely as JavaScript
allows. This page lists every intentional difference.

## Naming

Ruby's `snake_case` becomes `camelCase`, and predicate methods (`?`) lose their question mark.

| Ruby                                                             | JavaScript / TypeScript                                                                                      |
|------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `include Scientist` / `science "name" do \|e\| ... end`          | `class X extends Scientist` (or `withScience(Base)`) / `this.science("name", (e) => { ... })`                |
| `Scientist.run "name" do ... end`                                | `Scientist.run("name", (e) => { ... })`, or the `run` / `science` functions                                  |
| `include Scientist::Experiment`                                  | `class X extends Experiment`                                                                                 |
| `Scientist::Default`                                             | `DefaultExperiment` (alias `Default`)                                                                        |
| `Scientist::Experiment.set_default(klass)`                       | `Experiment.setDefault(klass)`; `null` restores the default                                                  |
| `Scientist::Experiment.new(name)` (factory)                      | `Experiment.create(name)`                                                                                    |
| `enabled?`                                                       | `enabled()`                                                                                                  |
| `e.use { }` / `e.try("name") { }`                                | `e.use(() => ...)` / `e.try("name", () => ...)`                                                              |
| `before_run`, `after_run`, `run_if`                              | `beforeRun`, `afterRun`, `runIf`                                                                             |
| `compare_errors`                                                 | `compareErrors`                                                                                              |
| `raise_with`                                                     | `raiseWith`                                                                                                  |
| `raise_on_mismatches` (class attribute)                          | static `Klass.raiseOnMismatches` and instance `raiseOnMismatches`                                            |
| `raise_on_mismatches?`                                           | `shouldRaiseOnMismatches()`                                                                                  |
| `should_experiment_run?`                                         | `shouldExperimentRun()`                                                                                      |
| `run_if_block_allows?`                                           | `runIfBlockAllows()`                                                                                         |
| `observations_are_equivalent?(a, b)`                             | `observationsAreEquivalent(a, b)`                                                                            |
| `ignore_mismatched_observation?(c, cand)`                        | `ignoreMismatchedObservation(c, cand)`                                                                       |
| `generate_result(name)`                                          | `generateResult(name)`                                                                                       |
| `clean_value(v)`                                                 | `cleanValue(v)`                                                                                              |
| `fabricate_durations_for_testing_purposes`                       | `fabricateDurationsForTestingPurposes`                                                                       |
| `default_scientist_context`                                      | `defaultScientistContext()`                                                                                  |
| `science "name", run: "x"`                                       | `science("name", configure, { run: "x" })`                                                                   |
| `result.matched?` / `mismatched?` / `ignored?`                   | `result.matched()` / `mismatched()` / `ignored()`                                                            |
| `result.mismatched` / `result.ignored` (arrays)                  | `result.mismatchedObservations` / `result.ignoredObservations`                                               |
| `result.experiment_name`                                         | `result.experimentName`                                                                                      |
| `observation.raised?`                                            | `observation.raised` (a boolean property)                                                                    |
| `observation.cpu_time`                                           | `observation.cpuTime`                                                                                        |
| `observation.cleaned_value`                                      | `observation.cleanedValue` (a getter)                                                                        |
| `observation.equivalent_to?(other, ...)`                         | `observation.equivalentTo(other, ...)`                                                                       |
| `Scientist::Observation::RESCUES`                                | `Observation.rescues` (a predicate function)                                                                 |
| `Scientist::Experiment::MismatchError#name`                      | `MismatchError#experimentName`                                                                               |
| `Scientist::BadBehavior#name`                                    | `BadBehaviorError#behaviorName` (also `#experiment`)                                                         |
| `BadBehavior`, `BehaviorMissing`, `BehaviorNotUnique`, `NoValue` | `...Error` classes, with the Ruby names exported as aliases                                                  |
| `raised(:publish, error)` symbols                                | `raised("publish", error)` strings: `"clean"`, `"compare"`, `"enabled"`, `"ignore"`, `"publish"`, `"run_if"` |

## Behavior

- **Behaviors must be functions.** Ruby's `try`/`use` take a block. Passing anything other than a function to `use` or
  `try` throws a `TypeError`.
- **No adding behaviors after a run.** Ruby freezes the behaviors and raises `FrozenError`. Here `use`/`try` after the
  experiment has run throw a `TypeError`.
- **No modifying the context after a run.** `context(data)` after the experiment has run throws a `TypeError`. Reading
  it with `context()` still works.
- **No auto-registration.** Including `Scientist::Experiment` in a Ruby class calls `set_default` automatically.
  Subclassing `Experiment` does nothing: call `Experiment.setDefault(MyExperiment)` yourself.
- **No constructor block.** Ruby's `MyExperiment.new("name") { |e| ... }` doesn't exist; create the experiment,
  configure it, then call `run(name)`. See [Multiple candidates](multiple-candidates.md#no-control-just-candidates).
- **`MismatchError` is a normal `Error`.** In Ruby it inherits from `Exception`, so a bare `rescue` doesn't catch it.
  JavaScript has no such split, so a `catch` in the code under test *will* catch it.
- **Static `raiseOnMismatches` is inherited.** Setting `MyExperiment.raiseOnMismatches = true` also affects subclasses
  of `MyExperiment` that don't set their own value. There is also an instance property that overrides the class value.
- **Fabricated durations.** An entry without a CPU time reports `cpuTime` as `0` (Ruby: `nil`). Both `cpuTime` and
  `cpu_time` keys are accepted, and a bare number sets the duration.
- **No `Exception` / `StandardError` split.** Anything can be thrown in JavaScript, and everything is captured by
  default. `Observation.rescues` is a predicate rather than a list of classes.
- **Default comparison.** Ruby uses `==`; this port uses [`defaultEquals`](comparing-results.md), a structural
  comparison of arrays, plain objects, `Map`, `Set`, `Date`, `RegExp` and typed arrays, an `equals()` method when
  present, and identity for other objects.
- **Error comparison.** Two thrown values are equivalent by default when they have the same prototype and the same
  `message`, the closest analogue of Ruby's class-and-message comparison.
- **Truthiness.** Results of `enabled`, `runIf`, `compare`, `compareErrors` and `ignore` are interpreted with JavaScript
  truthiness: `0`, `""` and `NaN` are false here, but true in Ruby.
- **CPU time.** Measured with `process.cpuUsage()` where available (Node.js). It is `0` in browsers and other runtimes
  without it. Because it is process CPU time, in async experiments it also includes other work interleaved on the event
  loop while a behavior awaits.
- **Async support.** Everything about promises is new in this port: `runAsync`, `scienceAsync`, `Scientist.runAsync`,
  and the rules for promises in synchronous runs. See [Async](async.md).
- **`NoValueError`** is exported for parity, but never thrown.
