// Loads the built CommonJS bundle the way a plain JavaScript project would.
const assert = require("node:assert/strict");
const { Experiment, Scientist, MismatchError } = require("../../dist/index.cjs");

const published = [];

class SmokeExperiment extends Experiment {
  enabled() {
    return true;
  }

  publish(result) {
    published.push(result);
  }
}

Experiment.setDefault(SmokeExperiment);

const value = Scientist.run("smoke-cjs", (e) => {
  e.use(() => [1, 2, 3]);
  e.try(() => [1, 2, 3]);
});
assert.deepEqual(value, [1, 2, 3]);
assert.equal(published.length, 1);
assert.equal(published[0].matched(), true);

SmokeExperiment.raiseOnMismatches = true;
assert.throws(
  () =>
    Scientist.run("smoke-cjs-mismatch", (e) => {
      e.use(() => "a");
      e.try(() => "b");
    }),
  MismatchError,
);

console.log("smoke.cjs: ok");
