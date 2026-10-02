import { afterEach, describe, expect, it } from "vitest";
import {
  Experiment,
  type Result,
  run,
  runAsync,
  Scientist,
  science,
  scienceAsync,
  withScience,
} from "../src/index";

class Recording<T = unknown> extends Experiment<T> {
  static instances: Recording[] = [];
  published: Result<T> | undefined;

  constructor(name: string) {
    super(name);
    Recording.instances.push(this as Recording);
  }

  enabled(): boolean {
    return true;
  }

  publish(result: Result<T>): void {
    this.published = result;
  }
}

afterEach(() => {
  Experiment.setDefault(null);
  Recording.instances = [];
});

describe("Scientist", () => {
  it("provides a helper to instantiate and run experiments", () => {
    const obj = new Scientist();

    const r = obj.science("test", (e) => {
      e.use(() => "control");
      e.try(() => "candidate");
    });

    expect(r).toBe("control");
  });

  it("provides a module method to instantiate and run experiments", () => {
    const r = Scientist.run("test", (e) => {
      e.use(() => "control");
      e.try(() => "candidate");
    });

    expect(r).toBe("control");
  });

  it("exposes run/science and their async variants as functions", async () => {
    expect(science).toBe(run);
    expect(scienceAsync).toBe(runAsync);
    expect(Scientist.runAsync).toBe(runAsync);

    expect(
      run("test", (e) => {
        e.use(() => 1);
      }),
    ).toBe(1);
    await expect(
      runAsync("test", async (e) => {
        e.use(async () => 2);
        e.try(async () => 3);
      }),
    ).resolves.toBe(2);
  });

  it("provides an empty defaultScientistContext", () => {
    const obj = new Scientist();
    expect(obj.defaultScientistContext()).toEqual({});
  });

  it("respects defaultScientistContext", () => {
    class Obj extends Scientist {
      override defaultScientistContext() {
        return { default: true };
      }
    }
    const obj = new Obj();

    let experiment: Experiment | undefined;

    obj.science("test", (e) => {
      experiment = e;
      e.context({ inline: true });
      e.use(() => undefined);
    });

    expect(experiment).toBeDefined();
    expect(experiment?.context().default).toBe(true);
    expect(experiment?.context().inline).toBe(true);
  });

  it("lets inline context take precedence over defaultScientistContext", () => {
    class Obj extends Scientist {
      override defaultScientistContext() {
        return { key: "default", other: 1 };
      }
    }

    let experiment: Experiment | undefined;
    new Obj().science("test", (e) => {
      experiment = e;
      e.context({ key: "inline" });
      e.use(() => undefined);
    });

    expect(experiment?.context()).toEqual({ key: "inline", other: 1 });
  });

  it("applies defaultScientistContext in scienceAsync", async () => {
    class Obj extends Scientist {
      override defaultScientistContext() {
        return { default: true };
      }
    }

    let experiment: Experiment | undefined;
    const r = await new Obj().scienceAsync("test", async (e) => {
      experiment = e;
      e.use(async () => "control");
    });

    expect(r).toBe("control");
    expect(experiment?.context()).toEqual({ default: true });
  });

  it("runs the named test instead of the control", () => {
    const obj = new Scientist();

    const behaviorsExecuted: string[] = [];

    const result = obj.science(
      "test",
      (e) => {
        e.try("first-way", () => {
          behaviorsExecuted.push("first-way");
          return true;
        });
        e.try("second-way", () => {
          behaviorsExecuted.push("second-way");
          return true;
        });
      },
      { run: "first-way" },
    );

    expect(result).toBe(true);
    expect(behaviorsExecuted).toEqual(["first-way"]);
  });

  it("runs control when there is a null named test", () => {
    const obj = new Scientist();

    const behaviorsExecuted: string[] = [];

    const result = obj.science(
      "test",
      (e) => {
        e.use(() => {
          behaviorsExecuted.push("control");
          return true;
        });
        e.try("second-way", () => {
          behaviorsExecuted.push("second-way");
          return true;
        });
      },
      null,
    );

    expect(result).toBe(true);
    expect(behaviorsExecuted).toEqual(["control"]);

    behaviorsExecuted.length = 0;
    const result2 = obj.science(
      "test",
      (e) => {
        e.use(() => {
          behaviorsExecuted.push("control");
          return true;
        });
      },
      { run: null },
    );
    expect(result2).toBe(true);
    expect(behaviorsExecuted).toEqual(["control"]);
  });

  it("supports the run option in the module method", async () => {
    expect(
      run(
        "test",
        (e) => {
          e.use(() => "control");
          e.try("other", () => "other");
        },
        { run: "other" },
      ),
    ).toBe("other");
    await expect(
      runAsync(
        "test",
        (e) => {
          e.use(async () => "control");
          e.try("other", async () => "other");
        },
        { run: "other" },
      ),
    ).resolves.toBe("other");
  });

  describe("Experiment.setDefault", () => {
    it("makes run and science use the given experiment class", () => {
      Experiment.setDefault(Recording);

      const r = run("test", (e) => {
        expect(e).toBeInstanceOf(Recording);
        e.use(() => 1);
        e.try(() => 2);
      });
      expect(r).toBe(1);
      expect(Recording.instances).toHaveLength(1);
      expect(Recording.instances[0]?.name).toBe("test");
      expect(Recording.instances[0]?.published?.mismatched()).toBe(true);

      new Scientist().science("science", (e) => {
        expect(e).toBeInstanceOf(Recording);
        e.use(() => 1);
      });
      expect(Recording.instances).toHaveLength(2);
    });

    it("restores the default experiment when given null", () => {
      Experiment.setDefault(Recording);
      Experiment.setDefault(null);
      run("test", (e) => {
        expect(e).not.toBeInstanceOf(Recording);
        e.use(() => 1);
      });
      expect(Recording.instances).toHaveLength(0);
    });

    it("is not set automatically when subclassing Experiment", () => {
      class NotDefault extends Recording {}
      const e = Experiment.create("x");
      expect(e).not.toBeInstanceOf(NotDefault);
      expect(e).not.toBeInstanceOf(Recording);
    });
  });

  describe("withScience", () => {
    class Base {
      readonly id: number;
      constructor(id: number) {
        this.id = id;
      }
      greet(): string {
        return `base ${this.id}`;
      }
    }

    class Repository extends withScience(Base) {
      override defaultScientistContext() {
        return { repository: this.id };
      }

      find(): string {
        return this.science<string>("find", (e) => {
          e.use(() => this.greet());
          e.try(() => "new");
        });
      }
    }

    it("keeps the base class and its constructor", () => {
      const repo = new Repository(7);
      expect(repo).toBeInstanceOf(Base);
      expect(repo.id).toBe(7);
      expect(repo.greet()).toBe("base 7");
    });

    it("adds science helpers", async () => {
      const repo = new Repository(7);
      expect(repo.find()).toBe("base 7");
      await expect(
        repo.scienceAsync("async", async (e) => {
          e.use(async () => "control");
        }),
      ).resolves.toBe("control");
    });

    it("merges defaultScientistContext", () => {
      Experiment.setDefault(Recording);
      const repo = new Repository(7);
      repo.find();
      expect(Recording.instances[0]?.context()).toEqual({ repository: 7 });
      expect(Recording.instances[0]?.published?.experimentName).toBe("find");
    });

    it("provides an empty defaultScientistContext by default", () => {
      class Plain extends withScience(Base) {}
      expect(new Plain(1).defaultScientistContext()).toEqual({});
    });

    it("supports the run option", () => {
      const repo = new Repository(1);
      expect(
        repo.science(
          "test",
          (e) => {
            e.use(() => "control");
            e.try("alt", () => "alt");
          },
          { run: "alt" },
        ),
      ).toBe("alt");
    });
  });
});
