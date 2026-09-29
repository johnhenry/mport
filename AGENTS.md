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
6. A genuinely fresh clone:
   `git clone . /tmp/mport-verifyN && cd $_ && npm ci && npm test && npm run examples`.
7. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs steps 1-4 in this order on Node 26; match it locally.
Node 24 also runs everything today, but 26 is the floor that is tested.

## Repo-specific gotchas

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
  to log 0 ms `ok` events and poison the adaptive scores (292a367).
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

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge, then
`gh release create v<version>` — the release event triggers
`.github/workflows/publish.yml`, which runs the full gate and is idempotent (skips if the
version is already on npm). It needs a scope-capable `NPM_TOKEN` repo secret.
