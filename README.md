# mport

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Fmport.svg)](https://www.npmjs.com/package/@johnhenry/mport)
[![CI](https://github.com/johnhenry/mport/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/mport/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Fmport.svg)](LICENSE.md)

Full documentation: [opensource.johnhenry.me/mport](https://opensource.johnhenry.me/mport/)

Route JavaScript imports across any number of CDNs.

You keep writing ordinary imports. mport decides which CDN, registry or origin serves each one. Choosing an exact version is deterministic, but which mirror delivers it can change. The result compiles down to a standard import map, so the browser never needs to know mport exists.

```js
import { createRouter, esmSh, jsDelivr, unpkg, jsr } from "@johnhenry/mport";

const router = createRouter({
  "*": [esmSh(), jsDelivr(), unpkg()],            // ordered fallback
  "@std/*": jsr(),                                 // JSR packages
  "@internal/*": "https://modules.example.com/",  // your own origin
});

const { importMap, lock } = await router.build(["react@^19", "lit/", "@std/path@^1"]);
```

```json
{
  "imports": {
    "react": "https://esm.sh/react@19.2.0",
    "lit/": "https://esm.sh/lit@3.3.1/",
    "@std/path": "https://esm.sh/jsr/@std/path@1.1.0"
  }
}
```

mport 1.x's one-liner still works. It is now the simplest router: a runtime race between jsDelivr, JSPM and unpkg.

```js
import mport from "@johnhenry/mport";
const { default: _ } = await mport("lodash-es@4.17.21/lodash.js");
```

The complete reference, every export with its options, defaults, return shapes, errors and trace events, is [`docs/api.md`](docs/api.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Routes](#routes)
- [Providers](#providers)
- [Strategies](#strategies)
- [Import maps, lockfiles and the CLI](#import-maps-lockfiles-and-the-cli)
- [In the browser](#in-the-browser)
- [Debugging: traces and events](#debugging-traces-and-events)
- [API](#api)
- [Native import maps vs mport](#native-import-maps-vs-mport)
- [The v1 API](#the-v1-api)
- [Migrating from 1.x](#migrating-from-1x)
- [Examples](#examples)
- [Adding a new provider](#adding-a-new-provider)
- [Honest limitations](#honest-limitations)
- [Family](#family)
- [License](#license)

## Install

```bash
npm install @johnhenry/mport
```

Previously published as `mport`, last unscoped version 1.0.0. `@johnhenry/mport` restarts at `0.0.0` because it is a new address, not because the code is new: `0.0.0` is the first release of the router API (developed as mport 2.0, which never reached npm under the old name), and it keeps the 1.x API working. Before 1.0, `^0.0.0` matches only `0.0.0`, so pin exact versions until a deliberate `0.1.0`.

The package is plain ES modules with no dependencies. It runs in browsers and Deno as well as Node; the Node floor for the package, its CLI and its tests is 26 (`engines.node >=26.0.0`). To load it straight from a CDN:

```html
<script type="module">
  import { createRouter, esmSh, unpkg } from "https://cdn.jsdelivr.net/npm/@johnhenry/mport@0.0.0/src/index.mjs";
</script>
```

## Quick start

At build time, resolve once and write an import map plus a lockfile:

```bash
npx @johnhenry/mport build react@^19 react-dom@^19/client lit/
# mport: wrote importmap.json (3 imports) and mport.lock.json
```

Put `importmap.json` in your page as `<script type="importmap">`, commit `mport.lock.json`, and the next build returns the same versions and builds without asking the registry.

In the browser, decide at startup, or import through the router so a failing CDN is retried elsewhere:

```js
import { createRouter, startup, createImporter, esmSh, jsDelivr } from "@johnhenry/mport";

const router = createRouter({ "*": [esmSh(), jsDelivr({ esm: true })] });

await startup(router, ["preact@^10", "preact@^10/hooks"]); // injects the import map
const load = createImporter(router);                        // failover on import errors
const { default: dayjs } = await load("dayjs@1");
```

Every resolution explains itself:

```js
const r = await router.resolve("react@^19");
r.url;   // "https://esm.sh/react@19.2.0"
r.trace; // lookup → resolved → probe → ok (or fail → next provider …)
```

## How it works

```
 import "npm:react@^19"
         │
         ▼                                   RESOLUTION: deterministic
   route match      "*" → fallback(cache(), race(esmSh(), jsDelivr()), unpkg())
         │
   registry lookup  react@^19 → 19.2.0 (npm registry / JSR metadata, or the lockfile)
         │
         ▼                                   ROUTING: adaptive
   strategy tree    fallback ─┬─ cache
                              ├─ race ─┬─ esm.sh   ✓ 41 ms  ← selected
                              │        └─ jsDelivr ✗ aborted
                              └─ unpkg
         │
         ▼                                   COMPILATION
   import map       "react": "https://esm.sh/react@19.2.0"
         │
         ▼
   native browser ESM
```

The rule mport follows is that **resolution is deterministic and transport is adaptive**:

- `react@^19` becomes `19.2.0` once. The lockfile then pins that version together with its **build**, and a CDN outage can't change it.
- Providers that transform packages, such as esm.sh and jspm, serve a different artifact from providers that serve raw npm files, such as jsDelivr and unpkg. Only providers with the same `build` count as mirrors of each other. Once something is locked to the `npm` build, failover moves between jsDelivr, unpkg and your `local()` copy, and never silently switches to an esm.sh build.

## Routes

`createRouter(routes, options)` takes either an object or an array.

**Object form.** An exact key beats a glob, a longer glob beats a shorter one, and `"*"` is the catch-all. Only a trailing `*` is a wildcard, and it is a plain prefix match: `"react*"` also matches `react-dom`.

```js
createRouter({
  "*": [esmSh(), jsDelivr(), unpkg()],
  "react*": esmSh(),
  "@std/*": jsr(),
  "@company/*": custom("https://modules.company.com/{bare}.js"),
});
```

**Array form.** The first match wins. `match` may also be a `RegExp` or a function.

```js
import { route } from "@johnhenry/mport";
createRouter([
  route("@std/*", jsr()),
  route("github:*", github()),
  route("*", [esmSh(), jsDelivr(), unpkg()]),
]);
```

What each route value means:
- An array is shorthand for `fallback(...)`.
- A string is shorthand for `custom(url)`.
- Anything else is a provider or a strategy.

### Specifiers

| Specifier | Meaning |
|---|---|
| `react`, `react@^19`, `react@19.2.0/jsx-runtime` | npm package, optional range, optional sub-path |
| `@scope/pkg@1.2.3/dist/x.js` | scoped npm package |
| `npm:lodash-es@4` | explicit npm |
| `jsr:@std/path@^1` | JSR |
| `github:user/repo@ref/path` or `gh:` | a GitHub repository |
| `lit/` (trailing slash) | a prefix mapping in the import map. Raw file CDNs (jsDelivr, unpkg, jspm, `local()`) skip it for packages with an `exports` map, and `jsDelivr({ esm: true })` always skips it, so the route falls through to e.g. esm.sh |
| `{ name, version, path, registry }` | object form |
| `./x.js`, `/x.js`, `https://…`, `node:fs`, `@scope` | not routed: `resolve()` returns `null` |

Patterns match the specifier without its version, e.g. `npm:react/jsx-runtime`. Three rules affect which route and registry apply:
- An explicit specifier such as `npm:react` also matches bare routes (`react*`).
- `gh:` specifiers match as `github:`, so write route patterns as `"github:*"`.
- A bare scoped name such as `@std/path` that reaches a JSR-only provider is treated as a JSR package.

## Providers

| Provider | Build | Registries | Notes |
|---|---|---|---|
| `esmSh()` | `esm.sh` | npm, jsr, github | transforms to browser ESM |
| `jsDelivr()` | `npm` | npm, github | raw files. The entry comes from `exports` → `module` → `main`, and sub-paths such as `preact/hooks` are mapped through `exports` |
| `jsDelivr({ esm: true })` | `jsdelivr-esm` | npm | jsDelivr's `/+esm` bundles |
| `unpkg()` | `npm` | npm | raw files |
| `jspm()` | `jspm` | npm | `ga.jspm.io` builds |
| `jsr()` | `esm.sh` | jsr | through esm.sh. `jsr({ via: "jsr.io" })` loads raw files from jsr.io and needs a path |
| `github()` | `npm` | github | through jsDelivr's `/gh/`. `{ via: "esm.sh" }` also works |
| `local({ base })` | `npm` | npm | your own copy, e.g. a vendored `node_modules` |
| `custom(template)` | origin host | npm | `"https://x/"` or a template using `{name}` `{version}` `{path}` `{entry}` `{scope}` `{bare}` |
| `provider({...})` | yours | yours | write your own: `{ name, build, registries, capabilities, needsEntry, needsVersion, url(artifact) }` |

The CDN providers (`esmSh`, `jsDelivr`, `unpkg`, `jspm`, `jsr`) accept `origin`, so you can point them at a self-hosted mirror. Full URL shapes and capabilities: [docs/api.md#built-in-providers](docs/api.md#built-in-providers).

**CommonJS and raw CDNs.** Raw file CDNs (`jsDelivr()`, `unpkg()`, `jspm()`, `local()`) serve files as published, so a package whose entry is CommonJS, such as React's `index.js`, can't be imported from them in a browser. mport skips those providers for such packages (`skip` with a reason) so the route falls through to an ESM-transforming CDN like esm.sh. ESM is detected from `.mjs`, an `import`/`module` export condition, the `module` field, `"type": "module"`, or ESM-by-convention names (`*.module.js`, `*.esm.js`, `…/esm/…`). Pass `createRouter(routes, { allowCommonJS: true })` to turn the check off. The exact rules: [docs/api.md#commonjs-detection](docs/api.md#commonjs-detection).

## Strategies

Strategies are nodes that can be nested inside each other in any combination:

```js
route("npm:*",
  fallback(
    cache(),
    race(verified(esmSh()), verified(jsDelivr({ esm: true }))),
    unpkg(),
  ),
);
```

| # | Strategy | What it does |
|---|---|---|
| 1 | static: a single provider | Always the same destination. Use `probe: "none"` for a pure build-time mapping |
| 2 | `fallback(a, b, c)` | Try each in order. Nodes that can't serve the request are skipped (wrong registry, wrong build, excluded, circuit open) |
| 3 | `race(a, b, c)` | Probe all at once. The first **success** wins and the others are aborted. One fast failure no longer sinks the race |
| 4 | `adaptive([a, 5], weighted(b, 3), c)` | Order by weight × success rate ÷ latency, then fall back through that order. Deterministic for a given health state |
| 5 | build locking (from the lockfile) | The same artifact from many mirrors: only mirrors with the same `build` may serve a locked package |
| 6 | `fallback({ providers, circuitBreaker: { failures: 3, reset: "30s" } })`, or the router's `circuitBreaker` option | Health-aware failover. After *n* failures in a row a provider is skipped until `reset` has passed |
| 7 | `prefer({ browser: esmSh(), raw: jsDelivr(), default: unpkg() })`, or the `capabilities` option | Choose by target or capability. `resolve(spec, { target: "raw" })` |
| | `verified(node)` | Fetches the chosen URL, computes its SRI hash, and rejects on a mismatch with the lockfile (or `integrity`). Wrap each mirror so a bad one fails over: `race(verified(a), verified(b))` |
| | `cache({ store, ttl? })` | Reuses remembered resolutions without probing or any network request, keyed by the specifier as written (works offline). `store` is a `Map` (the default) or `localStorage`; `ttl` expires records |

### Probing

How the router checks that a candidate URL is available:

| `probe` | Behaviour |
|---|---|
| `"head"` (default) | `HEAD` request, falling back to `GET` on 405/501. Works in Node, so it suits build time |
| `"import"` | Actually `import()`s the URL and returns the module. Browser or Deno |
| `"none"` | Trust the first candidate. Static routing; records no health data |
| function | `(url, { provider, signal }) => Promise<{ module? }>` |

## Import maps, lockfiles and the CLI

```js
const { importMap, lock } = await router.build(
  ["react@^19", "lit/", "npm:lodash-es@4"],
  { scopes: { "https://legacy.example.com/": { react: "react@18" } } },
);
```

`importMap` contains `imports`, `scopes` and, when `verified()` ran, an `integrity` map. A specifier the router can't route rejects the build with a `ResolutionError` instead of being dropped. `lock` looks like this:

```json
{
  "lockfileVersion": 1,
  "packages": {
    "react@^19": {
      "specifier": "react@^19", "registry": "npm", "name": "react", "range": "^19",
      "version": "19.2.0", "build": "esm.sh", "provider": "esm.sh",
      "url": "https://esm.sh/react@19.2.0"
    }
  }
}
```

Keys are the specifier as written: a registry prefix appears only if you wrote one (`npm:react@^19`), and the entry's `registry` says which registry actually served the package. A bare `@std/path@^1` routed to JSR is keyed `@std/path@^1` with `"registry": "jsr"`.

Pass the lockfile back in with `createRouter(routes, { lock })` and the same versions come back without asking the registry again. The same entry files and builds come back too. Passing `{ relock: true }` to `resolve` ignores the lock. The lockfile `build()` returns holds every resolution *this router* has made so far (the lockfile you passed in only pins; entries you no longer build are dropped), so use a fresh router per build.

### CLI

```bash
npx @johnhenry/mport build react@^19 lit/   # writes importmap.json and mport.lock.json
npx @johnhenry/mport resolve react@^19 --trace
```

Once the package is installed the command is plain `mport`. By default the CLI reads `mport.config.mjs`. Its default export is a `{ routes, specifiers, scopes, options }` object, a function `({ lock, relock }) => router | object`, or a prebuilt router:

```js
// mport.config.mjs
import { esmSh, jsDelivr, unpkg, jsr } from "@johnhenry/mport";
export default {
  routes: { "*": [esmSh(), jsDelivr(), unpkg()], "@std/*": jsr() },
  specifiers: ["react@^19", "@std/path@^1"],
};
```

Flags: `--config`, `--out importmap.json`, `--lock mport.lock.json`, `--relock`, `--trace`. A function config receives the parsed lockfile (`undefined` with `--relock` or when there is none): `export default ({ lock }) => createRouter(routes, { lock })`. A prebuilt router can't take a lockfile, so `--lock`/`--relock` with one is an error and `build` leaves the lock file alone. Details: [docs/api.md#the-cli](docs/api.md#the-cli).

## In the browser

```js
import { createRouter, startup, createImporter, esmSh, jsDelivr } from "@johnhenry/mport";
const router = createRouter({ "*": [esmSh(), jsDelivr()] });

// A: resolve at startup, then use plain imports
await startup(router, ["react@^19", "react-dom@^19/"]);
const React = await import("react");

// B: import through the router every time; if an import fails, that CDN is excluded
//    and the next one is tried (restricted to one build only when a lockfile or
//    the build option pins it)
const load = createImporter(router);
const { default: dayjs } = await load("dayjs@1");
```

With `startup()`, the import map has to be in the page before the first module that uses it resolves. Put the startup code in its own `<script type="module">` before the rest of your modules, or generate the map at build time with the CLI.

## Debugging: traces and events

Every resolution carries a trace of what was tried:

```js
const r = await router.resolve("react@^19");
r.trace;
// [ { type: "lookup",   provider: "npm registry", url: "npm:react@^19" },
//   { type: "resolved", provider: "npm registry", version: "19.2.0", ms: 38 },
//   { type: "probe", provider: "esm.sh",   url: "https://esm.sh/react@19.2.0" },
//   { type: "fail",  provider: "esm.sh",   ms: 212, error: "… responded 503" },
//   { type: "skip",  provider: "jspm",     reason: 'serves build "jspm", locked to "npm"' },
//   { type: "probe", provider: "jsdelivr", url: "…" },
//   { type: "ok",    provider: "jsdelivr", ms: 41 } ]
```

Event types are `lookup` / `resolved` (a registry lookup that turned a range into a version), `probe`, `ok`, `fail`, `skip` (with a `reason`), `aborted` (a race loser; an `import` probe that finishes after the race was decided is reported as `aborted` with `reason: "lost the race"`), and `selected` (with `probe: "none"`: the provider was chosen without checking the URL, so no health data is recorded either). Failed resolutions attach the same list as `error.trace`. The full table: [docs/api.md#trace-events](docs/api.md#trace-events).

Resolutions that can't happen at all, such as an unknown package, an unknown dist-tag or an impossible range, reject with a single `ResolutionError`. No CDN is blamed or put in its circuit.

To stream events, pass `onEvent` to `createRouter` or to a single `resolve`/`import` call. `router.import()` also reports `{ type: "fail", phase: "import" }` when a resolved URL fails to load and it moves to another mirror.

`router.health.snapshot()` returns per-provider counts, latency and circuit state. Pass `health: otherRouter.health` to `createRouter` to share that state between routers.

In the v1 API, `MPortURL` returns this as a third tuple element, so existing destructuring keeps working:

```js
const [module, url, info] = await MPortURL()("lodash-es@4.17.21/lodash.js");
info.provider; // "ga.jspm.io/npm:"
info.trace;    // every probe in the race
```

## API

Every export, from `@johnhenry/mport` (all of them), `@johnhenry/mport/firefox` (the same names) and `@johnhenry/mport/core` (all but the v1 functions). Each links to its full entry in [`docs/api.md`](docs/api.md).

| Export | Signature | What it does |
|---|---|---|
| [`createRouter`](docs/api.md#createrouter) | `(routes, options?) → Router` | Build a router. Options: `probe`, `lock`, `resolveVersions`, `circuitBreaker`, `health`, `target`, `capabilities`, `fetch`, `importer`, `registries`, `registry`, `onEvent`, `now`, `allowCommonJS`, `name` |
| [`router.resolve`](docs/api.md#routerresolve) | `(specifier, options?) → Promise<Resolution \| null>` | Resolve one specifier. Options: `signal`, `exclude`, `build`, `integrity`, `target`, `capabilities`, `relock`, `onEvent` |
| [`router.import`](docs/api.md#routerimport) | `(specifier, options?) → Promise<module>` | Resolve and import, failing over when the import fails |
| [`router.build`](docs/api.md#routerbuild) | `(specifiers, { scopes?, signal? }?) → Promise<{ importMap, lock }>` | Resolve many and compile an import map and lockfile |
| `router.health`, `router.lock`, `router.name` | | The router's [`HealthRegistry`](docs/api.md#healthregistry), its in-memory lock, its name |
| [`route`](docs/api.md#route) | `(match, use) → { match, use }` | One array-form route |
| [`esmSh`, `jsDelivr`, `unpkg`, `jspm`, `jsr`, `github`, `local`](docs/api.md#built-in-providers) | `(options?) → Provider` | Built-in providers |
| [`custom`](docs/api.md#custom) | `(template, options?) → Provider` | A base URL or a `{name}`/`{version}`/`{path}`/`{entry}`/`{scope}`/`{bare}` template |
| [`provider`](docs/api.md#provider) | `(definition) → Provider` | Define your own provider |
| [`origin`](docs/api.md#origin) | `(pathOrOrigin) → Provider` | A v1 origin as a provider |
| [`fallback`](docs/api.md#fallback) | `(...nodes)` or `({ providers, circuitBreaker })` | In order |
| [`race`](docs/api.md#race) | `(...nodes)` | First success wins |
| [`adaptive`](docs/api.md#adaptive), [`weighted`](docs/api.md#weighted) | `(...[node, weight])`, `(node, weight)` | Ordered by weight and health |
| [`prefer`](docs/api.md#prefer) | `({ [target]: node, default? })` | By target |
| [`verified`](docs/api.md#verified) | `(node, { algorithm? })` | SRI check against the pinned hash |
| [`cache`](docs/api.md#cache) | `({ store?, name?, prefix?, ttl? }?)` | Remembered resolutions |
| [`sri`](docs/api.md#sri) | `(bytes, algorithm?) → Promise<string>` | Compute an SRI hash |
| [`HealthRegistry`](docs/api.md#healthregistry) | `new ({ failures?, reset?, now? }?)` | Per-provider health and circuit breaker |
| [`RoutingError`, `SkipError`, `IntegrityError`, `ResolutionError`](docs/api.md#errors) | classes | See the errors table |
| [`parseSpecifier`](docs/api.md#parsespecifier), [`keyOf`](docs/api.md#keyof), [`isRoutable`](docs/api.md#isroutable) | | Specifier parsing, import-map keys, routability |
| [`createRegistry`](docs/api.md#createregistry) | `({ fetch?, npm?, jsr? }?)` | Version and entry lookups |
| [`entryInfo`](docs/api.md#entryinfo), [`entryOf`](docs/api.md#entryof), [`resolveExports`](docs/api.md#resolveexports) | `(packageJson, subpath?)` | Entry-file selection and CommonJS detection |
| [`compileImportMap`](docs/api.md#compileimportmap), [`mergeImportMaps`](docs/api.md#mergeimportmaps) | | Import maps from resolutions; merging |
| [`createLock`](docs/api.md#createlock), [`lockKey`](docs/api.md#lockkey) | | Lockfiles and their keys |
| [`injectImportMap`](docs/api.md#injectimportmap), [`startup`](docs/api.md#startup), [`createImporter`](docs/api.md#createimporter) | | Browser runtime helpers |
| [`semver`](docs/api.md#semver) | namespace | `parse`, `valid`, `compare`, `satisfies`, `maxSatisfying` |
| [`mport`](docs/api.md#mport) (default), [`MPort`](docs/api.md#mport-and-mporturl), [`MPortURL`](docs/api.md#mport-and-mporturl) | | The v1 API (not in `./core`) |
| [`DEFAULT_ORIGINS`, `DEFAULT_CACHE_KEY`](docs/api.md#constants) | | v1 defaults |

Errors, in one line each: `ResolutionError` means the package or version can't exist (or the registry is unreachable) and no CDN is blamed; `RoutingError` (an `AggregateError`) means every provider in a fallback or race failed or was skipped; `SkipError` is a provider declining without trying; `IntegrityError` is `verified()` rejecting bytes. Types ship in `src/types.d.ts`.

## Native import maps vs mport

| | Import map | mport |
|---|---|---|
| Map a bare specifier to a URL | ✓ | ✓ (this is what it outputs) |
| Prefix mappings, scopes | ✓ | ✓ |
| Integrity | ✓ (`integrity`) | ✓ computes it with `verified()` |
| Several candidate URLs for one specifier | ✗ | ✓ fallback, race, adaptive |
| Choose by health, latency or capability | ✗ | ✓ |
| Version ranges → exact versions | ✗ | ✓ plus a lockfile |
| Retry another CDN after the browser has picked a URL | ✗ | only through `router.import()` / `createImporter()` |

Once the browser has resolved `import "react"` through an import map, there is no standard hook to try another URL if that fetch fails. mport therefore resolves ahead of time (CLI or `startup()`), or runs every load through `router.import()`.

## The v1 API

These keep the same signatures as 1.x:
- `mport(spec, importOptions?)`: the default export
- `MPort(options | ...origins)`
- `MPortURL(options | ...origins)`
- options: `{ cdns, useCache: "localhost", cacheKey }`
- `@johnhenry/mport/firefox`

Specifiers are `"name@version[/path]"` or `{ name, version, path }`. With no path, mport reads the package's `package.json` and imports its ESM entry.

`@johnhenry/mport/firefox` exists because older Firefox versions reject any two-argument `import()` at parse time. That entry point never uses the syntax. It reads `package.json` with `fetch`, so path-less specifiers work there too, and it ignores per-call import options.

## Migrating from 1.x

Nothing you call has been removed. Change the install to `@johnhenry/mport` (the unscoped `mport` stays at 1.0.0). Behaviour changes, all of them bug fixes:

- **The race waits for the first success.** 1.x used `Promise.race`, so one CDN that failed quickly rejected the whole import.
- **Scoped names parse correctly.** `"@scope/pkg@1.2.3/x.js"` now works in string form.
- **Origin arguments are honoured.** `MPort("a.cdn/", "b.cdn/")`, as the old README showed, now uses those origins. 1.x silently ignored them.
- **`useCache: "localhost"` works.** It compared a URL host to an origin path and never matched.
- **`mport/firefox` works.** It referenced undefined variables. It is now `@johnhenry/mport/firefox`.
- **Path-less imports prefer ESM.** They pick the entry from `exports` → `module` → `main`; 1.x used `main` only. This can change which file loads for packages whose `main` is CommonJS.
- **`MPortURL` returns a third element** (debug info). `[module, url]` destructuring is unaffected.
- **The npm package ships every file.** The 1.0.0 tarball was missing `config.mjs` and `race-which.mjs`.

The default race still mixes builds (raw jsDelivr/unpkg files against jspm's transformed output), because that is what 1.x did. For consistent builds, move to a router such as `createRouter({ "*": race(jsDelivr(), unpkg()) })`.

## Examples

[`examples/README.md`](examples/README.md) indexes them all. Eleven numbered Node examples prove one behaviour each, offline, against a fake network (`npm run examples`, or `npm run example:05` for one): range resolution, fallback, race, CommonJS skipping, lockfile pinning, the circuit breaker, `verified()`, `router.import()` failover, `build()`, the CLI, and the 1.x race.

Three browser pages share one header, one timeline and one way of explaining results:

```bash
npm run demo:html   # then open http://localhost:8712/examples/
```

| Page | What it's for |
|---|---|
| `examples/playground.html` | **Learn.** Ten one-click scenarios: everything up; routing by package name (to an import map and lockfile); a CDN outage (and why React can't fall back to raw CDNs); retrying at import time with `router.import()`; a race; the circuit breaker; lockfile pinning to a different mirror; choosing by capability; a tampered mirror rejected by `verified()`; and the 1.x API. Each explains what to notice, checks that it happened, shows its code, and gives every result a plain-English verdict. The controls underneath build any other router. |
| `examples/app.html` | **Use it.** A Preact + htm app wired two ways, resolved once into an injected import map, or loaded through `router.import()`, with esm.sh up, down, or answering but failing to import. Shows why an import map can't fall back at runtime and `router.import()` can. |
| `examples/compat.html` | **Check it.** The 1.x API run through both `@johnhenry/mport` and `@johnhenry/mport/firefox` against the real CDNs, as a pass/fail table, including a scan proving the Firefox entry never uses two-argument `import()`. |

The pages talk to the real CDNs and registries; outages, latency and tampering are simulated with `fetch`/`importer` wrappers. `npm run demo` / `npm run demo:firefox` run the 1.x calls under Deno and print the results.

## Adding a new provider

`jsDelivr({ esm: true })` is the best worked example in this package's history: a second provider on a CDN mport already supported, serving a different artifact. It is what `examples/app.html` falls back to when esm.sh fails to import, and the test `router.import() fails over across builds unless a lock or opts.build pins one` in `test/router.test.mjs` (and `examples/08-router-import-fails-over-at-runtime.mjs`) depends on it.

**Smallest: no library change at all.** A provider is data plus a `url()` function, so a CDN or an internal origin you need is `provider({ name, build, registries, capabilities, needsEntry, url })` or `custom("https://cdn.example/{name}@{version}/{entry}", { build: "npm" })` in your own code, and every strategy, the lockfile and the health registry treat it exactly like a built-in. Add a built-in only when it is a public CDN that many users would otherwise redefine.

**A genuinely new built-in: `jsDelivr({ esm: true })`.** Every built-in follows one small pattern:

1. **`src/providers.mjs`**: a factory that returns `provider({...})`, taking `origin` and `name` options like `unpkg()` does.
2. **`src/core.mjs`**: export it. `src/index.mjs` and `src/firefox.mjs` re-export core, so nothing else changes.
3. **`src/types.d.ts`** and **`src/core.d.ts`**: declare it. `test/exports.test.mjs` fails until both name it.
4. **The one part that isn't boilerplate: the provider's identity.** `build` decides which providers count as mirrors, so it must name the artifact, not the host: `/+esm` bundles are transformed, so they get build `"jsdelivr-esm"`, not jsDelivr's raw `"npm"`. Declaring `"npm"` would make a bundle a "mirror" of unpkg's raw files, and a lockfile pinned to raw files could fail over to it. `needsEntry: false` because jsDelivr resolves the entry itself, which also means no CommonJS check; `registries: ["npm"]` because `/+esm` has no GitHub form; and `base()` throws, because a bundle has no directory to map a prefix specifier to.

**Tests.** Add URL-shape and skip-behaviour cases to `test/router.test.mjs` against `fakeFetch` from `test/helpers.mjs`, not a live CDN: the suite asserts exact traces and timing-dependent race outcomes, which a real network would make flaky. Then list the provider in the tables in this README and in `docs/api.md`, and check it for real in `examples/playground.html`.

## Honest limitations

- **Raw file CDNs serve packages exactly as published.** A CommonJS entry can't be imported by a browser, and mport's detection of CommonJS is a heuristic over `package.json` (file extension, `type`, `module`, export conditions, naming conventions): a `.js` ES module with none of those signals is skipped, and a CommonJS file that looks like ESM is served. Raw ES modules also keep their own bare imports (`import "preact"`), which only resolve if the page's import map covers them; ESM-transforming CDNs (esm.sh, jsDelivr `+esm`) rewrite those. Permanent: it follows from what raw CDNs are.
- **Import maps have no runtime fallback.** The platform lets a specifier map to one URL and gives no hook to retry when that fetch fails, so a map built with `startup()` or the CLI is only as available as the mirror it chose. Failover after page load exists only for loads that go through `router.import()` / `createImporter()`, and switching builds at runtime only works when the new build's own imports resolve. Permanent until import maps grow a fallback mechanism.
- **A probe proves availability, not correctness.** `probe: "head"` learns that a URL answers, not that it is an ES module that will evaluate; `probe: "none"` checks nothing and records no health; `resolveVersions: false` hands the CDN a range it resolves on its own (so providers that need an entry file, the raw CDNs, skip a range and fall through). `verified()` checks bytes only against a hash you already have: without a pinned `integrity` it records whatever the first mirror served (trust on first use). By design: stronger checks cost a download per candidate.
- **The npm registry answers an unknown package with a 404 that carries no CORS header.** In a browser that surfaces as a network error, so "this package doesn't exist" and "the registry is unreachable" are the same `ResolutionError` (its message says so). Registry lookups also cost a request per package per page load; resolve at build time or ship a lockfile to avoid both. A property of registry.npmjs.org, not of mport.

## Family

mport is one of three browser-side libraries adopted into the `@johnhenry` family together. None depends on another.

- **[`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules)** -- declarative HTML modules: `<html-import src="./ui.html" as="ui">` turns an HTML file's `<html-export>`s into custom elements. A separate concern that composes with mport through the import map: html-modules resolves a bare `src` with `import.meta.resolve`, which applies the page's own `<script type="importmap">`, and does no package or CDN routing of its own (it was split out of the project whose routing half became this router). mport's `router.build()` and `startup()` produce that import map, so a prefix mapping such as `"ui-kit/"` from `router.build(["ui-kit@1/"])` makes `<html-import src="ui-kit/card.html">` load from whichever CDN mport chose. Route such a package to a raw-file provider (`jsDelivr()`, `unpkg()`), since the HTML must be served as published.
- **[`@johnhenry/window-algebra`](https://github.com/johnhenry/window-algebra)** -- a functional window manager for the browser (pure state updates, a layout algebra, CSS as the layout solver). No dependency in either direction; they meet at the import map. A no-build page using window-algebra needs an import-map entry for each of its entry points (and for anything loaded alongside, such as React for its `/react` binding), and mport can generate that map with fallback across mirrors instead of hand-written CDN URLs.

## License

MIT
