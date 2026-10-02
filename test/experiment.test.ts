// Port of scientist's test/scientist/experiment_test.rb.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BehaviorMissingError,
  BehaviorNotUniqueError,
  DefaultExperiment,
  Experiment,
  MismatchError,
  Observation,
  type RaisedOperation,
  type Result,
} from "../src/index";

// tsconfig has no DOM/Node lib; declare the runtime globals used here.
declare function structuredClone<V>(value: V): V;
declare function setTimeout(callback: () => void, ms: number): unknown;
declare const performance: { now(): number };

class Fake extends Experiment<unknown> {
  publishedResult: Result<unknown> | undefined;
  exceptions: [RaisedOperation, unknown][] = [];

  enabled(): boolean | PromiseLike<boolean> {
    return true;
  }

  override raised(operation: RaisedOperation, error: unknown): void {
    this.exceptions.push([operation, error]);
  }

  publish(result: Result<unknown>): void | PromiseLike<void> {
    this.publishedResult = result;
  }
}

/** Like Fake, but records errors and then re-raises them (the default `raised` behavior). */
class RecordingRethrowFake extends Fake {
  override raised(operation: RaisedOperation, error: unknown): void {
    this.exceptions.push([operation, error]);
    throw error;
  }
}

/** Runs behaviors in registration order instead of shuffling them. */
class OrderedFake extends Fake {
  protected override shuffle(names: string[]): string[] {
    return names;
  }
}

function message(error: unknown): string {
  return (error as Error).message;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe("Experiment", () => {
  let ex: Fake;

  beforeEach(() => {
    Experiment.setDefault(null);
    ex = new Fake();
  });

  afterEach(() => {
    Experiment.setDefault(null);
  });

  it("sets the default on inclusion", () => {
    // Deliberate JS difference: subclassing doesn't set the default automatically,
    // Experiment.setDefault must be called explicitly.
    class Klass extends Fake {}
    expect(Experiment.create("hello")).toBeInstanceOf(DefaultExperiment);

    Experiment.setDefault(Klass);
    expect(Experiment.create("hello")).toBeInstanceOf(Klass);

    Experiment.setDefault(null);
  });

  it("doesn't set the default on inclusion when it's a module", () => {
    // JS has no modules-as-mixins; an abstract subclass is the closest analogue.
    abstract class Abstract extends Experiment {}
    expect(Abstract).toBeDefined();
    expect(Experiment.create("hello")).toBeInstanceOf(DefaultExperiment);
  });

  it("has a default implementation", () => {
    const e = Experiment.create("hello");
    expect(e).toBeInstanceOf(DefaultExperiment);
    expect(e.name).toBe("hello");
  });

  it("provides a static default name", () => {
    expect(new Fake().name).toBe("experiment");
  });

  it("requires includers to implement enabled?", () => {
    // `enabled` is abstract; at runtime an object without it can't call it.
    const obj = Object.create(Experiment.prototype) as Experiment;
    expect(() => obj.enabled()).toThrow(TypeError);
  });

  it("requires includers to implement publish", () => {
    const obj = Object.create(Experiment.prototype) as Experiment;
    expect(() => obj.publish(undefined as unknown as Result)).toThrow(TypeError);
  });

  it("can't be run without a control behavior", () => {
    let error: unknown;
    try {
      ex.run();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BehaviorMissingError);
    expect((error as BehaviorMissingError).behaviorName).toBe("control");
  });

  it("is a straight pass-through with only a control behavior", () => {
    ex.use(() => "control");
    expect(ex.run()).toBe("control");
  });

  it("runs other behaviors but always returns the control", () => {
    ex.use(() => "control");
    ex.try(() => "candidate");
    expect(ex.run()).toBe("control");
  });

  it("complains about duplicate behavior names", () => {
    ex.use(() => "control");

    let error: unknown;
    try {
      ex.use(() => "control-again");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BehaviorNotUniqueError);
    expect((error as BehaviorNotUniqueError).experiment).toBe(ex);
    expect((error as BehaviorNotUniqueError).behaviorName).toBe("control");
  });

  it("swallows exceptions raised by candidate behaviors", () => {
    ex.use(() => "control");
    ex.try(() => {
      throw new Error("candidate");
    });
    expect(ex.run()).toBe("control");
  });

  it("passes through exceptions raised by the control behavior", () => {
    ex.use(() => {
      throw new Error("control");
    });
    ex.try(() => "candidate");
    expect(() => ex.run()).toThrow(new Error("control"));
  });

  it("shuffles behaviors before running", () => {
    let last: string | undefined;
    const runs = new Set<string | undefined>();

    ex.use(() => {
      last = "control";
      return last;
    });
    ex.try(() => {
      last = "candidate";
      return last;
    });

    for (let i = 0; i < 1000; i++) {
      ex.run();
      runs.add(last);
    }

    expect(runs.size).toBeGreaterThan(1);
  });

  it("can override the protected shuffle for a deterministic order", () => {
    const order: string[] = [];
    const e = new OrderedFake();
    e.try("b", () => order.push("b"));
    e.use(() => order.push("control"));
    e.try("a", () => order.push("a"));

    for (let i = 0; i < 20; i++) e.run();

    for (let i = 0; i < 20; i++) {
      expect(order.slice(i * 3, i * 3 + 3)).toEqual(["b", "control", "a"]);
    }
    expect(e.publishedResult?.observations.map((o) => o.name)).toEqual(["b", "control", "a"]);
  });

  it("re-raises exceptions raised during publish by default", () => {
    const e = Experiment.create("hello");
    expect(e).toBeInstanceOf(DefaultExperiment);

    e.enabled = () => true;
    e.publish = () => {
      throw new Error("boomtown");
    };

    e.use(() => "control");
    e.try(() => "candidate");

    expect(() => e.run()).toThrow(new Error("boomtown"));
  });

  it("reports publishing errors", () => {
    ex.publish = () => {
      throw new Error("boomtown");
    };

    ex.use(() => "control");
    ex.try(() => "candidate");

    expect(ex.run()).toBe("control");

    const [op, exception] = ex.exceptions.pop() ?? [];
    expect(op).toBe("publish");
    expect(message(exception)).toBe("boomtown");
  });

  it("publishes results", () => {
    ex.use(() => 1);
    ex.try(() => 1);
    expect(ex.run()).toBe(1);
    expect(ex.publishedResult).toBeTruthy();
  });

  it("does not publish results when there is only a control value", () => {
    ex.use(() => 1);
    expect(ex.run()).toBe(1);
    expect(ex.publishedResult).toBeUndefined();
  });

  it("compares results with a comparator block if provided", () => {
    ex.compare((a, b) => a === String(b));
    ex.use(() => "1");
    ex.try(() => 1);

    expect(ex.run()).toBe("1");
    expect(ex.publishedResult?.matched()).toBe(true);
  });

  it("compares errors with an error comparator block if provided", () => {
    ex.compareErrors(
      (a, b) => Object.getPrototypeOf(a) === Object.getPrototypeOf(b) && a !== undefined,
    );
    ex.use(() => {
      throw new Error("foo");
    });
    ex.try(() => {
      throw new Error("bar");
    });

    expect(() => ex.run()).toThrow(new Error("foo"));
    expect(ex.publishedResult?.matched()).toBe(true);
  });

  it("knows how to compare two experiments", () => {
    const a = new Observation("a", ex, () => 1);
    const b = new Observation("b", ex, () => 2);

    expect(ex.observationsAreEquivalent(a, a)).toBe(true);
    expect(ex.observationsAreEquivalent(a, b)).toBe(false);
  });

  it("uses a compare block to determine if observations are equivalent", () => {
    const a = new Observation<unknown>("a", ex, () => "1");
    const b = new Observation<unknown>("b", ex, () => 1);
    ex.compare((x, y) => x === String(y));
    expect(ex.observationsAreEquivalent(a, b)).toBe(true);
  });

  it("reports errors in a compare block", () => {
    ex.compare(() => {
      throw new Error("boomtown");
    });
    ex.use(() => "control");
    ex.try(() => "candidate");

    expect(ex.run()).toBe("control");

    const [op, exception] = ex.exceptions.pop() ?? [];
    expect(op).toBe("compare");
    expect(message(exception)).toBe("boomtown");
  });

  it("reports errors in the enabled? method", () => {
    ex.enabled = () => {
      throw new Error("kaboom");
    };

    ex.use(() => "control");
    ex.try(() => "candidate");
    expect(ex.run()).toBe("control");

    const [op, exception] = ex.exceptions.pop() ?? [];
    expect(op).toBe("enabled");
    expect(message(exception)).toBe("kaboom");
  });

  it("reports errors in a run_if block", () => {
    ex.runIf(() => {
      throw new Error("kaboom");
    });
    ex.use(() => "control");
    ex.try(() => "candidate");
    expect(ex.run()).toBe("control");

    const [op, exception] = ex.exceptions.pop() ?? [];
    expect(op).toBe("run_if");
    expect(message(exception)).toBe("kaboom");
  });

  it("reports a run_if error twice, as run_if then enabled, when raised re-raises", () => {
    // Same quirk as Ruby: run_if_block_allows? re-raises from `raised`, which is
    // rescued again by should_experiment_run? and reported as :enabled.
    const e = new RecordingRethrowFake();
    const boom = new Error("kaboom");
    e.runIf(() => {
      throw boom;
    });
    e.use(() => "control");
    e.try(() => "candidate");

    expect(() => e.run()).toThrow(boom);
    expect(e.exceptions).toEqual([
      ["run_if", boom],
      ["enabled", boom],
    ]);
  });

  it("returns the given value when no clean block is configured", () => {
    expect(ex.cleanValue(10)).toBe(10);
  });

  it("provides the clean block when asked for it, in case subclasses wish to override and provide defaults", () => {
    expect(ex.cleaner).toBeUndefined();
    const cleaner = (value: unknown) => String(value).toUpperCase();
    ex.clean(cleaner);
    expect(ex.cleaner).toBe(cleaner);
  });

  it("calls the configured clean block with a value when configured", () => {
    ex.clean((value) => String(value).toUpperCase());
    expect(ex.cleanValue("test")).toBe("TEST");
  });

  it("reports an error and returns the original value when an error is raised in a clean block", () => {
    ex.clean(() => {
      throw new Error("kaboom");
    });

    ex.use(() => "control");
    ex.try(() => "candidate");
    expect(ex.run()).toBe("control");

    expect(ex.publishedResult?.control?.cleanedValue).toBe("control");

    const [op, exception] = ex.exceptions.pop() ?? [];
    expect(op).toBe("clean");
    expect(message(exception)).toBe("kaboom");
  });

  it("reports a clean error inside publish as clean then publish when raised re-raises", () => {
    const e = new RecordingRethrowFake();
    const boom = new Error("kaboom");
    e.clean(() => {
      throw boom;
    });
    e.publish = (result) => {
      void result.control?.cleanedValue;
    };
    e.use(() => "control");
    e.try(() => "candidate");

    expect(() => e.run()).toThrow(boom);
    expect(e.exceptions).toEqual([
      ["clean", boom],
      ["publish", boom],
    ]);
  });

  describe("#raise_with", () => {
    it("raises custom error if provided", () => {
      class CustomError extends MismatchError {}

      ex.use(() => 1);
      ex.try(() => 2);
      ex.raiseWith(CustomError);
      ex.raiseOnMismatches = true;

      expect(() => ex.run()).toThrow(CustomError);
    });
  });

  describe("#run_if", () => {
    it("does not run the experiment if the given block returns false", () => {
      let candidateRan = false;
      let runCheckRan = false;

      ex.use(() => 1);
      ex.try(() => {
        candidateRan = true;
        return 1;
      });

      ex.runIf(() => {
        runCheckRan = true;
        return false;
      });

      ex.run();

      expect(runCheckRan).toBe(true);
      expect(candidateRan).toBe(false);
    });

    it("runs the experiment if the given block returns true", () => {
      let candidateRan = false;
      let runCheckRan = false;

      ex.use(() => true);
      ex.try(() => {
        candidateRan = true;
        return candidateRan;
      });

      ex.runIf(() => {
        runCheckRan = true;
        return runCheckRan;
      });

      ex.run();

      expect(runCheckRan).toBe(true);
      expect(candidateRan).toBe(true);
    });
  });

  describe("#ignore_mismatched_observation?", () => {
    let a: Observation<unknown>;
    let b: Observation<unknown>;

    beforeEach(() => {
      a = new Observation<unknown>("a", ex, () => 1);
      b = new Observation<unknown>("b", ex, () => 2);
    });

    it("does not ignore an observation if no ignores are configured", () => {
      expect(ex.ignoreMismatchedObservation(a, b)).toBe(false);
    });

    it("calls a configured ignore block with the given observed values", () => {
      let called = false;
      ex.ignore((x, y) => {
        called = true;
        expect(x).toBe(a.value);
        expect(y).toBe(b.value);
        return true;
      });

      expect(ex.ignoreMismatchedObservation(a, b)).toBe(true);
      expect(called).toBe(true);
    });

    it("calls multiple ignore blocks to see if any match", () => {
      let calledOne = false;
      let calledTwo = false;
      let calledThree = false;
      ex.ignore(() => {
        calledOne = true;
        return false;
      });
      ex.ignore(() => {
        calledTwo = true;
        return false;
      });
      ex.ignore(() => {
        calledThree = true;
        return false;
      });
      expect(ex.ignoreMismatchedObservation(a, b)).toBe(false);
      expect(calledOne).toBe(true);
      expect(calledTwo).toBe(true);
      expect(calledThree).toBe(true);
    });

    it("only calls ignore blocks until one matches", () => {
      let calledOne = false;
      let calledTwo = false;
      let calledThree = false;
      ex.ignore(() => {
        calledOne = true;
        return false;
      });
      ex.ignore(() => {
        calledTwo = true;
        return true;
      });
      ex.ignore(() => {
        calledThree = true;
        return false;
      });
      expect(ex.ignoreMismatchedObservation(a, b)).toBe(true);
      expect(calledOne).toBe(true);
      expect(calledTwo).toBe(true);
      expect(calledThree).toBe(false);
    });

    it("reports exceptions raised in an ignore block and returns false", () => {
      ex.ignore(() => {
        throw new Error("kaboom");
      });

      expect(ex.ignoreMismatchedObservation(a, b)).toBe(false);

      const [op, exception] = ex.exceptions.pop() ?? [];
      expect(op).toBe("ignore");
      expect(message(exception)).toBe("kaboom");
    });

    it("skips ignore blocks that raise and tests any remaining blocks if an exception is swallowed", () => {
      ex.ignore(() => {
        throw new Error("kaboom");
      });
      ex.ignore(() => true);

      expect(ex.ignoreMismatchedObservation(a, b)).toBe(true);
      expect(ex.exceptions).toHaveLength(1);
    });
  });

  describe("raising on mismatches", () => {
    let oldRaiseOnMismatches: boolean | undefined;

    beforeEach(() => {
      oldRaiseOnMismatches = Fake.raiseOnMismatches;
    });

    afterEach(() => {
      Fake.raiseOnMismatches = oldRaiseOnMismatches;
    });

    it("raises when there is a mismatch if raise on mismatches is enabled", () => {
      Fake.raiseOnMismatches = true;
      ex.use(() => "fine");
      ex.try(() => "not fine");

      expect(() => ex.run()).toThrow(MismatchError);
    });

    it("cleans values when raising on observation mismatch", () => {
      Fake.raiseOnMismatches = true;
      ex.use(() => "fine");
      ex.try(() => "not fine");
      ex.clean(() => "So Clean");

      expect(() => ex.run()).toThrow(/So Clean/);
    });

    it("doesn't raise when there is a mismatch if raise on mismatches is disabled", () => {
      Fake.raiseOnMismatches = false;
      ex.use(() => "fine");
      ex.try(() => "not fine");

      expect(ex.run()).toBe("fine");
    });

    it("raises a mismatch error if the control raises and candidate doesn't", () => {
      Fake.raiseOnMismatches = true;
      ex.use(() => {
        throw new Error("control");
      });
      ex.try(() => "candidate");
      expect(() => ex.run()).toThrow(MismatchError);
    });

    it("raises a mismatch error if the candidate raises and the control doesn't", () => {
      Fake.raiseOnMismatches = true;
      ex.use(() => "control");
      ex.try(() => {
        throw new Error("candidate");
      });
      expect(() => ex.run()).toThrow(MismatchError);
    });

    it("allows MismatchError to bubble up through bare rescues", () => {
      // Deliberate JS difference: MismatchError is a normal Error. JS has no
      // StandardError/Exception split, so a bare catch does catch it.
      Fake.raiseOnMismatches = true;
      ex.use(() => "control");
      ex.try(() => "candidate");
      let caught: unknown;
      const runner = () => {
        try {
          ex.run();
        } catch (e) {
          caught = e;
        }
      };
      expect(runner).not.toThrow();
      expect(caught).toBeInstanceOf(MismatchError);
      expect(caught).toBeInstanceOf(Error);
    });

    it("can be marshaled", () => {
      // JS has no Marshal; structuredClone is the closest analogue.
      Fake.raiseOnMismatches = true;
      ex.beforeRun(() => "some block");
      ex.clean(() => "some block");
      ex.compareErrors(() => true);
      ex.ignore(() => false);
      ex.runIf(() => "some block");
      ex.try(() => "candidate");
      ex.use(() => "control");
      ex.compare((control, candidate) => control === candidate);

      let mismatch: unknown;
      try {
        ex.run();
      } catch (e) {
        mismatch = e;
      }

      expect(mismatch).toBeInstanceOf(MismatchError);
      const cloned = structuredClone(mismatch);
      expect(cloned).toBeInstanceOf(Error);
      expect(JSON.stringify({ message: message(mismatch) })).toContain("mismatched");
    });

    it("can be marshal loaded", () => {
      // JS has no Marshal; structuredClone copies the data but not the class.
      const cloned = structuredClone(ex) as unknown as Record<string, unknown>;
      expect(cloned.name).toBe(ex.name);
      expect(cloned.exceptions).toEqual([]);
    });

    describe("#raise_on_mismatches?", () => {
      it("raises when there is a mismatch if the experiment instance's raise on mismatches is enabled", () => {
        Fake.raiseOnMismatches = false;
        ex.raiseOnMismatches = true;
        ex.use(() => "fine");
        ex.try(() => "not fine");

        expect(() => ex.run()).toThrow(MismatchError);
      });

      it("doesn't raise when there is a mismatch if the experiment instance's raise on mismatches is disabled", () => {
        Fake.raiseOnMismatches = true;
        ex.raiseOnMismatches = false;
        ex.use(() => "fine");
        ex.try(() => "not fine");

        expect(ex.run()).toBe("fine");
      });

      it("respects the raise_on_mismatches class attribute by default", () => {
        Fake.raiseOnMismatches = false;
        ex.use(() => "fine");
        ex.try(() => "not fine");

        expect(ex.run()).toBe("fine");

        Fake.raiseOnMismatches = true;

        expect(() => ex.run()).toThrow(MismatchError);
      });

      it("inherits the class attribute in subclasses (JS difference)", () => {
        // Deliberate JS difference: static raiseOnMismatches inherits to subclasses.
        class Sub extends Fake {}
        Fake.raiseOnMismatches = true;
        const sub = new Sub();
        expect(sub.shouldRaiseOnMismatches()).toBe(true);
        Fake.raiseOnMismatches = false;
        expect(sub.shouldRaiseOnMismatches()).toBe(false);
      });
    });

    describe("MismatchError", () => {
      let mismatch: MismatchError;

      beforeEach(() => {
        Fake.raiseOnMismatches = true;
        ex.use(() => "foo");
        ex.try(() => "bar");
        try {
          ex.run();
        } catch (e) {
          mismatch = e as MismatchError;
        }
        expect(mismatch).toBeInstanceOf(MismatchError);
      });

      it("has the name of the experiment", () => {
        expect(mismatch.experimentName).toBe(ex.name);
      });

      it("includes the experiments' results", () => {
        expect(mismatch.result).toBe(ex.publishedResult);
      });

      it("formats nicely as a string", () => {
        // JS values are inspected with node:util (strings instead of Ruby symbols).
        expect(mismatch.message).toBe(
          "experiment 'experiment' observations mismatched:\ncontrol:\n  'foo'\ncandidate:\n  'bar'\n",
        );
      });

      it("includes the backtrace when an observation raises", () => {
        let err: MismatchError | undefined;
        const e = new Fake();
        e.use(() => "value");
        e.try(() => {
          throw new Error("error");
        });

        try {
          e.run();
        } catch (error) {
          err = error as MismatchError;
        }

        // Should look like this:
        // experiment 'experiment' observations mismatched:
        // control:
        //   'value'
        // candidate:
        //   [Error: error]
        //     at test/experiment.test.ts:NNN:NN
        // ... (more stack)
        const lines = String(err?.message).split("\n");
        expect(lines[1]).toBe("control:");
        expect(lines[2]).toBe("  'value'");
        expect(lines[3]).toBe("candidate:");
        expect(lines[4]).toBe("  [Error: error]");
        expect(lines[5]).toMatch(/^ {4}at .*experiment\.test\.ts:\d+/);
      });
    });
  });

  describe("before run block", () => {
    it("runs when an experiment is enabled", () => {
      let controlOk = false;
      let candidateOk = false;
      let before = false;
      ex.beforeRun(() => {
        before = true;
      });
      ex.use(() => {
        controlOk = before;
      });
      ex.try(() => {
        candidateOk = before;
      });

      ex.run();

      expect(before).toBe(true);
      expect(controlOk).toBe(true);
      expect(candidateOk).toBe(true);
    });

    it("does not run when an experiment is disabled", () => {
      let before = false;

      ex.enabled = () => false;
      ex.beforeRun(() => {
        before = true;
      });
      ex.use(() => "value");
      ex.try(() => "value");
      ex.run();

      expect(before).toBe(false);
    });
  });

  describe("after run block", () => {
    it("runs when an experiment is enabled", () => {
      let controlOk = false;
      let candidateOk = false;
      let afterResult: Result<unknown> | undefined;
      ex.afterRun((result) => {
        afterResult = result;
      });
      ex.use(() => {
        controlOk = afterResult === undefined;
      });
      ex.try(() => {
        candidateOk = afterResult === undefined;
      });

      ex.run();

      expect(afterResult).toBeTruthy();
      expect(afterResult?.matched()).toBe(true);
      expect(controlOk).toBe(true);
      expect(candidateOk).toBe(true);
    });

    it("does not run when an experiment is disabled", () => {
      let afterResult: Result<unknown> | undefined;

      ex.enabled = () => false;
      ex.afterRun((result) => {
        afterResult = result;
      });
      ex.use(() => "value");
      ex.try(() => "value");
      ex.run();

      expect(afterResult).toBeUndefined();
    });
  });

  describe("testing hooks for extending code", () => {
    it("allows a user to provide fabricated durations for testing purposes (old version)", () => {
      ex.use(() => true);
      ex.try(() => true);
      ex.fabricateDurationsForTestingPurposes({ control: 0.5, candidate: 1.0 });

      ex.run();

      const cont = ex.publishedResult?.control;
      const cand = ex.publishedResult?.candidates[0];
      expect(cont?.duration).toBeCloseTo(0.5, 2);
      expect(cand?.duration).toBeCloseTo(1.0, 2);
    });

    it("allows a user to provide fabricated durations for testing purposes (new version)", () => {
      ex.use(() => true);
      ex.try(() => true);
      ex.fabricateDurationsForTestingPurposes({
        control: { duration: 0.5, cpu_time: 0.4 },
        candidate: { duration: 1.0, cpu_time: 0.9 },
      });
      ex.run();

      const cont = ex.publishedResult?.control;
      const cand = ex.publishedResult?.candidates[0];

      // Wall Time
      expect(cont?.duration).toBeCloseTo(0.5, 2);
      expect(cand?.duration).toBeCloseTo(1.0, 2);

      // CPU Time
      expect(cont?.cpuTime).toBe(0.4);
      expect(cand?.cpuTime).toBe(0.9);
    });

    it("gives a CPU time of 0 when a fabricated hash omits cpu_time (JS difference)", () => {
      // Deliberate JS difference: Ruby leaves cpu_time nil here.
      ex.use(() => true);
      ex.try(() => true);
      ex.fabricateDurationsForTestingPurposes({ control: { duration: 0.5 } });
      ex.run();

      expect(ex.publishedResult?.control?.duration).toBe(0.5);
      expect(ex.publishedResult?.control?.cpuTime).toBe(0);
    });

    it("returns actual durations if fabricated ones are omitted for some blocks (old version)", () => {
      ex.use(() => true);
      ex.try(() => {
        sleepSync(100);
        return true;
      });
      ex.fabricateDurationsForTestingPurposes({ control: 0.5 });

      ex.run();

      const cont = ex.publishedResult?.control;
      const cand = ex.publishedResult?.candidates[0];
      expect(cont?.duration).toBeCloseTo(0.5, 2);
      // Looser tolerance than Ruby's 0.01 to keep CI timing noise out.
      expect(Math.abs((cand?.duration ?? 0) - 0.1)).toBeLessThan(0.05);
    });

    it("returns actual durations if fabricated ones are omitted for some blocks (new version)", () => {
      ex.use(() => true);
      ex.try(() => {
        const start = performance.now();
        let sink = 0;
        while (performance.now() - start < 100) {
          // Perform some CPU-intensive work
          for (let i = 1; i <= 1000; i++) sink += i * i;
        }
        return sink > 0;
      });
      ex.fabricateDurationsForTestingPurposes({ control: { duration: 0.5, cpu_time: 0.4 } });
      ex.run();

      const cont = ex.publishedResult?.control;
      const cand = ex.publishedResult?.candidates[0];

      // Fabricated durations
      expect(cont?.duration).toBeCloseTo(0.5, 2);
      expect(cont?.cpuTime).toBeCloseTo(0.4, 2);

      // Measured durations (looser tolerance than Ruby's 0.01)
      expect(Math.abs((cand?.duration ?? 0) - 0.1)).toBeLessThan(0.05);
      expect(Math.abs((cand?.cpuTime ?? 0) - 0.1)).toBeLessThan(0.05);
    });
  });

  describe("JS-specific behavior", () => {
    it("requires a function for try() and use() (JS difference)", () => {
      expect(() => ex.use("nope" as unknown as () => unknown)).toThrow(TypeError);
      expect(() => ex.try(undefined as unknown as () => unknown)).toThrow(TypeError);
    });

    it("throws a TypeError when adding behaviors after running (Ruby: FrozenError)", () => {
      ex.use(() => 1);
      ex.run();
      expect(() => ex.try(() => 2)).toThrow(TypeError);
    });

    it("throws a TypeError when merging context after running (Ruby: FrozenError)", () => {
      ex.context({ a: 1 });
      ex.use(() => 1);
      ex.run();
      expect(() => ex.context({ b: 2 })).toThrow(TypeError);
      expect(ex.context()).toEqual({ a: 1 });
    });

    describe("hooks returning a Promise during a synchronous run", () => {
      function setup(): Fake {
        const e = new Fake();
        e.use(() => "control");
        e.try(() => "candidate");
        return e;
      }

      function lastOp(e: Fake): [RaisedOperation | undefined, unknown] {
        const [op, error] = e.exceptions.pop() ?? [];
        return [op, error];
      }

      it("routes a promise from compare to raised('compare')", () => {
        const e = setup();
        e.compare(async () => true);
        expect(e.run()).toBe("control");
        const [op, error] = lastOp(e);
        expect(op).toBe("compare");
        expect(error).toBeInstanceOf(TypeError);
        expect(e.publishedResult?.mismatched()).toBe(true);
      });

      it("routes a promise from compareErrors to raised('compare')", () => {
        const e = new Fake();
        e.use(() => {
          throw new Error("a");
        });
        e.try(() => {
          throw new Error("b");
        });
        e.compareErrors(async () => true);
        expect(() => e.run()).toThrow("a");
        const [op, error] = lastOp(e);
        expect(op).toBe("compare");
        expect(error).toBeInstanceOf(TypeError);
      });

      it("routes a promise from ignore to raised('ignore')", () => {
        const e = new Fake();
        e.use(() => 1);
        e.try(() => 2);
        e.ignore(async () => true);
        expect(e.run()).toBe(1);
        const [op, error] = lastOp(e);
        expect(op).toBe("ignore");
        expect(error).toBeInstanceOf(TypeError);
        expect(e.publishedResult?.ignored()).toBe(false);
      });

      it("routes a promise from runIf to raised('run_if')", () => {
        const e = setup();
        let candidateRan = false;
        e.try("other", () => {
          candidateRan = true;
        });
        e.runIf(async () => true);
        expect(e.run()).toBe("control");
        const [op, error] = lastOp(e);
        expect(op).toBe("run_if");
        expect(error).toBeInstanceOf(TypeError);
        expect(candidateRan).toBe(false);
      });

      it("routes a promise from enabled to raised('enabled')", () => {
        const e = setup();
        e.enabled = async () => true;
        expect(e.run()).toBe("control");
        const [op, error] = lastOp(e);
        expect(op).toBe("enabled");
        expect(error).toBeInstanceOf(TypeError);
        expect(e.publishedResult).toBeUndefined();
      });

      it("throws the TypeError from beforeRun out of run", () => {
        const e = setup();
        e.beforeRun(async () => {});
        expect(() => e.run()).toThrow(TypeError);
      });

      it("throws the TypeError from afterRun out of run", () => {
        const e = setup();
        e.afterRun(async () => {});
        expect(() => e.run()).toThrow(TypeError);
        expect(e.publishedResult).toBeUndefined();
      });
    });

    it("fires and forgets an async publish in a sync run, routing rejection to raised('publish')", async () => {
      const boom = new Error("async boom");
      ex.publish = () => Promise.reject(boom);
      ex.use(() => "control");
      ex.try(() => "candidate");

      expect(ex.run()).toBe("control");
      expect(ex.exceptions).toEqual([]);

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(ex.exceptions).toEqual([["publish", boom]]);
    });
  });
});
