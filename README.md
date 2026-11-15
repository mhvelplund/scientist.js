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

Every tool this repository needs is pinned in [`mise.toml`](mise.toml) and installed by [mise](https://mise.jdx.dev):
Node.js, the GitHub CLI (`gh`), [EarthBuild](https://docs.earthbuild.dev/) (`earth`), [actionlint](https://github.com/rhysd/actionlint), and, via `uv`,
[commitizen](https://commitizen-tools.github.io/commitizen/) (`cz`) and [pre-commit](https://pre-commit.com). Install
mise by following the instructions at <https://mise.jdx.dev>, then from a checkout of this repository:

```sh
mise install     # installs the pinned tools
mise run hooks   # installs the git hooks (pre-commit, commit-msg, pre-push)
mise run ci      # installs dependencies, lints, type-checks, tests, builds and smoke-tests
```

The containerized build (`earth +ci`, see [`Earthfile`](Earthfile)) also needs Docker or Podman; run `earth bootstrap`
once after installing.

### Commit messages and git hooks

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org) (`feat: ...`, `fix: ...`,
`docs: ...`, `feat!: ...` for breaking changes, and so on), because releases are versioned from them. The hooks in
[`.pre-commit-config.yaml`](.pre-commit-config.yaml) check each commit message, and before every commit and every push
they run Biome and some basic file checks. Before a push they also check that every pushed commit message is
conventional. Use `cz commit` for an interactive prompt that writes a valid message.

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
| `hooks`     | Install the git hooks                                                         | `pre-commit install`                                   |
| `bump`      | Preview the next version and changelog commitizen would release               | `cz bump --dry-run --changelog`                        |
| `clean`     | Remove build and coverage output                                              | `rm -rf dist coverage`                                 |
| `ci`        | Everything CI runs: lint, typecheck, test, build, smoke                       | depends on the tasks above                             |

The build tasks depend on `install`, so a fresh checkout only needs `mise run <task>`.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every pull request. It installs
the pinned tools with [`jdx/mise-action`](https://github.com/jdx/mise-action), then runs `earth --ci +ci`, which runs
the same steps as `mise run ci` in containers. If `mise run ci` passes locally, CI should pass too.

`main` is protected: it can only change through a pull request, and the `ci` check must pass before the pull request
can merge.

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

### Releasing

Releases are automatic. On every push to `main`,
[`.github/workflows/release.yml`](.github/workflows/release.yml) runs commitizen (configured in
[`.cz.toml`](.cz.toml)) on the Conventional Commits since the last tag:

1. If there are no `feat`, `fix` or breaking-change commits, nothing happens.
2. Otherwise commitizen bumps `version` in `package.json` and `package-lock.json`, updates
   `CHANGELOG.md`, and commits and tags `vX.Y.Z` as the `commitizen-ci` GitHub App. That app is the only
   actor allowed to push to `main` directly.
3. The workflow builds the tarball with `earth +pack` and publishes it to npm with
   [trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance. No npm token is stored.
4. It creates a GitHub release for the tag with that version's changelog. While the version is `0.x`, releases are
   marked as pre-releases.

While on `0.x`, breaking changes bump the minor version. Never edit the version or `CHANGELOG.md` by hand. Run
`mise run bump` to preview what the next release would be.

## License

MIT. See [LICENSE](LICENSE). This project is a port of [github/scientist](https://github.com/github/scientist), which is
also [MIT licensed](https://github.com/github/scientist/blob/main/LICENSE.txt).
