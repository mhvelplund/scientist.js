import { beforeEach, describe, expect, it } from "vitest";
import { Default, DefaultExperiment, Experiment, Observation, Result } from "../src/index";

describe("DefaultExperiment", () => {
  let ex: DefaultExperiment<unknown>;

  beforeEach(() => {
    ex = new DefaultExperiment("default");
  });

  it("is always disabled", () => {
    expect(ex.enabled()).toBe(false);
  });

  it("noops publish", () => {
    const a = new Observation("control", ex, () => 1);
    expect(ex.publish(new Result(ex, [a], a))).toBeUndefined();
  });

  it("is an experiment", () => {
    expect(ex).toBeInstanceOf(Experiment);
    expect(Object.getPrototypeOf(DefaultExperiment)).toBe(Experiment);
  });

  it("is exported as Default too", () => {
    expect(Default).toBe(DefaultExperiment);
  });

  it("reraises when an internal action raises", () => {
    const error = new Error("kaboom");
    expect(() => ex.raised("publish", error)).toThrow(error);
  });

  it("is what Experiment.create returns by default", () => {
    Experiment.setDefault(null);
    const created = Experiment.create("thing");
    expect(created).toBeInstanceOf(DefaultExperiment);
    expect(created.name).toBe("thing");
  });

  it("only runs the control", () => {
    let candidateRan = false;
    ex.use(() => "control");
    ex.try(() => {
      candidateRan = true;
      return "candidate";
    });

    expect(ex.run()).toBe("control");
    expect(candidateRan).toBe(false);
  });
});
