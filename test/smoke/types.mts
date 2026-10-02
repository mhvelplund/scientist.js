// Type-checks the *built* declarations through the package's own "exports" map
// (self-reference by package name), the way a TypeScript consumer sees them.
import { Experiment, type Result, run, runAsync } from "@mhvelplund/scientist";

class TypedExperiment<T> extends Experiment<T> {
  enabled(): boolean {
    return true;
  }

  publish(result: Result<T>): void {
    const durations: number[] = result.observations.map((o) => o.duration);
    void durations;
  }
}

Experiment.setDefault(TypedExperiment);

export const value: number = run<number>("typed", (e) => {
  e.use(() => 1);
  e.try(() => 2);
  e.compare((control, candidate) => control === candidate);
});

export const later: Promise<string> = runAsync<string>("typed-async", (e) => {
  e.use(async () => "a");
});

// @ts-expect-error a behavior returning the wrong type must be rejected
run<number>("wrong", (e) => e.use(() => "not a number"));
