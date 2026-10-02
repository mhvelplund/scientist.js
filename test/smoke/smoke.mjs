// Loads the built ESM bundle the way a plain JavaScript project would.
import assert from "node:assert/strict";
import { Experiment, runAsync } from "../../dist/index.mjs";

const published = [];

class SmokeExperiment extends Experiment {
  enabled() {
    return true;
  }

  async publish(result) {
    published.push(result);
  }
}

Experiment.setDefault(SmokeExperiment);

const value = await runAsync("smoke-esm", (e) => {
  e.use(async () => 42);
  e.try(async () => 41);
});
assert.equal(value, 42);
assert.equal(published.length, 1);
assert.equal(published[0].mismatched(), true);
assert.ok(published[0].observations.every((o) => o.duration >= 0));

console.log("smoke.mjs: ok");
