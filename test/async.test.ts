import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Experiment,
  MismatchError,
  Observation,
  type RaisedOperation,
  Result,
  runAsync,
  Scientist,
  scienceAsync,
  withScience,
} from "../src/index";

// The project compiles without DOM/Node types, so declare the timer we use.
declare function setTimeout(callback: () => void, ms: number): unknown;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function later<T>(value: T, ms = 1): Promise<T> {
  await sleep(ms);
  return value;
}

async function rejectLater(error: unknown, ms = 1): Promise<never> {
  await sleep(ms);
  throw error;
}

class AsyncExperiment<T = unknown> extends Experiment<T> {
  static override raiseOnMismatches: boolean | undefined;

  isEnabled: () => boolean | PromiseLike<boolean> = () => true;
  publishImpl: (result: Result<T>) => void | PromiseLike<void> = () => {};
  published: Result<T>[] = [];
  exceptions: [RaisedOperation, unknown][] = [];

  enabled(): boolean | PromiseLike<boolean> {
    return this.isEnabled();
  }

  publish(result: Result<T>): void | PromiseLike<void> {
    this.published.push(result);
    return this.publishImpl(result);
  }

  override raised(operation: RaisedOperation, error: unknown): void {
    this.exceptions.push([operation, error]);
  }
}

class RaisingExperiment<T = unknown> extends AsyncExperiment<T> {
  override raised(_operation: RaisedOperation, error: unknown): void {
    throw error;
  }
}

describe("Experiment#runAsync", () => {
  let ex: AsyncExperiment<unknown>;

  beforeEach(() => {
    ex = new AsyncExperiment("async");
  });

  afterEach(() => {
    AsyncExperiment.raiseOnMismatches = undefined;
  });

  it("returns a promise resolving to the control value", async () => {
    ex.use(() => later(1));
    ex.try(() => later(1));
    const promise = ex.runAsync();
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).resolves.toBe(1);
    expect(ex.published).toHaveLength(1);
    expect(ex.published[0]?.matched()).toBe(true);
  });

  it("awaits behaviors sequentially, never concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const behavior = (name: string) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${name}`);
      await sleep(10);
      order.push(`end:${name}`);
      inFlight--;
      return 42;
    };
    ex.use(behavior("control"));
    ex.try("a", behavior("a"));
    ex.try("b", behavior("b"));
    ex.try("c", behavior("c"));

    expect(await ex.runAsync()).toBe(42);
    expect(maxInFlight).toBe(1);
    expect(order).toHaveLength(8);
    for (let i = 0; i < order.length; i += 2) {
      const name = order[i]?.slice("start:".length);
      expect(order[i]).toBe(`start:${name}`);
      expect(order[i + 1]).toBe(`end:${name}`);
    }
  });

  it("measures durations that cover the awaited time", async () => {
    ex.use(async () => {
      await sleep(50);
      return 1;
    });
    ex.try(async () => {
      await sleep(50);
      return 1;
    });
    await ex.runAsync();
    const result = ex.published[0] as Result<unknown>;
    for (const observation of result.observations) {
      expect(observation.duration).toBeGreaterThanOrEqual(0.04);
      expect(observation.duration).toBeLessThan(5);
      expect(typeof observation.cpuTime).toBe("number");
      expect(observation.cpuTime).toBeGreaterThanOrEqual(0);
    }
  });

  it("works with synchronous behaviors", async () => {
    ex.use(() => "sync");
    ex.try(() => "sync");
    await expect(ex.runAsync()).resolves.toBe("sync");
    expect(ex.published[0]?.matched()).toBe(true);
  });

  it("mixes sync and async behaviors and compares resolved values", async () => {
    ex.use(() => ({ a: [1, 2] }));
    ex.try(async () => ({ a: [1, 2] }));
    await ex.runAsync();
    const result = ex.published[0] as Result<unknown>;
    expect(result.matched()).toBe(true);
    expect(result.candidates[0]?.value).toEqual({ a: [1, 2] });
  });

  it("captures candidate rejections as exceptions", async () => {
    const error = new Error("candidate boom");
    ex.use(() => later("ok"));
    ex.try(() => rejectLater(error));
    await expect(ex.runAsync()).resolves.toBe("ok");
    const result = ex.published[0] as Result<unknown>;
    const candidate = result.candidates[0] as Observation<unknown>;
    expect(candidate.raised).toBe(true);
    expect(candidate.exception).toBe(error);
    expect(candidate.value).toBeUndefined();
    expect(result.mismatched()).toBe(true);
  });

  it("captures synchronous throws from async-mode behaviors", async () => {
    ex.use(() => later("ok"));
    ex.try(() => {
      throw new RangeError("sync throw");
    });
    await ex.runAsync();
    const candidate = ex.published[0]?.candidates[0] as Observation<unknown>;
    expect(candidate.raised).toBe(true);
    expect(candidate.exception).toBeInstanceOf(RangeError);
  });

  it("compares rejections by class and message", async () => {
    ex.use(() => rejectLater(new TypeError("same")));
    ex.try("same", () => rejectLater(new TypeError("same")));
    ex.try("other-message", () => rejectLater(new TypeError("different")));
    ex.try("other-class", () => rejectLater(new RangeError("same")));

    await expect(ex.runAsync()).rejects.toThrow(TypeError);
    const result = ex.published[0] as Result<unknown>;
    expect(result.mismatchedObservations.map((o) => o.name).sort()).toEqual([
      "other-class",
      "other-message",
    ]);
  });

  it("re-throws the control rejection with identity preserved", async () => {
    const error = new Error("control boom");
    ex.use(() => rejectLater(error));
    ex.try(() => rejectLater(new Error("control boom")));
    let caught: unknown;
    try {
      await ex.runAsync();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(ex.published[0]?.matched()).toBe(true);
  });

  it("re-throws non-Error control rejections as-is", async () => {
    const reason = { code: 7 };
    ex.use(() => Promise.reject(reason));
    ex.try(() => Promise.reject({ code: 7 }));
    await expect(ex.runAsync()).rejects.toBe(reason);
  });

  it("runs the named behavior with the name argument", async () => {
    ex.use(() => later("control"));
    ex.try("cand", () => later("candidate"));
    await expect(ex.runAsync("cand")).resolves.toBe("candidate");
    const result = ex.published[0] as Result<unknown>;
    expect(result.control?.name).toBe("cand");
    expect(result.candidates.map((o) => o.name)).toEqual(["control"]);
  });

  it("rejects with BehaviorMissingError when the named behavior is missing", async () => {
    ex.try(() => later(1));
    await expect(ex.runAsync()).rejects.toMatchObject({
      name: "BehaviorMissingError",
      behaviorName: "control",
    });
  });

  it("uses fabricated durations", async () => {
    ex.use(() => later(1, 20));
    ex.try(() => later(1, 20));
    ex.fabricateDurationsForTestingPurposes({
      control: 1.5,
      candidate: { duration: 0.5, cpu_time: 0.25 },
    });
    await ex.runAsync();
    const result = ex.published[0] as Result<unknown>;
    expect(result.control?.duration).toBe(1.5);
    expect(result.control?.cpuTime).toBe(0);
    expect(result.candidates[0]?.duration).toBe(0.5);
    expect(result.candidates[0]?.cpuTime).toBe(0.25);
  });

  describe("disabled experiments", () => {
    it("only awaits the control when enabled() resolves false", async () => {
      const candidate = vi.fn(() => later(2));
      ex.isEnabled = () => later(false);
      ex.use(() => later(1));
      ex.try(candidate);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(candidate).not.toHaveBeenCalled();
      expect(ex.published).toHaveLength(0);
    });

    it("still rejects with the control error when disabled", async () => {
      const error = new Error("nope");
      ex.isEnabled = () => false;
      ex.use(() => rejectLater(error));
      ex.try(() => later(2));
      await expect(ex.runAsync()).rejects.toBe(error);
    });

    it("only awaits the control when there are no candidates", async () => {
      const enabled = vi.fn(() => true);
      ex.isEnabled = enabled;
      ex.use(() => later(1));
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(enabled).not.toHaveBeenCalled();
      expect(ex.published).toHaveLength(0);
    });

    it("skips beforeRun when disabled", async () => {
      const before = vi.fn();
      ex.isEnabled = () => later(false);
      ex.beforeRun(before);
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(before).not.toHaveBeenCalled();
    });
  });

  describe("async hooks", () => {
    it("awaits enabled()", async () => {
      ex.isEnabled = () => later(true, 5);
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(ex.published).toHaveLength(1);
    });

    it("awaits runIf and skips the experiment when it resolves false", async () => {
      const candidate = vi.fn(() => 2);
      ex.runIf(() => later(false, 5));
      ex.use(() => 1);
      ex.try(candidate);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(candidate).not.toHaveBeenCalled();
      expect(ex.published).toHaveLength(0);
    });

    it("awaits runIf and runs the experiment when it resolves true", async () => {
      ex.runIf(() => later(true, 5));
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(ex.published).toHaveLength(1);
    });

    it("awaits compare", async () => {
      const compare = vi.fn((a: unknown, b: unknown) => later(String(a) === String(b), 5));
      ex.compare(compare);
      ex.use(() => later(1));
      ex.try(() => later("1"));
      await ex.runAsync();
      expect(compare).toHaveBeenCalledWith(1, "1");
      expect(ex.published[0]?.matched()).toBe(true);
    });

    it("treats a compare resolving false as a mismatch", async () => {
      ex.compare(() => later(false, 5));
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(ex.published[0]?.mismatched()).toBe(true);
    });

    it("awaits compareErrors", async () => {
      const compareErrors = vi.fn((a: unknown, b: unknown) =>
        later((a as Error).message === (b as Error).message, 5),
      );
      ex.compareErrors(compareErrors);
      ex.use(() => rejectLater(new TypeError("x")));
      ex.try(() => rejectLater(new RangeError("x")));
      await expect(ex.runAsync()).rejects.toThrow(TypeError);
      expect(compareErrors).toHaveBeenCalledTimes(1);
      expect(ex.published[0]?.matched()).toBe(true);
    });

    it("awaits ignore and receives values", async () => {
      const ignore = vi.fn((control: unknown, candidate: unknown) =>
        later(control === 1 && candidate === 2, 5),
      );
      ex.ignore(ignore);
      ex.use(() => later(1));
      ex.try(() => later(2));
      await ex.runAsync();
      const result = ex.published[0] as Result<unknown>;
      expect(ignore).toHaveBeenCalledWith(1, 2);
      expect(result.ignored()).toBe(true);
      expect(result.mismatched()).toBe(false);
      expect(result.matched()).toBe(false);
    });

    it("awaits ignore callbacks in order and stops at the first truthy one", async () => {
      const calls: string[] = [];
      ex.ignore(async () => {
        await sleep(5);
        calls.push("first");
        return false;
      });
      ex.ignore(async () => {
        calls.push("second");
        return true;
      });
      ex.ignore(async () => {
        calls.push("third");
        return true;
      });
      ex.use(() => 1);
      ex.try(() => 2);
      await ex.runAsync();
      expect(calls).toEqual(["first", "second"]);
      expect(ex.published[0]?.ignored()).toBe(true);
    });

    it("awaits beforeRun before any behavior starts", async () => {
      const order: string[] = [];
      ex.beforeRun(async () => {
        await sleep(10);
        order.push("before");
      });
      ex.use(() => {
        order.push("control");
        return 1;
      });
      ex.try(() => {
        order.push("candidate");
        return 1;
      });
      await ex.runAsync();
      expect(order[0]).toBe("before");
      expect(order).toHaveLength(3);
    });

    it("awaits afterRun with the result before publishing", async () => {
      const order: string[] = [];
      let seen: Result<unknown> | undefined;
      ex.afterRun(async (result) => {
        await sleep(10);
        seen = result;
        order.push("after");
      });
      ex.publishImpl = () => {
        order.push("publish");
      };
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(order).toEqual(["after", "publish"]);
      expect(seen).toBe(ex.published[0]);
    });

    it("awaits publish before resolving", async () => {
      let done = false;
      ex.publishImpl = async () => {
        await sleep(10);
        done = true;
      };
      ex.use(() => 1);
      ex.try(() => 1);
      await ex.runAsync();
      expect(done).toBe(true);
    });

    it("propagates beforeRun rejections", async () => {
      const error = new Error("before failed");
      ex.beforeRun(() => rejectLater(error));
      ex.use(() => 1);
      ex.try(() => 1);
      await expect(ex.runAsync()).rejects.toBe(error);
    });

    it("propagates afterRun rejections", async () => {
      const error = new Error("after failed");
      ex.afterRun(() => rejectLater(error));
      ex.use(() => 1);
      ex.try(() => 1);
      await expect(ex.runAsync()).rejects.toBe(error);
      expect(ex.published).toHaveLength(0);
    });
  });

  describe("async hook errors are routed to raised()", () => {
    it("routes enabled rejections to 'enabled' and returns the control value", async () => {
      const error = new Error("enabled failed");
      const candidate = vi.fn(() => 2);
      ex.isEnabled = () => rejectLater(error);
      ex.use(() => later(1));
      ex.try(candidate);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["enabled", error]]);
      expect(candidate).not.toHaveBeenCalled();
    });

    it("routes synchronous enabled throws to 'enabled'", async () => {
      const error = new Error("enabled threw");
      ex.isEnabled = () => {
        throw error;
      };
      ex.use(() => 1);
      ex.try(() => 2);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["enabled", error]]);
    });

    it("routes runIf rejections to 'run_if'", async () => {
      const error = new Error("run_if failed");
      const candidate = vi.fn(() => 2);
      ex.runIf(() => rejectLater(error));
      ex.use(() => later(1));
      ex.try(candidate);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["run_if", error]]);
      expect(candidate).not.toHaveBeenCalled();
    });

    it("routes compare rejections to 'compare' and counts a mismatch", async () => {
      const error = new Error("compare failed");
      ex.compare(() => rejectLater(error));
      ex.use(() => 1);
      ex.try(() => 1);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["compare", error]]);
      expect(ex.published[0]?.mismatched()).toBe(true);
    });

    it("routes compareErrors rejections to 'compare'", async () => {
      const error = new Error("compare_errors failed");
      ex.compareErrors(() => rejectLater(error));
      ex.use(() => later(1));
      ex.try(() => rejectLater(new Error("x")));
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["compare", error]]);
      expect(ex.published[0]?.mismatched()).toBe(true);
    });

    it("routes ignore rejections to 'ignore' and treats them as not ignored", async () => {
      const error = new Error("ignore failed");
      ex.ignore(() => rejectLater(error));
      ex.use(() => 1);
      ex.try(() => 2);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["ignore", error]]);
      expect(ex.published[0]?.mismatched()).toBe(true);
      expect(ex.published[0]?.ignored()).toBe(false);
    });

    it("keeps checking later ignore callbacks after one rejects", async () => {
      const error = new Error("ignore failed");
      ex.ignore(() => rejectLater(error));
      ex.ignore(() => later(true));
      ex.use(() => 1);
      ex.try(() => 2);
      await ex.runAsync();
      expect(ex.exceptions).toEqual([["ignore", error]]);
      expect(ex.published[0]?.ignored()).toBe(true);
    });

    it("routes publish rejections to 'publish' and returns the control value", async () => {
      const error = new Error("publish failed");
      ex.publishImpl = () => rejectLater(error);
      ex.use(() => 1);
      ex.try(() => 1);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["publish", error]]);
    });

    it("routes synchronous publish throws to 'publish'", async () => {
      const error = new Error("publish threw");
      ex.publishImpl = () => {
        throw error;
      };
      ex.use(() => 1);
      ex.try(() => 1);
      await expect(ex.runAsync()).resolves.toBe(1);
      expect(ex.exceptions).toEqual([["publish", error]]);
    });

    it("routes clean errors to 'clean' when reading cleanedValue", async () => {
      const error = new Error("clean failed");
      ex.clean(() => {
        throw error;
      });
      ex.use(() => later(1));
      ex.try(() => later(1));
      await ex.runAsync();
      expect(ex.published[0]?.control?.cleanedValue).toBe(1);
      expect(ex.exceptions).toEqual([["clean", error]]);
    });

    it("rejects the run with the hook error when raised() re-throws", async () => {
      const error = new Error("publish failed");
      const strict = new RaisingExperiment("strict");
      strict.publishImpl = () => rejectLater(error);
      strict.use(() => 1);
      strict.try(() => 1);
      await expect(strict.runAsync()).rejects.toBe(error);
    });

    it("rejects with the compare error when raised() re-throws", async () => {
      const error = new Error("compare failed");
      const strict = new RaisingExperiment("strict");
      strict.compare(() => rejectLater(error));
      strict.use(() => 1);
      strict.try(() => 1);
      await expect(strict.runAsync()).rejects.toBe(error);
    });
  });

  describe("raiseOnMismatches", () => {
    it("rejects with MismatchError on a mismatch", async () => {
      ex.raiseOnMismatches = true;
      ex.use(() => later("control"));
      ex.try(() => later("candidate"));
      const error = await ex.runAsync().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(MismatchError);
      const mismatch = error as MismatchError;
      expect(mismatch.experimentName).toBe("async");
      expect(mismatch.result).toBe(ex.published[0]);
      expect(mismatch.message).toContain("experiment 'async' observations mismatched");
      expect(mismatch.message).toContain("control:\n  'control'");
      expect(mismatch.message).toContain("candidate:\n  'candidate'");
    });

    it("uses the class-level default", async () => {
      AsyncExperiment.raiseOnMismatches = true;
      ex.use(() => later(1));
      ex.try(() => later(2));
      await expect(ex.runAsync()).rejects.toBeInstanceOf(MismatchError);
    });

    it("does not reject when the mismatch is ignored asynchronously", async () => {
      ex.raiseOnMismatches = true;
      ex.ignore(() => later(true));
      ex.use(() => later(1));
      ex.try(() => later(2));
      await expect(ex.runAsync()).resolves.toBe(1);
    });

    it("does not reject when an async compare matches", async () => {
      ex.raiseOnMismatches = true;
      ex.compare(() => later(true));
      ex.use(() => later(1));
      ex.try(() => later(2));
      await expect(ex.runAsync()).resolves.toBe(1);
    });

    it("rejects with MismatchError even when the control rejected", async () => {
      ex.raiseOnMismatches = true;
      ex.use(() => rejectLater(new Error("control")));
      ex.try(() => later(1));
      await expect(ex.runAsync()).rejects.toBeInstanceOf(MismatchError);
    });

    it("rejects with the raiseWith class", async () => {
      class CustomMismatch extends Error {
        constructor(
          readonly experimentName: string,
          readonly result: Result<unknown>,
        ) {
          super(`custom ${experimentName}`);
        }
      }
      ex.raiseOnMismatches = true;
      ex.raiseWith(CustomMismatch);
      ex.use(() => later(1));
      ex.try(() => later(2));
      await expect(ex.runAsync()).rejects.toBeInstanceOf(CustomMismatch);
    });

    it("publishes before rejecting", async () => {
      ex.raiseOnMismatches = true;
      ex.publishImpl = () => sleep(5);
      ex.use(() => 1);
      ex.try(() => 2);
      await expect(ex.runAsync()).rejects.toBeInstanceOf(MismatchError);
      expect(ex.published).toHaveLength(1);
    });
  });

  describe("Observation.rescues", () => {
    const original = Observation.rescues;
    afterEach(() => {
      Observation.rescues = original;
    });

    it("lets rejections it doesn't rescue propagate out of runAsync", async () => {
      class Fatal extends Error {}
      const fatal = new Fatal("fatal");
      Observation.rescues = (error) => !(error instanceof Fatal);
      ex.use(() => later(1));
      ex.try(() => rejectLater(fatal));
      await expect(ex.runAsync()).rejects.toBe(fatal);
      expect(ex.published).toHaveLength(0);
    });
  });

  it("freezes the experiment once runAsync starts", async () => {
    ex.use(() => later(1));
    ex.try(() => later(1));
    const promise = ex.runAsync();
    expect(() => ex.try("late", () => 1)).toThrow(TypeError);
    expect(() => ex.context({ late: true })).toThrow(TypeError);
    await promise;
  });
});

describe("Observation.createAsync", () => {
  const ex = new AsyncExperiment<unknown>("obs");

  it("awaits the block and records its value", async () => {
    const observation = await Observation.createAsync("test", ex, () => later("value", 50));
    expect(observation).toBeInstanceOf(Observation);
    expect(observation.name).toBe("test");
    expect(observation.experiment).toBe(ex);
    expect(observation.value).toBe("value");
    expect(observation.raised).toBe(false);
    expect(observation.exception).toBeUndefined();
    expect(observation.duration).toBeGreaterThanOrEqual(0.04);
    expect(Object.isFrozen(observation)).toBe(true);
  });

  it("records rejections", async () => {
    const error = new Error("rejected");
    const observation = await Observation.createAsync("test", ex, () => rejectLater(error));
    expect(observation.raised).toBe(true);
    expect(observation.exception).toBe(error);
    expect(observation.value).toBeUndefined();
  });

  it("records synchronous throws", async () => {
    const error = new Error("thrown");
    const observation = await Observation.createAsync("test", ex, () => {
      throw error;
    });
    expect(observation.raised).toBe(true);
    expect(observation.exception).toBe(error);
  });

  it("accepts synchronous blocks", async () => {
    const observation = await Observation.createAsync("test", ex, () => 5);
    expect(observation.value).toBe(5);
  });

  it("uses a fabricated duration", async () => {
    const observation = await Observation.createAsync("test", ex, () => later(1, 20), {
      fabricatedDuration: { duration: 2, cpuTime: 1 },
    });
    expect(observation.duration).toBe(2);
    expect(observation.cpuTime).toBe(1);
  });

  it("produces observations comparable with equivalentTo", async () => {
    const a = await Observation.createAsync("a", ex, () => rejectLater(new TypeError("m")));
    const b = await Observation.createAsync("b", ex, () => rejectLater(new TypeError("m")));
    const c = await Observation.createAsync("c", ex, () => rejectLater(new TypeError("n")));
    const d = await Observation.createAsync("d", ex, () => later({ x: 1 }));
    const e = await Observation.createAsync("e", ex, () => ({ x: 1 }));
    expect(a.equivalentTo(b)).toBe(true);
    expect(a.equivalentTo(c)).toBe(false);
    expect(a.equivalentTo(d)).toBe(false);
    expect(d.equivalentTo(e)).toBe(true);
  });

  it("propagates rejections that Observation.rescues rejects", async () => {
    const original = Observation.rescues;
    const fatal = new Error("fatal");
    Observation.rescues = (error) => error !== fatal;
    try {
      await expect(Observation.createAsync("x", ex, () => rejectLater(fatal))).rejects.toBe(fatal);
    } finally {
      Observation.rescues = original;
    }
  });
});

describe("Result.createAsync", () => {
  let ex: AsyncExperiment<unknown>;

  beforeEach(() => {
    ex = new AsyncExperiment("result");
  });

  it("awaits an async comparator", async () => {
    ex.compare((a, b) => later(a === b, 5));
    const control = new Observation("control", ex, () => 1);
    const same = new Observation("same", ex, () => 1);
    const different = new Observation("different", ex, () => 2);
    const result = await Result.createAsync(ex, [control, same, different], control);
    expect(result).toBeInstanceOf(Result);
    expect(result.control).toBe(control);
    expect(result.candidates).toEqual([same, different]);
    expect(result.mismatchedObservations).toEqual([different]);
    expect(result.mismatched()).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("awaits async ignore callbacks", async () => {
    ex.ignore((control, candidate) => later(control === 1 && candidate === 2, 5));
    const control = new Observation("control", ex, () => 1);
    const candidate = new Observation("candidate", ex, () => 2);
    const result = await Result.createAsync(ex, [control, candidate], control);
    expect(result.ignoredObservations).toEqual([candidate]);
    expect(result.mismatchedObservations).toEqual([]);
    expect(result.ignored()).toBe(true);
    expect(result.matched()).toBe(false);
  });

  it("awaits an async error comparator", async () => {
    ex.compareErrors(() => later(true, 5));
    const control = new Observation("control", ex, () => {
      throw new TypeError("a");
    });
    const candidate = new Observation("candidate", ex, () => {
      throw new RangeError("b");
    });
    const result = await Result.createAsync(ex, [control, candidate], control);
    expect(result.matched()).toBe(true);
  });

  it("routes comparator and ignore rejections to raised()", async () => {
    const compareError = new Error("compare");
    const ignoreError = new Error("ignore");
    ex.compare(() => rejectLater(compareError));
    ex.ignore(() => rejectLater(ignoreError));
    const control = new Observation("control", ex, () => 1);
    const candidate = new Observation("candidate", ex, () => 1);
    const result = await Result.createAsync(ex, [control, candidate], control);
    expect(ex.exceptions).toEqual([
      ["compare", compareError],
      ["ignore", ignoreError],
    ]);
    expect(result.mismatchedObservations).toEqual([candidate]);
  });

  it("evaluates comparisons sequentially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    ex.compare(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight--;
      return true;
    });
    const control = new Observation("control", ex, () => 1);
    const candidates = ["a", "b", "c"].map((n) => new Observation(n, ex, () => 1));
    const result = await Result.createAsync(ex, [control, ...candidates], control);
    expect(maxInFlight).toBe(1);
    expect(result.matched()).toBe(true);
  });

  it("defaults to no observations", async () => {
    const result = await Result.createAsync(ex);
    expect(result.observations).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.control).toBeUndefined();
    expect(result.matched()).toBe(true);
  });

  it("exposes the experiment name and context", async () => {
    ex.context({ foo: "bar" });
    const control = new Observation("control", ex, () => 1);
    const result = await Result.createAsync(ex, [control], control);
    expect(result.experimentName).toBe("result");
    expect(result.context).toEqual({ foo: "bar" });
  });
});

describe("runAsync / scienceAsync helpers", () => {
  const instances: AsyncExperiment<unknown>[] = [];

  class TrackedExperiment<T = unknown> extends AsyncExperiment<T> {
    constructor(name: string) {
      super(name);
      instances.push(this as AsyncExperiment<unknown>);
    }
  }

  beforeEach(() => {
    instances.length = 0;
    Experiment.setDefault(TrackedExperiment);
  });

  afterEach(() => {
    Experiment.setDefault(null);
  });

  it("runAsync builds an experiment of the default class and awaits it", async () => {
    const value = await runAsync<number>("helper", (e) => {
      e.use(() => later(1));
      e.try(() => later(1));
    });
    expect(value).toBe(1);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.name).toBe("helper");
    expect(instances[0]?.published[0]?.matched()).toBe(true);
  });

  it("runAsync awaits an async configure callback", async () => {
    const value = await runAsync<string>("helper", async (e) => {
      await sleep(5);
      e.use(() => later("a"));
      e.try(() => later("a"));
    });
    expect(value).toBe("a");
    expect(instances[0]?.published).toHaveLength(1);
  });

  it("runAsync supports the run option", async () => {
    const value = await runAsync<string>(
      "helper",
      (e) => {
        e.use(() => later("control"));
        e.try("cand", () => later("candidate"));
      },
      { run: "cand" },
    );
    expect(value).toBe("candidate");
  });

  it("scienceAsync is an alias of runAsync", async () => {
    const value = await scienceAsync<number>("helper", (e) => {
      e.use(() => later(3));
      e.try(() => later(3));
    });
    expect(value).toBe(3);
  });

  it("Scientist.runAsync is the same helper", async () => {
    expect(Scientist.runAsync).toBe(runAsync);
    const value = await Scientist.runAsync<number>("helper", (e) => {
      e.use(() => later(4));
      e.try(() => later(4));
    });
    expect(value).toBe(4);
  });

  it("propagates control rejections with identity preserved", async () => {
    const error = new Error("control");
    await expect(
      runAsync("helper", (e) => {
        e.use(() => rejectLater(error));
        e.try(() => later(1));
      }),
    ).rejects.toBe(error);
  });

  it("rejects with MismatchError when raiseOnMismatches is set", async () => {
    await expect(
      runAsync("helper", (e) => {
        e.raiseOnMismatches = true;
        e.use(() => later(1));
        e.try(() => later(2));
      }),
    ).rejects.toBeInstanceOf(MismatchError);
  });

  it("only awaits the control with the never-enabled DefaultExperiment", async () => {
    Experiment.setDefault(null);
    const candidate = vi.fn(() => later(2));
    const value = await runAsync<number>("default", (e) => {
      e.use(() => later(1));
      e.try(candidate);
    });
    expect(value).toBe(1);
    expect(candidate).not.toHaveBeenCalled();
  });

  describe("Scientist#scienceAsync", () => {
    class Repo extends Scientist {
      override defaultScientistContext(): Record<string, unknown> {
        return { repo: true };
      }

      find(id: number): Promise<number> {
        return this.scienceAsync<number>("find", (e) => {
          e.use(() => later(id));
          e.try(() => later(id));
        });
      }
    }

    it("runs the experiment and merges the default context", async () => {
      await expect(new Repo().find(7)).resolves.toBe(7);
      const experiment = instances[0] as AsyncExperiment<unknown>;
      expect(experiment.name).toBe("find");
      expect(experiment.context()).toEqual({ repo: true });
      expect(experiment.published[0]?.context).toEqual({ repo: true });
    });

    it("awaits an async configure callback and supports the run option", async () => {
      const value = await new Repo().scienceAsync<string>(
        "configure",
        async (e) => {
          await sleep(5);
          e.context({ extra: 1 });
          e.use(() => later("control"));
          e.try("cand", () => later("candidate"));
        },
        { run: "cand" },
      );
      expect(value).toBe("candidate");
      expect(instances[0]?.context()).toEqual({ repo: true, extra: 1 });
    });

    it("is provided by withScience as well", async () => {
      class Base {
        base = true;
      }
      class Mixed extends withScience(Base) {
        override defaultScientistContext(): Record<string, unknown> {
          return { mixed: true };
        }
      }
      const value = await new Mixed().scienceAsync<number>("mixed", (e) => {
        e.use(() => later(9));
        e.try(() => later(9));
      });
      expect(value).toBe(9);
      expect(instances[0]?.context()).toEqual({ mixed: true });
    });
  });
});
