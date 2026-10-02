import { afterEach, describe, expect, it } from "vitest";
import {
  BadBehavior,
  BadBehaviorError,
  BehaviorMissing,
  BehaviorMissingError,
  BehaviorNotUnique,
  BehaviorNotUniqueError,
  DefaultExperiment,
  Experiment,
  MismatchError,
  NoValue,
  NoValueError,
  Observation,
  Result,
} from "../src/index";

/** Enabled experiment that runs behaviors in registration order. */
class Fake<T = unknown> extends Experiment<T> {
  published: Result<T> | undefined;

  enabled(): boolean {
    return true;
  }

  publish(result: Result<T>): void {
    this.published = result;
  }

  protected override shuffle(names: string[]): string[] {
    return names;
  }
}

afterEach(() => {
  Fake.raiseOnMismatches = undefined;
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

describe("aliases", () => {
  it("exports Ruby-style aliases", () => {
    expect(BadBehavior).toBe(BadBehaviorError);
    expect(BehaviorMissing).toBe(BehaviorMissingError);
    expect(BehaviorNotUnique).toBe(BehaviorNotUniqueError);
    expect(NoValue).toBe(NoValueError);
  });
});

describe("BadBehaviorError", () => {
  const ex = new DefaultExperiment("exp");

  it("carries the experiment, behavior name and message", () => {
    const error = new BadBehaviorError(ex, "thing", "smoking in the bathroom");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BadBehaviorError");
    expect(error.message).toBe("smoking in the bathroom");
    expect(error.experiment).toBe(ex);
    expect(error.behaviorName).toBe("thing");
  });

  it("BehaviorMissingError formats like Ruby", () => {
    const error = new BehaviorMissingError(ex, "control");
    expect(error).toBeInstanceOf(BadBehaviorError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BehaviorMissingError");
    expect(error.message).toBe("exp missing control behavior");
    expect(error.experiment).toBe(ex);
    expect(error.behaviorName).toBe("control");
  });

  it("BehaviorNotUniqueError formats like Ruby", () => {
    const error = new BehaviorNotUniqueError(ex, "candidate");
    expect(error).toBeInstanceOf(BadBehaviorError);
    expect(error.name).toBe("BehaviorNotUniqueError");
    expect(error.message).toBe("exp already has candidate behavior");
    expect(error.behaviorName).toBe("candidate");
  });

  it("is thrown by run and try", () => {
    const e = new Fake("exp");
    expect(() => e.run()).toThrow(BehaviorMissingError);
    expect(() => e.run()).toThrow("exp missing control behavior");
    const f = new Fake("exp");
    f.use(() => 1);
    expect(() => f.use(() => 2)).toThrow(BehaviorNotUniqueError);
    expect(() => f.use(() => 2)).toThrow("exp already has control behavior");
  });
});

describe("NoValueError", () => {
  it("formats like Ruby", () => {
    const ex = new DefaultExperiment("exp");
    const ob = new Observation("candidate", ex, () => 1);
    const error = new NoValueError(ob);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NoValueError");
    expect(error.message).toBe("candidate didn't return a value");
    expect(error.observation).toBe(ob);
  });
});

describe("MismatchError", () => {
  function mismatch(configure: (e: Fake) => void): MismatchError {
    const e = new Fake();
    e.raiseOnMismatches = true;
    configure(e);
    const error = catchError(() => e.run());
    expect(error).toBeInstanceOf(MismatchError);
    return error as MismatchError;
  }

  it("is a normal, catchable Error", () => {
    const error = mismatch((e) => {
      e.use(() => "foo");
      e.try(() => "bar");
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MismatchError");
    expect(String(error)).toContain("MismatchError: experiment 'experiment' observations");
  });

  it("has the name of the experiment and the result", () => {
    const e = new Fake("my-exp");
    e.raiseOnMismatches = true;
    e.use(() => 1);
    e.try(() => 2);
    const error = catchError(() => e.run()) as MismatchError;
    expect(error.experimentName).toBe("my-exp");
    expect(error.result).toBe(e.published);
  });

  it("formats nicely as a string", () => {
    const error = mismatch((e) => {
      e.use(() => "foo");
      e.try(() => "bar");
    });
    expect(error.message).toBe(
      "experiment 'experiment' observations mismatched:\ncontrol:\n  'foo'\ncandidate:\n  'bar'\n",
    );
  });

  it("lists every candidate", () => {
    const error = mismatch((e) => {
      e.use(() => 1);
      e.try("a", () => 2);
      e.try("b", () => ({ x: [1, 2] }));
    });
    expect(error.message).toBe(
      "experiment 'experiment' observations mismatched:\ncontrol:\n  1\na:\n  2\nb:\n  { x: [ 1, 2 ] }\n",
    );
  });

  it("uses cleaned values", () => {
    const error = mismatch((e) => {
      e.use(() => "fine");
      e.try(() => "not fine");
      e.clean(() => "So Clean");
    });
    expect(error.message).toMatch(/So Clean/);
  });

  it("includes the stack when an observation raises", () => {
    const error = mismatch((e) => {
      e.use(() => "value");
      e.try(() => {
        throw new Error("error");
      });
    });

    const lines = error.message.split("\n");
    expect(lines[0]).toBe("experiment 'experiment' observations mismatched:");
    expect(lines[1]).toBe("control:");
    expect(lines[2]).toBe("  'value'");
    expect(lines[3]).toBe("candidate:");
    expect(lines[4]).toBe("  [Error: error]");
    expect(lines[5]).toMatch(/^ {4}at .*errors\.test\.ts:\d+/);
    expect(error.message.endsWith("\n")).toBe(true);
  });

  it("formats a raised control too", () => {
    const error = mismatch((e) => {
      e.use(() => {
        throw new TypeError("control");
      });
      e.try(() => "candidate");
    });
    const lines = error.message.split("\n");
    expect(lines[1]).toBe("control:");
    expect(lines[2]).toBe("  [TypeError: control]");
    expect(lines[3]).toMatch(/^ {4}at /);
    expect(lines).toContain("candidate:");
    expect(lines).toContain("  'candidate'");
  });

  it("formats non-Error thrown values without a stack", () => {
    const error = mismatch((e) => {
      e.use(() => 1);
      e.try(() => {
        throw "string thrown";
      });
    });
    expect(error.message).toBe(
      "experiment 'experiment' observations mismatched:\ncontrol:\n  1\ncandidate:\n  'string thrown'\n\n",
    );
  });

  it("can be constructed directly", () => {
    const ex = new DefaultExperiment("direct");
    const a = new Observation("control", ex, () => 1);
    const b = new Observation("candidate", ex, () => 2);
    const error = new MismatchError("direct", new Result(ex, [a, b], a));
    expect(error.message).toBe(
      "experiment 'direct' observations mismatched:\ncontrol:\n  1\ncandidate:\n  2\n",
    );
  });

  it("lets subclasses override formatObservation", () => {
    class Terse extends MismatchError {
      override formatObservation(observation: Observation): string {
        return `${observation.name}=${String(observation.value)}`;
      }
    }

    const e = new Fake();
    e.raiseOnMismatches = true;
    e.raiseWith(Terse);
    e.use(() => 1);
    e.try(() => 2);

    const error = catchError(() => e.run());
    expect(error).toBeInstanceOf(Terse);
    expect(error).toBeInstanceOf(MismatchError);
    expect((error as Terse).name).toBe("Terse");
    expect((error as Terse).message).toBe(
      "experiment 'experiment' observations mismatched:\ncontrol=1\ncandidate=2\n",
    );
  });
});

describe("raiseWith", () => {
  it("raises a custom MismatchError subclass", () => {
    class CustomError extends MismatchError {}
    const e = new Fake();
    e.use(() => 1);
    e.try(() => 2);
    expect(e.raiseWith(CustomError)).toBe(CustomError);
    e.raiseOnMismatches = true;

    expect(() => e.run()).toThrow(CustomError);
  });

  it("accepts any class taking (experimentName, result)", () => {
    class Unrelated extends Error {
      constructor(
        readonly experimentName: string,
        readonly result: Result,
      ) {
        super(`custom ${experimentName}`);
      }
    }
    const e = new Fake("named");
    e.use(() => 1);
    e.try(() => 2);
    e.raiseWith(Unrelated);
    e.raiseOnMismatches = true;

    const error = catchError(() => e.run());
    expect(error).toBeInstanceOf(Unrelated);
    expect(error).not.toBeInstanceOf(MismatchError);
    expect((error as Unrelated).message).toBe("custom named");
    expect((error as Unrelated).result).toBe(e.published);
  });

  it("does not raise when nothing mismatched", () => {
    class CustomError extends MismatchError {}
    const e = new Fake();
    e.use(() => 1);
    e.try(() => 1);
    e.raiseWith(CustomError);
    e.raiseOnMismatches = true;
    expect(e.run()).toBe(1);
  });

  it("works with the class-level raiseOnMismatches and in runAsync", async () => {
    class CustomError extends MismatchError {}
    Fake.raiseOnMismatches = true;
    const e = new Fake();
    e.use(async () => 1);
    e.try(async () => 2);
    e.raiseWith(CustomError);
    await expect(e.runAsync()).rejects.toBeInstanceOf(CustomError);
  });
});
