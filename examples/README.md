# mport examples

Runnable, self-verifying examples. Each numbered example asserts the behaviour it
demonstrates and exits 0 on success, so `npm run examples` doubles as a smoke test (CI
runs it). The numbered examples run offline: the npm and JSR registries and the CDNs are
a fake `fetch` (`_offline.mjs`) with registry metadata shaped like the real endpoints,
and `import()` is a fake `importer` where one is needed. The routing, resolution,
lockfile, health and integrity logic they exercise is exactly what runs against the real
network. The browser pages under the second table talk to the real CDNs.

| Example | Demonstrates |
| --- | --- |
| [`01-ranges-resolve-once-to-exact-versions.mjs`](./01-ranges-resolve-once-to-exact-versions.mjs) | `react@^19` becomes exactly `19.2.0` through one registry lookup, visible in the trace as `lookup` → `resolved`; an exact version skips the lookup; dist-tags and JSR packages (ignoring yanked versions) resolve too; an unsatisfiable range rejects once with `ResolutionError` and no CDN is blamed. |
| [`02-fallback-skips-a-cdn-that-is-down.mjs`](./02-fallback-skips-a-cdn-that-is-down.mjs) | An array route is `fallback()`: a CDN answering 503 is a recorded failure, a provider without npm support is skipped without a request, and the next mirror serves the package with its entry file from `exports`. When every provider fails the rejection is a `RoutingError` carrying one error per provider and the trace. |
| [`03-race-first-success-wins-losers-are-not-blamed.mjs`](./03-race-first-success-wins-losers-are-not-blamed.mjs) | `race()` takes the first **success**, so a fast failure does not sink it; slower probes are aborted and get no health entry. With `probe: "import"` a loser that finishes after the race was decided is traced as `aborted` with reason `"lost the race"`, never `ok`. |
| [`04-commonjs-is-skipped-on-raw-cdns.mjs`](./04-commonjs-is-skipped-on-raw-cdns.mjs) | React's CommonJS entry is skipped on jsDelivr and unpkg with a reason, and esm.sh serves it; Preact's sub-path `hooks` is mapped through its `exports` to an `.mjs` file; `allowCommonJS: true` turns the check off; `entryInfo()` applies the detection rules. |
| [`05-lockfile-pins-version-and-build.mjs`](./05-lockfile-pins-version-and-build.mjs) | A lockfile brings back the same version and entry with **no** registry request, and only mirrors of the locked build may serve it: esm.sh and jspm are skipped as `locked to "npm"` and jsDelivr stands in for unpkg. `relock: true` ignores the lock for one call. |
| [`06-circuit-breaker-opens-and-resets.mjs`](./06-circuit-breaker-opens-and-resets.mjs) | After two failures esm.sh's circuit opens and it is skipped without a request; after `reset` it closes, but its failure streak survives so one more failure reopens it; routers can share a `HealthRegistry`; `snapshot()`'s shape. |
| [`07-verified-rejects-a-tampered-mirror.mjs`](./07-verified-rejects-a-tampered-mirror.mjs) | `verified()` rejects a mirror whose bytes don't match the expected SRI hash even though its availability probe passed, and fails over; without an expected hash it records whatever it downloaded (trust on first use) into the import map's `integrity` and the lockfile. |
| [`08-router-import-fails-over-at-runtime.mjs`](./08-router-import-fails-over-at-runtime.mjs) | `router.import()` (and `createImporter()`) excludes a provider whose module fails to import and resolves again, switching from esm.sh to jsDelivr's `+esm` build; with `build: "esm.sh"` or a lockfile pin it rejects with a `RoutingError` instead; unroutable specifiers are imported as they are. |
| [`09-build-compiles-an-import-map-and-lockfile.mjs`](./09-build-compiles-an-import-map-and-lockfile.mjs) | `router.build()` compiles exact, sub-path, prefix (`lit/`), registry-prefixed and scoped entries into one import map, keys the lockfile by the specifier as written, and rejects an unroutable specifier with `ResolutionError` instead of dropping it. |
| [`10-cli-builds-offline-from-a-config.mjs`](./10-cli-builds-offline-from-a-config.mjs) | The `mport` CLI builds `importmap.json` and `mport.lock.json` from `mport.config.mjs`, `mport resolve` honours a hand-edited lockfile pin (no lookup in the trace), `--relock` ignores it, and an unknown command exits 1 with the message on stderr. |
| [`11-v1-api-races-origins-on-the-router.mjs`](./11-v1-api-races-origins-on-the-router.mjs) | The 1.x `MPortURL()` race takes the first import that succeeds (1.x rejected on the first failure), returns `[module, url, info]` with a trace, parses scoped names, and honours origin arguments. Uses the internal `createV1()` factory with a fake importer, because Node cannot `import()` https URLs. |

Browser pages, demos and support files (not part of `npm run examples`):

| Example | Demonstrates |
| --- | --- |
| [`playground.html`](./playground.html) | **Learn.** Ten one-click scenarios against the real CDNs and registries, with outages, latency, broken imports and tampered bytes simulated through `fetch`/`importer` wrappers: routing by package name into an import map and lockfile, a CDN outage (and why React can't fall back to a raw CDN), retrying at import time, a race, the circuit breaker, lockfile pinning to a different mirror, choosing by capability, a tampered mirror rejected by `verified()`, and the 1.x API. Each scenario states what to notice and checks that it happened. |
| [`app.html`](./app.html) | **Use it.** A Preact + htm app ([`app-main.mjs`](./app-main.mjs), [`app-view.mjs`](./app-view.mjs)) loaded either through an injected import map or through `router.import()`, with esm.sh up, down, or answering but failing to import. Proves an import map cannot fall back at runtime and `router.import()` can. |
| [`compat.html`](./compat.html) | **Check it.** The 1.x API run through both `@johnhenry/mport` and `@johnhenry/mport/firefox` against the real CDNs as a pass/fail table, including a scan proving the Firefox entry never uses two-argument `import()`. |
| [`index.html`](./index.html) | Redirects to the playground. |
| [`demo.mjs`](./demo.mjs), [`demo.firefox.mjs`](./demo.firefox.mjs), [`demo-run.mjs`](./demo-run.mjs) | The 1.x calls against the real CDNs under Deno (`npm run demo`, `npm run demo:firefox`), printing results. `demo-run.mjs` holds the shared calls and imports nothing from mport, so the Firefox demo never loads the standard entry point. |
| [`ui.mjs`](./ui.mjs), [`shared.css`](./shared.css) | Shared header, timeline, verdicts and styles for the three pages. |
| [`_offline.mjs`](./_offline.mjs) | The fake network and registry fixtures the numbered examples share. |

## Running

```sh
npm run examples      # run all numbered examples in sequence
npm run example:05    # run one
node examples/05-lockfile-pins-version-and-build.mjs

npm run demo:html     # serve the repo, then open http://localhost:8712/examples/
npm run demo          # 1.x calls against the real CDNs (Deno)
```

## Runtime requirements (honest edition)

The numbered examples run under **plain Node >= 26** with no network: they import the
package by its own name (`@johnhenry/mport`, a self-reference through `package.json`
`exports`) and pass a fake `fetch`, which every router option accepts. Example 10 links
the repo into a temporary directory's `node_modules` so its config can import the package
the way an installed one would.

What they deliberately do not cover, and why: Node cannot `import()` an `https:` URL, so
`probe: "import"`, `router.import()` and the v1 functions are shown with a fake
`importer` (examples 03, 08 and 11) rather than real CDN modules. `startup()` and
`injectImportMap()` need a `document`; `app.html` exercises them in a real browser, and
`test/importmap.test.mjs` covers `injectImportMap()` headlessly. The browser pages and the
Deno demos need the real network and are excluded from `npm run examples`; that is
intentional, not an oversight.
