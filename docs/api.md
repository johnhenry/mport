# @johnhenry/mport API reference

Every export of every entry point, with signatures, options, defaults, return shapes,
errors and trace events. Defaults and behaviour here are checked against `src/` and the
tests; where the code does something surprising, this document says so rather than
describing what it was meant to do. Types live in [`src/types.d.ts`](../src/types.d.ts)
(and [`src/core.d.ts`](../src/core.d.ts) for `./core`). The [README](../README.md) is the
tutorial; this is the reference.

## Contents

- [Entry points](#entry-points)
- [Concepts](#concepts)
- [Specifiers](#specifiers)
- [createRouter()](#createrouter)
  - [Routes and matching](#routes-and-matching)
  - [Router options](#router-options)
  - [router.resolve()](#routerresolve)
  - [router.import()](#routerimport)
  - [router.build()](#routerbuild)
  - [router.health, router.lock, router.name](#routerhealth-routerlock-routername)
- [Resolution: versions and entry files](#resolution-versions-and-entry-files)
- [Providers](#providers)
- [Strategies](#strategies)
- [Probing](#probing)
- [Health and the circuit breaker](#health-and-the-circuit-breaker)
- [Trace events](#trace-events)
- [Errors](#errors)
- [Lockfiles](#lockfiles)
- [Import maps](#import-maps)
- [Registry helpers and CommonJS detection](#registry-helpers-and-commonjs-detection) (incl. `outdated()` and `installedRegistry()`)
- [Browser runtime helpers](#browser-runtime-helpers)
- [semver](#semver)
- [Bundler plugins](#bundler-plugins)
- [The CLI](#the-cli)
- [The v1 API](#the-v1-api)
- [Constants](#constants)

## Entry points

| Import | File | Exports |
|---|---|---|
| `@johnhenry/mport` | `src/index.mjs` | everything in `./core`, plus the v1 functions `mport` (also the default export), `MPort`, `MPortURL` |
| `@johnhenry/mport/firefox` | `src/firefox.mjs` | the same names as `@johnhenry/mport`. No file it loads contains a two-argument `import()`, which older Firefox rejects at parse time. See [Firefox](#the-firefox-entry-point). |
| `@johnhenry/mport/core` | `src/core.mjs` | the router, providers, strategies, registry, import-map, lockfile, runtime and semver exports, without the v1 functions |
| `@johnhenry/mport/vite` | `src/vite.mjs` | [`mportVite`](#bundler-plugins) (also the default export). Node-side build tooling. |
| `@johnhenry/mport/rollup` | `src/rollup.mjs` | [`mportRollup`](#bundler-plugins) (also the default export). Node-side build tooling. |
| `@johnhenry/mport/node` | `src/node.mjs` | [`installedRegistry`](#installedregistry): a registry client that reads installed packages from disk. Node only; it is the one entry point that imports `node:` modules, which is why it is not in `./core`. |
| `mport` (bin) | `bin/mport.mjs` | the [CLI](#the-cli) |

The module entry points are ES modules with no dependencies. The package is plain
JavaScript that runs in browsers, Deno and Node; the router's defaults (`fetch`,
`import()`) are the host's.

The `./core` exports, grouped:

| Group | Exports |
|---|---|
| Router | [`createRouter`](#createrouter), [`route`](#route) |
| Specifiers | [`parseSpecifier`](#parsespecifier), [`keyOf`](#keyof), [`isRoutable`](#isroutable) |
| Providers | [`provider`](#provider), [`esmSh`](#built-in-providers), [`jsDelivr`](#built-in-providers), [`unpkg`](#built-in-providers), [`jspm`](#built-in-providers), [`jsr`](#built-in-providers), [`github`](#built-in-providers), [`local`](#built-in-providers), [`custom`](#custom), [`origin`](#origin), [`DEFAULT_ORIGINS`](#constants) |
| Strategies | [`fallback`](#fallback), [`race`](#race), [`adaptive`](#adaptive), [`weighted`](#weighted), [`prefer`](#prefer), [`verified`](#verified), [`cache`](#cache), [`sri`](#sri) |
| Health and errors | [`HealthRegistry`](#healthregistry), [`RoutingError`](#errors), [`SkipError`](#errors), [`IntegrityError`](#errors), [`ResolutionError`](#errors) |
| Registry | [`createRegistry`](#createregistry), [`pickVersion`](#pickversion), [`outdated`](#outdated), [`entryInfo`](#entryinfo), [`entryOf`](#entryof), [`resolveExports`](#resolveexports) |
| Import maps | [`compileImportMap`](#compileimportmap), [`mergeImportMaps`](#mergeimportmaps), [`renderImportMap`](#renderimportmap), [`importMapText`](#importmaphash-importmaptext-csphash-renderimportmapcsp), [`importMapHash`](#importmaphash-importmaptext-csphash-renderimportmapcsp), [`cspHash`](#importmaphash-importmaptext-csphash-renderimportmapcsp), [`renderImportMapCsp`](#importmaphash-importmaptext-csphash-renderimportmapcsp), [`modulePreloads`](#modulepreloads), [`renderModulePreload`](#rendermodulepreload) |
| Lockfiles | [`createLock`](#createlock), [`lockKey`](#lockkey), [`parseImports`](#parseimports) |
| Browser runtime | [`injectImportMap`](#injectimportmap), [`injectModulePreload`](#injectmodulepreload), [`startup`](#startup), [`createImporter`](#createimporter) |
| Misc | [`semver`](#semver), [`DEFAULT_CACHE_KEY`](#constants) |

## Concepts

mport splits every import into two halves.

**Resolution is deterministic.** The router parses the specifier, matches it to a route,
turns a range into one exact version (from the npm or JSR registry, or from the
lockfile) and, for providers that serve raw files, looks up the entry file. None of this
depends on which CDN is up.

**Transport is adaptive.** The route's node (a provider or a strategy that combines
providers) chooses which provider serves that exact artifact: in order, by racing, by
weight and health, by target, from a cache, with integrity checks.

Every provider declares a **build**: what it actually serves. jsDelivr and unpkg both
serve the files as published to npm (build `"npm"`); esm.sh and jspm transform packages,
so their output is a different artifact even for the same version. Only providers with
the same build are mirrors of each other. A lockfile pins the build as well as the
version, so failover moves between mirrors and never silently switches to a different
build.

The router's output is a **Resolution** (one specifier) or an **import map** plus a
**lockfile** (many specifiers). The browser never needs mport at runtime unless you want
failover after the page has loaded, which only [`router.import()`](#routerimport) gives.

## Specifiers

| Specifier | Parsed as |
|---|---|
| `react` | npm package `react`, no range, no path |
| `react@^19` | npm `react`, range `^19` |
| `react@19.2.0/jsx-runtime` | npm `react`, range `19.2.0`, path `jsx-runtime` |
| `@scope/pkg@1.2.3/dist/x.js` | npm `@scope/pkg`, range `1.2.3`, path `dist/x.js` |
| `npm:lodash-es@4` | npm, **explicit** (the prefix is kept in keys) |
| `jsr:@std/path@^1` | JSR `@std/path`, range `^1`. JSR names must be scoped. |
| `github:user/repo@ref/path`, `gh:user/repo@ref/path` | GitHub repository `user/repo`, ref `ref` (both prefixes parse to registry `github`) |
| `lit/` | a **prefix** specifier (trailing slash): compiles to a prefix mapping in the import map |
| `{ name, version?, path?, registry? }` | object form; `registry` defaults to `"npm"`, leading slashes are stripped from `path`, never explicit, never a prefix |
| `./x.js`, `../x.js`, `/x.js`, `https://…`, `data:…`, `blob:…` | not routable: `parseSpecifier` returns `null` and `resolve()` returns `null` |
| `node:fs`, `partial:card`, any other `scheme:` | not a package: `null` |
| `@scope`, `@scope/` | a bare scope (an alias, not a package): `null` |

The version lives on the last name segment (`@scope/pkg@1.2`, `pkg@1.2`); `pkg@` means no
range.

### parseSpecifier()

```ts
parseSpecifier(input: string | SpecifierObject): ParsedSpecifier | null
```

Returns `{ raw, registry, explicit, name, range?, path, prefix }`:

| Field | Type | Meaning |
|---|---|---|
| `raw` | `string \| object` | the input |
| `registry` | `"npm" \| "jsr" \| "github"` | from the prefix, else `"npm"` (object form: `registry` or `"npm"`) |
| `explicit` | `boolean` | the string had an `npm:`, `jsr:`, `github:` or `gh:` prefix |
| `name` | `string` | `react`, `@scope/pkg`, or `user/repo` |
| `range` | `string \| undefined` | version, range, dist-tag or git ref, as written |
| `path` | `string` | sub-path without a leading slash, `""` when none |
| `prefix` | `boolean` | trailing slash |

Throws `TypeError` for: an empty string or a non-string, non-object input; an object
without `name`; `jsr:` with an unscoped name (`jsr:path`); an explicit prefix without a
complete two-part name (`github:user`, `npm:@scope`).

### keyOf()

```ts
keyOf(parsed: ParsedSpecifier): string
```

The import-map key a parsed specifier compiles to: the registry prefix only if the
specifier was explicit (`gh:` is spelled `github:`), the name, the path, and a trailing
`/` for prefixes. The version is dropped: `npm:react@19/jsx-runtime` → `npm:react/jsx-runtime`,
`lodash-es@4/` → `lodash-es/`, `@scope/pkg@1` → `@scope/pkg`.

### isRoutable()

```ts
isRoutable(specifier: string | object): boolean
```

`false` for relative (`./`, `../`), absolute-path (`/`), URL (`scheme://`), `data:` and
`blob:` specifiers; `true` for objects and everything else. It does not reject other
schemes; `parseSpecifier` does that.

## createRouter()

```ts
createRouter(routes: Routes, options?: RouterOptions): Router
```

Returns `{ name, health, lock, resolve, import, build }`.

### Routes and matching

`routes` is an object or an array.

**Object form**: `{ [pattern]: route }`. Patterns are ranked, not taken in order:

| Pattern | Matches | Rank |
|---|---|---|
| `"react"` (no `*`) | exactly that match text | highest |
| `"@std/*"`, `"react*"` (trailing `*`) | any match text starting with the part before `*` | longer prefix beats shorter |
| `"*"` | everything | lowest |

Ties keep insertion order. Only a trailing `*` is a wildcard. Note that `"react*"`
matches `react-dom` and `reactive` too; use `"react"` and `"react/*"` to mean only React.

**Array form**: `[{ match, use }]`, usually built with [`route()`](#route). The first
entry whose `match` accepts wins; nothing is ranked. `match` is a pattern string as above,
a `RegExp` (tested with `.test()`), or a function `(matchText) => boolean`.

**Match text** is the specifier without its version: `react/jsx-runtime`,
`@scope/pkg/dist/x.js`, and for explicit specifiers `npm:react/jsx-runtime`,
`jsr:@std/path`, `github:user/repo/x.js`. An explicit specifier is tested with and without
its prefix, so `npm:react` also matches a `"react*"` route; the highest-ranked route that
accepts either form wins, so with `{ "npm:*": a, "react": b }` the specifier `npm:react`
goes to `b`. `gh:` specifiers match as
`github:`, so a route pattern `"gh:*"` never matches anything; write `"github:*"`.

**Route values:**

| Value | Means |
|---|---|
| a provider or strategy node | itself |
| an array | `fallback(...)` of its elements (nested arrays become nested fallbacks) |
| a string | `custom(string)`, a [custom origin](#custom) |

The string and array shorthands work only at the top level of a route value (and inside
its arrays). Inside `fallback()`, `race()` and the other strategies, a string throws
`TypeError: wrap URL strings with custom() inside strategies`.

**A directory specifier is matched as written too.** `components/` (a prefix mapping) has the match
text `components`, and is also tested as `components/`, so a `"components/*"` route captures it;
an exact `"components"` route still does. (Before, `components/` skipped a `"components/*"` route
and was looked up on the registry.)

#### Recipe: an app-owned prefix, no registry

Your own modules can be routed like packages, so one import map covers your code and your
dependencies, and a lockfile or `verified()` strategy can treat them uniformly:

```js
const router = createRouter({
  "components/*": custom("/components/{path}", { name: "app", build: "app" }),
  "*": [esmSh(), jsDelivr()],
});
await router.build(["components/button.js", "components/", "react@^19"]);
// "components/button.js" → "/components/button.js", "components/" → "/components/", react → esm.sh
```

Why it needs no registry: a [`custom()`](#custom) template needs a version lookup only if it contains
`{version}`, and an entry lookup only if it contains `{entry}`; `{path}` alone is just the part of the
specifier after the package name (`components/forms/input.js` → `forms/input.js`), so the router never asks npm about a
package called `components`. Choices that matter:

- **Give it an explicit `name` and `build`.** Without them both default to the template's host, and a
  path-only template has none (the template string itself becomes the name). `name` is the identity in traces,
  health and `exclude`; `build: "app"` is what the lockfile pins, so a lock-pinned `components/…` can only be
  served by another provider of build `"app"` (say a `custom("https://static.example.com/components/{path}", { build: "app" })` mirror), never by a CDN
  that happens to have a package of that name.
- **A directory specifier (`components/`) gives a prefix mapping** (`"components/": "/components/"`), so any
  `import "components/x.js"` resolves without listing each file. Listing files gives you `modulepreload` and
  `integrity` candidates; the prefix does not.
- **Route on the first path segment.** The route pattern is matched against the specifier without a version, so
  `"components/*"` (or `/^components(\/|$)/` in the array form) captures it. A package of the same name on
  npm is shadowed by the route, which is the point.
- The lockfile records `{ provider: "app", build: "app", url }` and **no `version`**; there is nothing to pin.
  Files are not hashed (`graph` skips origin-relative URLs).

#### route()

```ts
route(match: string | RegExp | ((matchText: string) => boolean), use: Route): { match, use }
```

Builds one array-form entry.

### Router options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `probe` | `"head" \| "import" \| "none" \| function` | `"head"` | How a candidate URL is checked. See [Probing](#probing). |
| `lock` | `Lockfile` | none | A lockfile whose entries pin version, entry, build and integrity. See [Lockfiles](#lockfiles). |
| `resolveVersions` | `boolean` | `true` | Resolve ranges to exact versions through the registries. With `false`, providers get the range (or nothing) as written, e.g. `https://esm.sh/react@^19?target=es2022`; exact versions and lockfile pins still apply. Providers that need an entry file (`needsEntry`: jsDelivr raw, unpkg, jspm, `local()`) can't look one up for a range, so they **skip** with a reason (`needs an exact version to find its entry file…`) and the route falls through to e.g. esm.sh; an exact version or a lockfile pin still gets an entry. |
| `circuitBreaker` | `{ failures?, reset? }` | `{ failures: 3, reset: 30000 }` | Options for this router's own [`HealthRegistry`](#healthregistry). Ignored when `health` is given. |
| `health` | `HealthRegistry` | a new one | Share health and open circuits with another router (`health: other.health`). |
| `target` | `string` | `"browser"` | Default target for [`prefer()`](#prefer). |
| `capabilities` | `string[]` | none | Capabilities every provider must have; a provider missing one is skipped (`lacks …`). |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Used for probes, registry lookups (unless `registry` is given) and `verified()`. Tests and the examples pass a fake. |
| `importer` | `(url) => Promise<module>` | `(url) => import(url)` | Used by `probe: "import"` and by `router.import()`. |
| `registries` | `{ npm?, jsr?, fetch? }` | `https://registry.npmjs.org`, `https://jsr.io` | Registry base URLs, passed to `createRegistry({ fetch, ...registries })`. |
| `registry` | `RegistryClient` | `createRegistry(...)` | A registry client to use instead (see [createRegistry()](#createregistry)). |
| `onEvent` | `(event) => void` | none | Called with every [trace event](#trace-events) as it happens, plus `router.import()`'s import failures. Exceptions it throws are swallowed. |
| `now` | `() => number` | `Date.now` | Clock for health, circuit timing and event timestamps. |
| `allowCommonJS` | `boolean` | `false` | Let raw file CDNs serve packages whose entry looks like CommonJS. See [CommonJS detection](#commonjs-detection). |
| `name` | `string` | `"mport"` | Exposed as `router.name`; not used otherwise. |

### router.resolve()

```ts
router.resolve(specifier: string | SpecifierObject, options?: ResolveOptions): Promise<Resolution | null>
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `signal` | `AbortSignal` | none | A pre-aborted signal rejects immediately with `signal.reason`; aborting later rejects promptly with it, even while a shared registry lookup or an uncancellable import probe is still running. `race()` aborts its in-flight probes. |
| `exclude` | `Iterable<string>` | none | Provider names to skip (`skip`, reason `excluded`). |
| `build` | `string` | the lockfile entry's build | Only providers with this build may serve. |
| `integrity` | `string` | the lockfile entry's integrity | Expected SRI hash for [`verified()`](#verified). |
| `target` | `string` | the router's `target` | Target for `prefer()`. |
| `capabilities` | `string[]` | the router's `capabilities` | Replaces the router's list for this call. |
| `relock` | `boolean` | `false` | Ignore the lockfile for this call. |
| `onEvent` | `(event) => void` | the router's `onEvent` | Replaces (does not add to) the router's handler for this call. |

Steps: parse the specifier (`null` if unroutable); find the route (`null` if none
matches); look up the lockfile entry by [`lockKey`](#lockkey); run the route's node, which
resolves the version and entry lazily for the providers that need them; build the
Resolution; store it in every [`cache()`](#cache) node anywhere in the router's route
table; record it in `router.lock`.

**Returns** `null` for unroutable or unmatched specifiers, otherwise a **Resolution**:

| Field | Type | Meaning |
|---|---|---|
| `specifier` | `string` | the specifier as given; for object specifiers, `keyOf()` of it |
| `key` | `string` | the import-map key ([`keyOf`](#keyof)) |
| `registry` | `"npm" \| "jsr" \| "github"` | the registry that actually served it (a bare `@std/path` routed to JSR says `"jsr"`) |
| `name` | `string` | package name |
| `range` | `string?` | the range as written |
| `version` | `string?` | the exact version (or the range when versions weren't resolved) |
| `path` | `string` | the sub-path, `""` when none |
| `entry` | `string?` | the entry file, for providers that needed one |
| `build` | `string` | the serving provider's build |
| `provider` | `string` | the serving provider's name |
| `url` | `string` | the URL to import |
| `base` | `string?` | for prefix specifiers only: the directory URL mapped by the import map |
| `integrity` | `string?` | SRI hash from `verified()` or from the lockfile |
| `module` | `unknown?` | the imported module, when `probe` is `"import"` |
| `cached` | `boolean` | served from a `cache()` node without probing |
| `trace` | `TraceEvent[]` | every attempt; see [Trace events](#trace-events) |

`trace` is the live array the strategies write into. After a `race()`, events from the
losing probes can still be appended for a moment after `resolve()` returns.

**Rejects** with the first applicable of: `signal.reason` (aborted); `ResolutionError`
(the package or version can't exist, or the registry is unreachable); `RoutingError`
(a fallback or race ran out of providers); `SkipError` or `IntegrityError` when the
route is a single provider or `verified()` node that declined; a plain `Error` from a
provider that can't build the URL (`jsr({ via: "jsr.io" })` without a path). Whatever it rejects with gets a `trace`
property. See [Errors](#errors).

### router.import()

```ts
router.import<T>(specifier: string | SpecifierObject, options?: ResolveOptions): Promise<T>
```

Resolves, then imports, with failover when the **import** fails (a URL that passed the
probe but whose module failed to load or evaluate). Rules:

1. `resolve(specifier, { ...options, exclude })`. If it returns `null`, the specifier is
   imported as it is with the router's `importer` (so relative imports still work).
2. If the Resolution has a `module` (`probe: "import"`), return it without importing again.
3. Otherwise import `url`. On success, return the module.
4. On failure: record a health failure against the provider, add it to `exclude`, emit
   `{ type: "fail", phase: "import", provider, url, error, at }` to `onEvent` (it is not
   in any Resolution's trace), and go back to 1.
5. When `resolve()` finally rejects (every provider excluded, skipped or failed): if any
   import failed, reject with `RoutingError("mport: could not import <specifier>")` whose
   `errors` are the import errors followed by the final rejection; otherwise rethrow the
   rejection as is.

**Build switching.** Failover may move to a different build (esm.sh → jsDelivr's `+esm`)
unless something pins one: a lockfile entry for the specifier, or `options.build`. With a
pin, only same-build mirrors are tried, and when they are exhausted the call rejects. Raw
file builds (`"npm"`) contain bare imports of their own dependencies, so switching to one
at runtime only works when the page's import map already covers those.

### router.build()

```ts
router.build(specifiers: string[], options?: { scopes?, signal?, conflicts?, graph?, html?, dependencies?, dependencyDepth? }): Promise<{ importMap: ImportMap, lock: Lockfile, conflicts: ConflictReport[], dependencies?: DependencyReport, graph?: GraphReport, html?: GraphReport }>
```

Resolves every specifier concurrently and compiles an [import map](#import-maps).
`scopes` is `{ [scopeURL]: { [importMapKey]: specifier } }`; each scoped specifier is
resolved and placed under its scope with the key you gave. A specifier that resolves to
`null` (unroutable or unmatched) rejects the whole build with
`ResolutionError("mport: no route for …")`; nothing is silently dropped. Any other
rejection from `resolve()` rejects the build.

`conflicts` is `"error"` (the default) or `"scope"`; see [Conflicting versions](#conflicting-versions-conflicts-scope).
Any other value is a `TypeError`. The result's `conflicts` array holds one
[`ConflictReport`](#conflicting-versions-conflicts-scope) per conflicting key that `"scope"` handled
(always empty with `"error"`).

`graph` (default off) is `true` or [`GraphOptions`](#whole-graph-integrity-graph); the result then
has a `graph` report.

`html` (default off) is an array of HTML module URLs or `{ roots, scan?, …GraphOptions }`; see
[HTML module graphs](#html-module-graphs-an-integrity-manifest-for-html-modules). The result then has an `html`
report (same shape as `graph`), and the hashes join the import map's `integrity` and the lockfile's `files`.
`specifiers` may be empty when `html` is given.

`dependencies` (default `false`) is `true` or `"prod"` and `dependencyDepth` (default `5`) a
non-negative integer; see [Including dependencies](#including-dependencies-dependencies). Any other
value is a `TypeError`. The result then has a `dependencies` report.

`lock` is `router.lock.toJSON()`: every resolution this router has made itself so far,
including earlier `resolve()` and `import()` calls, not only this build's specifiers. It
starts **empty**: entries of the `lock` option are read-only pins, never copied across, so
specifiers you no longer build are pruned from the written lockfile. Use a fresh router
per build if the lockfile should contain exactly one build's inputs.

#### Including dependencies (`dependencies`)

A raw file CDN (jsDelivr, unpkg) or `local()` serves a package's files exactly as published. A
file that says `import("dompurify")` or `import "preact"` keeps that bare specifier, which the
browser resolves through **your** import map, and the map holds only what you asked `build()` for.
You can list every dependency by hand, or let the build read each resolved package's manifest:

```js
const { importMap, dependencies } = await router.build(["safe-fragment@1"], { dependencies: true });
// importMap.imports: { "safe-fragment": ".../safe-fragment@1.0.0/index.js", "dompurify": ".../dompurify@3.2.0/purify.es.mjs" }
```

| Option | Meaning |
|---|---|
| `dependencies: true` or `"prod"` | the two are the same: add the package's manifest **`dependencies`**. Dev, peer and optional dependencies are not added (a peer is the app's choice; list it yourself). Default `false`. |
| `dependencyDepth` | levels to follow, the specifiers you list being level 0 (default `5`; `0` adds nothing and reports every direct dependency as truncated). Dependencies of dependencies are followed, each `name@version`'s manifest is read once, and cycles end. |

How each dependency is handled:

- **It is routed like any specifier**, `<name>@<range>` through the router's own routes (so a
  dependency can land on a different provider than its dependent), resolved to an exact version by the
  usual rules and **locked** in `result.lock` as `<name>@<range>`. A lockfile therefore reproduces the
  expanded build. The import-map key is the package name; a sub-path an entry imports
  (`dompurify/purify.js`) is not added, list it as a specifier.
- **Ranges are respected.** A dependency already in the build (listed, or added earlier) whose
  resolved version satisfies the dependent's range is left alone. If it does not satisfy it, the
  dependency is resolved at the dependent's range too and meets the existing
  [`conflicts`](#conflicting-versions-conflicts-scope) handling: the default `"error"` throws
  (`conflicting resolutions for "dompurify"…`), `"scope"` keeps the first and gives the dependent a scope with its own version.
  The expansion runs before `conflicts` and `graph`, so scopes cover added packages and `graph` hashes their files.
- **Only packages on raw-file providers are expanded**: those with the `raw` capability
  (`jsDelivr()`, `unpkg()`, `local()`, and a `custom()` / `provider()` you declare `capabilities: ["raw"]`
  for) from the npm registry. **esm.sh and `jsDelivr({ esm: true })` rewrite a module's imports
  themselves** (the bare `"dompurify"` in the source becomes a URL to the dependency, which they
  serve). Adding the same packages to the map would only duplicate them, at the risk of a different
  version than the one the CDN wired in. jspm is also a transforming provider (build `jspm`, no `raw`
  capability), so it is treated the same way. They are reported in `skipped` as `rewrites its own imports`
  and no manifest is fetched.
  GitHub and JSR packages have no npm manifest and are not expanded.
- **A dependency that cannot be added is reported, not thrown**: a range that is not a registry
  range (`github:…`, `file:…`, `workspace:…`, `npm:` aliases), no matching route, or a
  resolution error (not published, CommonJS-only on a raw CDN) goes to `skipped` with its reason, and
  everything else is still added. Aborting (`signal`) does throw.

`result.dependencies`:

```ts
{
  added: [{ specifier, key, version, url, provider, from, range, depth }],   // from: "<name>@<version>" of the dependent
  skipped: [{ from, provider?, name?, range?, reason }],                      // name + range: a dependency; else a package not expanded
  truncated: [{ name, range, from, depth, limit }],                           // beyond dependencyDepth
  maxDepth,
}
```

Each addition is also an `onEvent` event, `{ type: "dependency", phase: "dependencies", provider: "build", reason }`
(`truncated` and `fail` likewise). From the CLI: `mport build --dependencies [--dependency-depth N]`, or
`dependencies` / `dependencyDepth` in the config; it prints each added dependency and a warning for
each skipped or truncated one. `registry.manifest()` is required: the default client and
[`installedRegistry()`](#installedregistry) have it. `mport update` also honours `config.dependencies`.

Limits: manifests describe what a package *declares*; a module that imports something it does
not declare is not helped, and a package that imports a Node built-in or a CommonJS dependency is not made browser-ready by
this (the dependency lands in `skipped`). Nested `node_modules` layouts are not modelled with `local()` + `installedRegistry()`: one version per name, from `root`.

#### Conflicting versions (`conflicts: "scope"`)

An import map maps one key to one URL per scope. If `react@18.3.1` and `react@19.2.0` are
both requested, the unscoped `imports.react` can hold only one, and the other is reachable
only from a **scope**. By default `build()` throws (`ResolutionError`, *conflicting
resolutions for "react"*). With `conflicts: "scope"` it instead:

1. keeps the **first listed** specifier in `imports` (put your app's own version first);
2. for every other package in the build, reads its registry manifest (`dependencies`,
   `peerDependencies`, `optionalDependencies`; one `GET <npm>/<name>/<version>` per
   package, memoized) and looks at the range it declares for the conflicting package;
3. gives each such dependent the first of the conflicting versions that satisfies its
   range, *if that is not the unscoped one*, as an entry in `scopes[<dependent's package
   directory>]`. The directory is the dependent provider's `base()` for that exact
   version (`https://cdn.jsdelivr.net/npm/lib-a@1.0.0/`, `https://ga.jspm.io/npm:lib-a@1.0.0/`,
   `https://esm.sh/lib-a@1.0.0/`).

The scope key is a **URL prefix of the importing module**, which is how import maps work:
for every module whose URL starts with it, the scoped mapping beats the top-level one.
Each scoped URL's `integrity` is carried into the map like any other. Each conflicting key
yields a report, also traced as `{ type: "conflict", provider: "build", reason }` through
`onEvent`:

```ts
interface ConflictReport {
  key: string;
  kept: { specifier: string; url: string };      // owns the unscoped imports entry
  scoped: Array<{ specifier; url; scope; dependent: "name@version"; range }>;
  unscoped: Array<{ specifier; url }>;            // versions no package in the build depends on
}
```

Why this design rather than a `{ scope }` per specifier: the information that decides which
dependent needs which version is the dependency graph, and the registry already records it.
Explicit scopes remain available (`build(specifiers, { scopes })`) and combine with
`conflicts: "scope"`. They are also the only way to scope something the manifests don't
tell you about.

**Limits, stated plainly:**

- Dependents are the **npm packages named in this build**, not their transitive
  dependencies. If `lib-a` imports `lib-a-utils` which imports `react@18`, list
  `lib-a-utils` in the build too (or add an explicit scope); otherwise `lib-a-utils` sees
  the unscoped version.
- Scopes only change what a **bare specifier** inside a file resolves to. Builds that
  rewrite their dependency imports to absolute URLs (esm.sh, jsDelivr `+esm`) never use
  the key, so for them the scope is generated but has no effect; the version a module
  gets is already fixed inside it. Scopes matter for jspm, raw CDNs (jsDelivr, unpkg)
  and `local()`, whose files keep bare imports.
- A key conflicting between two **explicit** scoped lists, or two different URLs inside one
  scope, is still an error.
- `npm` dependents only; JSR and GitHub packages have no manifest the router reads.
- A conflicting version nobody depends on (or whose dependents' ranges it doesn't satisfy)
  ends up in no scope: it is listed under `unscoped` and the map still has no way to reach
  it. The page's own modules can only ever see the unscoped version.
- A dependent whose range both the unscoped version and another satisfy keeps the unscoped
  one. A dependent whose range no listed version satisfies gets nothing.

#### Whole-graph integrity (`graph`)

`verified()` proves the bytes of the one URL a specifier resolves to. On esm.sh that URL
is a stub (`export * from "/react@19.2.0/es2022/react.mjs"`) and the real code is one hop
away, unchecked. `build(specifiers, { graph })` closes that gap at build time:

1. For every module the build maps (top-level, scoped, conflict-scoped; **not** prefix
   specifiers such as `lit/`, which map a directory), it `fetch`es the URL with the
   router's `fetch` and computes its SRI hash (`algorithm`, default `sha384`).
2. It parses the file's **static** imports (`import … from`, `import "x"`,
   `export … from`, `export * from`, with or without `with { … }` attributes;
   `import("literal")` as well when `dynamic: true`) with [`parseImports()`](#parseimports),
   resolves each against the file's URL, and repeats for every **same-origin** URL it
   has not seen. Origin means the module's own origin plus `origins`.
3. Every hash goes into the import map's `integrity` (so the browser verifies every file),
   and into the lockfile's top-level `files` map. The entry's hash is also its package's
   `integrity`. If `verified()` or the lockfile already pinned a different hash for the
   entry, the build rejects with `IntegrityError`.

On the next build the lockfile's `files` are expectations: a file whose bytes no longer
match rejects with `IntegrityError` (traced `fail`, `phase: "integrity"`) instead of being
re-recorded. Dropping the lock (`relock`, a router without `lock`) accepts the new bytes.
A file that cannot be fetched (non-OK, network error) **fails the build**: it could not be
hashed, and an unlisted file is an unverified one.

`GraphOptions`: `maxFiles` (default 500, counted across the whole build), `maxDepth`
(default 20 hops from a module), `dynamic` (false), `origins` (none), `algorithm`
(`"sha384"`), `concurrency` (8). Hitting a bound does not fail the build: the files past it
are not fetched and the walk reports it, as a `{ type: "truncated", phase: "graph",
provider, url, reason: "maxFiles" | "maxDepth", limit, skipped, examples }` event through
`onEvent` and as `result.graph.truncated` (one entry per module and bound). The CLI prints
a warning for each. A truncated lockfile is a *partial* one: treat the warning as an
error in CI, or raise the bound.

`result.graph` is `{ files, truncated, bare, skipped }`: `bare` lists the bare specifiers
found inside files (raw CDN files import their dependencies by name, so they depend on
your import map; they are **not** followed), `skipped` the imports left alone (other
origins, non-HTTP schemes).
A module that a provider maps to an origin-relative URL (`local()`: `/node_modules/…`) has nothing to be fetched
from at build time: it is left out of the walk, listed in `skipped` (`{ url, from: <its specifier>, reason }`) and gets no
`integrity`, so one `build({ graph: true })` can mix local and CDN packages. (It used to throw `TypeError: Invalid URL`.)

#### HTML module graphs: an integrity manifest for html-modules

[`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules) pages load `.html` files that reference each
other: `<html-import src>` and `<html-export src>`. Its `createHTMLModules({ integrity, strict })` takes an **integrity
manifest**, `{ [url]: "sha384-…" }`, which is the shape of an import map's `integrity` object, so one manifest can drive
both. mport builds it, the same way `graph` hashes JavaScript:

```js
import { htmlGraph, integrityManifest } from "@johnhenry/mport";

// 1. standalone: fetch, hash and follow the graph
const { integrity, files, truncated, bare, skipped } = await htmlGraph("https://cdn.example/ui/kit.html");

// 2. or as part of a build (map `integrity` + lockfile `files`; tampering is refused on the next build)
const { importMap, lock, html } = await router.build(["react@^19"], { graph: true, html: ["https://cdn.example/ui/kit.html"] });
const manifest = integrityManifest({ importMap });   // URL → hash, sorted
```

```sh
mport build --html https://cdn.example/ui/kit.html --manifest integrity.json   # no specifiers needed
```

```js
// in the page: html-modules checks every HTML fetch, at any depth; strict refuses anything unpinned
import { createHTMLModules } from "@johnhenry/html-modules";
const modules = createHTMLModules({ integrity: await (await fetch("/integrity.json")).json(), strict: true });
```

What is walked, per root URL (an absolute `http(s)` URL; `htmlGraph(roots)` takes one or an array):

1. The file is fetched with the router's `fetch` (`htmlGraph`: `options.fetch`, default `globalThis.fetch`) and hashed
   (`algorithm`, default `sha384`).
2. An HTML module is read with html-modules' own `scanHTMLModule` (so mport agrees with the loader about what an import is:
   nothing inside comments or `<template>` counts, and an `<html-import-settings base>` moves the module's imports and
   re-exports, as the loader does). A module that cannot be read (`SyntaxError`) fails the build with an
   `IntegrityError` naming it.
3. Every `<html-import src>`, **lazy ones too**, and `<html-export src>` is followed when it is a URL-like specifier
   (`./`, `../`, `/` or a scheme) on the root's origin or one of `origins`. A `.js` file (or `type="js"`) is followed as
   JavaScript, its static imports included (`dynamic` applies); `type="html"` or a `.html`/`.htm` name is HTML. Bare
   specifiers go to `bare` (html-modules resolves them through your import map), other origins and non-HTTP schemes to
   `skipped`.
4. `maxFiles`, `maxDepth`, `concurrency`, `origins`, `dynamic`, `signal` and the lockfile rules (a recorded hash is an
   expectation: a changed file rejects with `IntegrityError`, `relock` accepts it) are those of
   [`graph`](#whole-graph-integrity-graph). `maxFiles` counts the HTML walk apart from the `graph` walk.

The result of `htmlGraph()` is `{ integrity, files, truncated, bare, skipped }`; `integrity` is the manifest, sorted by
URL. `integrityManifest(source)` extracts the same object from a build result (`{ importMap }`), an import map or a
lockfile. In a build, `html` files are sorted into the map so a committed `importmap.json` is stable.

`scan` (a function `(source, url) => record`) replaces the reader. By default it is `scanHTMLModule` from
**`@johnhenry/html-modules`, an optional peer** imported on demand (`import("@johnhenry/html-modules")`, resolved from
mport's own location); without it installed, using `html` is an `Error` that says to install it or pass `scan`.
Everything else in mport is unaffected.

**Limits.** All of those of `graph` (build-time download of everything; the bytes the build machine received; same
origin by default), plus: a module reached only through a *computed* `import()`, a `fetch()`ed HTML file or a dynamic
`load()` call is not in the graph; an `<html-import>` whose `src` is a bare specifier is not followed. Pass every page
root you ship, since each entry point's graph is separate. The manifest proves the files you hashed are the files
the browser gets; it does not say they are safe.

**Limits:**

- *The parser is a tokenizer, not a JavaScript parser.* It skips comments, strings,
  template literals and regular expressions and finds import/export statements; it is
  exercised on minified esm.sh output. A construct it misreads (an obscure regex or
  division ambiguity) can hide or invent an import; a hidden one is simply not hashed.
- Dynamic imports with computed arguments, `new Worker(url)`, `fetch()`ed assets, CSS
  and anything else the code loads at run time are not in the graph, and neither are
  other origins (a CDN file importing from a second CDN).
- It hashes the bytes *the build machine's* request received. esm.sh pins `?target=` so
  those bytes don't depend on the User-Agent; a CDN that varies its output per client
  produces a hash some browsers will reject.
- Browsers verify import map `integrity` only where they implement the key; where they
  don't, the entries are ignored (as an unknown key is) and nothing is verified.
- Every file is downloaded once more at build time (the entry is fetched again even
  after `verified()`), so this is for build and CI, not page load.

### router.health, router.lock, router.name

- `router.health`: the router's [`HealthRegistry`](#healthregistry) (or the one passed as
  `health`).
- `router.lock`: a [`Lock`](#createlock) recording each resolution by `lockKey`. The
  `lock` option is read separately and never modified.
- `router.name`: the `name` option.

## Resolution: versions and entry files

The lockfile's `version` is only ever a **resolved** version. A provider with
`needsVersion: false` (`local()`, `origin()`) is handed the range as written to build its
URL, but the lock records `version` only when a resolution happened anyway (`local()`
looks up the entry file, so it does) and otherwise omits it.

The deterministic half, run lazily and only for the providers that need it.

**Versions** (providers with `needsVersion`, which is all built-ins except `local()` and
`origin()`):

| Situation | Version | Registry request |
|---|---|---|
| the lockfile pins a version (and no `relock`) | the pinned one, if it is an exact version or a GitHub ref (an entry whose `version` is a range, as older locks recorded for `local()`/`origin()`, is ignored) | none |
| `resolveVersions: false` | the range as written (may be `undefined`) | none |
| GitHub | the ref as written | none |
| an exact version (`19.2.0`) | as written, even if it doesn't exist | none |
| a dist-tag present in the registry (`next`) | the tag's version | one |
| no range, `""` or `latest` | the `latest` dist-tag | one |
| any other range | npm's rule: the `latest` dist-tag if it satisfies the range, else the highest satisfying version (see [semver](#semver)). Versions marked `deprecated` (npm) are passed over unless nothing else satisfies | one |

npm lookups read `GET <npm>/<name>` with the abbreviated-metadata `accept` header; JSR
lookups read `GET <jsr>/<name>/meta.json` and ignore yanked versions. Lookups are
memoized per router for its lifetime (a long-lived router never re-reads `latest`);
failed lookups are forgotten and retried next time. Lookups appear in the trace as
`lookup` → `resolved` or `fail`.

**Entry files** (providers with `needsEntry`: jsDelivr raw, unpkg, jspm, local, and
`custom()` templates with `{entry}`) are looked up only when the specifier has no path,
or its path has no file extension (so `preact/hooks` is mapped through `exports`, while
`lit/decorators.js` is used as written). The lookup reads `GET <npm>/<name>/<version>`
and applies [`entryInfo()`](#entryinfo). Only npm packages have entries; JSR and GitHub
paths are used as written. A lockfile `entry` is used without a lookup and is trusted to
be ESM.

`local()` needs no version for its URL but still needs one to look up the entry, so it
still reads the registry unless the lockfile pins the entry. A package that is not on npm
is then a `ResolutionError` ("not found in the registry"), and a published one resolves to
the registry's `latest`, not to the copy you serve. Give the router an
[`installedRegistry({ root })`](#installedregistry) (`createRouter(routes, { registry })`) and
the version, the entry and the manifest all come from the installed `package.json`.

## Providers

A provider turns an exact **artifact** `{ registry, name, version, path, entry, esm }`
into a URL. Its selection runs these checks in order, each producing a `skip` event with
the reason shown:

| Check | Skip reason |
|---|---|
| the provider supports the request's registry. A bare scoped name (`@std/path`, not explicit) reaching a provider that supports `jsr` but not `npm` is read as a JSR package. | `no <registry> support` |
| not in `exclude` | `excluded` |
| a pinned build (`options.build` or the lockfile) equals the provider's build | `serves build "<b>", locked to "<pin>"` |
| the provider has every required capability | `lacks <cap>, <cap>` |
| a prefix specifier needs a provider that serves directories (`prefix`, default true) | `serves no directory (prefix) mapping` |
| the provider's circuit is closed | `circuit open` |
| (after resolving the artifact) an entry file can be found: with `resolveVersions: false` and a range or tag, `needsEntry` providers can't | `needs an exact version to find its entry file, but "<range>" is not one (resolveVersions: false)` |
| (after resolving the artifact) a prefix specifier on a `needsEntry` provider needs a package without an `exports` map | `<name> has an exports map, so a directory prefix on a raw file CDN would 404 its subpaths (…)` |
| (after resolving the artifact) the entry is not CommonJS, unless `allowCommonJS` | `<entry> is CommonJS; raw file CDNs can't serve it to browsers (…)` |

Then the URL is built and [probed](#probing).

### Built-in providers

| Factory | `name` | `build` | Registries | Capabilities | needsEntry | URL shape |
|---|---|---|---|---|---|---|
| `esmSh({ origin?, name?, esTarget? = "es2022" })` | `esm.sh` | `esm.sh` | npm, jsr, github | browser, esm-transform, types | no | `https://esm.sh/[jsr/\|gh/]<name>[@<version>][/<path>][?target=<esTarget>]` |
| `jsDelivr({ origin?, name? })` | `jsdelivr` | `npm` | npm, github | raw | yes | `https://cdn.jsdelivr.net/<npm\|gh>/<name>[@<version>]/<entry or path>` |
| `jsDelivr({ esm: true, origin?, name? })` | `jsdelivr-esm` | `jsdelivr-esm` | npm | browser, esm-transform | no | `https://cdn.jsdelivr.net/npm/<name>[@<version>][/<path>]/+esm` (skips prefix specifiers) |
| `unpkg({ origin?, name? })` | `unpkg` | `npm` | npm | raw | yes | `https://unpkg.com/<name>[@<version>]/<entry or path>` |
| `jspm({ origin?, name? })` | `jspm` | `jspm` | npm | browser, esm-transform | yes | `https://ga.jspm.io/npm:<name>[@<version>]/<entry or path>` |
| `jsr({ origin?, name?, esTarget? })` | `jsr` | `esm.sh` | jsr | browser, esm-transform, types | no | `https://esm.sh/jsr/<name>[@<version>][/<path>][?target=<esTarget>]` |
| `jsr({ via: "jsr.io", origin?, name? })` | `jsr` | `jsr` | jsr | types, deno | no | `https://jsr.io/<name>/<version>/<path>`; throws without a path |
| `github({ name? })` | `github` | `npm` | github | raw | no | `https://cdn.jsdelivr.net/gh/<user>/<repo>[@<ref>]/<path>` |
| `github({ via: "esm.sh", name?, esTarget? })` | `github` | `esm.sh` | github | browser, esm-transform, types | no | `https://esm.sh/gh/<user>/<repo>[@<ref>][/<path>][?target=<esTarget>]` |
| `local({ base?, name?, build? })` | `local` | `npm` | npm | raw, offline | yes | `<base>/<name>/<entry or path>`, `base` default `/node_modules/`; no version (`needsVersion: false`). It still asks the router's registry for the version and entry: pair it with [`installedRegistry()`](#installedregistry) for packages that are not on npm or whose installed version must win. |
| `custom(template, opts?)` | the template's host | the template's host | npm | none | with `{entry}` | see [custom()](#custom) |
| `origin(o)` | `o.path` | `o.path` | npm | none | no | `https://<path><name><versionMarker><version>/<path>`; see [origin()](#origin) |

`esmSh`, `jsDelivr`, `unpkg`, `jspm` and `jsr` take `origin` to point them at a
self-hosted mirror (`github()` does not; `local()` takes `base`). The provider's
`name` is its identity for health, circuits, `exclude` and traces: two providers with the
same name share all of those.

Notes that follow from the table:

- `jspm()` is treated as a raw file CDN for entry lookup (it needs an entry), so
  CommonJS entries are skipped on it too, although ga.jspm.io transforms packages.
- **esm.sh builds for the requester's User-Agent unless given a target**, so an unpinned
  URL can serve different bytes to Chrome and to Safari and break a pinned `integrity`
  hash. `esmSh()` therefore adds `?target=es2022` (`esTarget`, also on `jsr()` and
  `github({ via: "esm.sh" })`; `esTarget: null` leaves it to esm.sh). A **prefix** mapping
  (`lit/`) points at a directory, which can't carry a query, so it stays unpinned.
- **`verified()` covers the entry module only.** It hashes the one URL it selected. The
  modules that file imports in turn (esm.sh's rewritten `/react@19.2.0/es2022/react.mjs`
  chains, dependencies of a raw file) are fetched by the browser without an integrity
  check unless the import map's `integrity` lists them. `build(specifiers, { graph: true })`
  walks the graph and lists them: see [Whole-graph integrity](#whole-graph-integrity-graph).
- `jsr()` defaults to esm.sh's build, so it and `esmSh()` are mirrors of each other.
- `github()` defaults to jsDelivr's `"npm"` build, so it can stand in for other raw mirrors
  of a GitHub-hosted package only if they serve the same files.
- A prefix specifier (`lit/`) maps to the provider's `base()`: its URL with an empty
  path and entry, ending in `/`. Two kinds of provider **skip** a prefix specifier (with a
  reason, so the route carries on) instead of failing:
  - `jsDelivr({ esm: true })`: it serves bundles, not directories (provider option
    `prefix: false`);
  - raw providers (`needsEntry`: `jsDelivr()`, `unpkg()`, `jspm()`, `local()`) when the
    package has an `exports` map. `"react/"` would map to `…/react@19.2.0/`, but
    `import "react/jsx-runtime"` then asks for `…/react@19.2.0/jsx-runtime`, a file that
    does not exist (the exports map points somewhere else), so it would 404. Route such
    packages to an ESM-transforming CDN (esm.sh) for prefix mappings, or map each subpath
    as its own key. Packages without an `exports` map keep the directory mapping.

#### provider()

```ts
provider({ name, build?, registries?, capabilities?, needsEntry?, needsVersion?, prefix?, url, base? }): Provider
```

Define your own provider.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | identity for health, `exclude` and traces |
| `build` | `string` | `name` | what it serves; equal builds are mirrors |
| `registries` | `Registry[]` | `["npm"]` | registries it can serve |
| `capabilities` | `string[]` | `[]` | matched against the `capabilities` option |
| `needsEntry` | `boolean` | `false` | resolve the entry file (and run the CommonJS check) before `url()` |
| `needsVersion` | `boolean` | `true` | resolve the exact version before `url()`; with `false` the artifact carries the range as written |
| `prefix` | `boolean` | `true` | serves a directory for prefix specifiers; `false` skips them with a reason |
| `url(artifact)` | function | required (`TypeError` without it) | the URL for an artifact |
| `base(artifact)` | function | `url()` with empty path and entry, plus a trailing `/` | the directory URL for prefix specifiers |

Returns `{ kind: "provider", name, build, registries, capabilities, needsEntry, needsVersion, prefix, url, base, select }`.
Built-in factories return the same shape, and spreading one (`{ ...esmSh(), registries: ["jsr"] }`)
is how `jsr()` and `github()` are built.

#### custom()

```ts
custom(template: string, { name?, build?, registries? = ["npm"], capabilities? = [] }?): Provider
```

Two forms:

- **A base URL** without `{`: `"https://modules.example.com/"` becomes
  `https://modules.example.com/<name>[@<version>][/<path>]`. It needs a version.
- **A template** with placeholders: `{name}` (full name), `{version}`, `{path}`, `{entry}`
  (the entry file, or the path), `{scope}` (`@scope`, including the `@`, or `""`),
  `{bare}` (the name without its scope). Unknown placeholders become `""`. A template
  needs a version only if it contains `{version}`, and an entry lookup only if it
  contains `{entry}`.

`name` and `build` default to the URL's host (`modules.example.com`). A string used as a
route value is `custom(string)` with those defaults.

#### origin()

```ts
origin(o: string | { path, versionMarker? = "@", defaultVersion? = "latest" }): Provider
```

The v1 origin as a provider: `https://` + `path` + name + `versionMarker` + version (or
`defaultVersion`) + `/` + path. `name` and `build` are `path`; `needsVersion` is `false`,
so it receives the range as written. The v1 functions build their race from these.

## Strategies

Every node, provider or strategy, implements `select(request, ctx)` and resolves to a
selection or rejects. Strategies nest freely:

```js
fallback(cache(), race(verified(esmSh()), verified(jsDelivr({ esm: true }))), unpkg())
```

#### fallback()

```ts
fallback(...nodes: Array<Node | Node[]>): Node
fallback({ providers: Node[], circuitBreaker?: { failures?, reset?, now? } }): Node
```

Tries each node in order and returns the first success. Arrays among the arguments are
flattened. A `ResolutionError` or an `AbortError` from a node is rethrown at once (no
other node could do better); once the caller's signal is aborted, the abort reason is
thrown instead of whatever the node rejected with. Otherwise errors are collected, and
when every node has failed or skipped the result is
`RoutingError("mport: no provider could serve <specifier>")` with `errors` in node order.

The object form gives the fallback its own circuit-breaker **settings** (`failures`,
`reset`, optionally `now`) over the router's health **state**: its nodes' successes and
failures are recorded in `router.health` (and in a shared `health`), on the router's `now`
clock unless `circuitBreaker.now` is given, and the fallback decides whether a circuit is
open using its own `failures`/`reset` (via `health.scoped()`). Used outside a router,
where there is no registry, it builds a private one.

#### race()

```ts
race(...nodes: Array<Node | Node[]>): Node
```

Selects every node concurrently and returns the first **success** (`Promise.any`): a
fast failure does not end the race. The winner's return aborts the others' signal, so
fetch probes are cancelled and traced as `aborted`, and aborted probes record no health
failure. Import probes can't be cancelled; one that finishes after the race was decided
is traced as `aborted` with `reason: "lost the race"` (its success still counts in the
health registry). When every node fails: the caller's abort reason if aborted; otherwise
the first `ResolutionError` among the errors if there is one; otherwise
`RoutingError("mport: every provider failed for <specifier>")`.

#### adaptive()

```ts
adaptive(...nodes: Array<Node | [Node, weight]>): Node
```

Orders nodes by `weight × successRate ÷ (1 + latency / 100)`, highest first, using the
health registry in effect (`weight` defaults to 1, `successRate` is
`(ok + 1) / (ok + fail + 1)`, `latency` is the smoothed latency in ms or 0 when unknown),
with ties in argument order, then runs `fallback()` over that order. Deterministic for a
given health state. `[node, weight]` pairs are shorthand for `weighted(node, weight)`.

#### weighted()

```ts
weighted(node: Node, weight: number): Node
```

A copy of `node` with `weight`, for `adaptive()`.

#### prefer()

```ts
prefer(byTarget: Record<string, Node>): Node
```

Picks the node for the current target (the `target` option of the call, else the
router's, default `"browser"`), else the `default` key. With neither it rejects with
`SkipError("prefer: nothing for target …")`, which is not traced. Targets are free-form
strings; `browser`, `raw` and `node` are conventions, not a fixed list.

#### verified()

```ts
verified(node: Node, { algorithm? = "sha384" }?): Node
```

Selects through `node`, then **downloads** the selected URL with `GET` and computes its
SRI hash (`sha256`, `sha384` or `sha512`). The expected hash is `options.integrity` or
the lockfile entry's `integrity`.

- The download responds non-OK: rejects with `IntegrityError("… responded <status>")`.
  With the `"head"` probe this is the probe failing, so it is traced `fail` and counts
  against the provider's health; with another probe it is neither.
- The hash differs from the expected one: records a health failure, traces
  `{ type: "fail", phase: "integrity", provider, url, error: "expected …, got …" }`, and
  rejects with `IntegrityError`.
- Otherwise the selection carries `integrity`, which `build()` writes into the import
  map's `integrity` field and the lockfile.

With no expected hash it only records what it downloaded: trust on first use. Wrap each
mirror (`race(verified(a), verified(b))`) so a bad one fails over. With the default `"head"`
probe the download **is** the probe (one `GET` per candidate, traced `probe` → `ok`, health
recorded from it; a non-OK answer is a failed candidate), not a `HEAD` followed by a `GET`
of the same URL. With any other probe (`"import"`, a function) the probe runs first and the
download follows; `verified()` downloads even with `probe: "none"`. A cache hit inside
`verified()` is hashed again.

#### cache()

```ts
cache({ store? = new Map(), name? = "cache", prefix? = "mport:", ttl? }?): Node
```

A node that serves remembered resolutions without probing. The router writes every
successful, non-cached resolution into **every** `cache()` node in its whole route
table (not only the route that served it), keyed by the **specifier as written** plus the
target, the matched route and any lockfile pin (never the resolved version, so a hit needs
no network). Each record holds the resolution and its artifact (`registry`, `version`,
`entry`), so a hit returns the same `registry`, `entry` and lock data as a miss. `ttl`
(milliseconds or `"30s"`/`"5m"`) expires records: an older one traces `skip` (reason
`expired`) and is re-resolved and overwritten; without `ttl` records never expire.
`store` is a `Map`, anything with `get`/`set`, or
a `Storage` such as `localStorage` (detected by `getItem`; values are JSON under
`prefix + key`, and storage errors are ignored).

On select: a miss traces `skip` (reason `miss`) and rejects with `SkipError`; a hit
whose build differs from a pinned build, or whose provider is excluded or has an open
circuit, rejects with `SkipError` without a trace event; otherwise it traces
`{ type: "ok", provider: <cache name>, url, cached: true }` and returns the stored
resolution with `cached: true`.

A hit makes no request at all, not even a registry lookup, so a `cache()` over a
persistent `store` serves `react@^19` while offline. The flip side: a range stays pinned to
whatever it resolved to until the record expires (`ttl`) or the store is cleared; a changed
lockfile pin is a different key.

#### sri()

```ts
sri(data: BufferSource, algorithm? = "sha384"): Promise<string>
```

`"<algorithm>-<base64 digest>"` via `crypto.subtle`. Throws `TypeError` for an algorithm
other than `sha256`, `sha384`, `sha512`.

## Probing

| `probe` | Behaviour | Health | Trace |
|---|---|---|---|
| `"head"` (default) | `fetch(url, { method: "HEAD", redirect: "follow" })`; on 405 or 501, a `GET`. Non-OK is a failure. | success with latency, or failure | `probe` then `ok` / `fail` / `aborted` |
| `"import"` | `importer(url)`; the module is returned in `Resolution.module`. | as above | as above; late race losers are `aborted` / `lost the race` |
| `"none"` | nothing is checked; the first eligible provider in the strategy's order is chosen (in a `race()`, whichever selection settles first) | **none recorded** | `selected` |
| function `(url, { provider, signal }) => Promise<{ module? } \| void>` | yours; resolve for success, reject for failure | as above | as above |

A probe proves availability, not correctness: a `HEAD` 200 does not mean the file is an
ES module whose own imports will resolve. `"none"` is for build-time routing where you
trust the table; it records no health data because nothing was checked.

## Health and the circuit breaker

### HealthRegistry

```ts
new HealthRegistry({ failures? = 3, reset? = 30000, now? = Date.now }?)
```

Per-provider (keyed by provider `name`) counts and a circuit breaker. `reset` is
milliseconds or a string: `"500ms"`, `"30s"`, `"1m"`, or a bare number of milliseconds
(`TypeError` for anything else).

| Member | Meaning |
|---|---|
| `success(name, ms?, { keepStreak? }?)` | `ok++`, streak reset to 0, circuit closed; `ms` updates the smoothed latency (`0.7 × previous + 0.3 × ms`). With `keepStreak: true` it counts the success but leaves the streak and circuit alone |
| `settle(name)` | streak reset to 0, circuit closed: a deferred success was confirmed |
| `failure(name)` | `fail++`, `streak++`; when `streak >= failures` the circuit opens until `now() + reset` |
| `isOpen(name)` | the circuit is open now: `streak >= threshold` and `now() < lastFailure + reset` |
| `scoped({ failures?, reset?, now? }?)` | a view of the same state judged by other settings (what `fallback({ providers, circuitBreaker })` uses) |
| `successRate(name)` | `(ok + 1) / (ok + fail + 1)`; 1 for an unknown provider |
| `latency(name)` | smoothed latency, or `undefined` |
| `snapshot()` | `{ [name]: { ok, fail, streak, latency, openUntil, healthy } }` for every provider that has recorded a success or failure; `healthy` is `!isOpen` |
| `threshold`, `reset`, `now` | the resolved options |

When `reset` has passed the circuit is closed again, but the streak is not reset, so the
next failure reopens it immediately (a half-open state); a success closes it for good.
Reading health never creates an entry.

What records health: probe outcomes (not with `probe: "none"`), `verified()` mismatches,
and `router.import()` import failures. Aborted race losers do not.

Inside `router.import()` a passing probe does **not** reset the failure streak (it records
`success(name, ms, { keepStreak: true })`); only a completed import calls `settle()`. So a
mirror that answers the probe but whose module fails to load (syntax error, bad exports)
accumulates failures and its circuit opens after `failures` imports in a row. `resolve()`
and `build()` never import, so a passing probe still resets the streak there.

## Trace events

Every Resolution has a `trace`; every rejection from `resolve()` carries the same array
as `error.trace`; `onEvent` receives each event as it happens. Every event has
`at` (the router's `now()`).

| `type` | Emitted when | Fields |
|---|---|---|
| `lookup` | a registry lookup starts (not for exact versions, GitHub, pinned versions or `resolveVersions: false`) | `provider: "npm registry" \| "jsr registry"`, `url: "<registry>:<name>@<range or latest>"` (a label, not a URL) |
| `resolved` | the lookup chose a version | `provider`, `url`, `version`, `ms` |
| `fail` (no phase) | the lookup failed | `provider`, `url`, `ms`, `error` |
| `skip` | a provider declined without a request; a cache missed | `provider`, `reason` |
| `selected` | `probe: "none"` chose a provider without checking it | `provider`, `url` |
| `probe` | a probe starts | `provider`, `url` |
| `ok` | the probe succeeded, or a cache hit | `provider`, `url`, `ms`; cache hits: `cached: true`, no `ms` |
| `fail` (no phase) | the probe failed | `provider`, `url`, `ms`, `error` |
| `aborted` | a race loser's probe was cancelled, or finished after the race was decided | `provider`, `url`, `ms`; `reason: "lost the race"` for the late finisher |
| `fail`, `phase: "integrity"` | `verified()` got bytes with the wrong hash | `provider`, `url`, `error: "expected …, got …"` |
| `fail`, `phase: "integrity"` | `build({ graph })` fetched a file whose hash differs from the lockfile's `files` entry. **`onEvent` only** | `provider`, `url`, `error` |
| `truncated`, `phase: "graph"` | `build({ graph })` hit `maxFiles` or `maxDepth` and left files unhashed. **`onEvent` only** | `provider`, `url` (the module), `reason`, `limit`, `skipped`, `examples` |
| `dependency`, `phase: "dependencies"` | `build({ dependencies })` added one entry. **`onEvent` only** | `provider: "build"`, `reason: "<specifier> -> <url> (needed by <name@version>, depth N)"` |
| `truncated`, `phase: "dependencies"` | `build({ dependencies })` found a dependency deeper than `dependencyDepth`. **`onEvent` only** | `provider: "build"`, `reason` |
| `fail`, `phase: "dependencies"` | `build({ dependencies })` could not resolve a dependency (it is in `result.dependencies.skipped`). **`onEvent` only** | `provider: "build"`, `reason` |
| `conflict` | `build({ conflicts: "scope" })` handled one conflicting key. **`onEvent` only** | `provider: "build"`, `reason` |
| `fail`, `phase: "import"` | `router.import()` failed to import a resolved URL. **`onEvent` only**, not in a trace. | `provider`, `url`, `error` |

A typical fallback where esm.sh is down:

```
lookup:npm registry → resolved:npm registry → probe:esm.sh → fail:esm.sh → skip:jsr (no npm support) → probe:jsdelivr → ok:jsdelivr
```

## Errors

| Error | Extends | Thrown or rejected when | Notes |
|---|---|---|---|
| `ResolutionError` | `Error` | a registry lookup fails: the fetch itself throws (in browsers an unknown npm package's 404 has no CORS header and looks like this; the message says so), the registry answers 404 (`not found in the registry`) or another non-OK status, no version satisfies the range, or the range is neither a dist-tag nor valid; `router.build()` meets an unroutable or unmatched specifier, or two specifiers map one import-map key to different URLs | Propagates through `fallback()` and `race()` at once: no provider is blamed or put in its circuit. The fetch case has the original error as `cause`. |
| `RoutingError` | `AggregateError` | `fallback()` or `race()` ran out of providers; `router.import()` exhausted its mirrors after an import failure | `errors` holds each provider's (or import's) error, `SkipError`s included |
| `SkipError` | `Error` | a node declined without trying | Normally ends up in a `RoutingError`'s `errors`; reaches the caller directly when the route is a single provider, cache or `prefer()` |
| `IntegrityError` | `Error` | `verified()` got a non-OK response or a hash mismatch | As above: collected by `fallback()` / `race()`, direct from a lone `verified()` |
| `TypeError` | | an invalid specifier ([parseSpecifier](#parsespecifier)); a string inside a strategy; a non-node argument to a strategy; `provider()` without `url`; an unsupported `sri` algorithm; a bad duration string | Synchronous for strategy/provider construction |
| `Error` | | `jsr({ via: "jsr.io" })` without a path; the CLI's usage errors | |
| `signal.reason` | | the caller's `AbortSignal` aborted | Whatever you passed to `abort()` (a `DOMException` `AbortError` by default) |

`resolve()` attaches `trace` to whatever object it rejects with. All four mport classes
are exported, so `instanceof` works; `error.name` is the class name.

## Lockfiles

```json
{
  "lockfileVersion": 1,
  "packages": {
    "react@^19": {
      "specifier": "react@^19", "registry": "npm", "name": "react", "range": "^19",
      "version": "19.2.0", "build": "esm.sh", "provider": "esm.sh",
      "url": "https://esm.sh/react@19.2.0?target=es2022", "integrity": "sha384-…"
    }
  }
}
```

With `build(…, { graph })` the lockfile also has a top-level `files` map, URL → SRI hash,
for every file of every locked module's import graph (keys sorted); see
[Whole-graph integrity](#whole-graph-integrity-graph). Without `graph` the key is absent.
`createLock()`'s `getFile(url)` and `setFile(url, integrity)` read and write it.

Entry fields, in this order: `specifier`, `registry`, `name`, `range`, `version`, `path`,
`entry`, `build`, `provider`, `url`, `integrity`. Undefined and empty-string values are
left out. Keys are sorted.

**What a pin does** (when the router's `lock` has an entry for the specifier's key and
the call doesn't pass `relock`):

| Field | Effect |
|---|---|
| `version` | used without a registry lookup |
| `entry` | used without an entry lookup, and trusted to be ESM (no CommonJS check) |
| `build` | only providers with this build may serve (unless `options.build` overrides) |
| `integrity` | the expected hash for `verified()` (unless `options.integrity` overrides); also carried into the Resolution and the import map's `integrity` |
| `provider`, `url`, `specifier`, `registry`, `name`, `range`, `path` | recorded for reference; any mirror of the build may serve next time |

### lockKey()

```ts
lockKey(parsed: ParsedSpecifier): string
```

The specifier as written, normalized: the registry prefix only if the specifier had one,
`gh:` spelled `github:`, the range if any, the path if any, no trailing `/`.

| Specifier | Key |
|---|---|
| `react@^19` | `react@^19` |
| `npm:react@18.3.1` | `npm:react@18.3.1` |
| `@std/path@^1` (routed to JSR) | `@std/path@^1` (its entry says `"registry": "jsr"`) |
| `jsr:@std/path@1.0.0` | `jsr:@std/path@1.0.0` |
| `lit/` | `lit` |
| `gh:johnhenry/mport@v2/src/index.mjs` | `github:johnhenry/mport@v2/src/index.mjs` |
| `{ name: "react", version: "^19", path: "jsx-runtime" }` | `react@^19/jsx-runtime` |

`react@^19` and `react@19` are different keys: a pin applies only to the specifier as it
was written when the lockfile was made.

### createLock()

```ts
createLock(data?: { packages?, files? }): { get(key), set(key, entry), getFile(url), setFile(url, integrity), toJSON() }
```

The in-memory lock the router uses. `set` keeps only the fields above; `toJSON()` returns
`{ lockfileVersion: 1, packages, files? }` sorted by key (`files` only when non-empty).

## Import maps

### compileImportMap()

```ts
compileImportMap(resolved: Resolution[], scoped?: Record<string, Resolution[]>, extra?: { integrity?: Record<string, string> }): ImportMap
```

`{ imports, scopes?, integrity? }`. `extra.integrity` (URL → hash) is merged into the map's
`integrity`, which is how `build({ graph })` adds the files of the import graph. Each Resolution maps `key → url`; a prefix key
(ending `/`) maps to `base` (or the URL without its file name). `integrity` maps URL →
hash for every Resolution with an `integrity` (prefix keys are excluded, at the top
level and in scopes alike: the hash is of one entry file, not of the directory a prefix maps). `scopes` and `integrity` are omitted when empty. Two Resolutions that map one key
to **different** URLs (`react@18` and `react@19` both want `"react"`) throw a
`ResolutionError` naming the key and both URLs, in `imports` and inside each scope alike,
instead of keeping one silently; the same URL twice is fine. Give the second version its
own scope (`router.build(specifiers, { scopes })`), or build with
[`conflicts: "scope"`](#conflicting-versions-conflicts-scope). For scoped lists, each entry's
`key` is the key to use inside that scope.

### mergeImportMaps()

```ts
mergeImportMaps(...maps: ImportMap[]): ImportMap
```

Later maps win, per key; scopes merge per scope. Empty `scopes`/`integrity` are omitted.

### renderImportMap()

```ts
renderImportMap(map: ImportMap, { nonce? }?): string
```

`<script type="importmap">…</script>` as an HTML string, for a server-rendered page (the
counterpart of [`injectImportMap`](#injectimportmap), which needs a DOM). The JSON has
`<`, U+2028 and U+2029 escaped, so no key or URL can end the element early. Put it before
the first module script. `nonce` adds a CSP nonce attribute; a page that cannot have one
(a static site) allows the script [by hash](#importmaphash-importmaptext-csphash-renderimportmapcsp).

### importMapHash(), importMapText(), cspHash(), renderImportMapCsp()

```ts
importMapHash(map: ImportMap, { algorithm? = "sha256" }?): Promise<string>        // "'sha256-…'"
renderImportMapCsp(map: ImportMap, { algorithm?, nonce? }?): Promise<{ html: string, hash: string, text: string }>
importMapText(map: ImportMap): string                                              // the text between the tags
cspHash(text: string, algorithm?: "sha256" | "sha384" | "sha512"): Promise<string>
```

**Which to use.** A server that renders every response can give each its own **nonce**
(`renderImportMap(map, { nonce })`, `script-src 'nonce-…'`). A **static site** (GitHub Pages, any
CDN) cannot, and a CSP can allow an inline script only by the hash of its text:

```js
const { html, hash } = await renderImportMapCsp(importMap);
// <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-…'">  ← hash, quotes included
// …and `html` in <head>, before the first module script
```

- `importMapText(map)` is the string `renderImportMap()` puts between the tags (`JSON.stringify`
  with `<`, U+2028 and U+2029 escaped). It is also what `injectImportMap()` sets as the script's
  `textContent` and what the Vite plugin injects, so **one hash allows the map whichever way it
  reaches the page**. A change to the escaping changes the text and the hash together.
- `importMapHash(map)` is `cspHash(importMapText(map))`: the value for `script-src`, **with its single
  quotes** (`'sha256-47DEQ…='`). `renderImportMapCsp(map)` returns the rendered HTML, the hash and the
  text from the same string; a `nonce` only adds the attribute (the hash is unaffected).
- `cspHash(text)` hashes any inline script's UTF-8 bytes. mport renders no other inline script: its
  `<link rel="modulepreload">` tags are not scripts, and the Vite plugin's injected map is covered by
  `plugin.api.importMapHash()` (see [Bundler plugins](#bundler-plugins)).
- They use Web Crypto (`crypto.subtle`), so they are **async**, and in a browser need a secure context
  (HTTPS or localhost). `sha384` and `sha512` are accepted; anything else is a `TypeError`.

The hash is of the text exactly as emitted: write `html` to the page unchanged. A build step that
re-serialises the HTML afterwards (a minifier that rewrites the script, CRLF conversion) changes the
text and the browser blocks the map. **Recompute the hash from the final map** whenever it changes
(a new lockfile means a new map means a new hash) and generate the policy and the page in the same
build. `test/browser/csp.spec.mjs` has real engines enforce a strict policy: the map is allowed by
mport's hash and blocked by a wrong one, and the engine's own hash of the parsed text equals mport's.

Under `require-trusted-types-for 'script'`, an import map set from script (`injectImportMap()`)
assigns a string to a script's text, which Trusted Types refuses: put the map in the HTML
(`renderImportMapCsp()`) instead; the static-page test runs under that directive.

### modulePreloads()

```ts
modulePreloads(map: ImportMap): Array<{ href: string, integrity?: string }>
```

Every distinct module URL in `imports` and `scopes` (prefix mappings are directories, not
modules, and are left out), in order, each with its hash from `map.integrity` when there is
one.

### renderModulePreload()

```ts
renderModulePreload(map: ImportMap, { crossorigin? = "anonymous", nonce? }?): string
```

One `<link rel="modulepreload" href integrity? crossorigin>` per `modulePreloads(map)`
entry, joined by newlines, with attributes HTML-escaped. Put them in `<head>` so the browser
fetches the modules before the importing script runs, **after the import map**: Firefox
(155) ignores an import map that comes after a `modulepreload` (it has "started a module
load or preload", the same warning as for a late map), so every bare import on the page then
fails there, while Chromium and WebKit take either order (a browser test pins this down).
`crossorigin: ""` omits the attribute.

```js
const { importMap } = await router.build(["react@^19"]);
res.send(`<head>${renderImportMap(importMap)}${renderModulePreload(importMap)}</head>`);
```

### htmlGraph(), integrityManifest()

```ts
htmlGraph(roots: string | string[], options?: { fetch?, scan?, signal?, maxFiles?, maxDepth?, dynamic?, origins?, algorithm?, concurrency? }):
  Promise<{ integrity: Record<string, string>, files: number, truncated, bare: string[], skipped }>
integrityManifest(source: { importMap } | ImportMap | Lockfile): Record<string, string>
```

Hash an html-modules graph and extract the manifest; see [HTML module graphs](#html-module-graphs-an-integrity-manifest-for-html-modules).
`htmlGraph` rejects with `TypeError` for no roots, a relative or non-http(s) root or a `scan` that is not a function, and
with `IntegrityError` when a file cannot be fetched (non-OK or network error) or an HTML module cannot be read. Both are
exported from `@johnhenry/mport` and `@johnhenry/mport/core` (and `/firefox`).

### parseImports()

```ts
parseImports(source: string, options?: { dynamic?: boolean }): string[]
```

The specifiers a JavaScript module imports **statically**, in source order: `import … from "x"`,
`import "x"`, `export … from "x"`, `export * from "x"`, `export * as ns from "x"`. With
`dynamic: true`, `import("x")` calls whose first argument is a string literal as well
(computed ones are never reported). Text inside comments, strings, template literals and
regular expressions is ignored. A tokenizer, not a parser; see the
[limits](#whole-graph-integrity-graph). It is what `build({ graph })` uses.

## Registry helpers and CommonJS detection

### createRegistry()

```ts
createRegistry({ fetch? = globalThis.fetch, npm? = "https://registry.npmjs.org", jsr? = "https://jsr.io" }?): RegistryClient
```

| Method | Returns |
|---|---|
| `version({ registry, name, range })` | the exact version per the [resolution table](#resolution-versions-and-entry-files) |
| `info(registry, name)` | `{ versions, tags, deprecated }` for a package on `"npm"` or `"jsr"`; one request per package, however many ranges ask (JSR: yanked versions are left out, `tags` is `{ latest }`) |
| `manifest(name, version)` | the package.json for one exact npm version (what `conflicts: "scope"` reads) |
| `entryInfo(name, version, subpath?)` | `{ file, esm, hasExports }` from `GET <npm>/<name>/<version>` |
| `entry(name, version, subpath?)` | `entryInfo(...).file` |

All memoized per client; failures are evicted. Errors are `ResolutionError`s as listed
under [Errors](#errors).

### installedRegistry()

```ts
import { installedRegistry } from "@johnhenry/mport/node";
installedRegistry({ root, fallback? = false }): RegistryClient & { root: string }
```

A registry client that answers from packages **installed on disk**, for
`createRouter(routes, { registry: installedRegistry({ root }) })`. It is the fix for
`local()` with a package that is not on npm (installed from git, `file:` or a workspace link),
and for a published package whose *installed* version must be the one served.

| Option | Meaning |
|---|---|
| `root` | the directory holding the packages, normally `<project>/node_modules`: `<root>/<name>/package.json` is read (scoped names are nested). A path or a `file:` URL. Required. |
| `fallback` | a registry client, e.g. `createRegistry()`, asked about packages that are **not** installed under `root` (`false`, the default, makes them a `ResolutionError`). Installed packages never reach it. |

| Method | Answer |
|---|---|
| `version({ registry, name, range })` | the installed `version`. A dist-tag (`latest`) or no range means "whatever is installed"; a range the installed version does not satisfy is a `ResolutionError` (`react@18.3.1 is installed … does not satisfy "^19"`). Only npm: JSR and GitHub requests go to `fallback` or fail. |
| `info(registry, name)` | `{ versions: [installed], tags: { latest: installed }, deprecated: Set{} }` |
| `manifest(name, version)` | the installed `package.json`; asking for another version (a lockfile pin that no longer matches what is installed) is a `ResolutionError`, or goes to `fallback` |
| `entryInfo(name, version, subpath?)`, `entry(...)` | [`entryInfo()`](#entryinfo) of that manifest: `exports` → `module` → `main`, with the same CommonJS judgement |

Each manifest is read once per client. A missing package is `not installed under <root>`; a
`package.json` that is not JSON or has no valid `version` is a `ResolutionError` naming the
file. The lockfile then records the installed version (`local()` has `needsVersion: false`,
so the import-map URL carries none).

```js
import { createRouter, local } from "@johnhenry/mport";
import { installedRegistry } from "@johnhenry/mport/node";

const router = createRouter(
  { "*": local({ base: "/node_modules/" }) },
  { registry: installedRegistry({ root: "node_modules" }), probe: "none" },
);
await router.build(["@scope/unpublished"]); // /node_modules/@scope/unpublished/<entry from its package.json>
```

**Why a registry client and not a `local({ packageRoot })` option.** A provider only turns an
artifact into a URL and has to run in a browser; reading `package.json` from disk is a *lookup*,
which is what the router's `registry` already abstracts (it also feeds `conflicts: "scope"` and
[`dependencies`](#including-dependencies-dependencies) the manifests they need). One client therefore fixes every
consumer at once, any provider (`jsDelivr()` in a build that is checked against local files, `custom()`) can use it, and `src/`
stays free of `node:` imports.

What it does not do: it does not read the files it serves, so a vendored copy has no `integrity`
(`graph` skips origin-relative URLs, see [Whole-graph integrity](#whole-graph-integrity-graph)); it does not walk up
parent `node_modules` directories (give the `root` that holds the package); and it does not follow
symlinks specially (a workspace link is read through the link).

### pickVersion()

```ts
pickVersion(name: string, range: string | undefined, info: { versions, tags, deprecated? }): string
```

The choice `registry.version()` makes from `registry.info()`: a dist-tag name is that tag;
no range means `latest`; otherwise `latest` if it satisfies the range, else the highest
satisfying version, passing over deprecated ones unless nothing else matches. Throws
`ResolutionError` for an unparseable range or when nothing satisfies it.

### outdated()

```ts
outdated(lock: Lockfile, { registry, names?, signal? }): Promise<{ outdated: OutdatedRow[], skipped: { key, reason }[] }>
```

What `mport outdated` prints. For each lockfile entry (all, or those whose key, specifier or
package name is in `names`) on npm or JSR with an exact locked `version`: `wanted` is the
newest version the entry's own `range` allows (an exact range is its own `wanted`) and
`latest` the registry's `latest` dist-tag. A row is returned when `updatable` (`wanted` is
newer than `current`) or `behindLatest` (`latest` is). GitHub refs, entries with no exact
version, and entries whose lookup failed are returned in `skipped` with a reason instead
of failing the call. `registry` is any client with `info()`; `router.registry` works.

### entryInfo()

```ts
entryInfo(pkg: packageJson, subpath? = ""): { file: string, esm: boolean, hasExports: boolean }
```

The file to import for a package (or a sub-path), whether it is an ES module, and whether the package has an `exports` field (`hasExports`). The
file is chosen in this order:

1. `exports`, mapped through [`resolveExports`](#resolveexports) (conditions `browser`,
   `import`, `module`, `default`, in that order; `require`, `node` and `types` are
   ignored).
2. A sub-path that `exports` doesn't map: the sub-path itself.
3. `module`.
4. `browser_module`.
5. `browser` when it is a string (object `browser` maps are ignored), else `main`, else
   `index.js`.

A leading `./` is removed.

#### CommonJS detection

Raw file CDNs serve files as published, and browsers can't import CommonJS, so the
router skips raw providers when `esm` is `false`. The rules, first match wins:

| Rule | `esm` |
|---|---|
| the file ends in `.mjs` | `true` |
| the file ends in `.cjs` | `false` |
| it was chosen through an `import` or `module` export condition (an inner `import`/`module` beats an outer `browser`/`default`) | `true` |
| the package has `"type": "module"`, or the file is the `module` field | `true` |
| ESM by naming convention: `*.module.js`, `*.esm.js`, `*.es.js` (optionally with an extra extension such as `.min`), or inside an `/esm/`, `/es/` or `/module/` directory | `true` |
| any other file | `false` |

These rules apply to files chosen in steps 1, 2 and 5. A file chosen from the `module`
field (step 3) is ESM unless it ends in `.cjs`; `browser_module` (step 4) is always ESM.

It is a heuristic in both directions: a `.js` file that is ESM but carries none of these
signals is skipped (pass `allowCommonJS: true`, or route the package to an
ESM-transforming CDN), and a file that carries a signal but is really CommonJS is served.
The check runs only for providers with `needsEntry`, only when an entry is looked up (no
path, or a path without an extension), and never for lockfile-pinned entries.

### entryOf()

```ts
entryOf(pkg, subpath? = ""): string
```

`entryInfo(pkg, subpath).file`.

### resolveExports()

```ts
resolveExports(exportsField: unknown, subpath? = ""): string | undefined
```

Maps `"."` or `"./<subpath>"` through an `exports` field: string and array sugar,
condition objects (as above), exact keys, and `*` patterns (the longest matching
prefix wins; `*` in the target is replaced). Returns the file as written in `exports`
(with its `./`), or `undefined`.

## Browser runtime helpers

Import maps can only name one URL per specifier and have to be in the document before
the first module that uses them resolves; once the browser has loaded a URL from an
import map, there is no hook to try another. So there are two runtime modes.

### injectImportMap()

```ts
injectImportMap(map: ImportMap, { document? = globalThis.document, nonce? }?): HTMLScriptElement
```

Creates `<script type="importmap">` whose text is [`importMapText(map)`](#importmaphash-importmaptext-csphash-renderimportmapcsp) (`JSON.stringify` with `<`, U+2028, U+2029 escaped, the same text `renderImportMap()` emits, so one CSP hash covers both; `nonce` sets the element's nonce) and inserts it before the
first `script[type="module"]` or existing `script[type="importmap"]`, or at the end of
`<head>`. Throws `Error("mport: injectImportMap needs a document")` without one. It has
to run before the first module import that uses the map resolves.

### injectModulePreload()

```ts
injectModulePreload(map: ImportMap, { document? = globalThis.document, crossorigin? = "anonymous" }?): HTMLLinkElement[]
```

Appends a `<link rel="modulepreload">` to `<head>` for each `modulePreloads(map)` entry
(with `integrity` where known) and returns the elements. Throws
`Error("mport: injectModulePreload needs a document")` without a document.

### startup()

```ts
startup(router, specifiers: string[], { document?, ...buildOptions }?): Promise<BuildResult>
```

`router.build(specifiers, buildOptions)` (`scopes`, `conflicts`, `graph`, `signal`, …), then
`injectImportMap(importMap)`. Afterwards plain `import "react"` works natively, and nothing
retries if a mirror goes down later.

**Firefox ignores a late import map.** Firefox (155, the version the browser tests run) does not
allow an import map once any module has loaded or begun preloading: it logs "Import maps are
not allowed after a module load or preload has started" and leaves bare specifiers unmapped.
Since mport is itself a module, `startup()` and `injectImportMap()` cannot work there (Chromium
153 and WebKit 26 accept the map). So that this isn't a mystery `TypeError` later, when `startup()`
runs against the real `document` it asks the engine (`import.meta.resolve()` of the map's first
non-prefix key) whether the map took, and if not **rejects with an `Error` whose `result` property
is the build result** (message: *this browser ignored the import map startup() injected*). The
map has still been inserted. With a `document` option (a stand-in) nothing is checked.
What works in every engine: put the map in the HTML before any module script (build it ahead of
time or on a server, and use [`renderImportMap()`](#renderimportmap)), or load packages with
[`createImporter()`](#createimporter), which needs no import map.

### createImporter()

```ts
createImporter(router): (specifier, options?) => Promise<module>
```

`(specifier, options) => router.import(specifier, options)`: every load goes through the
router and [fails over](#routerimport) when an import fails.

## semver

`semver` is a namespace export with a small semver implementation, enough for the ranges
people write in import specifiers.

| Function | Meaning |
|---|---|
| `parse(v)` | `{ major, minor, patch, pre: string[] }` or `null`; a leading `v` and `+build` metadata are accepted; the prerelease is everything after the first `-` (`1.0.0-rc-1` → `pre: ["rc-1"]`) |
| `valid(v)` | `parse(v) !== null` |
| `compare(a, b)` | `-1`, `0` or `1`; prereleases sort before their release, numeric identifiers numerically |
| `satisfies(version, range)` | whether `version` is in `range` |
| `maxSatisfying(versions, range)` | the highest satisfying version, or `null` |

Range syntax: exact (`1.2.3`, `=1.2.3`), x-ranges (`1`, `1.2`, `1.x`, `*`, `""`), `^`,
`~`, comparators (`>=`, `<=`, `>`, `<`) including space-separated sets and a space after
the operator, hyphen ranges (`1.2.3 - 2`), and unions (`||`). A prerelease only matches
a comparator that names a prerelease on the same `major.minor.patch` (`^20` does not
match `20.0.0-rc.1`; `>=20.0.0-rc.0` does). An unparseable range throws `TypeError`
(`resolve()` reports it as a `ResolutionError`).

## Bundler plugins

```js
// vite.config.js
import mportVite from "@johnhenry/mport/vite";
import { createRouter, esmSh } from "@johnhenry/mport";
const router = createRouter({ "*": esmSh() }, { lock: JSON.parse(readFileSync("mport.lock.json")) });
export default { plugins: [mportVite(router, { packageJson: true })] };

// rollup.config.js
import mportRollup from "@johnhenry/mport/rollup";
export default { input: "src/main.js", plugins: [mportRollup(router, { mode: "importmap" })], output: { dir: "dist" } };
```

```ts
mportRollup(router: Router, options?: RollupPluginOptions): Plugin
mportVite(router: Router, options?: VitePluginOptions): Plugin
```

Both resolve every **bare package import** the bundler meets (`react`, `react/jsx-runtime`,
`@scope/pkg/x.js`, `jsr:@std/path`) through `router.resolve()`. `vite` and `rollup` are not
dependencies of this package (they are dev dependencies here, used by its tests); the
plugins are plain objects the bundler calls.

| Option | Default | Meaning |
|---|---|---|
| `mode` | `"external"` | `"external"`: the import becomes the resolved CDN URL in the output, and the bundler treats it as external. `"importmap"`: the import stays bare and the build yields the import map for it (below) |
| `versions` | `{}` | `{ name: range }` for imports with no version. Without one the specifier has none, so the router uses its lockfile's pin for that specifier if it has one, else the registry's `latest` |
| `packageJson` | `false` | `true`: read `dependencies`, `devDependencies` and `peerDependencies` ranges from `package.json` (Vite: in `root`; Rollup: in the working directory) or give a path. Values that aren't registry ranges (`workspace:`, `file:`, git URLs) are ignored. `versions` wins |
| `exclude` | none | leave these to the bundler: package names or exact sources, a `RegExp` tested on the source, or a predicate |
| `specifiers` | `[]` | importmap mode: specifiers always put in the map (what only `router.import()` or a dynamic computed import uses) |
| `build` | `{}` | importmap mode: `router.build()` options for the map: `conflicts`, `graph`, `scopes` |
| `fileName` | `"importmap.json"` | Rollup, importmap mode: the emitted asset |
| `dev` | `false` | Vite: also resolve in the dev server (`"external"` mode only) |

What the plugins decide, per import:

- **Not touched** (the bundler handles it as usual): relative and absolute paths, URLs,
  `node:` and Node built-ins, prefix imports (`lit/`), `\0` virtual modules, anything in
  `exclude`, and a specifier **no route matches** (`router.resolve()` returned `null`).
  In Vite also `vite` and `vite/*` (its own virtual modules) and every SSR build (Node cannot
  import an `https:` URL).
- **A routable package whose lookup fails** (unknown package, no version satisfies the
  range, registry unreachable, no provider can serve it) **fails the build** with the
  router's `ResolutionError`/`RoutingError`; it is not left bare.
- Resolution happens once per distinct specifier per plugin instance, and uses the router
  exactly as `build` does: its probe, lockfile pins, fallback and integrity strategies.
  With the default `"head"` probe a build makes real requests; use `probe: "none"` to
  resolve without checking.

**`"external"` mode** emits `import React from "https://esm.sh/react@19.2.0?target=es2022"`.
The browser needs nothing else. It maps each import to **one** URL (the router's first
choice at build time): there is no runtime failover, and no `integrity` (a URL in an
`import` statement cannot carry one).

**`"importmap"` mode** keeps `import "react"` and builds the map from the specifiers it
routed (plus `specifiers`) with `router.build()`: Rollup emits it as the `fileName` asset
(`importmap.json`), for you to inline or serve; Vite injects
`<script type="importmap">…</script>` at the start of `index.html`'s `<head>`, before the
module script. Because it goes through `build()`, `build: { conflicts: "scope" }` and
`build: { graph: true }` give the page scopes and `integrity` for every file. Only HTML
entry pages get the injection: a Vite library or SSR build has none.

`plugin.api` exposes the instance: `api.specifiers()` (what has been routed) and
`api.importMap()` (the `build()` result) and `api.importMapHash({ algorithm? })`, the
[CSP hash](#importmaphash-importmaptext-csphash-renderimportmapcsp) of the exact text the Vite plugin injects, for a static site's `script-src`.

**Limits.** Only imports the bundler reports are seen: `import(expr)` with a computed
specifier is not (list it in `specifiers`). Vite's dev server is untouched by default
because it pre-bundles dependencies itself, so dev and production can differ; `dev: true`
makes dev import CDN URLs too. The Vite plugin is `enforce: "pre"`; a plugin that resolves
bare imports earlier (an alias) wins. CommonJS-only packages need a provider that can serve
them (the router's CommonJS check applies as in `resolve()`). The Rollup tests here run
against Rollup 4 and Vite 8 (Rolldown-based); other majors are untested.

## The CLI

```
mport build   [specifier...] [--config file] [--out importmap.json] [--lock mport.lock.json] [--relock] [--conflicts error|scope]
              [--graph [--max-files N] [--max-depth N]] [--dependencies [--dependency-depth N]]
              [--html url...] [--manifest integrity.json]
mport resolve <specifier> [--config file] [--trace] [--lock mport.lock.json] [--relock]
mport outdated [name...] [--config file] [--lock mport.lock.json] [--json]
mport update   [name...] [--config file] [--lock mport.lock.json] [--json]
mport --help
```

Run it with `npx @johnhenry/mport …` or, once installed, `npx mport …`. It needs a
global `fetch` (Node 18+; the package declares Node >= 26).

| Flag | Short | Default | Meaning |
|---|---|---|---|
| `--config` | `-c` | `mport.config.mjs` in the working directory, if it exists | the config module |
| `--out` | `-o` | `importmap.json` | where `build` writes the import map |
| `--lock` | `-l` | `mport.lock.json` | the lockfile both commands read (if it exists) and `build` writes. Not for prebuilt-router configs (error) |
| `--relock` | | `false` | don't read the lockfile (not for prebuilt-router configs: error) |
| `--conflicts` | | config's `conflicts`, else `error` | `build`: `scope` generates import-map scopes for conflicting versions (see [Conflicting versions](#conflicting-versions-conflicts-scope)) |
| `--graph` | | `false` (or config's `graph`) | `build`: hash the whole import graph (see [Whole-graph integrity](#whole-graph-integrity-graph)); the lockfile gets `files`, the import map `integrity` for every file; prints a warning per truncated walk |
| `--max-files`, `--max-depth` | | 500, 20 | the graph bounds; imply `--graph` |
| `--dependencies` | | `false` (or config's `dependencies`) | `build`: also add each raw-CDN package's manifest `dependencies` (see [Including dependencies](#including-dependencies-dependencies)); prints each addition and a warning per skipped or too-deep dependency |
| `--dependency-depth` | | 5 | how many levels of dependencies to follow; implies `--dependencies` |
| `--html` | | config's `html` | `build`: an HTML module URL to hash with its whole graph (repeatable; see [HTML module graphs](#html-module-graphs-an-integrity-manifest-for-html-modules)). With `--html`, no specifiers are needed |
| `--manifest` | | none | `build`: also write the integrity manifest (URL → hash, the import map's `integrity`) to this file |
| `--json` | | `false` | `outdated` and `update` print JSON |
| `--trace` | | `false` | `resolve` prints the trace too |
| `--help` | `-h` | | print usage |

**The config module's default export** is a config object
`{ routes?, specifiers?, scopes?, options? }`, a function, or a router (anything with a
`resolve` function):

| Field | Default | Meaning |
|---|---|---|
| `routes` | `{ "*": [esmSh(), jsDelivr(), unpkg()] }` | passed to `createRouter` |
| `options` | `{}` | passed to `createRouter`, with `lock` set from `--lock` |
| `specifiers` | `[]` | what `build` resolves when none are given on the command line |
| `scopes` | none | passed to `build` |
| `graph` | off | `true` or `GraphOptions`, passed to `build` |
| `html` | off | HTML module URLs, or `{ roots, … }`, passed to `build` (`--html` overrides it) |
| `conflicts` | `"error"` | passed to `build` (the `--conflicts` flag overrides it) |
| `dependencies`, `dependencyDepth` | off, `5` | passed to `build` (the flags override them) |

With no config at all, the default routes are used.

**A function** is called as `config({ lock, relock, lockPath })` and returns a router or a
config object. `lock` is the parsed lockfile (`undefined` with `--relock`, or when the file
doesn't exist), so `export default ({ lock }) => createRouter(routes, { lock })` honours
`--lock` and `--relock`. It may be `async`.

**A prebuilt router** was constructed before the CLI knew about the lockfile, so it can't
be given one. Passing `--lock` or `--relock` with it is an error (`--lock has no effect
because … exports a prebuilt router`), and `build` writes the import map but does **not**
write the lock file (it says so), rather than overwriting a committed lockfile with one the
flags never influenced.

**`build`** resolves the specifiers, writes the import map and the lockfile (both as
two-space JSON with a trailing newline), and prints
`mport: wrote importmap.json (N imports) and mport.lock.json`. It fails if there are no
specifiers. **`resolve`** prints the Resolution as JSON without `module` and, unless
`--trace`, without `trace`; an unroutable specifier prints `{}`.

### `mport outdated` and `mport update`

```
mport outdated [name...] [--config file] [--lock mport.lock.json] [--json]
mport update   [name...] [--config file] [--lock mport.lock.json] [--json]
```

Both need the lockfile (an error if it doesn't exist) and use the config's router, so its
registries and `fetch` apply. `name` selects entries by lock key (`react@^19`), specifier
or package name (`react`, which matches every entry for that package); none selects all.

**`outdated`** prints a table (`package current wanted latest`) of the entries where the
locked version is behind what the range allows or behind `latest`, then a
`mport: skipped <key>: <reason>` line for each it could not judge (see
[`outdated()`](#outdated)), or `mport: everything in the lockfile is up to date`. `--json`
prints `{ "outdated": OutdatedRow[], "skipped": [...] }`. It always exits 0: read the JSON
to gate on it. It only reads, so a prebuilt-router config works.

**`update`** re-resolves the selected entries (their pins are dropped, so they go back to
the registry; the router's strategy, build and mirrors choose the URL as in `build`) and
re-resolves every other entry against its pin, then rewrites the lockfile if it changed
and prints `mport: <specifier>: <from> -> <to>` per moved entry. Notes:

- It moves a package **within its range** (`^19` to the newest 19.x), never past it; to cross
  a major, change the specifier and `build`.
- It does **not** touch the import map: run `mport build` afterwards.
- It re-resolves every locked specifier (to rebuild a complete lockfile), so all CDN
  probes of a build run; entries that conflict on one import-map key are handled as with
  `--conflicts scope`.
- A lockfile with `files` (graph hashes) gets its graph re-walked and **all** its file
  hashes re-recorded, not only the selected packages': the files of one entry cannot be told
  from another's.
- `--relock` is an error (it is what `update` without names does); a prebuilt-router
  config is an error, as for `build`.
- `--json` prints `{ "updated": [{ key, specifier, name, from, to }], "checked": N, "lockfile", "written": bool }`.

Exit codes: 0 on success; on any error the message goes to stderr and the exit code is 1
(unknown command, missing specifier, a rejected resolution).

The default probe is `"head"`, so a build makes real requests. The CLI's `main(argv,
{ log, cwd })` is exported from `bin/mport.mjs` for tests; it is not part of the package's
`exports` and can change.

## The v1 API

The mport 1.x API (published as the unscoped `mport`, last version 1.0.0), kept with
the same signatures as a thin layer over the router.

### mport()

```ts
mport<T>(input: string | { name, version?, path? }, importOptions?: ImportCallOptions): Promise<T>
```

The default export: `MPort()` with the default origins. Resolves to the module.

### MPort() and MPortURL()

```ts
MPort(options?: { cdns?, useCache?, cacheKey? }): (input, importOptions?) => Promise<module>
MPort(...origins: string[]): (input, importOptions?) => Promise<module>
MPortURL(options?): (input, importOptions?) => Promise<[module, url, info]>
MPortURL(...origins: string[]): (input, importOptions?) => Promise<[module, url, info]>
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `cdns` | `Array<string \| { path, versionMarker?, defaultVersion? }>` | `DEFAULT_ORIGINS` | origins to race; strings are `{ path }`; an empty array means the default |
| `useCache` | `"localhost"` | none | remember each winning URL in `localStorage` and reuse it |
| `cacheKey` | `string` | `"mport-cache"` | the `localStorage` key (one JSON object of input → URL) |

Passing only strings (`MPort("a.cdn/", "b.cdn/")`) is the same as `{ cdns: [...] }`.
`importOptions` is passed to `import(url, importOptions)` (the Firefox entry ignores it).

**Input**: `"name@version/path"` or `{ name, version, path }`. With no version, v1 uses
`latest` (it does not resolve ranges; the CDN does). Scoped names work.

**With a path**, each call builds a router over the origins,
`race(...origins.map(origin))` with `probe: "import"`, `resolveVersions: false` and a
circuit breaker that never opens, and resolves: every origin's URL is imported at once and
the first import to **succeed** wins. `info` is that Resolution without `module`
(`url`, `provider` (the origin path), `version`, `trace`, …). If every import fails it
rejects with a `RoutingError`.

**Without a path**, it races `<origin>/<name>@<version>/package.json` from every origin
(JSON import in the standard entry, `fetch` in the Firefox entry), takes the first that
loads, picks its entry with [`entryOf()`](#entryof) (so `exports` → `module` → `main`,
preferring ESM), and imports that one URL from the same origin. `info` is
`{ url, name, version, packageJson, entry, cached: false }` with no trace. If no
`package.json` loads it rejects with `AggregateError("mport: could not load <name>")`;
if the entry import fails, that error is the rejection (there is no failover for the
entry).

**`useCache: "localhost"`**: before racing, a stored URL for the same input is used if it
starts with `https://` plus one of the current origins' paths. Then the call imports it
directly and `info` is `{ url, cached: true, trace: [] }`; if that import fails, the call
rejects rather than racing again. Storage errors are ignored.

### The Firefox entry point

`@johnhenry/mport/firefox` exports the same names. Its importer is the one-argument
`import(url)` (so `importOptions` is ignored), it reads `package.json` with `fetch`
(rejecting with `mport: <url> responded <status>` on a non-OK response), and no module it
loads contains a two-argument `import()`, which older SpiderMonkey rejects at parse time.
`test/v1.test.mjs` walks its import graph to keep it that way.

### Differences from 1.x

Nothing that 1.x exported has been removed. Behaviour changes, all bug fixes, plus one
addition:

| 1.x | Now |
|---|---|
| `Promise.race`: one CDN that failed quickly rejected the whole import | the first **success** wins |
| `"@scope/pkg@1.2.3/x.js"` split on the first `@` | scoped names parse |
| `MPort("a.cdn/", "b.cdn/")` ignored its arguments | the origins are used |
| `useCache: "localhost"` compared a URL host with an origin path and never matched | it stores and reuses the winner |
| `mport/firefox` referenced undefined variables | it works |
| path-less imports used `main` | `exports` → `module` → `main`, preferring ESM; this can change which file loads for packages whose `main` is CommonJS |
| `MPortURL` resolved to `[module, url]` | `[module, url, info]`; two-element destructuring is unaffected |
| the 1.0.0 tarball lacked `config.mjs` and `race-which.mjs` | the package ships all of `src/` |
| the package was `mport` | it is `@johnhenry/mport`, restarting at 0.0.0; the router API ([createRouter](#createrouter) and everything above) is new |

The default race still mixes builds (raw jsDelivr/unpkg files against jspm's transformed
output), because that is what 1.x did. For consistent builds use a router, e.g.
`createRouter({ "*": race(jsDelivr(), unpkg()) })`.

## Constants

| Export | Value |
|---|---|
| `DEFAULT_ORIGINS` | `["cdn.jsdelivr.net/npm/", "ga.jspm.io/npm:", "unpkg.com/"]`, the v1 race |
| `DEFAULT_CACHE_KEY` | `"mport-cache"`, the v1 `localStorage` key |
