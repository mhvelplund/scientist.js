# scientist

A TypeScript/JavaScript library for carefully refactoring critical paths.

This is a port of GitHub's Ruby library [Scientist](https://github.com/github/scientist), by
[@jbarnette](https://github.com/jbarnette), [@jesseplusplus](https://github.com/jesseplusplus),
[@rick](https://github.com/rick), [@zerowidth](https://github.com/zerowidth) and contributors. The API, the behavior and
most of the documentation follow the original as closely as JavaScript allows; the
[differences](docs/differences-from-ruby.md) are documented. Like the original, it is released under the
[MIT license](#license).

It works in Node.js (20 or newer) and other modern JavaScript runtimes, ships ESM and CommonJS builds with type
declarations, and has no runtime dependencies.

## Upstream version

This port tracks the Ruby library at tag [`v1.6.5`](https://github.com/github/scientist/tree/v1.6.5) (commit
[`504a396e987f655a21c6bf2ed57935aadaa40859`](https://github.com/github/scientist/commit/504a396e987f655a21c6bf2ed57935aadaa40859)).
The sources were read from `main` at commit
[`2cd5c16210a4f4c938f48395b2860ebe0ccf56e7`](https://github.com/github/scientist/commit/2cd5c16210a4f4c938f48395b2860ebe0ccf56e7)
(2026-09-28). That commit differs from `v1.6.5` only in CI and dependabot configuration, so `lib/` and `test/` are
identical. The ported test suite in [`test/`](test) mirrors upstream's `test/scientist/*_test.rb` at that revision. When
syncing with a newer upstream release, compare `lib/` from this tag onwards.

## Install

```sh
npm install @mhvelplund/scientist
```

TypeScript type declarations ship with the package (`dist/index.d.mts` for `import`, `dist/index.d.cts` for `require`),
so there is no separate `@types/...` package to install. They are resolved through the `exports` map and work with
`moduleResolution` set to `nodenext`, `node16` or `bundler`.

## Quick start

Let's pretend you're changing the way you handle permissions in a large web app. Tests can help guide your refactoring,
but you really want to compare the current and refactored behaviors under load.

### TypeScript / ESM

```ts
import { Experiment, type Result, Scientist } from "@mhvelplund/scientist";

// 1. Decide how experiments are enabled and where results go.
class MyExperiment<T = unknown> extends Experiment<T> {
  enabled(): boolean {
    return true; // see docs/custom-experiments.md for ramping up
  }

  publish(result: Result<T>): void {
    console.log(this.name, result.matched() ? "matched" : "mismatched");
  }
}

Experiment.setDefault(MyExperiment);

// 2. Wrap the old code in `use` and the new code in `try`.
class MyWidget extends Scientist {
  allows(user: User): boolean {
    return this.science<boolean>("widget-permissions", (e) => {
      e.use(() => model.checkUser(user).valid); // old way
      e.try(() => user.can("read", model)); // new way
    }); // returns the control value
  }
}
```

Without a base class, call `Scientist.run` (or the standalone `run` / `science` functions):

```ts
import { Scientist } from "@mhvelplund/scientist";

const allowed = Scientist.run<boolean>("widget-permissions", (e) => {
  e.use(() => model.checkUser(user).valid);
  e.try(() => user.can("read", model));
});
```

Behaviors that return promises are supported with `runAsync`, `scienceAsync` and `Experiment#runAsync`; see
[async experiments](docs/async.md).

### CommonJS

```js
const { Experiment, Scientist } = require("@mhvelplund/scientist");

class MyExperiment extends Experiment {
  enabled() {
    return true;
  }

  publish(result) {
    console.log(this.name, result.matched() ? "matched" : "mismatched");
  }
}

Experiment.setDefault(MyExperiment);

const allowed = Scientist.run("widget-permissions", (e) => {
  e.use(() => model.checkUser(user).valid);
  e.try(() => user.can("read", model));
});
```

## How it works

Wrap a `use` callback around the code's original behavior, and wrap `try` around the new behavior. `run` always returns
whatever the `use` callback returns (or throws what it threw), but it does a bunch of stuff behind the scenes:

- It decides whether or not to run the `try` callback (`enabled()` and `runIf`),
- Randomizes the order in which `use` and `try` callbacks are run,
- Measures the wall time and CPU time of all behaviors, in seconds,
- Compares the result of `try` to the result of `use`,
- Swallows and records errors thrown in the `try` callback, and
- Publishes all this information.

The `use` callback is called the **control**. The `try` callback is called the **candidate**.

If you don't declare any `try` callbacks, none of the Scientist machinery is invoked and the control value is always
returned.

Note that the built-in default experiment (`DefaultExperiment`) is never enabled and publishes nothing, so nothing
interesting happens until you register your own experiment class with `Experiment.setDefault`.

## Documentation

The full guide lives in [docs/index.md](docs/index.md). It covers custom experiments, comparing results, context,
cleaning, ignoring mismatches, publishing, testing, error handling, multiple candidates, async experiments, plain
JavaScript usage, and the differences from the Ruby library.

## Building from source

### Prerequisites

The toolchain (Node.js and the build tasks) is managed by [mise](https://mise.jdx.dev). Install it by following the
instructions at <https://mise.jdx.dev>, then from a checkout of this repository:

```sh
mise install   # installs the Node.js version pinned in mise.toml
mise run ci    # installs dependencies, lints, type-checks, tests, builds and smoke-tests
```

### Tasks

Every task is defined in [`mise.toml`](mise.toml) and run with `mise run <task>`:

| Task        | What it does                                                                  | Runs                                                   |
|-------------|-------------------------------------------------------------------------------|--------------------------------------------------------|
| `install`   | Install npm dependencies (skipped when the lockfile is unchanged)             | `npm ci`                                               |
| `lint`      | Lint and check formatting with Biome                                          | `biome check .`                                        |
| `format`    | Format all files with Biome                                                   | `biome check --write .`                                |
| `typecheck` | Type-check sources and tests                                                  | `tsc --noEmit`                                         |
| `test`      | Run the unit tests with coverage                                              | `vitest run --coverage`                                |
| `build`     | Build ESM + CJS bundles and type declarations into `dist/`                    | `tsdown`                                               |
| `smoke`     | Load the built package from CommonJS and ESM, and type-check its declarations | `node test/smoke/smoke.{cjs,mjs}`, `tsc -p test/smoke` |
| `pack`      | Show what would be published to npm                                           | `npm pack --dry-run`                                   |
| `clean`     | Remove build and coverage output                                              | `rm -rf dist coverage`                                 |
| `ci`        | Everything CI runs: lint, typecheck, test, build, smoke                       | depends on the tasks above                             |

All tasks except `clean` depend on `install`, so a fresh checkout only needs `mise run <task>`.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the exact same `mise run ci` on every push to `main` and
every pull request, using [`jdx/mise-action`](https://github.com/jdx/mise-action) to install mise and the pinned tools.
If `mise run ci` passes locally, CI should pass too.

### Using a local build from another project

To try an unpublished version in another local project, either pack it into a tarball:

```sh
# in this repository
mise run build
npm pack                      # creates mhvelplund-scientist-<version>.tgz

# in the other project
npm install /path/to/scientist.js/mhvelplund-scientist-<version>.tgz
```

or link it, so that rebuilding here is picked up there immediately:

```sh
# in this repository
mise run build
npm link

# in the other project
npm link @mhvelplund/scientist
```

The tarball is closer to what users get from the registry (only `dist/` is included); `npm link` is more convenient
while iterating.

### Publishing

```sh
mise run ci
npm publish
```

`prepublishOnly` rebuilds `dist/` first. The package is scoped (`@mhvelplund/scientist`), and `publishConfig.access` is
set to `"public"` in `package.json`, so no `--access public` flag is needed. Use `mise run pack` beforehand to check
what will be uploaded.

## License

MIT. See [LICENSE](LICENSE). This project is a port of [github/scientist](https://github.com/github/scientist), which is
also [MIT licensed](https://github.com/github/scientist/blob/main/LICENSE.txt).
