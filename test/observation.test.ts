import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultExperiment, type Experiment, Observation } from "../src/index";

describe("Observation", () => {
  let experiment: Experiment<unknown>;

  beforeEach(() => {
    experiment = new DefaultExperiment("test");
  });

  it("observes and records the execution of a block", () => {
    const ob = new Observation("test", experiment, () => {
      const start = Date.now();
      let sink = 0;
      while (Date.now() - start < 100) {
        // Perform some CPU-intensive work
        for (let i = 1; i <= 1000; i++) sink += i * i;
      }
      return sink > 0 ? "ret" : "never";
    });

    expect(ob.value).toBe("ret");
    expect(ob.raised).toBe(false);
    // Ruby uses a delta of 0.01; slightly looser here to tolerate CI/VM jitter.
    expect(Math.abs(ob.duration - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(ob.cpuTime - 0.1)).toBeLessThan(0.05);
  });

  it("is immutable", () => {
    const ob = new Observation("test", experiment, () => 1);
    expect(Object.isFrozen(ob)).toBe(true);
    expect(ob.name).toBe("test");
    expect(ob.experiment).toBe(experiment);
  });

  it("stashes exceptions", () => {
    const ob = new Observation("test", experiment, () => {
      throw new Error("exception");
    });

    expect(ob.raised).toBe(true);
    expect((ob.exception as Error).message).toBe("exception");
    expect(ob.value).toBeUndefined();
  });

  describe("rescues", () => {
    let original: (error: unknown) => boolean;

    beforeEach(() => {
      original = Observation.rescues;
    });

    afterEach(() => {
      Observation.rescues = original;
    });

    it("includes all thrown values by default", () => {
      const ob = new Observation("test", experiment, () => {
        throw "not an Error";
      });

      expect(ob.raised).toBe(true);
      expect(ob.exception).toBe("not an Error");
    });

    it("can customize rescued types", () => {
      Observation.rescues = (error) => error instanceof Error;

      expect(
        () =>
          new Observation("test", experiment, () => {
            throw "not an Error";
          }),
      ).toThrow("not an Error");

      const ob = new Observation("test", experiment, () => {
        throw new Error("an Error");
      });
      expect(ob.raised).toBe(true);
    });
  });

  it("compares values", () => {
    const a = new Observation("test", experiment, () => 1);
    const b = new Observation("test", experiment, () => 1);

    expect(a.equivalentTo(b)).toBe(true);

    const x = new Observation("test", experiment, () => 1);
    const y = new Observation("test", experiment, () => 2);

    expect(x.equivalentTo(y)).toBe(false);
  });

  it("is not equivalent to something that isn't an observation", () => {
    const a = new Observation("test", experiment, () => 1);
    expect(a.equivalentTo(1)).toBe(false);
  });

  it("compares exception messages", () => {
    const a = new Observation("test", experiment, () => {
      throw new Error("error");
    });
    const b = new Observation("test", experiment, () => {
      throw new Error("error");
    });

    expect(a.equivalentTo(b)).toBe(true);

    const x = new Observation("test", experiment, () => {
      throw new Error("error");
    });
    const y = new Observation("test", experiment, () => {
      throw new Error("ERROR");
    });

    expect(x.equivalentTo(y)).toBe(false);
  });

  class FirstError extends Error {}
  class SecondError extends Error {}

  it("compares exception classes", () => {
    const x = new Observation("test", experiment, () => {
      throw new FirstError("error");
    });
    const y = new Observation("test", experiment, () => {
      throw new SecondError("error");
    });
    const z = new Observation("test", experiment, () => {
      throw new FirstError("error");
    });

    expect(x.equivalentTo(z)).toBe(true);
    expect(x.equivalentTo(y)).toBe(false);
  });

  it("is not equivalent when only one side raised", () => {
    const x = new Observation("test", experiment, () => {
      throw new Error("error");
    });
    const y = new Observation("test", experiment, () => "error");

    expect(x.equivalentTo(y)).toBe(false);
    expect(y.equivalentTo(x)).toBe(false);
  });

  it("compares values using a comparator function", () => {
    const a = new Observation<unknown>("test", experiment, () => 1);
    const b = new Observation<unknown>("test", experiment, () => "1");

    expect(a.equivalentTo(b)).toBe(false);

    const compareOnString = (x: unknown, y: unknown) => String(x) === String(y);

    expect(a.equivalentTo(b, compareOnString)).toBe(true);

    const yielded: unknown[] = [];
    const compareAppends = (x: unknown, y: unknown) => {
      yielded.push(x, y);
      return true;
    };
    a.equivalentTo(b, compareAppends);

    expect(yielded).toEqual([a.value, b.value]);
  });

  it("compares exceptions using an error comparator function", () => {
    const x = new Observation("test", experiment, () => {
      throw new FirstError("error");
    });
    const y = new Observation("test", experiment, () => {
      throw new SecondError("error");
    });
    const z = new Observation("test", experiment, () => {
      throw new FirstError("ERROR");
    });

    expect(x.equivalentTo(z)).toBe(false);
    expect(x.equivalentTo(y)).toBe(false);

    const compareOnClass = (error: unknown, other: unknown) =>
      (error as Error).constructor === (other as Error).constructor;
    const compareOnMessage = (error: unknown, other: unknown) =>
      (error as Error).message === (other as Error).message;

    expect(x.equivalentTo(z, null, compareOnClass)).toBe(true);
    expect(x.equivalentTo(y, null, compareOnMessage)).toBe(true);
  });

  it("throws a TypeError when a comparator returns a promise", () => {
    const a = new Observation("test", experiment, () => 1);
    const b = new Observation("test", experiment, () => 1);
    expect(() => a.equivalentTo(b, async () => true)).toThrow(TypeError);
  });

  describe("cleanedValue", () => {
    it("returns the observation's value by default", () => {
      const a = new Observation("test", experiment, () => 1);
      expect(a.cleanedValue).toBe(1);
    });

    it("uses the experiment's clean callback to clean a value when configured", () => {
      experiment.clean((value) => (value as string).toUpperCase());
      const a = new Observation("test", experiment, () => "test");
      expect(a.cleanedValue).toBe("TEST");
    });

    it("doesn't clean null or undefined values", () => {
      experiment.clean(() => "foo");
      const a = new Observation("test", experiment, () => null);
      expect(a.cleanedValue).toBeNull();
      const b = new Observation("test", experiment, () => undefined);
      expect(b.cleanedValue).toBeUndefined();
    });

    it("returns false boolean values", () => {
      const a = new Observation("test", experiment, () => false);
      expect(a.cleanedValue).toBe(false);
    });

    it("cleans false values", () => {
      experiment.clean((value) => String(value).toUpperCase());
      const a = new Observation("test", experiment, () => false);
      expect(a.cleanedValue).toBe("FALSE");
    });
  });

  describe("createAsync", () => {
    it("awaits the behavior's value", async () => {
      const ob = await Observation.createAsync("test", experiment, async () => "ret");
      expect(ob).toBeInstanceOf(Observation);
      expect(ob.value).toBe("ret");
      expect(ob.raised).toBe(false);
      expect(Object.isFrozen(ob)).toBe(true);
    });

    it("stashes rejections", async () => {
      const ob = await Observation.createAsync("test", experiment, async () => {
        throw new Error("nope");
      });
      expect(ob.raised).toBe(true);
      expect((ob.exception as Error).message).toBe("nope");
    });
  });

  describe("fabricated durations", () => {
    it("uses a plain number as the duration and 0 cpu time", () => {
      const ob = new Observation("test", experiment, () => 1, { fabricatedDuration: 5 });
      expect(ob.duration).toBe(5);
      expect(ob.cpuTime).toBe(0);
    });

    it("uses duration and cpu_time from an object", () => {
      const ob = new Observation("test", experiment, () => 1, {
        fabricatedDuration: { duration: 2, cpu_time: 1.5 },
      });
      expect(ob.duration).toBe(2);
      expect(ob.cpuTime).toBe(1.5);
    });

    it("defaults a missing cpu_time to 0 (Ruby: nil)", () => {
      const ob = new Observation("test", experiment, () => 1, {
        fabricatedDuration: { duration: 2 },
      });
      expect(ob.cpuTime).toBe(0);
    });
  });
});
