# Agent playbook

`@johnhenry/mport` — routes JavaScript imports across CDNs: deterministic resolution,
adaptive transport, compiled to import maps; plus the 1.x `mport()` API on top. Single
package, Node >= 26, `node:test` (`npm test`), ships source (`src/*.mjs`, no build step).
The library is browser code with no dependencies; Node runs the tests, the offline
examples and the CLI. `docs/api.md` is the behavioural contract: change it with the code.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm ci`
2. `npm run typecheck` — compiles `test/types.check.ts` against `src/types.d.ts` and
   `src/core.d.ts` through the package's own `exports` map.
3. `npm test` — must show **0 skipped** as well as 0 failed. No test touches the network
   (`test/helpers.mjs` has `fakeFetch`); a test that needs one is wrong.
4. `npm run examples` — the numbered examples are self-verifying and offline.
5. `npm pack --dry-run` — read the file list: `src/`, `bin/`, `docs/`, `CHANGELOG.md`,
   `README.md`, `LICENSE.md`, `package.json`, nothing else.
6. `npm run size` — the size budgets (below); and, when you touched an entry point, `exports`, a `.d.ts` or `jsr.json`,
   `npm run jsr-dry-run` (JSR, below).
7. A genuinely fresh clone:
   `git clone . /tmp/mport-verifyN && cd $_ && npm ci && npm test && npm run examples`.
8. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`, the reusable family gate) runs steps 1-5 on Node 26, with `typecheck`, `test`, `examples`, `pack` in this order; match it locally. Step 6 is the local `size` and `jsr-dry-run` jobs.
Node 24 also runs everything today, but 26 is the floor that is tested.

## Browser tests and the type-check

`npm run test:browser` is a separate CI job per engine, not part of the loop above (it needs
browsers installed). Pages are served by `test/browser/serve.mjs` on port 8731 and never reuse an
existing server; all CDN traffic is answered by `test/browser/stubs.mjs`. Firefox ignores an
import map added after a module has loaded, so `startup()` can't work there (documented,
asserted by the "late import maps" spec). `tsc` finds `@types/*` in parent directories, so run the
type-check in a fresh clone (step 6) before trusting a pass that needs an ambient type.

## Size budgets and the bench

`npm run size` (`scripts/size.mjs`, gating in the CI `size` job) measures the packed tarball (`npm pack --dry-run --json`: compressed
and unpacked bytes) and the **gzip size of every entry point of `exports`**, counted as the entry file plus everything it reaches
through relative static imports (what a no-bundler page downloads). The limits are `package.json` `sizeBudget`
(`tarball`, `unpacked`, `entries: { "<export key>": <gzip bytes> }`), set at today's measurement plus about 10%. It exits 1 when a
measure is over its budget, when an export has no budget, or when a budget names an export that is gone, and `-- --json <file>`
writes the report (CI uploads it as the `size-report` artifact). Raise a limit deliberately, in the commit that grows the package,
with the reason in the message; never to turn a red build green. A new entry point needs its `sizeBudget.entries` row.

`npm run bench` (non-gating, the CI `bench` job) prints the numbers; `-- --out <file>` also writes them as JSON. CI stores that file
as the `bench-results` artifact and runs `node bench/compare.mjs bench-results.json` against the committed
`bench/baseline.json`: a measure more than 3x worse (lower-is-better for ms, higher-is-better for per-second) prints a `::warning::`
annotation. It never fails the build (runners differ). Refresh the baseline on purpose, ideally from a CI run's artifact
(`gh run download <id> -n bench-results`, then copy it to `bench/baseline.json`): `npm run bench -- --out bench/baseline.json`
locally records this machine's numbers instead.

## JSR (prepared, not published)

`jsr.json` names `@johnhenry/mport` at the package version, exports the same entry points as `package.json` (minus
`./package.json`), and publishes `src/**/*.mjs`, `src/**/*.d.ts`, README, LICENSE, CHANGELOG. JSR needs types for a JavaScript
entry point, so each entry `.mjs` starts with `// @ts-self-types="./<its>.d.ts"` (the `types` of that export).
`test/jsr.test.mjs` fails when `jsr.json` drifts from `package.json` (name, version, exports, the self-types comment), so a
version bump touches both. `npm run jsr-dry-run` (`npx jsr@0.14.3 publish --dry-run --allow-dirty`) must say `Success Dry run
complete`; the CI `jsr-dry-run` job runs it. Its `unanalyzable-dynamic-import` / `import.meta.resolve` warnings are expected: the
injected `import(url)` importers and the optional-peer import in `graph.mjs` are dynamic by design.
**Never run a real `jsr publish` from here.** Creating the `@johnhenry/mport` package on jsr.io is a **manual browser step for
the owner** (JSR has no API or CLI for creating a scope or package; sign in at https://jsr.io/new as `johnhenry`); see
`~/Projects/@johnhenry/ecosystem/jsr-packages/README.md`. After it exists, publishing from CI uses GitHub OIDC (no token).

## Repo-specific gotchas

- **`@johnhenry/html-modules` is an optional peer and a pinned git devDependency.** `htmlGraph()` / `build({ html })` import it on
  demand for `scanHTMLModule`. It is unpublished, so the devDependency is `git+https://github.com/johnhenry/html-modules.git#<sha>`
  (the tests need the real scanner): `npm install` rewrites the lockfile's `resolved` to `git+ssh://`, which CI cannot clone, so
  after any `npm install` change it back to `git+https` (leave the `integrity` npm wrote). To move the pin, edit `package.json` and
  the lockfile, install, fix `resolved`. Once it is on npm, replace the git pin with a normal range.
- **An HTML graph is walked with html-modules' own reader.** What counts as an import is whatever `scanHTMLModule` records
  (comments and `<template>` content do not count; `<html-import-settings base>` rebases the module's imports and re-exports),
  so mport never re-implements it with a regex. The manifest is `{ [absolute url]: "sha384-…" }`, the shape of an import map's
  `integrity`; do not invent a second format.

- **Raw file CDNs cannot serve CommonJS, and fixtures must say which format they are.**
  jsDelivr/unpkg/jspm/`local()` skip a package whose entry `entryInfo()` judges CommonJS
  (292a367). `test/helpers.mjs` marks `react` as `"type": "module"` on purpose so routing
  tests can use raw CDNs; `cjs-only` is the realistic case. Don't "fix" a raw-CDN test by
  adding `allowCommonJS`; decide which format the fixture models.
- **A trace keeps growing after `resolve()` returns.** Race losers settle later, and an
  `import()` probe can't be cancelled: one that finishes after the race was decided must
  be traced `aborted` / `"lost the race"`, never `ok` (292a367). Tests wait a tick before
  asserting on losers.
- **`probe: "none"` checks nothing, so it emits `selected` and records no health.** It used
  to log 0 ms `ok` events that counted as real successes in health (292a367).
- **Anything that cannot exist is a `ResolutionError`, and it must not be retried per
  provider.** `fallback()` and `race()` rethrow it by `name`; a `TypeError` from the range
  parser once turned `react@beta` into a `RoutingError` blaming every CDN (b70dabf).
- **Lockfile keys are the specifier as written** (`lockKey`, 90c05c9), which is not the
  import-map key (`keyOf`, no version). Changing the key format orphans every committed
  lockfile, so it is a breaking change with a CHANGELOG migration answer.
- **`router.import()` may switch builds unless something pins one** (53f5fd6). Sticking to
  the first build made failover from esm.sh impossible without a lockfile. Keep the pin
  semantics (lockfile entry or `options.build`) exactly as documented in `docs/api.md`.
- **Nothing reachable from `src/firefox.mjs` may contain a two-argument `import()`.**
  Older SpiderMonkey rejects it at parse time; `test/v1.test.mjs` walks the import graph.
  `import(url, options)` lives only in `src/index.mjs`'s injected importer.
- **Shared lookups can't take a per-call signal.** Registry lookups and import probes are
  memoized across calls, so `resolve()` races them against the caller's signal
  (`abortable()`), and `fallback()` reports the abort reason, not the node's error
  (d8f7607, 2218afb).
- **Two declaration files, one drift test.** `src/types.d.ts` (`.` and `./firefox`) and
  `src/core.d.ts` (`./core`, no v1 functions) must both name every runtime export;
  `test/exports.test.mjs` fails otherwise.
- **The package was renamed from `mport`.** Live pointers say `@johnhenry/mport`; the bin,
  the router's default `name: "mport"` and error-message prefixes (`mport: …`) are
  deliberately unchanged. Examples import the package by its own name (self-reference).

## Definition of done

A change is done when all of the following hold, not just when tests pass:
- A regression test exists for any bug fixed, using `fakeFetch`, not the network.
- `docs/api.md` states the new behaviour, default or error, and the README tables agree;
  anything the feature does **not** do is written down, not left for a test to reveal.
- Both `.d.ts` files are updated and `npm run typecheck` passes.
- `CHANGELOG.md` has an entry citing the commit.
- A new behaviour worth showing gets a numbered example and a row in `examples/README.md`.

## Releases

CI (`.github/workflows/ci.yml`) and publish (`publish.yml`) call the family's reusable workflows
(`johnhenry/workflows/.github/workflows/{ci,npm-publish}.yml@v1`). Local to this repo and
not expressible there: the `browser` matrix (chromium/firefox/webkit), the gating `size` and `jsr-dry-run` jobs and the non-gating `bench`
in ci.yml. `publish.yml` folds the browser suite into its `gate-commands` (installs all three
engines, runs `npm run test:browser`), keeps `id-token: write` on the caller job and
`secrets: inherit`, and triggers on `release: published`, `workflow_dispatch` and a redundant
`push: tags: v*` (the release event can be dropped for `uses:`-bodied jobs; the `npm view`
guard makes a double run a no-op). The caller's concurrency group in ci.yml is named differently
from the reusable one on purpose so it never cancels the called workflow.

Routine release: bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>`.

### First release checklist (0.0.0, never published)

Checked without a token on 2026-10-01: `npm pack --dry-run` / `npm publish --dry-run` list 34
files (`src/`, `bin/`, `docs/`, `CHANGELOG.md`, `README.md`, `LICENSE.md`, `package.json`; no
tests, no scratch, no `.env`), 106.6 kB. `name` is `@johnhenry/mport`, `repository.url` is
`git+https://github.com/johnhenry/mport.git` (must match the publishing repo for provenance),
`publishConfig.access` is `public`, `engines.node` `>=26`, every `exports` entry has a `types`
file. `npm view @johnhenry/mport@0.0.0` exits 1 with E404 for an unpublished scoped package, and the
guard treats any non-zero exit as "not published, go ahead", so a 404 does not fail the job.

Before: the repo secret `NPM_TOKEN` must exist (a scope-capable token for `@johnhenry`; the reusable
workflow requires it) and `main` CI must be green on the head commit.

```sh
gh release create v0.0.0 --target main --title v0.0.0 --notes "First release of @johnhenry/mport (successor to the unpublished mport 2.x)."
```

Verify afterwards: the Publish run is green (a tag push may start a second run that skips with the
"Already published" notice); `npm view @johnhenry/mport version` prints `0.0.0`; the package page
shows the provenance badge; `npx -p @johnhenry/mport mport --help` runs from an empty directory.
A failed run can be retried with "Re-run failed jobs" or `workflow_dispatch`.
