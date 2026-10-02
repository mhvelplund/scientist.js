import { Experiment } from "./experiment";

/** Options for running an experiment. */
export interface RunOptions {
  /** The name of the behavior whose value is returned, instead of `"control"`. */
  run?: string | null | undefined;
}

/**
 * Define and run an experiment with the default experiment class (see
 * `Experiment.setDefault`). Returns the value of the control behavior, or
 * throws what it threw. Ruby: `Scientist.run`.
 *
 * ```ts
 * const user = run<User>("find-user", (e) => {
 *   e.use(() => oldFindUser(id));
 *   e.try(() => newFindUser(id));
 * });
 * ```
 */
export function run<T = unknown>(
  name: string,
  configure: (experiment: Experiment<T>) => void,
  options?: RunOptions | null,
): T {
  const experiment = Experiment.create<T>(name);
  configure(experiment);
  return experiment.run(options?.run);
}

/** Like `run`, but awaits asynchronous behaviors and callbacks. */
export async function runAsync<T = unknown>(
  name: string,
  configure: (experiment: Experiment<T>) => void | PromiseLike<void>,
  options?: RunOptions | null,
): Promise<T> {
  const experiment = Experiment.create<T>(name);
  await configure(experiment);
  return experiment.runAsync(options?.run);
}

/** Alias of `run`, for code that reads better as "science". */
export const science: typeof run = run;

/** Alias of `runAsync`. */
export const scienceAsync: typeof runAsync = runAsync;

/** The members added by `Scientist` and `withScience`. */
export interface ScienceMethods {
  /**
   * Define and run an experiment. The context from `defaultScientistContext()`
   * is merged into the experiment before `configure` is called.
   */
  science<T = unknown>(
    name: string,
    configure: (experiment: Experiment<T>) => void,
    options?: RunOptions | null,
  ): T;
  /** Like `science`, but awaits asynchronous behaviors and callbacks. */
  scienceAsync<T = unknown>(
    name: string,
    configure: (experiment: Experiment<T>) => void | PromiseLike<void>,
    options?: RunOptions | null,
  ): Promise<T>;
  /** Default context for experiments run with `science`. Override to add your own. */
  defaultScientistContext(): Record<string, unknown>;
}

/**
 * Extend this class to get `science` helpers, like including `Scientist` in
 * Ruby. Also provides `Scientist.run` / `Scientist.runAsync` for one-off use.
 */
export class Scientist implements ScienceMethods {
  /** See `run`. */
  static run: typeof run = run;
  /** See `runAsync`. */
  static runAsync: typeof runAsync = runAsync;

  science<T = unknown>(
    name: string,
    configure: (experiment: Experiment<T>) => void,
    options?: RunOptions | null,
  ): T {
    return run<T>(
      name,
      (experiment) => {
        experiment.context(this.defaultScientistContext());
        configure(experiment);
      },
      options,
    );
  }

  scienceAsync<T = unknown>(
    name: string,
    configure: (experiment: Experiment<T>) => void | PromiseLike<void>,
    options?: RunOptions | null,
  ): Promise<T> {
    return runAsync<T>(
      name,
      async (experiment) => {
        experiment.context(this.defaultScientistContext());
        await configure(experiment);
      },
      options,
    );
  }

  defaultScientistContext(): Record<string, unknown> {
    return {};
  }
}

// biome-ignore lint/suspicious/noExplicitAny: mixin constructors must accept any arguments
type Constructor<T = object> = abstract new (...args: any[]) => T;

/**
 * Add the `science` helpers to a class that already extends something else:
 *
 * ```ts
 * class Repository extends withScience(BaseRepository) { ... }
 * ```
 */
export function withScience<TBase extends Constructor>(
  Base: TBase,
): TBase & Constructor<ScienceMethods> {
  abstract class WithScience extends Base implements ScienceMethods {
    science<T = unknown>(
      name: string,
      configure: (experiment: Experiment<T>) => void,
      options?: RunOptions | null,
    ): T {
      return run<T>(
        name,
        (experiment) => {
          experiment.context(this.defaultScientistContext());
          configure(experiment);
        },
        options,
      );
    }

    scienceAsync<T = unknown>(
      name: string,
      configure: (experiment: Experiment<T>) => void | PromiseLike<void>,
      options?: RunOptions | null,
    ): Promise<T> {
      return runAsync<T>(
        name,
        async (experiment) => {
          experiment.context(this.defaultScientistContext());
          await configure(experiment);
        },
        options,
      );
    }

    defaultScientistContext(): Record<string, unknown> {
      return {};
    }
  }
  return WithScience;
}
