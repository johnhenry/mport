# mport

[![npm version](https://img.shields.io/npm/v/mport.svg)](https://www.npmjs.com/package/mport)
[![license](https://img.shields.io/npm/l/mport.svg)](https://opensource.org/licenses/MIT)

Route JavaScript imports across any number of CDNs.

You keep writing ordinary imports. mport decides which CDN, registry or origin serves each one. Choosing an exact version is deterministic, but which mirror delivers it can change. The result compiles down to a standard import map, so the browser never needs to know mport exists.

```js
import { createRouter, esmSh, jsDelivr, unpkg, jsr } from "mport";

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
import mport from "mport";
const { default: _ } = await mport("lodash-es@4.17.21/lodash.js");
```

## Contents

- [How it works](#how-it-works)
- [Install](#install)
- [Routes](#routes)
- [Providers](#providers)
- [Strategies](#strategies)
- [Import maps, lockfiles and the CLI](#import-maps-lockfiles-and-the-cli)
- [In the browser](#in-the-browser)
- [Debugging: traces and events](#debugging-traces-and-events)
- [Native import maps vs mport](#native-import-maps-vs-mport)
- [The v1 API](#the-v1-api)
- [Migrating from 1.x](#migrating-from-1x)

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

## Install

```bash
npm install mport
```

Or load it from a CDN:

```html
<script type="module">
  import { createRouter, esmSh, unpkg } from "https://cdn.jsdelivr.net/npm/mport@2/src/index.mjs";
</script>
```

## Routes

`createRouter(routes, options)` takes either an object or an array.

**Object form.** An exact key beats a glob, a longer glob beats a shorter one, and `"*"` is the catch-all:

```js
createRouter({
  "*": [esmSh(), jsDelivr(), unpkg()],
  "react*": esmSh(),
  "@std/*": jsr(),
  "@company/*": custom("https://modules.company.com/{bare}.js"),
});
```

**Array form.** The first match wins:

```js
import { route } from "mport";
createRouter([
  route("@std/*", jsr()),
  route("@johnhenry/*", github()),
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
| `lit/` (trailing slash) | a prefix mapping in the import map |
| `./x.js`, `/x.js`, `https://…` | not routed: `resolve()` returns `null` |

Patterns match the specifier without its version, e.g. `npm:react/jsx-runtime`. Two rules affect which route and registry apply:
- An explicit specifier such as `npm:react` also matches bare routes (`react*`).
- A bare scoped name such as `@std/path` that reaches a JSR-only provider is treated as a JSR package.

## Providers

| Provider | Build | Registries | Notes |
|---|---|---|---|
| `esmSh()` | `esm.sh` | npm, jsr, github | transforms to browser ESM |
| `jsDelivr()` | `npm` | npm, github | raw files; the entry comes from `exports` → `module` → `main` |
| `jsDelivr({ esm: true })` | `jsdelivr-esm` | npm | jsDelivr's `/+esm` bundles |
| `unpkg()` | `npm` | npm | raw files |
| `jspm()` | `jspm` | npm | `ga.jspm.io` builds |
| `jsr()` | `esm.sh` | jsr | through esm.sh. `jsr({ via: "jsr.io" })` loads raw files from jsr.io and needs a path |
| `github()` | `npm` | github | through jsDelivr's `/gh/`. `{ via: "esm.sh" }` also works |
| `local({ base })` | `npm` | npm | your own copy, e.g. a vendored `node_modules` |
| `custom(template)` | origin host | npm | `"https://x/"` or a template using `{name}` `{version}` `{path}` `{entry}` `{scope}` `{bare}` |
| `provider({...})` | yours | yours | write your own: `{ name, build, registries, capabilities, url(artifact) }` |

The CDN providers (`esmSh`, `jsDelivr`, `unpkg`, `jspm`, `jsr`) accept `origin`, so you can point them at a self-hosted mirror.

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
| | `cache({ store })` | Reuses remembered resolutions without probing. `store` is a `Map` (the default) or `localStorage` |

### Probing

How the router checks that a candidate URL is available:

| `probe` | Behaviour |
|---|---|
| `"head"` (default) | `HEAD` request, falling back to `GET` on 405/501. Works in Node, so it suits build time |
| `"import"` | Actually `import()`s the URL and returns the module. Browser or Deno |
| `"none"` | Trust the first candidate. Static routing |
| function | `(url, { provider, signal }) => Promise<{ module? }>` |

## Import maps, lockfiles and the CLI

```js
const { importMap, lock } = await router.build(
  ["react@^19", "lit/", "npm:lodash-es@4"],
  { scopes: { "https://legacy.example.com/": { react: "react@18" } } },
);
```

`importMap` contains `imports`, `scopes` and, when `verified()` ran, an `integrity` map. `lock` looks like this:

```json
{
  "lockfileVersion": 1,
  "packages": {
    "npm:react@^19": {
      "specifier": "react@^19", "registry": "npm", "name": "react", "range": "^19",
      "version": "19.2.0", "build": "esm.sh", "provider": "esm.sh",
      "url": "https://esm.sh/react@19.2.0"
    }
  }
}
```

Pass the lockfile back in with `createRouter(routes, { lock })` and the same versions come back without asking the registry again. The same entry files and builds come back too. Passing `{ relock: true }` to `resolve` ignores the lock.

### CLI

```bash
npx mport build react@^19 lit/   # writes importmap.json and mport.lock.json
npx mport resolve react@^19 --trace
```

By default the CLI reads `mport.config.mjs`. Its default export is either a router or `{ routes, specifiers, scopes, options }`:

```js
// mport.config.mjs
import { esmSh, jsDelivr, unpkg, jsr } from "mport";
export default {
  routes: { "*": [esmSh(), jsDelivr(), unpkg()], "@std/*": jsr() },
  specifiers: ["react@^19", "@std/path@^1"],
};
```

Flags: `--config`, `--out importmap.json`, `--lock mport.lock.json`, `--relock`, `--trace`.

## In the browser

```js
import { createRouter, startup, createImporter, esmSh, jsDelivr } from "mport";
const router = createRouter({ "*": [esmSh(), jsDelivr()] });

// A: resolve at startup, then use plain imports
await startup(router, ["react@^19", "react-dom@^19/"]);
const React = await import("react");

// B: import through the router every time, failing over to other mirrors
const load = createImporter(router);
const { default: dayjs } = await load("dayjs@1");
```

With `startup()`, the import map has to be in the page before the first module that uses it resolves. Put the startup code in its own `<script type="module">` before the rest of your modules, or generate the map at build time with the CLI.

## Debugging: traces and events

Every resolution carries a trace of what was tried:

```js
const r = await router.resolve("react@^19");
r.trace;
// [ { type: "probe", provider: "esm.sh",   url: "https://esm.sh/react@19.2.0" },
//   { type: "fail",  provider: "esm.sh",   ms: 212, error: "… responded 503" },
//   { type: "skip",  provider: "jspm",     reason: 'serves build "jspm", locked to "npm"' },
//   { type: "probe", provider: "jsdelivr", url: "…" },
//   { type: "ok",    provider: "jsdelivr", ms: 41 } ]
```

Event types are `probe`, `ok`, `fail`, `skip` (with a `reason`) and `aborted` (a race loser). Failed resolutions attach the same list as `error.trace`.

To stream events, pass `onEvent` to `createRouter` or to a single `resolve`/`import` call. `router.import()` also reports `{ type: "fail", phase: "import" }` when a resolved URL fails to load and it moves to another mirror.

`router.health.snapshot()` returns per-provider counts, latency and circuit state.

In the v1 API, `MPortURL` returns this as a third tuple element, so existing destructuring keeps working:

```js
const [module, url, info] = await MPortURL()("lodash-es@4.17.21/lodash.js");
info.provider; // "ga.jspm.io/npm:"
info.trace;    // every probe in the race
```

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
- `mport/firefox`

Specifiers are `"name@version[/path]"` or `{ name, version, path }`. With no path, mport reads the package's `package.json` and imports its ESM entry.

`mport/firefox` exists because older Firefox versions reject any two-argument `import()` at parse time. That entry point never uses the syntax. It reads `package.json` with `fetch`, so path-less specifiers work there too, and it ignores per-call import options.

## Migrating from 1.x

Nothing you call has been removed. Behaviour changes, all of them bug fixes:

- **The race waits for the first success.** 1.x used `Promise.race`, so one CDN that failed quickly rejected the whole import.
- **Scoped names parse correctly.** `"@scope/pkg@1.2.3/x.js"` now works in string form.
- **Origin arguments are honoured.** `MPort("a.cdn/", "b.cdn/")`, as the old README showed, now uses those origins. 1.x silently ignored them.
- **`useCache: "localhost"` works.** It compared a URL host to an origin path and never matched.
- **`mport/firefox` works.** It referenced undefined variables.
- **Path-less imports prefer ESM.** They pick the entry from `exports` → `module` → `main`; 1.x used `main` only. This can change which file loads for packages whose `main` is CommonJS.
- **`MPortURL` returns a third element** (debug info). `[module, url]` destructuring is unaffected.
- **The npm package ships every file.** The 1.0.0 tarball was missing `config.mjs` and `race-which.mjs`.

The default race still mixes builds (raw jsDelivr/unpkg files against jspm's transformed output), because that is what 1.x did. For consistent builds, move to a router such as `createRouter({ "*": race(jsDelivr(), unpkg()) })`.

## Demos

```bash
npm run demo:html   # then open http://localhost:8712/examples/router.html
```

`examples/router.html` runs against the real CDNs and shows the trace for a race, a fallback with a dead mirror, namespace routing that compiles to an import map, and runtime failover. `examples/demo.html` is the 1.x demo.

## License

MIT
