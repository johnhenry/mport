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

### Conflicting versions, whole-graph integrity, lockfile upkeep, bundler plugins, browser CI

All additive; the one behaviour that changed is that `startup()` can now reject (below).

- **`build(specifiers, { conflicts: "scope" })` generates import-map scopes for conflicting
  versions.** Two specifiers that map one key to different URLs still throw by default
  (`conflicts: "error"`); with `"scope"` the first listed keeps `imports` and each package in
  the build whose registry manifest depends on another version gets a scope keyed by its own
  directory. The result gains `conflicts`, a report of what was scoped and which versions no
  package reaches; `--conflicts scope` and `config.conflicts` in the CLI. Dependents are the
  packages named in the build, not their transitive dependencies, and a scope only changes
  bare imports (esm.sh and jsDelivr `+esm` already import by URL): the limits are in
  docs/api.md. Real engines honour the generated scopes (browser tests). In f167c83.
- **`build(specifiers, { graph })` records integrity for every file of each module's static
  import graph.** `verified()` hashes the entry file only, which on esm.sh is a stub; `graph`
  fetches each module, parses its `import`/`export … from` specifiers (`parseImports()`, a
  dependency-free tokenizer that handles minified output), follows same-origin URLs and puts
  every hash in the import map's `integrity` and the lockfile's new top-level `files` map. A
  later build refuses a file whose bytes changed. Bounded by `maxFiles` (500) and `maxDepth`
  (20); hitting a bound is a `truncated` trace event and `result.graph.truncated`, and the CLI
  warns. `--graph`, `--max-files`, `--max-depth`. In 9a376f7.
- **`mport outdated` and `mport update [name…]`, both with `--json`.** `outdated` lists locked
  packages whose range allows a newer version (`wanted`) or that trail the `latest` tag;
  `update` re-resolves the named entries (or all) within their ranges and rewrites the
  lockfile, never the import map. New: `outdated()`, `pickVersion()`, `registry.info()`,
  `registry.manifest()`, `router.registry`. Registry metadata is now fetched once per package
  however many ranges ask. In 4e39688.
- **Bundler plugins: `@johnhenry/mport/vite` and `@johnhenry/mport/rollup`.** Bare imports go
  through a router: `mode: "external"` emits the CDN URL, `mode: "importmap"` keeps the import
  bare and injects the map into `index.html` (Vite) or emits `importmap.json` (Rollup), with
  `build: { conflicts, graph }` passed through. `vite` and `rollup` are dev dependencies only,
  used by the real-build tests (Rollup 4, Vite 8). In 65ff684.
- **The types cover all of it** (`ConflictReport`, `GraphOptions`, `GraphReport`,
  `OutdatedRow`, the plugin entry points), and the type-check compiles a usage file against
  them, including that the real `vite` and `rollup` `Plugin` types accept ours. It now needs
  `@types/node` as a dev dependency; a parent directory's `node_modules` had hidden its
  absence locally. In 2f1ba9f and 6748da5.
- **The browser runtime is tested on Chromium, Firefox and WebKit** (Playwright, a local
  static server, every CDN stubbed with `page.route`; one CI job per engine), and `npm run
  bench` measures cold builds and resolution throughput (non-gating; numbers in the README).
  In 2f1ba9f.
- **`startup()` rejects when the engine ignored the import map it injected.** The browser tests
  found that Firefox (155) ignores an import map added after any module has loaded ("Import maps
  are not allowed after a module load or preload has started"), so `startup()` and
  `injectImportMap()` never worked there; bare imports failed later with a confusing
  `TypeError`. `startup()` now asks the engine (`import.meta.resolve`) and rejects with an
  error carrying the build result. `examples/app.html` says so. Chromium and WebKit are
  unaffected, and `createImporter()` or a map in the HTML works everywhere. In 7b6ba06 and ca8f0e3.

### Audit fixes (breaking changes, since 0.0.0 is unreleased)

- **The circuit breaker trips for a mirror that passes the probe but fails to import.**
  Inside `router.import()` a passing probe no longer resets the failure streak; only a
  completed import does (`HealthRegistry.settle()`). In da58440.
- **`resolveVersions: false` works with raw CDNs.** Providers that need an entry file skip
  a range or tag with a reason instead of asking the registry about `react/^19` and
  aborting the whole route. In d1a6870.
- **The lockfile's `version` is only ever resolved.** `local()`/`origin()` wrote the range
  (`^19`) there and the next run trusted it as exact; they now record the resolved version
  or omit it, and a stale range entry is ignored. In 1355e0e.
- **The output lockfile starts empty**, so specifiers you stopped building are pruned; the
  input lockfile only pins. In fae913a.
- **`cache()` keeps `entry`/`registry` on a hit, hits offline, and takes a `ttl`.** Its key
  is the specifier as written (plus target, route and pin), not the resolved version, so a
  hit makes no request at all. In 616663c (both).
- **`build()` throws when two specifiers map one key to different URLs** (`react@18` and
  `react@19`), pointing at scopes, instead of silently keeping one. In 8645866.
- **Prefix specifiers skip providers that can't serve a directory.** `jsDelivr({ esm: true })`
  threw a plain `Error` after a successful probe; raw CDNs mapped `react/` to a directory
  whose `jsx-runtime` subpath 404s when the package has an `exports` map. Both skip with a
  reason and the route falls through (new provider option `prefix`; `entryInfo()` reports
  `hasExports`). In b539f89 (both).
- **Semver:** a prerelease containing `-` (`1.0.0-beta-2`) is no longer truncated (ea636ef);
  `latest` wins when it satisfies the range, as in npm, and deprecated versions are passed
  over when others match (4174bfa).
- **CLI:** a config may be a function `({ lock, relock }) => router`, so `--lock`/`--relock`
  reach it; a prebuilt router refuses those flags and `build` no longer overwrites the lock
  file around it. In f13115b.
- **`fallback({ providers, circuitBreaker })` uses the router's health state and clock**
  with its own thresholds (`HealthRegistry.scoped()`), so it shows in `router.health`
  instead of a private registry on `Date.now`. In 4d83f2e.
- **`esmSh()` pins `?target=es2022`** (`esTarget`, `null` to opt out) so bytes and integrity
  don't vary by User-Agent; the docs now say integrity covers the entry module only. In a1add55.
- **`verified()` with the default `head` probe makes one `GET`**, not a `HEAD` then a `GET`.
  In f7f40c7.
- **Server-side rendering:** `renderImportMap()`, `renderModulePreload()`, `modulePreloads()`
  and `injectModulePreload()`, plus example 12. In c196736.
- **`compileImportMap()` omits integrity for prefix keys in scopes too**, matching the top
  level. In bbbcb6f.
- **Docs and example 12 put the import map before the modulepreload links.** They printed `renderModulePreload()` first; Firefox ignores an import map that follows a modulepreload (the same rule as for a late map), so every bare import failed there. Chromium and WebKit accept either order; `test/browser/runtime.spec.mjs` pins it per engine. Found by building the `workbench` integration app. In f5417e8.
- **`build({ graph: true })` no longer throws `TypeError: Invalid URL` when a module is mapped to an
  origin-relative URL** (a `local()` route in the same build): such a module is listed in
  `graph.skipped` and has no `integrity`. Found by building the `workbench` integration app.
  In 0936131.

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
