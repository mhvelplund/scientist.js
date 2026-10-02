import { defaultEquals } from "./equality";
import type { Experiment } from "./experiment";
import { behaviorValue, hookValue, runAsync, runSync, type Steps } from "./internal";
import { captureTimes } from "./timing";

/**
 * Fake timing data for an observation, see
 * `Experiment#fabricateDurationsForTestingPurposes`. A plain number sets the
 * duration and a CPU time of 0.
 */
export type FabricatedDuration = number | { duration: number; cpu_time?: number; cpuTime?: number };

/** Compares two observed values (control first, then candidate). */
export type Comparator<T> = (control: T, candidate: T) => boolean | PromiseLike<boolean>;

/**
 * Compares two thrown values (control first, then candidate). One side is
 * `undefined` when only the other behavior threw.
 */
export type ErrorComparator = (
  controlError: unknown,
  candidateError: unknown,
) => boolean | PromiseLike<boolean>;

export interface ObservationOptions {
  fabricatedDuration?: FabricatedDuration | undefined;
}

interface Observed<T> {
  value: T | undefined;
  exception: unknown;
  raised: boolean;
  duration: number;
  cpuTime: number;
}

/** What happened when a named behavior was executed. Immutable. */
export class Observation<T = unknown> {
  /**
   * Decides which thrown values are captured in an observation. Values it
   * rejects propagate out of the experiment run. Defaults to capturing
   * everything, like Ruby's `Scientist::Observation::RESCUES = [Exception]`.
   */
  static rescues: (error: unknown) => boolean = () => true;

  /** The name of the behavior. */
  readonly name!: string;
  /** The experiment this observation is for. */
  readonly experiment!: Experiment<T>;
  /** The value returned (or resolved, in async runs), if any. */
  readonly value!: T | undefined;
  /** The thrown value (or rejection reason), if any. Check `raised`. */
  readonly exception!: unknown;
  /** Whether the behavior threw (Ruby: `raised?`). */
  readonly raised!: boolean;
  /** Elapsed wall-clock time, in seconds. */
  readonly duration!: number;
  /** Elapsed process CPU time, in seconds (0 where unavailable). */
  readonly cpuTime!: number;

  /** Observe a synchronous behavior. */
  constructor(
    name: string,
    experiment: Experiment<T>,
    block: () => T,
    options: ObservationOptions = {},
  ) {
    initialize(
      this,
      name,
      experiment,
      runSync(observeSteps(block, options.fabricatedDuration, false)),
    );
  }

  /** Observe a behavior, awaiting its result. */
  static async createAsync<T>(
    name: string,
    experiment: Experiment<T>,
    block: () => T | PromiseLike<T>,
    options: ObservationOptions = {},
  ): Promise<Observation<T>> {
    const observed = await runAsync(observeSteps(block, options.fabricatedDuration, true));
    return buildObservation(name, experiment, observed);
  }

  /**
   * The value cleaned by the experiment's `clean` callback, suitable for
   * publishing. `null`/`undefined` values are returned without cleaning.
   */
  get cleanedValue(): unknown {
    if (this.value === null || this.value === undefined) return this.value;
    return this.experiment.cleanValue(this.value);
  }

  /**
   * Is this observation equivalent to another?
   *
   * - If either raised: `errorComparator(this.exception, other.exception)` when
   *   given, otherwise both must have thrown values of the same class with the
   *   same message.
   * - Otherwise: `comparator(this.value, other.value)` when given, otherwise the
   *   default deep equality.
   */
  equivalentTo(
    other: unknown,
    comparator?: Comparator<T> | null,
    errorComparator?: ErrorComparator | null,
  ): boolean {
    return runSync(equivalentSteps(this, other, comparator, errorComparator, false));
  }
}

function initialize<T>(
  target: Observation<T>,
  name: string,
  experiment: Experiment<T>,
  observed: Observed<T>,
): Observation<T> {
  Object.assign(target, { name, experiment, ...observed });
  return Object.freeze(target);
}

/** @internal Build an observation from already observed data. */
export function buildObservation<T>(
  name: string,
  experiment: Experiment<T>,
  observed: Observed<T>,
): Observation<T> {
  return initialize(
    Object.create(Observation.prototype) as Observation<T>,
    name,
    experiment,
    observed,
  );
}

/** @internal Run a behavior and capture its value or exception and timings. */
export function* observeSteps<T>(
  block: () => T | PromiseLike<T>,
  fabricated: FabricatedDuration | undefined,
  isAsync: boolean,
): Steps<Observed<T>> {
  const fabricate = fabricated !== undefined && fabricated !== null;
  const [startWall, startCpu] = fabricate ? [0, 0] : captureTimes();

  let value: T | undefined;
  let exception: unknown;
  let raised = false;
  try {
    value = (yield* behaviorValue(block(), isAsync)) as T;
  } catch (error) {
    if (!Observation.rescues(error)) throw error;
    exception = error;
    raised = true;
  }

  let duration: number;
  let cpuTime: number;
  if (typeof fabricated === "object" && fabricated !== null) {
    duration = fabricated.duration;
    cpuTime = fabricated.cpu_time ?? fabricated.cpuTime ?? 0;
  } else if (fabricate) {
    duration = fabricated as number;
    cpuTime = 0;
  } else {
    const [endWall, endCpu] = captureTimes();
    duration = endWall - startWall;
    cpuTime = endCpu - startCpu;
  }

  return { value, exception, raised, duration, cpuTime };
}

/** @internal Compare two observations, see `Observation#equivalentTo`. */
export function* equivalentSteps<T>(
  observation: Observation<T>,
  other: unknown,
  comparator: Comparator<T> | null | undefined,
  errorComparator: ErrorComparator | null | undefined,
  isAsync: boolean,
): Steps<boolean> {
  if (!(other instanceof Observation)) return false;

  if (observation.raised || other.raised) {
    if (errorComparator) {
      return Boolean(
        yield* hookValue(
          errorComparator(observation.exception, other.exception),
          isAsync,
          "compareErrors",
        ),
      );
    }
    return observation.raised && other.raised && sameError(observation.exception, other.exception);
  }

  if (comparator) {
    return Boolean(
      yield* hookValue(comparator(observation.value as T, other.value as T), isAsync, "compare"),
    );
  }
  return defaultEquals(observation.value, other.value);
}

/** Same class and same message, like Ruby's default exception comparison. */
function sameError(a: unknown, b: unknown): boolean {
  return errorClass(a) === errorClass(b) && errorMessage(a) === errorMessage(b);
}

function errorClass(error: unknown): unknown {
  if (error !== null && typeof error === "object") return Object.getPrototypeOf(error);
  return typeof error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
