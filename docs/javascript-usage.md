# Using the library from plain JavaScript

[Back to the documentation index](index.md)

The package ships ESM and CommonJS builds, selected automatically through `package.json` `exports`. Requires Node.js 20
or newer (or a bundler / modern runtime).

## CommonJS

```js
const { Experiment, Scientist, MismatchError } = require("@mhvelplund/scientist");

class MyExperiment extends Experiment {
  enabled() {
    return true;
  }

  publish(result) {
    console.log(`${this.name}: ${result.matched() ? "matched" : "mismatched"}`);
  }
}

Experiment.setDefault(MyExperiment);

const value = Scientist.run("smoke", (e) => {
  e.use(() => [1, 2, 3]);
  e.try(() => [1, 2, 3]);
});
```

## ESM

```js
import { Experiment, runAsync } from "@mhvelplund/scientist";

class MyExperiment extends Experiment {
  enabled() {
    return true;
  }

  async publish(result) {
    await metrics.send(this.name, result.matched());
  }
}

Experiment.setDefault(MyExperiment);

const value = await runAsync("fetch-answer", (e) => {
  e.use(async () => 42);
  e.try(async () => 41);
});
```

## Things TypeScript would have told you

- `Experiment` is abstract in TypeScript only. In plain JavaScript you *can* instantiate a subclass that doesn't
  implement `enabled` and `publish`; the first run with a candidate then fails with
  `TypeError: experiment.enabled is not a function` (routed through `raised("enabled", ...)`, which re-throws by
  default). Always implement both.
- `use` and `try` require functions; passing a value throws a `TypeError`.
- `run` returns the control's value. Calling `run` (not `runAsync`) with async behaviors returns a promise, but compares
  promises; see [Async](async.md#pitfalls-of-promises-in-a-synchronous-run).

## JSDoc typing tip

The package includes type declarations, so editors like VS Code give you completions in plain JavaScript. Add
`// @ts-check` and JSDoc annotations to get type checking as well:

```js
// @ts-check
const { Experiment, run } = require("@mhvelplund/scientist");

/** @extends {Experiment<number>} */
class CountExperiment extends Experiment {
  enabled() {
    return true;
  }

  /** @param {import("@mhvelplund/scientist").Result<number>} result */
  publish(result) {
    console.log(result.control?.value);
  }
}

Experiment.setDefault(CountExperiment);

/** @type {number} */
const count = run("count", (e) => {
  e.use(() => 1);
  e.try(() => 1);
});
```

Explicit type arguments (`run<number>(...)`) can't be written in JavaScript, but TypeScript infers them from an
annotated variable, as above. Alternatively annotate the configuration callback's parameter with
`/** @param {import("@mhvelplund/scientist").Experiment<number>} e */`.
