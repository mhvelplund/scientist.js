import type { Experiment } from "./experiment";
import { ignoreMismatchedObservationSteps, observationsAreEquivalentSteps } from "./experiment";
import { runAsync, runSync, type Steps } from "./internal";
import type { Observation } from "./observation";

interface Evaluated<T> {
  mismatchedObservations: readonly Observation<T>[];
  ignoredObservations: readonly Observation<T>[];
}

/** The immutable result of running an experiment. */
export class Result<T = unknown> {
  /** The experiment this result is for. */
  readonly experiment!: Experiment<T>;
  /** All observations, in execution order. */
  readonly observations!: readonly Observation<T>[];
  /** The observation every candidate is compared to. */
  readonly control!: Observation<T> | undefined;
  /** Every observation except the control, in execution order. */
  readonly candidates!: readonly Observation<T>[];
  /** Candidates that didn't match the control and were not ignored (Ruby: `mismatched`). */
  readonly mismatchedObservations!: readonly Observation<T>[];
  /** Candidates that didn't match the control but were ignored (Ruby: `ignored`). */
  readonly ignoredObservations!: readonly Observation<T>[];

  /**
   * Create a result, comparing every candidate to the control. Comparison and
   * ignore callbacks must be synchronous; see `Result.createAsync`.
   */
  constructor(
    experiment: Experiment<T>,
    observations: readonly Observation<T>[] = [],
    control?: Observation<T>,
  ) {
    const candidates = observations.filter((o) => o !== control);
    const evaluated = runSync(evaluateSteps(experiment, control, candidates, false));
    initialize(this, experiment, observations, control, candidates, evaluated);
  }

  /** Create a result, awaiting asynchronous comparison and ignore callbacks. */
  static async createAsync<T>(
    experiment: Experiment<T>,
    observations: readonly Observation<T>[] = [],
    control?: Observation<T>,
  ): Promise<Result<T>> {
    return runAsync(resultSteps(experiment, observations, control, true));
  }

  /** The experiment's context. */
  get context(): Record<string, unknown> {
    return this.experiment.context();
  }

  /** The experiment's name. */
  get experimentName(): string {
    return this.experiment.name;
  }

  /** Did every candidate match the control, with nothing ignored? (Ruby: `matched?`) */
  matched(): boolean {
    return this.mismatchedObservations.length === 0 && !this.ignored();
  }

  /** Did any candidate mismatch the control? (Ruby: `mismatched?`) */
  mismatched(): boolean {
    return this.mismatchedObservations.length > 0;
  }

  /** Were any mismatches ignored? (Ruby: `ignored?`) */
  ignored(): boolean {
    return this.ignoredObservations.length > 0;
  }
}

function initialize<T>(
  target: Result<T>,
  experiment: Experiment<T>,
  observations: readonly Observation<T>[],
  control: Observation<T> | undefined,
  candidates: readonly Observation<T>[],
  evaluated: Evaluated<T>,
): Result<T> {
  Object.assign(target, {
    experiment,
    observations: Object.freeze([...observations]),
    control,
    candidates: Object.freeze(candidates),
    mismatchedObservations: Object.freeze(evaluated.mismatchedObservations),
    ignoredObservations: Object.freeze(evaluated.ignoredObservations),
  });
  return Object.freeze(target);
}

/** @internal Compare candidates and build a result. */
export function* resultSteps<T>(
  experiment: Experiment<T>,
  observations: readonly Observation<T>[],
  control: Observation<T> | undefined,
  isAsync: boolean,
): Steps<Result<T>> {
  const candidates = observations.filter((o) => o !== control);
  const evaluated = yield* evaluateSteps(experiment, control, candidates, isAsync);
  const result = Object.create(Result.prototype) as Result<T>;
  return initialize(result, experiment, observations, control, candidates, evaluated);
}

function* evaluateSteps<T>(
  experiment: Experiment<T>,
  control: Observation<T> | undefined,
  candidates: readonly Observation<T>[],
  isAsync: boolean,
): Steps<Evaluated<T>> {
  const mismatched: Observation<T>[] = [];
  for (const candidate of candidates) {
    if (!(yield* observationsAreEquivalentSteps(experiment, control, candidate, isAsync))) {
      mismatched.push(candidate);
    }
  }

  const ignored: Observation<T>[] = [];
  for (const candidate of mismatched) {
    if (yield* ignoreMismatchedObservationSteps(experiment, control, candidate, isAsync)) {
      ignored.push(candidate);
    }
  }

  return {
    mismatchedObservations: mismatched.filter((o) => !ignored.includes(o)),
    ignoredObservations: ignored,
  };
}
