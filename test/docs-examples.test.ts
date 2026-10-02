// Executable versions of the examples in README.md and docs/*.md.
// If an example in the docs changes, update the matching test here.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BehaviorMissingError,
  BehaviorNotUniqueError,
  DefaultExperiment,
  defaultEquals,
  Experiment,
  MismatchError,
  Observation,
  type RaisedOperation,
  type Result,
  run,
  runAsync,
  Scientist,
  science,
  scienceAsync,
  withScience,
} from "../src/index";

// A small "published results" sink shared by the examples.
let published: Result<unknown>[] = [];
let raisedErrors: { operation: RaisedOperation; error: unknown }[] = [];

class MyExperiment<T = unknown> extends Experiment<T> {
  override enabled(): boolean {
    return true;
  }

  override publish(result: Result<T>): void {
    published.push(result as Result<unknown>);
  }

  override raised(operation: RaisedOperation, error: unknown): void {
    raisedErrors.push({ operation, error });
  }
}

afterEach(() => {
  Experiment.setDefault(null);
  MyExperiment.raiseOnMismatches = undefined;
  Observation.rescues = () => true;
  published = [];
  raisedErrors = [];
});

// The tsconfig has no DOM/Node typings, so declare the timer we use.
declare function setTimeout(callback: () => void, ms: number): unknown;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Fixtures used in examples.
interface User {
  login: string;
  staff: boolean;
}
const alice: User = { login: "alice", staff: false };
const oldCheck = (user: User) => user.login.length > 0;
const newCheck = (user: User) => user.login !== "";

describe("README quick start", () => {
  it("runs with the default (disabled) experiment and returns the control", () => {
    let candidateRan = false;
    const allowed = run<boolean>("widget-permissions", (e) => {
      e.use(() => oldCheck(alice));
      e.try(() => {
        candidateRan = true;
        return newCheck(alice);
      });
    });
    expect(allowed).toBe(true);
    // DefaultExperiment is never enabled, so the candidate does not run.
    expect(candidateRan).toBe(false);
  });

  it("runs both behaviors once a custom default is set", () => {
    Experiment.setDefault(MyExperiment);
    const allowed = Scientist.run<boolean>("widget-permissions", (e) => {
      e.use(() => oldCheck(alice));
      e.try(() => newCheck(alice));
    });
    expect(allowed).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]?.matched()).toBe(true);
  });
});

describe("getting-started.md", () => {
  it("creates an experiment by hand", () => {
    const experiment = new DefaultExperiment<boolean>("widget-permissions");
    experiment.use(() => oldCheck(alice));
    experiment.try(() => newCheck(alice));
    expect(experiment.run()).toBe(true);
  });

  it("uses the science helper and the Scientist base class", () => {
    Experiment.setDefault(MyExperiment);

    class MyWidget extends Scientist {
      allows(user: User): boolean {
        return this.science<boolean>("widget-permissions", (e) => {
          e.use(() => oldCheck(user));
          e.try(() => newCheck(user));
        });
      }
    }

    expect(new MyWidget().allows(alice)).toBe(true);
    expect(science<number>("x", (e) => e.use(() => 1))).toBe(1);
    expect(published).toHaveLength(1);
  });

  it("uses withScience when the class already extends something", () => {
    Experiment.setDefault(MyExperiment);

    class BaseRepository {
      table = "users";
    }

    class UserRepository extends withScience(BaseRepository) {
      count(): number {
        return this.science<number>("user-count", (e) => {
          e.use(() => 3);
          e.try(() => 3);
        });
      }
    }

    const repo = new UserRepository();
    expect(repo.table).toBe("users");
    expect(repo.count()).toBe(3);
    expect(published[0]?.matched()).toBe(true);
  });

  it("returns the control without running anything else when there are no candidates", () => {
    Experiment.setDefault(MyExperiment);
    expect(run<number>("only-control", (e) => e.use(() => 42))).toBe(42);
    expect(published).toHaveLength(0);
  });

  it("re-throws what the control threw", () => {
    expect(() =>
      run("throws", (e) => {
        e.use(() => {
          throw new RangeError("boom");
        });
      }),
    ).toThrow(RangeError);
  });

  it("throws BehaviorMissingError when there is no control", () => {
    expect(() => run("no-control", (e) => e.try(() => 1))).toThrow(BehaviorMissingError);
  });

  it("throws BehaviorNotUniqueError for duplicate names", () => {
    const e = new DefaultExperiment("dup");
    e.use(() => 1);
    expect(() => e.use(() => 2)).toThrow(BehaviorNotUniqueError);
  });
});

describe("custom-experiments.md", () => {
  it("supports a percentage ramp-up", () => {
    class RampedExperiment<T = unknown> extends Experiment<T> {
      percentEnabled = 100;

      override enabled(): boolean {
        return this.percentEnabled > 0 && Math.random() * 100 < this.percentEnabled;
      }

      override publish(_result: Result<T>): void {}
    }

    const experiment = new RampedExperiment<number>("ramp");
    experiment.percentEnabled = 0;
    let candidateRan = false;
    experiment.use(() => 1);
    experiment.try(() => {
      candidateRan = true;
      return 1;
    });
    expect(experiment.run()).toBe(1);
    expect(candidateRan).toBe(false);
  });

  it("Experiment.create uses the default class", () => {
    expect(Experiment.create("a")).toBeInstanceOf(DefaultExperiment);
    Experiment.setDefault(MyExperiment);
    expect(Experiment.create("a")).toBeInstanceOf(MyExperiment);
    Experiment.setDefault(null);
    expect(Experiment.create("a")).toBeInstanceOf(DefaultExperiment);
  });

  it("raised receives errors from publish", () => {
    class BrokenPublish extends MyExperiment {
      override publish(): void {
        throw new Error("statsd is down");
      }
    }
    const e = new BrokenPublish("broken");
    e.use(() => 1);
    e.try(() => 1);
    expect(e.run()).toBe(1);
    expect(raisedErrors[0]?.operation).toBe("publish");
  });

  it("the default raised re-throws", () => {
    class Rethrows extends Experiment<number> {
      override enabled(): boolean {
        return true;
      }
      override publish(): void {
        throw new Error("publish failed");
      }
    }
    const e = new Rethrows("rethrows");
    e.use(() => 1);
    e.try(() => 1);
    expect(() => e.run()).toThrow("publish failed");
  });
});

describe("comparing-results.md", () => {
  it("uses a custom comparator", () => {
    Experiment.setDefault(MyExperiment);
    class ServiceUser {
      constructor(readonly login: string) {}
    }
    run<{ login: string }[]>("users", (e) => {
      e.use(() => [{ login: "alice" }, { login: "bob" }]);
      e.try(() => [new ServiceUser("alice"), new ServiceUser("bob")]);
      e.compare(
        (control, candidate) =>
          control.map((u) => u.login).join() === candidate.map((u) => u.login).join(),
      );
    });
    expect(published[0]?.matched()).toBe(true);
  });

  it("uses compareErrors", () => {
    Experiment.setDefault(MyExperiment);
    // The control threw, so run() re-throws its error after publishing.
    expect(() =>
      run<string>("slug-from-login", (e) => {
        e.use(() => {
          throw new TypeError("Input has invalid characters: !");
        });
        e.try(() => {
          throw new TypeError("Invalid characters in input: !");
        });
        e.compareErrors(
          (control, candidate) =>
            control instanceof TypeError &&
            candidate instanceof TypeError &&
            control.message.startsWith("Input has invalid characters") &&
            candidate.message.startsWith("Invalid characters in input"),
        );
      }),
    ).toThrow("Input has invalid characters");
    expect(published[0]?.matched()).toBe(true);
  });

  it("compares errors by class and message by default", () => {
    Experiment.setDefault(MyExperiment);
    expect(() =>
      run("errors", (e) => {
        e.use(() => {
          throw new RangeError("nope");
        });
        e.try(() => {
          throw new RangeError("nope");
        });
      }),
    ).toThrow(RangeError);
    expect(published[0]?.matched()).toBe(true);
  });

  it("documents defaultEquals rules", () => {
    expect(defaultEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(defaultEquals(new Map([["k", 1]]), new Map([["k", 1]]))).toBe(true);
    expect(defaultEquals(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(defaultEquals(new Date(0), new Date(0))).toBe(true);
    expect(defaultEquals(/a/g, /a/g)).toBe(true);
    expect(defaultEquals(Number.NaN, Number.NaN)).toBe(false);
    expect(defaultEquals(1, "1")).toBe(false);
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }
    expect(defaultEquals(new Point(1, 2), new Point(1, 2))).toBe(false);
    class Money {
      constructor(readonly cents: number) {}
      equals(other: unknown): boolean {
        return other instanceof Money && other.cents === this.cents;
      }
    }
    expect(defaultEquals(new Money(5), new Money(5))).toBe(true);
  });
});

describe("context.md", () => {
  it("adds context and default scientist context", () => {
    Experiment.setDefault(MyExperiment);

    class MyWidget extends Scientist {
      allows(user: User): boolean {
        return this.science<boolean>("widget-permissions", (e) => {
          e.context({ user: user.login });
          e.use(() => oldCheck(user));
          e.try(() => newCheck(user));
        });
      }

      override defaultScientistContext(): Record<string, unknown> {
        return { widget: "my-widget" };
      }
    }

    new MyWidget().allows(alice);
    expect(published[0]?.context).toEqual({ widget: "my-widget", user: "alice" });
  });

  it("freezes the context after the run", () => {
    const e = new MyExperiment<number>("ctx");
    e.context({ a: 1 });
    e.use(() => 1);
    e.run();
    expect(e.context()).toEqual({ a: 1 });
    expect(() => e.context({ b: 2 })).toThrow(TypeError);
  });
});

describe("before-and-after-run.md", () => {
  it("runs beforeRun only when the experiment runs", () => {
    const bigObject = { items: [1, 2, 3] };
    let valueForNewCode: { items: number[] } | undefined;
    let beforeRunCalls = 0;

    const configure = (e: Experiment<number>) => {
      e.beforeRun(() => {
        beforeRunCalls++;
        valueForNewCode = { items: [...bigObject.items] };
      });
      e.use(() => bigObject.items.length);
      e.try(() => valueForNewCode?.items.length ?? 0);
    };

    run<number>("expensive-but-worthwhile", configure);
    expect(beforeRunCalls).toBe(0);

    Experiment.setDefault(MyExperiment);
    run<number>("expensive-but-worthwhile", configure);
    expect(beforeRunCalls).toBe(1);
    expect(published[0]?.matched()).toBe(true);
  });

  it("runs afterRun with the result before publishing", () => {
    Experiment.setDefault(MyExperiment);
    const seen: string[] = [];
    run<number>("after", (e) => {
      e.use(() => 1);
      e.try(() => 2);
      e.afterRun((result) => {
        seen.push(result.mismatched() ? "mismatch" : "match");
        expect(published).toHaveLength(0);
      });
    });
    expect(seen).toEqual(["mismatch"]);
  });
});

describe("cleaning-values.md", () => {
  it("cleans values for publishing", () => {
    Experiment.setDefault(MyExperiment);
    run<User[]>("users", (e) => {
      e.use(() => [alice, { login: "bob", staff: true }]);
      e.try(() => [alice, { login: "bob", staff: true }]);
      e.clean((users) => users.map((u) => u.login).sort());
    });
    expect(published[0]?.control?.cleanedValue).toEqual(["alice", "bob"]);
    expect(published[0]?.control?.value).toHaveLength(2);
  });

  it("does not use clean for comparison", () => {
    Experiment.setDefault(MyExperiment);
    run<number[]>("user-ids", (e) => {
      e.use(() => [1, 2, 3]);
      e.try(() => [1, 3, 2]);
      e.clean((value) => [...value].sort());
      e.compare((a, b) => defaultEquals([...a].sort(), [...b].sort()));
    });
    expect(published[0]?.matched()).toBe(true);

    const e = new MyExperiment<number[]>("x");
    const cleaner = e.clean((value) => value.length);
    expect(e.cleaner).toBe(cleaner);
  });
});

describe("ignoring-mismatches.md", () => {
  it("ignores known mismatches", () => {
    Experiment.setDefault(MyExperiment);
    const user = { login: "carol", staff: true, confirmedEmail: false };
    run<boolean>("widget-permissions", (e) => {
      e.use(() => false);
      e.try(() => true);
      e.ignore(() => user.staff);
      e.ignore((control, candidate) => Boolean(control && !candidate && !user.confirmedEmail));
    });
    const result = published[0];
    expect(result?.matched()).toBe(false);
    expect(result?.mismatched()).toBe(false);
    expect(result?.ignored()).toBe(true);
    expect(result?.ignoredObservations).toHaveLength(1);
  });

  it("breaks the rules: ignore all values, still catches errors", () => {
    Experiment.setDefault(MyExperiment);
    run<number>("timing-only", (e) => {
      e.use(() => 1);
      e.try(() => 2);
      e.compare(() => true);
    });
    expect(published[0]?.matched()).toBe(true);

    run<number>("timing-only", (e) => {
      e.use(() => 1);
      e.try(() => {
        throw new Error("blew up");
      });
      e.compare(() => true);
    });
    expect(published[1]?.mismatched()).toBe(true);
  });
});

describe("enabling-and-run-if.md", () => {
  it("skips the experiment when runIf returns false", () => {
    Experiment.setDefault(MyExperiment);
    const currentUser = alice;
    let candidateRan = false;
    const value = run<string[]>("dashboard-items", (e) => {
      e.runIf(() => currentUser.staff);
      e.use(() => ["a"]);
      e.try(() => {
        candidateRan = true;
        return ["a"];
      });
    });
    expect(value).toEqual(["a"]);
    expect(candidateRan).toBe(false);
    expect(published).toHaveLength(0);
  });

  it("exposes shouldExperimentRun and runIfBlockAllows", () => {
    const e = new MyExperiment<number>("x");
    e.use(() => 1);
    expect(e.shouldExperimentRun()).toBe(false); // only one behavior
    e.try(() => 1);
    expect(e.shouldExperimentRun()).toBe(true);
    e.runIf(() => false);
    expect(e.runIfBlockAllows()).toBe(false);
    expect(e.shouldExperimentRun()).toBe(false);
  });
});

describe("publishing-results.md", () => {
  it("builds a payload from the result", () => {
    const payloads: Record<string, unknown>[] = [];

    function observationPayload<T>(observation: Observation<T> | undefined) {
      if (!observation) return undefined;
      if (observation.raised) {
        const error = observation.exception as Error;
        return { exception: error.name, message: error.message, stack: error.stack };
      }
      return { value: observation.cleanedValue };
    }

    class StatsExperiment<T = unknown> extends Experiment<T> {
      override enabled(): boolean {
        return true;
      }

      override publish(result: Result<T>): void {
        const control = result.control;
        const candidate = result.candidates[0];
        payloads.push({
          name: this.name,
          context: this.context(),
          control: observationPayload(control),
          candidate: observationPayload(candidate),
          executionOrder: result.observations.map((o) => o.name),
          durations: { control: control?.duration, candidate: candidate?.duration },
          cpuTimes: { control: control?.cpuTime, candidate: candidate?.cpuTime },
          outcome: result.matched() ? "matched" : result.ignored() ? "ignored" : "mismatched",
        });
      }
    }

    const e = new StatsExperiment<number>("payload");
    e.context({ requestId: "r-1" });
    e.use(() => 1);
    e.try(() => 2);
    e.fabricateDurationsForTestingPurposes({
      control: { duration: 1.0, cpuTime: 0.9 },
      candidate: { duration: 0.5, cpuTime: 0.4 },
    });
    expect(e.run()).toBe(1);

    const payload = payloads[0];
    expect(payload?.name).toBe("payload");
    expect(payload?.context).toEqual({ requestId: "r-1" });
    expect(payload?.control).toEqual({ value: 1 });
    expect(payload?.candidate).toEqual({ value: 2 });
    expect([...((payload?.executionOrder as string[] | undefined) ?? [])].sort()).toEqual([
      "candidate",
      "control",
    ]);
    expect(payload?.durations).toEqual({ control: 1.0, candidate: 0.5 });
    expect(payload?.cpuTimes).toEqual({ control: 0.9, candidate: 0.4 });
    expect(payload?.outcome).toBe("mismatched");
  });

  it("exposes result and observation fields", () => {
    Experiment.setDefault(MyExperiment);
    run<number>("fields", (e) => {
      e.use(() => 1);
      e.try(() => 1);
    });
    const result = published[0] as Result<number>;
    expect(result.experimentName).toBe("fields");
    expect(result.experiment).toBeInstanceOf(MyExperiment);
    expect(result.observations).toHaveLength(2);
    expect(result.control?.name).toBe("control");
    expect(result.candidates.map((c) => c.name)).toEqual(["candidate"]);
    expect(result.mismatchedObservations).toEqual([]);
    expect(result.control?.raised).toBe(false);
    expect(result.control?.duration).toBeGreaterThanOrEqual(0);
    expect(result.control?.cpuTime).toBeGreaterThanOrEqual(0);
    expect(result.control?.equivalentTo(result.candidates[0])).toBe(true);
  });
});

describe("testing.md", () => {
  it("raises on mismatches via the static flag", () => {
    Experiment.setDefault(MyExperiment);
    MyExperiment.raiseOnMismatches = true;
    let error: unknown;
    try {
      run<string>("widget-permissions", (e) => {
        e.use(() => "control");
        e.try(() => "candidate");
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MismatchError);
    const mismatch = error as MismatchError<string>;
    expect(mismatch.experimentName).toBe("widget-permissions");
    expect(mismatch.result.mismatched()).toBe(true);
    expect(mismatch.message).toContain("experiment 'widget-permissions' observations mismatched");
    expect(mismatch.message).toContain("'candidate'");
  });

  it("static raiseOnMismatches is inherited by subclasses", () => {
    class Child extends MyExperiment<number> {}
    MyExperiment.raiseOnMismatches = true;
    expect(new Child("c").shouldRaiseOnMismatches()).toBe(true);
  });

  it("raises on mismatches via the instance flag", () => {
    const e = new MyExperiment<number>("instance");
    e.raiseOnMismatches = true;
    e.use(() => 1);
    e.try(() => 2);
    expect(e.shouldRaiseOnMismatches()).toBe(true);
    expect(() => e.run()).toThrow(MismatchError);

    MyExperiment.raiseOnMismatches = true;
    const off = new MyExperiment<number>("instance-off");
    off.raiseOnMismatches = false; // instance value wins over the class value
    off.use(() => 1);
    off.try(() => 2);
    expect(off.run()).toBe(1);
  });

  it("raises a custom MismatchError subclass", () => {
    class DiffMismatchError<T> extends MismatchError<T> {
      override formatMessage(_summary: string): string {
        const control = this.result.control;
        return this.result.candidates
          .map((c) => `${c.name}: expected ${String(control?.value)}, got ${String(c.value)}`)
          .join("\n");
      }
    }

    MyExperiment.raiseOnMismatches = true;
    const e = new MyExperiment<number>("custom");
    e.use(() => 1);
    e.try(() => 2);
    e.raiseWith(DiffMismatchError);
    expect(() => e.run()).toThrow(DiffMismatchError);
    expect(() => {
      const again = new MyExperiment<number>("custom");
      again.use(() => 1);
      again.try(() => 2);
      again.raiseWith(DiffMismatchError);
      again.run();
    }).toThrow("candidate: expected 1, got 2");
  });

  it("fabricates durations", () => {
    Experiment.setDefault(MyExperiment);
    run<number>("absolutely-nothing-suspicious-happening-here", (e) => {
      e.use(() => 1);
      e.try(() => 1);
      e.fabricateDurationsForTestingPurposes({
        control: { duration: 1.0, cpuTime: 0.9 },
        candidate: 0.5,
      });
    });
    const result = published[0] as Result<number>;
    expect(result.control?.duration).toBe(1.0);
    expect(result.control?.cpuTime).toBe(0.9);
    expect(result.candidates[0]?.duration).toBe(0.5);
    expect(result.candidates[0]?.cpuTime).toBe(0);
  });
});

describe("error-handling.md", () => {
  it("captures candidate errors in the observation", () => {
    Experiment.setDefault(MyExperiment);
    const value = run<number>("candidate-throws", (e) => {
      e.use(() => 1);
      e.try(() => {
        throw new Error("candidate failed");
      });
    });
    expect(value).toBe(1);
    const candidate = published[0]?.candidates[0];
    expect(candidate?.raised).toBe(true);
    expect(candidate?.exception).toBeInstanceOf(Error);
    expect((candidate?.exception as Error | undefined)?.message).toBe("candidate failed");
  });

  it("routes callback errors to raised", () => {
    Experiment.setDefault(MyExperiment);
    run<number>("callbacks", (e) => {
      e.use(() => 1);
      e.try(() => 2);
      e.compare(() => {
        throw new Error("compare failed");
      });
      e.ignore(() => {
        throw new Error("ignore failed");
      });
      e.clean(() => {
        throw new Error("clean failed");
      });
    });
    published[0]?.control?.cleanedValue;
    expect(raisedErrors.map((r) => r.operation)).toEqual(["compare", "ignore", "clean"]);
  });

  it("lets Observation.rescues decide what is captured", () => {
    class FatalError extends Error {}
    Observation.rescues = (error) => !(error instanceof FatalError);
    Experiment.setDefault(MyExperiment);
    expect(() =>
      run<number>("fatal", (e) => {
        e.use(() => 1);
        e.try(() => {
          throw new FatalError("stop everything");
        });
      }),
    ).toThrow(FatalError);
  });
});

describe("multiple-candidates.md", () => {
  it("compares several named candidates", () => {
    Experiment.setDefault(MyExperiment);
    run<boolean>("widget-permissions", (e) => {
      e.use(() => oldCheck(alice));
      e.try("api", () => newCheck(alice));
      e.try("raw-sql", () => false);
    });
    const result = published[0] as Result<boolean>;
    expect(result.candidates.map((c) => c.name).sort()).toEqual(["api", "raw-sql"]);
    expect(result.mismatchedObservations.map((c) => c.name)).toEqual(["raw-sql"]);
  });

  it("runs with no control", () => {
    const experiment = new MyExperiment<string>("various-ways");
    experiment.try("first-way", () => "first");
    experiment.try("second-way", () => "second");
    expect(experiment.run("second-way")).toBe("second");
    expect(published[0]?.control?.name).toBe("second-way");

    Experiment.setDefault(MyExperiment);
    const value = run<string>(
      "various-ways",
      (e) => {
        e.try("first-way", () => "first");
        e.try("second-way", () => "second");
      },
      { run: "first-way" },
    );
    expect(value).toBe("first");
  });

  it("exposes behaviors in registration order", () => {
    const e = new MyExperiment<number>("behaviors");
    e.use(() => 1);
    e.try("a", () => 2);
    expect([...e.behaviors.keys()]).toEqual(["control", "a"]);
  });
});

describe("async.md", () => {
  it("awaits async behaviors sequentially", async () => {
    Experiment.setDefault(MyExperiment);
    let running = 0;
    let maxRunning = 0;
    const fetchUser = async (source: string) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(5);
      running--;
      return { login: "alice", source };
    };

    const user = await runAsync<{ login: string }>("fetch-user", (e) => {
      e.use(() => fetchUser("db"));
      e.try(() => fetchUser("service"));
      e.compare(async (control, candidate) => control.login === candidate.login);
    });
    expect(user.login).toBe("alice");
    expect(maxRunning).toBe(1);
    expect(published[0]?.matched()).toBe(true);
  });

  it("scienceAsync on a Scientist subclass", async () => {
    Experiment.setDefault(MyExperiment);
    class Repo extends Scientist {
      count(): Promise<number> {
        return this.scienceAsync<number>("count", (e) => {
          e.use(async () => 3);
          e.try(async () => 3);
        });
      }
    }
    expect(await new Repo().count()).toBe(3);
    expect(
      await scienceAsync<number>("plain", (e) => {
        e.use(async () => 4);
      }),
    ).toBe(4);
  });

  it("supports async enabled/publish in runAsync", async () => {
    const sink: Result<number>[] = [];
    class AsyncExperiment extends Experiment<number> {
      override async enabled(): Promise<boolean> {
        return true;
      }
      override async publish(result: Result<number>): Promise<void> {
        await Promise.resolve();
        sink.push(result);
      }
    }
    const e = new AsyncExperiment("async");
    e.use(async () => 1);
    e.try(async () => 1);
    expect(await e.runAsync()).toBe(1);
    expect(sink).toHaveLength(1);
  });

  it("pitfall: a sync run compares promises, not values", () => {
    Experiment.setDefault(MyExperiment);
    const value = run<Promise<number>>("oops", (e) => {
      e.use(async () => 1);
      e.try(async () => 1);
    });
    expect(value).toBeInstanceOf(Promise);
    // Two distinct Promise objects are never equal.
    expect(published[0]?.mismatched()).toBe(true);
  });

  it("pitfall: an async callback in a sync run is a TypeError routed to raised", () => {
    Experiment.setDefault(MyExperiment);
    run<number>("oops", (e) => {
      e.use(() => 1);
      e.try(() => 1);
      e.compare(async () => true);
    });
    expect(raisedErrors[0]?.operation).toBe("compare");
    expect(raisedErrors[0]?.error).toBeInstanceOf(TypeError);
  });
});

describe("differences-from-ruby.md", () => {
  it("requires functions for behaviors", () => {
    const e = new MyExperiment("x");
    // @ts-expect-error demonstrating the runtime check
    expect(() => e.try("candidate", 42)).toThrow(TypeError);
  });

  it("refuses new behaviors after a run", () => {
    const e = new MyExperiment<number>("x");
    e.use(() => 1);
    e.run();
    expect(() => e.try(() => 2)).toThrow(TypeError);
  });

  it("fabricated durations without cpuTime give 0", () => {
    const e = new MyExperiment<number>("x");
    e.use(() => 1);
    e.try(() => 1);
    e.fabricateDurationsForTestingPurposes({ control: { duration: 2 } });
    e.run();
    expect(published[0]?.control?.cpuTime).toBe(0);
  });

  it("a fire-and-forget async publish in a sync run routes rejections to raised", async () => {
    const onRaised = vi.fn();
    class AsyncPublish extends Experiment<number> {
      override enabled(): boolean {
        return true;
      }
      override async publish(): Promise<void> {
        throw new Error("async publish failed");
      }
      override raised(operation: RaisedOperation, error: unknown): void {
        onRaised(operation, error);
      }
    }
    const e = new AsyncPublish("x");
    e.use(() => 1);
    e.try(() => 1);
    expect(e.run()).toBe(1);
    await sleep(0);
    expect(onRaised).toHaveBeenCalledWith("publish", expect.any(Error));
  });
});

describe("designing-experiments.md", () => {
  it("measures noise by running the control twice", () => {
    Experiment.setDefault(MyExperiment);
    const legacyItems = () => ["a", "b"];
    run<string[]>("dashboard-items", (e) => {
      e.use(() => legacyItems());
      e.try(() => legacyItems());
    });
    expect(published[0]?.matched()).toBe(true);
  });
});

describe("javascript-usage.md", () => {
  it("fails at run time when a plain JS subclass lacks enabled()", () => {
    // `abstract` is TypeScript-only; plain JavaScript can construct it anyway.
    const e = Reflect.construct(Experiment, ["broken"]) as Experiment<number>;
    e.use(() => 1);
    e.try(() => 2);
    expect(() => e.run()).toThrow("experiment.enabled is not a function");
  });
});
