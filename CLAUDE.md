# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@mhvelplund/scientist`: a TypeScript port of GitHub's Ruby [Scientist](https://github.com/github/scientist) library. It has zero runtime dependencies and ships ESM and CJS builds with type declarations. It tracks upstream tag `v1.6.5`. The API, behavior and docs follow the Ruby original as closely as JavaScript allows. Every intentional deviation is listed in `docs/differences-from-ruby.md`, so update that file whenever behavior or naming diverges from Ruby.

## Commands

[mise](https://mise.jdx.dev) manages the toolchain (Node 24, pinned in `mise.toml`) and is the single build entrypoint, both locally and in CI. `mise.toml` puts `./node_modules/.bin` on PATH.

```sh
mise run ci         # everything CI runs: lint, typecheck, test, build, smoke
mise run lint       # biome check .
mise run format     # biome check --write .
mise run typecheck  # tsc --noEmit (src + test)
mise run test       # vitest run --coverage
mise run build      # tsdown -> dist/ (also runs publint + attw)
mise run smoke      # load built dist/ from CJS and ESM, type-check the declarations
```

Run a single test file or test by name with `npx vitest run test/experiment.test.ts` or `npx vitest run -t "pattern"`.

- Vitest also type-checks `test/**/*.test-d.ts` (`expectTypeOf` assertions in `test/types.test-d.ts`).
- `test/smoke/` is excluded from the root tsconfig. It only runs against the built `dist/`, so run `build` first.

## Architecture

**One algorithm, sync and async.** The experiment logic is written once, as generator functions ("steps", named `*Steps`) in `experiment.ts`, `observation.ts` and `result.ts`. `src/internal.ts` holds the two drivers:
- `runSync` expects the generator never to yield. It throws an internal error if it does.
- `runAsync` awaits every yielded value and resumes the generator with the result.

Every user callback result goes through one of two helpers:
- `behaviorValue` (for `use`/`try` behaviors): in sync mode it passes the value through untouched.
- `hookValue` (for compare, ignore, runIf, enabled, clean and similar callbacks): in sync mode it throws a `TypeError` if it gets a Promise.

When adding logic that calls user code, write it inside a steps generator and route the value through the matching helper. Don't fork separate sync and async implementations.

**Private state via WeakMap.** `Experiment` keeps its configuration (behaviors, comparators, context, hooks, frozen flag) in a module-level `WeakMap` (`stateOf()` in `experiment.ts`), not in instance fields. This keeps subclass namespaces clean, because users subclass `Experiment` and override `enabled()` / `publish()` / `raised()`. After a run the state is frozen, and `use`/`try`/`context(data)` then throw `TypeError`.

**Entry points.**
- `Experiment.setDefault(klass)` registers the default experiment class. `Experiment.create(name)` instantiates it.
- `src/scientist.ts` wraps these as `run`/`runAsync`, `science`/`scienceAsync`, the `Scientist` base class, and the `withScience(Base)` mixin.
- `DefaultExperiment` is never enabled and never publishes.

**Ruby-compat naming.** Ruby names are exported as aliases in `src/index.ts`, for example `Default`, `BadBehavior` and `NoValue`. Error operations passed to `raised()` are the strings in `RaisedOperation` (`"run_if"` keeps Ruby's snake_case).

**Tests.** Unit tests in `test/*.test.ts` mirror upstream's `test/scientist/*_test.rb`. `test/docs-examples.test.ts` has executable copies of the examples in `README.md` and `docs/*.md`. When you change a doc example, update its test too.

## Conventions

- Biome sets the formatting: 2-space indent, 100-column lines, double quotes. It also organizes imports.
- tsconfig is strict, with `noUncheckedIndexedAccess`, `noImplicitOverride` (subclass overrides need `override`) and `verbatimModuleSyntax` (use `import type` / inline `type` imports).
- Build target is ES2022.
