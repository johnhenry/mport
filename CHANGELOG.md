# Changelog

## 0.0.0 — npm scope migration (2026-09-28)

**Previously published as `mport`, last unscoped version 1.0.0.** `@johnhenry/mport`
restarts at `0.0.0` because it is a new address in the `@johnhenry` family, not because
the code is immature. This is not a rename-only release: it is also the first publish of
the router API, developed as mport 2.0.0 after 1.0.0 and never published under the old
name, and of the 1.x fixes that came with it. The unscoped `mport` stays at 1.0.0.

Before 1.0, `^0.0.0` matches only `0.0.0`: pin exactly until a deliberate `0.1.0`.

### Can I keep calling `mport()`, `MPort()` and `MPortURL()`? Yes.

Same signatures, same default origins. Change the import to `@johnhenry/mport` (and
`mport/firefox` to `@johnhenry/mport/firefox`). The behaviour changes are the bug fixes
listed below; the one visible addition is a third element in `MPortURL`'s result, which
two-element destructuring ignores. See the README's "Migrating from 1.x".

### Will `npm install mport` get these fixes? No.

Nothing more will be published as `mport`. Install `@johnhenry/mport`.

### The router (new)

- **Imports are routed across CDNs with deterministic resolution and adaptive
  transport.** `createRouter()` turns ranges into exact versions from npm or JSR
  metadata, finds entry files for raw CDNs, and lets a strategy tree (`fallback`, `race`,
  `adaptive`/`weighted`, `prefer`, `verified` SRI, `cache`, circuit-breaker health)
  choose among providers for esm.sh, jsDelivr (raw and `+esm`), unpkg, jspm, JSR, GitHub,
  local and custom origins. `build()` compiles an import map and a lockfile that pins
  version, entry, build and integrity; only providers with the same build are treated
  as mirrors. `npm:`, `jsr:` and `github:` specifiers, a CLI (`mport build`,
  `mport resolve`), browser helpers (`startup()`, `createImporter()` with runtime
  failover) and per-resolution traces plus `onEvent` came with it. In 35ac6af.
- **Registry lookups are traced, and an unknown package or impossible range is one
  `ResolutionError`.** It used to fail every provider in turn and blame each of them.
  Raw CDNs map sub-paths through `exports` (`preact/hooks`); `createRouter({ health })`
  shares health between routers. In 39c0e72, which also added the examples playground.
- **The API was hardened from integration feedback.** `resolve()` honours a pre-aborted
  signal and rejects promptly on abort even while a shared lookup or import probe is
  running; `exclude` takes any iterable; `parseSpecifier()` returns `null` for
  non-package schemes (`node:`, `partial:`) and bare `@scope` aliases instead of
  treating them as npm names; `build()` rejects unroutable specifiers instead of
  silently dropping them; `verified()` records mismatches in the trace
  (`phase: "integrity"`). Fixed in d8f7607.
- **`fallback()` reports the caller's abort reason**, not a skipped node's error, and a
  synchronous abort no longer leaks an unhandled inner rejection. Fixed in 2218afb.
- **Raw file CDNs skip packages whose entry is CommonJS.** jsDelivr, unpkg, jspm and
  `local()` served React's CommonJS `index.js`, which a browser can't import; they now
  skip it with a reason and the route falls through to an ESM-transforming CDN.
  `allowCommonJS: true` opts out. An import probe that finishes after a race was decided
  is traced as `aborted` ("lost the race") instead of `ok`; `probe: "none"` emits
  `selected` instead of a fake probe/ok pair and records no health data (it used to log
  0 ms successes); lookup errors explain that browsers see the npm registry's 404 as a
  CORS error. Fixed in 292a367.
- **Lockfile keys are the specifier as written.** Keys used to be
  `<registry>:<name>@<range>` with the registry taken from the request, so a bare
  `@std/path@^1` routed to JSR was keyed `npm:@std/path@^1` while its entry said
  `registry: "jsr"`. The entry's `registry` now records who served it. Fixed in 90c05c9.
- **`router.import()` can fail over across builds.** It stuck to the first CDN's build
  after an import failure, so without a lockfile failover from esm.sh to jsDelivr was
  impossible. A lockfile pin or the `build` option still restricts it. Fixed in 53f5fd6,
  which also rebuilt the example pages (playground, app, compatibility).
- **An unknown dist-tag is one `ResolutionError`.** `react@beta` with no `beta` tag fell
  through to the range parser, whose `TypeError` every provider retried, ending in a
  `RoutingError` of `TypeError`s. Fixed in b70dabf.

### 1.x fixes (the v1 API now runs on the router)

All in 35ac6af:

- **The race waits for the first success.** 1.x used `Promise.race`, so one CDN that
  failed quickly rejected the whole import.
- **Scoped names parse** in string form (`"@scope/pkg@1.2.3/x.js"`); 1.x split on the
  first `@`.
- **Origin arguments are honoured.** `MPort("a.cdn/", "b.cdn/")` silently used the
  defaults.
- **`useCache: "localhost"` works.** It compared a URL host with an origin path and never
  matched.
- **`mport/firefox` works.** It referenced undefined variables.
- **Path-less imports prefer ESM**: `exports` → `module` → `main` instead of `main` only.
  This can change which file loads for packages whose `main` is CommonJS.
- **The tarball ships every file.** 1.0.0's was missing `config.mjs` and
  `race-which.mjs`.

### Types

- **`src/types.d.ts` agrees with the code.** `./core` pointed at declarations that
  include the v1 functions it doesn't export (it now has `src/core.d.ts`); `keyOf`,
  `isRoutable`, `createLock`, `lockKey`, `semver`, `router.lock`, the `registry` option
  and errors' `trace` were missing. `test/exports.test.mjs` and `npm run typecheck` keep
  them in sync. In cd541ac.

### Housekeeping (adoption)

- Renamed to `@johnhenry/mport` at `0.0.0` with `homepage`
  `https://opensource.johnhenry.me/mport/`, `publishConfig.access: public`,
  `engines.node >=26.0.0` and `.nvmrc` 26 (1.0.0 declared `>=18`, which affects only the
  CLI and tests: the library itself is browser code). The bin is still `mport`. The
  license's copyright line gained its holder. In e968406.
- CI (`ci.yml`: typecheck, tests, examples smoke test on Node 26) and a release-triggered
  `publish.yml` with provenance and an idempotent `npm view` guard; the repo had no
  workflows before. In 685ba26.
- Eleven numbered, offline, self-verifying examples and an examples index. In fe7aa20.
- `docs/api.md`, a complete API reference, and a README rewritten to the family
  standard. In 6fec102.

## 1.0.0 (2025-04-18)

Reconstructed from git history; there was no changelog before the adoption. Published as
`mport`.

- Default export `mport`, `useCache: "localhost"` to remember the winning URL (a965a09).
- `mport/firefox`, an entry point without two-argument `import()` (93016bb).

## 0.0.1 – 0.0.3 (2025-04-17)

Published as `mport`: `MPort()` / `MPortURL()` racing jsDelivr, JSPM and unpkg
(cff3149, 6daef34, 62a2f40, cc2bb40).
