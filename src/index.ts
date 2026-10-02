export { defaultEquals } from "./equality";
export {
  BadBehaviorError,
  BadBehaviorError as BadBehavior,
  BehaviorMissingError,
  BehaviorMissingError as BehaviorMissing,
  BehaviorNotUniqueError,
  BehaviorNotUniqueError as BehaviorNotUnique,
  MismatchError,
  NoValueError,
  NoValueError as NoValue,
} from "./errors";
export {
  type Behavior,
  DefaultExperiment,
  DefaultExperiment as Default,
  Experiment,
  type ExperimentClass,
  type IgnoreCallback,
  type MismatchErrorClass,
  type RaisedOperation,
} from "./experiment";
export {
  type Comparator,
  type ErrorComparator,
  type FabricatedDuration,
  Observation,
  type ObservationOptions,
} from "./observation";
export { Result } from "./result";
export {
  type RunOptions,
  run,
  runAsync,
  type ScienceMethods,
  Scientist,
  science,
  scienceAsync,
  withScience,
} from "./scientist";
