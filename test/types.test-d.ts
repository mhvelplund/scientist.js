import { describe, expectTypeOf, it } from "vitest";
import {
  type Behavior,
  DefaultExperiment,
  Experiment,
  MismatchError,
  Observation,
  Result,
  run,
  runAsync,
  Scientist,
  science,
  scienceAsync,
  withScience,
} from "../src/index";

describe("run", () => {
  it("returns T", () => {
    const value = run<number>("x", (e) => {
      expectTypeOf(e).toEqualTypeOf<Experiment<number>>();
      e.use(() => 1);
    });
    expectTypeOf(value).toEqualTypeOf<number>();
    expectTypeOf(science<string>("x", () => {})).toEqualTypeOf<string>();
  });

  it("defaults T to unknown", () => {
    expectTypeOf(run("x", () => {})).toEqualTypeOf<unknown>();
  });

  it("rejects behaviors of the wrong type", () => {
    run<number>("x", (e) => {
      // @ts-expect-error a string behavior in a number experiment
      e.use(() => "nope");
    });
  });

  it("accepts the run option", () => {
    run<number>("x", () => {}, { run: "candidate" });
    run<number>("x", () => {}, null);
    // @ts-expect-error run must be a string
    run<number>("x", () => {}, { run: 1 });
  });
});

describe("runAsync", () => {
  it("returns Promise<T>", () => {
    const value = runAsync<number>("x", async (e) => {
      e.use(async () => 1);
      e.try(() => 2);
    });
    expectTypeOf(value).toEqualTypeOf<Promise<number>>();
    expectTypeOf(scienceAsync<string>("x", () => {})).toEqualTypeOf<Promise<string>>();
    expectTypeOf(Scientist.runAsync<boolean>("x", () => {})).toEqualTypeOf<Promise<boolean>>();
  });

  it("returns Promise<T> from Experiment#runAsync", () => {
    const e = new DefaultExperiment<number>("x");
    expectTypeOf(e.runAsync()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(e.run()).toEqualTypeOf<number>();
  });
});

describe("Experiment<T> callbacks", () => {
  const e = new DefaultExperiment<number>("x");

  it("types behaviors", () => {
    expectTypeOf(e.use).parameter(0).toEqualTypeOf<Behavior<number>>();
    expectTypeOf(e.behaviors.get("control")).toEqualTypeOf<Behavior<number> | undefined>();
  });

  it("types compare parameters", () => {
    e.compare((control, candidate) => {
      expectTypeOf(control).toEqualTypeOf<number>();
      expectTypeOf(candidate).toEqualTypeOf<number>();
      return control === candidate;
    });
    e.compare(async (a, b) => a === b);
  });

  it("types compareErrors parameters", () => {
    e.compareErrors((controlError, candidateError) => {
      expectTypeOf(controlError).toEqualTypeOf<unknown>();
      expectTypeOf(candidateError).toEqualTypeOf<unknown>();
      return true;
    });
  });

  it("types ignore parameters", () => {
    e.ignore((control, candidate) => {
      expectTypeOf(control).toEqualTypeOf<number | undefined>();
      expectTypeOf(candidate).toEqualTypeOf<number | undefined>();
      return false;
    });
  });

  it("types clean, afterRun and runIf", () => {
    e.clean((value) => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return value.toFixed(2);
    });
    e.afterRun((result) => {
      expectTypeOf(result).toEqualTypeOf<Result<number>>();
    });
    e.runIf(() => true);
    e.beforeRun(() => {});
  });

  it("types publish and raised", () => {
    class Typed extends Experiment<string> {
      enabled() {
        return true;
      }
      publish(result: Result<string>) {
        expectTypeOf(result.control).toEqualTypeOf<Observation<string> | undefined>();
      }
    }
    expectTypeOf(new Typed().publish).parameter(0).toEqualTypeOf<Result<string>>();
    expectTypeOf(e.raised)
      .parameter(0)
      .toEqualTypeOf<"clean" | "compare" | "enabled" | "ignore" | "publish" | "run_if">();
  });

  it("types Experiment.create", () => {
    expectTypeOf(Experiment.create<string>("x")).toEqualTypeOf<Experiment<string>>();
    Experiment.setDefault(DefaultExperiment);
    Experiment.setDefault(null);
  });
});

describe("Result<T> and Observation<T>", () => {
  const e = new DefaultExperiment<string>("x");
  const ob = new Observation("control", e, () => "v");
  const result = new Result(e, [ob], ob);

  it("types observation values", () => {
    expectTypeOf(ob).toEqualTypeOf<Observation<string>>();
    expectTypeOf(ob.value).toEqualTypeOf<string | undefined>();
    expectTypeOf(ob.exception).toEqualTypeOf<unknown>();
    expectTypeOf(ob.raised).toEqualTypeOf<boolean>();
    expectTypeOf(ob.duration).toEqualTypeOf<number>();
    expectTypeOf(ob.cpuTime).toEqualTypeOf<number>();
    expectTypeOf(ob.cleanedValue).toEqualTypeOf<unknown>();
    expectTypeOf(ob.experiment).toEqualTypeOf<Experiment<string>>();
    expectTypeOf(Observation.createAsync("c", e, async () => "v")).toEqualTypeOf<
      Promise<Observation<string>>
    >();
  });

  it("types result members", () => {
    expectTypeOf(result).toEqualTypeOf<Result<string>>();
    expectTypeOf(result.control).toEqualTypeOf<Observation<string> | undefined>();
    expectTypeOf(result.candidates).toEqualTypeOf<readonly Observation<string>[]>();
    expectTypeOf(result.observations).toEqualTypeOf<readonly Observation<string>[]>();
    expectTypeOf(result.mismatchedObservations).toEqualTypeOf<readonly Observation<string>[]>();
    expectTypeOf(result.ignoredObservations).toEqualTypeOf<readonly Observation<string>[]>();
    expectTypeOf(result.matched()).toEqualTypeOf<boolean>();
    expectTypeOf(result.context).toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf(result.experimentName).toEqualTypeOf<string>();
  });

  it("types MismatchError", () => {
    const error = new MismatchError("x", result);
    expectTypeOf(error).toEqualTypeOf<MismatchError<string>>();
    expectTypeOf(error.result).toEqualTypeOf<Result<string>>();
    expectTypeOf(error.experimentName).toEqualTypeOf<string>();
  });
});

describe("Scientist and withScience", () => {
  it("types science helpers", () => {
    const s = new Scientist();
    expectTypeOf(s.science<number>("x", () => {})).toEqualTypeOf<number>();
    expectTypeOf(s.scienceAsync<number>("x", () => {})).toEqualTypeOf<Promise<number>>();
    expectTypeOf(s.defaultScientistContext()).toEqualTypeOf<Record<string, unknown>>();
  });

  it("keeps the base class's members", () => {
    class Base {
      constructor(readonly id: number) {}
    }
    class Repo extends withScience(Base) {}
    const repo = new Repo(1);
    expectTypeOf(repo.id).toEqualTypeOf<number>();
    expectTypeOf(repo.science<string>("x", () => {})).toEqualTypeOf<string>();
    expectTypeOf(repo).toExtend<Base>();
    // @ts-expect-error constructor arguments come from the base class
    new Repo("1");
  });
});
