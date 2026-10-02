import { beforeEach, describe, expect, it } from "vitest";
import { DefaultExperiment, type Experiment, Observation, Result } from "../src/index";

describe("Result", () => {
  let experiment: Experiment<unknown>;

  beforeEach(() => {
    experiment = new DefaultExperiment("experiment");
  });

  const observe = (name: string, value: unknown) => new Observation(name, experiment, () => value);

  it("is immutable", () => {
    const control = observe("control", 1);
    const candidate = observe("candidate", 1);

    const result = new Result(experiment, [control, candidate], control);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.mismatchedObservations)).toBe(true);
    expect(Object.isFrozen(result.ignoredObservations)).toBe(true);
  });

  it("exposes its observations, control and candidates", () => {
    const a = observe("a", 1);
    const b = observe("b", 2);
    const c = observe("c", 3);
    const result = new Result(experiment, [b, a, c], a);

    expect(result.experiment).toBe(experiment);
    expect(result.observations).toEqual([b, a, c]);
    expect(result.control).toBe(a);
    expect(result.candidates).toEqual([b, c]);
  });

  it("evaluates its observations", () => {
    const a = observe("a", 1);
    const b = observe("b", 1);

    expect(a.equivalentTo(b)).toBe(true);

    let result = new Result(experiment, [a, b], a);
    expect(result.matched()).toBe(true);
    expect(result.mismatched()).toBe(false);
    expect(result.mismatchedObservations).toEqual([]);

    const x = observe("x", 1);
    const y = observe("y", 2);
    const z = observe("z", 3);

    result = new Result(experiment, [x, y, z], x);
    expect(result.matched()).toBe(false);
    expect(result.mismatched()).toBe(true);
    expect(result.mismatchedObservations).toEqual([y, z]);
  });

  it("has no mismatches if there is only a control observation", () => {
    const a = observe("a", 1);
    const result = new Result(experiment, [a], a);
    expect(result.matched()).toBe(true);
  });

  it("evaluates observations using the experiment's compare callback", () => {
    const a = observe("a", "1");
    const b = observe("b", 1);

    experiment.compare((x, y) => x === String(y));

    const result = new Result(experiment, [a, b], a);

    expect(result.matched()).toBe(true);
  });

  it("does not ignore any mismatches when nothing's ignored", () => {
    const x = observe("x", 1);
    const y = observe("y", 2);

    const result = new Result(experiment, [x, y], x);

    expect(result.mismatched()).toBe(true);
    expect(result.ignored()).toBe(false);
  });

  it("uses the experiment's ignore callback to ignore mismatched observations", () => {
    const x = observe("x", 1);
    const y = observe("y", 2);
    let called = false;
    experiment.ignore(() => {
      called = true;
      return true;
    });

    const result = new Result(experiment, [x, y], x);

    expect(result.mismatched()).toBe(false);
    expect(result.matched()).toBe(false);
    expect(result.ignored()).toBe(true);
    expect(result.mismatchedObservations).toEqual([]);
    expect(result.ignoredObservations).toEqual([y]);
    expect(called).toBe(true);
  });

  it("partitions observations into mismatched and ignored when applicable", () => {
    const x = observe("x", "x");
    const y = observe("y", "y");
    const z = observe("z", "z");

    experiment.ignore((_control, candidate) => candidate === "y");

    const result = new Result(experiment, [x, y, z], x);

    expect(result.mismatched()).toBe(true);
    expect(result.ignored()).toBe(true);
    expect(result.ignoredObservations).toEqual([y]);
    expect(result.mismatchedObservations).toEqual([z]);
  });

  it("knows the experiment's name", () => {
    const a = observe("a", 1);
    const b = observe("b", 1);
    const result = new Result(experiment, [a, b], a);

    expect(result.experimentName).toBe(experiment.name);
  });

  it("has the context from an experiment", () => {
    experiment.context({ foo: "bar" });
    const a = observe("a", 1);
    const b = observe("b", 1);
    const result = new Result(experiment, [a, b], a);

    expect(result.context).toEqual({ foo: "bar" });
  });

  describe("createAsync", () => {
    it("awaits async compare and ignore callbacks", async () => {
      const x = observe("x", 1);
      const y = observe("y", 2);
      const z = observe("z", 3);

      experiment.compare(async (a, b) => a === b);
      experiment.ignore(async (_control, candidate) => candidate === 2);

      const result = await Result.createAsync(experiment, [x, y, z], x);

      expect(result).toBeInstanceOf(Result);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.mismatchedObservations).toEqual([z]);
      expect(result.ignoredObservations).toEqual([y]);
    });
  });
});
