import { BehaviorMissingError, BehaviorNotUniqueError, MismatchError } from "./errors";
import { behaviorValue, hookValue, isThenable, runAsync, runSync, type Steps } from "./internal";
import {
  buildObservation,
  type Comparator,
  type ErrorComparator,
  equivalentSteps,
  type FabricatedDuration,
  type Observation,
  observeSteps,
} from "./observation";
import { type Result, resultSteps } from "./result";

/** A behavior: the code under experiment. */
export type Behavior<T> = () => T | PromiseLike<T>;

/** The operations whose errors are routed to `Experiment#raised`. */
export type RaisedOperation = "clean" | "compare" | "enabled" | "ignore" | "publish" | "run_if";

/** Decides whether a mismatched candidate should be ignored. Receives values, not observations. */
export type IgnoreCallback<T> = (
  controlValue: T | undefined,
  candidateValue: T | undefined,
) => boolean | PromiseLike<boolean>;

/** A class that can be instantiated as an experiment, see `Experiment.setDefault`. */
// biome-ignore lint/suspicious/noExplicitAny: experiment classes may use any value type
export type ExperimentClass = new (name: string) => Experiment<any>;

/** An error class thrown on mismatches, see `Experiment#raiseWith`. */
// biome-ignore lint/suspicious/noExplicitAny: any result type is accepted
export type MismatchErrorClass = new (experimentName: string, result: Result<any>) => unknown;

interface ExperimentState<T> {
  behaviors: Map<string, Behavior<T>>;
  frozen: boolean;
  context: Record<string, unknown> | undefined;
  comparator: Comparator<T> | undefined;
  errorComparator: ErrorComparator | undefined;
  cleaner: ((value: T) => unknown) | undefined;
  ignores: IgnoreCallback<T>[];
  runIf: (() => unknown) | undefined;
  beforeRun: (() => unknown) | undefined;
  afterRun: ((result: Result<T>) => unknown) | undefined;
  mismatchError: MismatchErrorClass | undefined;
  fabricated: Record<string, FabricatedDuration> | undefined;
}

const states = new WeakMap<object, ExperimentState<never>>();

function stateOf<T>(experiment: Experiment<T>): ExperimentState<T> {
  let state = states.get(experiment) as unknown as ExperimentState<T> | undefined;
  if (!state) {
    state = {
      behaviors: new Map(),
      frozen: false,
      context: undefined,
      comparator: undefined,
      errorComparator: undefined,
      cleaner: undefined,
      ignores: [],
      runIf: undefined,
      beforeRun: undefined,
      afterRun: undefined,
      mismatchError: undefined,
      fabricated: undefined,
    };
    states.set(experiment, state as unknown as ExperimentState<never>);
  }
  return state;
}

let defaultClass: ExperimentClass | null = null;

/**
 * Shared behavior for experiments. Subclasses must implement `enabled()` and
 * `publish(result)`, and usually override `raised(operation, error)`.
 *
 * `T` is the type of value the behaviors return.
 */
export abstract class Experiment<T = unknown> {
  /**
   * Class-wide default for `raiseOnMismatches`, used when the instance value
   * is `undefined`. Set it on your own subclass, e.g. in test setup:
   * `MyExperiment.raiseOnMismatches = true`.
   */
  static raiseOnMismatches: boolean | undefined;

  /** The name of this experiment. Defaults to `"experiment"`. */
  name: string;

  /**
   * Whether to throw a `MismatchError` when the control and a candidate
   * mismatch. If `undefined`, the class-level `raiseOnMismatches` is used.
   */
  raiseOnMismatches: boolean | undefined;

  constructor(name?: string) {
    this.name = name ?? "experiment";
  }

  /**
   * Set the class used by `Experiment.create` (and therefore by `Scientist.run`
   * and `science`). Pass `null` to restore `DefaultExperiment`.
   */
  static setDefault(klass: ExperimentClass | null): void {
    defaultClass = klass;
  }

  /** Instantiate a new experiment using the class given to `Experiment.setDefault`. */
  static create<T = unknown>(name: string): Experiment<T> {
    return new (defaultClass ?? DefaultExperiment)(name) as Experiment<T>;
  }

  /**
   * Is this experiment enabled? When it returns false, only the requested
   * behavior (default `"control"`) runs. May return a promise in `runAsync`.
   */
  abstract enabled(): boolean | PromiseLike<boolean>;

  /** Publish the result of a run. May return a promise. */
  abstract publish(result: Result<T>): void | PromiseLike<void>;

  /**
   * Called when a callback throws while running an internal operation. The
   * default implementation re-throws the error. Override it to track errors.
   */
  raised(_operation: RaisedOperation, error: unknown): void {
    throw error;
  }

  /** The registered behaviors, keyed by name, in registration order. */
  get behaviors(): ReadonlyMap<string, Behavior<T>> {
    return stateOf(this).behaviors;
  }

  /** Register the control behavior. */
  use(block: Behavior<T>): Behavior<T> {
    return this.try("control", block);
  }

  /** Register a candidate behavior, named `"candidate"` unless a name is given. */
  try(block: Behavior<T>): Behavior<T>;
  try(name: string, block: Behavior<T>): Behavior<T>;
  try(nameOrBlock: string | Behavior<T>, maybeBlock?: Behavior<T>): Behavior<T> {
    const [name, block] =
      typeof nameOrBlock === "function" ? [undefined, nameOrBlock] : [nameOrBlock, maybeBlock];
    const key = String(name ?? "candidate");
    const state = stateOf(this);

    if (state.behaviors.has(key)) throw new BehaviorNotUniqueError(this, key);
    if (state.frozen) {
      throw new TypeError(`can't add behavior ${key} to experiment ${this.name} after it has run`);
    }
    if (typeof block !== "function") {
      throw new TypeError(`behavior ${key} of experiment ${this.name} must be a function`);
    }

    state.behaviors.set(key, block);
    return block;
  }

  /** Run a callback before the behaviors, only when the experiment runs. */
  beforeRun<F extends () => unknown>(block: F): F {
    stateOf(this).beforeRun = block;
    return block;
  }

  /** Run a callback with the result after the behaviors, before publishing. */
  afterRun<F extends (result: Result<T>) => unknown>(block: F): F {
    stateOf(this).afterRun = block;
    return block;
  }

  /** Clean observed values for publishing. Must be synchronous. Not used for comparison. */
  clean<F extends (value: T) => unknown>(block: F): F {
    stateOf(this).cleaner = block;
    return block;
  }

  /** The configured clean callback, if any. */
  get cleaner(): ((value: T) => unknown) | undefined {
    return stateOf(this).cleaner;
  }

  /** Clean a value with the clean callback. Errors go to `raised("clean", ...)`. */
  cleanValue(value: T): unknown {
    const cleaner = stateOf(this).cleaner;
    try {
      return cleaner ? cleaner(value) : value;
    } catch (error) {
      this.raised("clean", error);
      return value;
    }
  }

  /** Compare control and candidate values with a custom callback. */
  compare<F extends Comparator<T>>(block: F): F {
    stateOf(this).comparator = block;
    return block;
  }

  /** Compare control and candidate errors with a custom callback. */
  compareErrors<F extends ErrorComparator>(block: F): F {
    stateOf(this).errorComparator = block;
    return block;
  }

  /** Merge extra data into the experiment's context and return it. */
  context(context?: Record<string, unknown> | null): Record<string, unknown> {
    const state = stateOf(this);
    state.context ??= {};
    if (context !== undefined && context !== null) {
      if (Object.isFrozen(state.context)) {
        throw new TypeError(`can't modify the context of experiment ${this.name} after it has run`);
      }
      Object.assign(state.context, context);
    }
    return state.context;
  }

  /** Ignore mismatches for which the callback returns true. May be called more than once. */
  ignore<F extends IgnoreCallback<T>>(block: F): F {
    stateOf(this).ignores.push(block);
    return block;
  }

  /** Should a mismatched candidate be ignored? (Ruby: `ignore_mismatched_observation?`) */
  ignoreMismatchedObservation(
    control: Observation<T> | undefined,
    candidate: Observation<T>,
  ): boolean {
    return runSync(ignoreMismatchedObservationSteps(this, control, candidate, false));
  }

  /** Compare two observations with the configured comparators. (Ruby: `observations_are_equivalent?`) */
  observationsAreEquivalent(a: Observation<T> | undefined, b: Observation<T>): boolean {
    return runSync(observationsAreEquivalentSteps(this, a, b, false));
  }

  /** Throw instances of this class instead of `MismatchError`. */
  raiseWith(errorClass: MismatchErrorClass): MismatchErrorClass {
    stateOf(this).mismatchError = errorClass;
    return errorClass;
  }

  /** Whether a mismatch will throw. (Ruby: `raise_on_mismatches?`) */
  shouldRaiseOnMismatches(): boolean {
    if (this.raiseOnMismatches === undefined || this.raiseOnMismatches === null) {
      return Boolean((this.constructor as typeof Experiment).raiseOnMismatches);
    }
    return Boolean(this.raiseOnMismatches);
  }

  /** Only run the experiment when the callback returns true. */
  runIf<F extends () => unknown>(block: F): F {
    stateOf(this).runIf = block;
    return block;
  }

  /** Does the `runIf` callback allow the experiment to run? (Ruby: `run_if_block_allows?`) */
  runIfBlockAllows(): boolean {
    return runSync(runIfBlockAllowsSteps(this, false));
  }

  /** Should the experiment run? (Ruby: `should_experiment_run?`) */
  shouldExperimentRun(): boolean {
    return runSync(shouldExperimentRunSteps(this, false));
  }

  /** Use fake timing data per behavior name instead of measuring. For tests and tooling. */
  fabricateDurationsForTestingPurposes(fabricated: Record<string, FabricatedDuration> = {}): void {
    stateOf(this).fabricated = fabricated;
  }

  /** Run every behavior, in random order, and build the result. */
  generateResult(name: string): Result<T> {
    return runSync(generateResultSteps(this, name, false));
  }

  /**
   * Run the experiment synchronously and return the value of the named behavior
   * (default `"control"`), or throw what it threw.
   *
   * Behaviors and callbacks must be synchronous; use `runAsync` otherwise.
   */
  run(name?: string | null): T {
    return runSync(runSteps(this, name, false));
  }

  /**
   * Run the experiment, awaiting each behavior in turn (never concurrently) and
   * every callback, and resolve with the value of the named behavior.
   */
  runAsync(name?: string | null): Promise<T> {
    return runAsync(runSteps(this, name, true));
  }

  /** Shuffle behavior names into execution order. Override for deterministic ordering. */
  protected shuffle(names: string[]): string[] {
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j] as string, names[i] as string];
    }
    return names;
  }
}

/** The experiment used when no other default is set. It is never enabled and publishes nothing. */
export class DefaultExperiment<T = unknown> extends Experiment<T> {
  constructor(name: string) {
    super(name);
  }

  enabled(): boolean {
    return false;
  }

  publish(_result: Result<T>): void {}
}

function* runSteps<T>(
  experiment: Experiment<T>,
  requested: string | null | undefined,
  isAsync: boolean,
): Steps<T> {
  const state = stateOf(experiment);
  state.frozen = true;
  Object.freeze(experiment.context());

  const name = String(requested ?? "control");
  const block = state.behaviors.get(name);
  if (!block) throw new BehaviorMissingError(experiment, name);

  if (!(yield* shouldExperimentRunSteps(experiment, isAsync))) {
    return (yield* behaviorValue(block(), isAsync)) as T;
  }

  if (state.beforeRun) yield* hookValue(state.beforeRun(), isAsync, "beforeRun");

  const result = yield* generateResultSteps(experiment, name, isAsync);

  if (state.afterRun) yield* hookValue(state.afterRun(result), isAsync, "afterRun");

  try {
    const published = experiment.publish(result);
    if (isAsync) {
      yield published;
    } else if (isThenable(published)) {
      // A sync run can't wait for an async publish; still report its failure.
      Promise.resolve(published).catch((error) => experiment.raised("publish", error));
    }
  } catch (error) {
    experiment.raised("publish", error);
  }

  if (experiment.shouldRaiseOnMismatches() && result.mismatched()) {
    throw new (state.mismatchError ?? MismatchError)(experiment.name, result);
  }

  const control = result.control as Observation<T>;
  if (control.raised) throw control.exception;
  return control.value as T;
}

function* generateResultSteps<T>(
  experiment: Experiment<T>,
  name: string,
  isAsync: boolean,
): Steps<Result<T>> {
  const state = stateOf(experiment);
  const names = (experiment as unknown as { shuffle(n: string[]): string[] }).shuffle([
    ...state.behaviors.keys(),
  ]);

  const observations: Observation<T>[] = [];
  for (const key of names) {
    const block = state.behaviors.get(key) as Behavior<T>;
    const observed = yield* observeSteps(block, state.fabricated?.[key], isAsync);
    observations.push(buildObservation(key, experiment, observed));
  }

  const control = observations.find((o) => o.name === name);
  return yield* resultSteps(experiment, observations, control, isAsync);
}

function* shouldExperimentRunSteps<T>(experiment: Experiment<T>, isAsync: boolean): Steps<boolean> {
  try {
    if (stateOf(experiment).behaviors.size <= 1) return false;
    if (!(yield* hookValue(experiment.enabled(), isAsync, "enabled"))) return false;
    return yield* runIfBlockAllowsSteps(experiment, isAsync);
  } catch (error) {
    experiment.raised("enabled", error);
    return false;
  }
}

function* runIfBlockAllowsSteps<T>(experiment: Experiment<T>, isAsync: boolean): Steps<boolean> {
  const runIf = stateOf(experiment).runIf;
  try {
    return runIf ? Boolean(yield* hookValue(runIf(), isAsync, "runIf")) : true;
  } catch (error) {
    experiment.raised("run_if", error);
    return false;
  }
}

/** @internal */
export function* observationsAreEquivalentSteps<T>(
  experiment: Experiment<T>,
  a: Observation<T> | undefined,
  b: Observation<T>,
  isAsync: boolean,
): Steps<boolean> {
  const state = stateOf(experiment);
  try {
    if (!a) throw new TypeError(`experiment ${experiment.name} has no control observation`);
    return yield* equivalentSteps(a, b, state.comparator, state.errorComparator, isAsync);
  } catch (error) {
    experiment.raised("compare", error);
    return false;
  }
}

/** @internal */
export function* ignoreMismatchedObservationSteps<T>(
  experiment: Experiment<T>,
  control: Observation<T> | undefined,
  candidate: Observation<T>,
  isAsync: boolean,
): Steps<boolean> {
  for (const ignore of stateOf(experiment).ignores) {
    let ignored: unknown;
    try {
      ignored = yield* hookValue(ignore(control?.value, candidate.value), isAsync, "ignore");
    } catch (error) {
      experiment.raised("ignore", error);
      ignored = false;
    }
    if (ignored) return true;
  }
  return false;
}
