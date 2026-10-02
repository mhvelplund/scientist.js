import type { Experiment } from "./experiment";
import { inspect, inspectError } from "./inspect";
import type { Observation } from "./observation";
import type { Result } from "./result";

// biome-ignore lint/suspicious/noExplicitAny: errors accept experiments of any value type
type AnyExperiment = Experiment<any>;

/** Base class for errors caused by misconfigured behaviors ("smoking in the bathroom and/or sassing"). */
export class BadBehaviorError extends Error {
  /** The experiment the behavior belongs to. */
  readonly experiment: AnyExperiment;
  /** The name of the offending behavior (Ruby: `name`). */
  readonly behaviorName: string;

  constructor(experiment: AnyExperiment, behaviorName: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.experiment = experiment;
    this.behaviorName = behaviorName;
  }
}

/** Raised by `run` when the requested behavior (default `"control"`) was never registered. */
export class BehaviorMissingError extends BadBehaviorError {
  constructor(experiment: AnyExperiment, behaviorName: string) {
    super(experiment, behaviorName, `${experiment.name} missing ${behaviorName} behavior`);
  }
}

/** Raised by `use`/`try` when a behavior with the same name is already registered. */
export class BehaviorNotUniqueError extends BadBehaviorError {
  constructor(experiment: AnyExperiment, behaviorName: string) {
    super(experiment, behaviorName, `${experiment.name} already has ${behaviorName} behavior`);
  }
}

/** Kept for parity with Ruby's `Scientist::NoValue`. Not raised by the library itself. */
export class NoValueError extends Error {
  // biome-ignore lint/suspicious/noExplicitAny: observations of any value type
  readonly observation: Observation<any>;

  // biome-ignore lint/suspicious/noExplicitAny: observations of any value type
  constructor(observation: Observation<any>) {
    super(`${observation.name} didn't return a value`);
    this.name = new.target.name;
    this.observation = observation;
  }
}

/**
 * Thrown by `run` when an experiment mismatches and `raiseOnMismatches` is
 * enabled. Intended for test environments.
 *
 * The `message` is a readable report of every observation (cleaned values, or
 * the error and its stack). It is built lazily, so subclasses may override
 * `formatObservation` or `message`.
 */
export class MismatchError<T = unknown> extends Error {
  /** The name of the experiment that mismatched (Ruby: `name`). */
  readonly experimentName: string;
  /** The result of the experiment run. */
  readonly result: Result<T>;

  constructor(experimentName: string, result: Result<T>) {
    super(`experiment '${experimentName}' observations mismatched`);
    this.name = new.target.name;
    this.experimentName = experimentName;
    this.result = result;

    const summary = this.message;
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: false,
      get: () => this.formatMessage(summary),
    });
  }

  /** Build the full message from the one-line summary. Mirrors Ruby's `MismatchError#to_s`. */
  formatMessage(summary: string): string {
    const control = this.result.control;
    return `${summary}:\n${control ? this.formatObservation(control) : ""}\n${this.result.candidates
      .map((candidate) => this.formatObservation(candidate))
      .join("\n")}\n`;
  }

  /** Format a single observation for the message. */
  formatObservation(observation: Observation<T>): string {
    if (observation.raised) {
      const stack = stackLines(observation.exception)
        .map((line) => `    ${line}`)
        .join("\n");
      return `${observation.name}:\n  ${inspectError(observation.exception)}\n${stack}`;
    }
    return `${observation.name}:\n  ${inspect(observation.cleanedValue)}`;
  }
}

function stackLines(error: unknown): string[] {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
}
