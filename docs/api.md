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
- [Registry helpers and CommonJS detection](#registry-helpers-and-commonjs-detection)
- [Browser runtime helpers](#browser-runtime-helpers)
- [semver](#semver)
- [The CLI](#the-cli)
- [The v1 API](#the-v1-api)
- [Constants](#constants)

## Entry points

| Import | File | Exports |
|---|---|---|
| `@johnhenry/mport` | `src/index.mjs` | everything in `./core`, plus the v1 functions `mport` (also the default export), `MPort`, `MPortURL` |
| `@johnhenry/mport/firefox` | `src/firefox.mjs` | the same names as `@johnhenry/mport`. No file it loads contains a two-argument `import()`, which older Firefox rejects at parse time. See [Firefox](#the-firefox-entry-point). |
| `@johnhenry/mport/core` | `src/core.mjs` | the router, providers, strategies, registry, import-map, lockfile, runtime and semver exports, without the v1 functions |
| `mport` (bin) | `bin/mport.mjs` | the [CLI](#the-cli) |

All three module entry points are ES modules with no dependencies. The package is plain
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
| Registry | [`createRegistry`](#createregistry), [`entryInfo`](#entryinfo), [`entryOf`](#entryof), [`resolveExports`](#resolveexports) |
| Import maps | [`compileImportMap`](#compileimportmap), [`mergeImportMaps`](#mergeimportmaps) |
| Lockfiles | [`createLock`](#createlock), [`lockKey`](#lockkey) |
| Browser runtime | [`injectImportMap`](#injectimportmap), [`startup`](#startup), [`createImporter`](#createimporter) |
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
| `resolveVersions` | `boolean` | `true` | Resolve ranges to exact versions through the registries. With `false`, providers get the range (or nothing) as written, e.g. `https://esm.sh/react@^19`; exact versions and lockfile pins still apply. Providers that need an entry file (`needsEntry`: jsDelivr raw, unpkg, jspm, `local()`) can't look one up for a range, so they **skip** with a reason (`needs an exact version to find its entry file…`) and the route falls through to e.g. esm.sh; an exact version or a lockfile pin still gets an entry. |
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
router.build(specifiers: string[], options?: { scopes?, signal? }): Promise<{ importMap: ImportMap, lock: Lockfile }>
```

Resolves every specifier concurrently and compiles an [import map](#import-maps).
`scopes` is `{ [scopeURL]: { [importMapKey]: specifier } }`; each scoped specifier is
resolved and placed under its scope with the key you gave. A specifier that resolves to
`null` (unroutable or unmatched) rejects the whole build with
`ResolutionError("mport: no route for …")`; nothing is silently dropped. Any other
rejection from `resolve()` rejects the build.

`lock` is `router.lock.toJSON()`: every resolution this router has made itself so far,
including earlier `resolve()` and `import()` calls, not only this build's specifiers. It
starts **empty**: entries of the `lock` option are read-only pins, never copied across, so
specifiers you no longer build are pruned from the written lockfile. Use a fresh router
per build if the lockfile should contain exactly one build's inputs.

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
still reads the registry unless the lockfile pins the entry.

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
| `esmSh({ origin?, name? })` | `esm.sh` | `esm.sh` | npm, jsr, github | browser, esm-transform, types | no | `https://esm.sh/[jsr/\|gh/]<name>[@<version>][/<path>]` |
| `jsDelivr({ origin?, name? })` | `jsdelivr` | `npm` | npm, github | raw | yes | `https://cdn.jsdelivr.net/<npm\|gh>/<name>[@<version>]/<entry or path>` |
| `jsDelivr({ esm: true, origin?, name? })` | `jsdelivr-esm` | `jsdelivr-esm` | npm | browser, esm-transform | no | `https://cdn.jsdelivr.net/npm/<name>[@<version>][/<path>]/+esm` (skips prefix specifiers) |
| `unpkg({ origin?, name? })` | `unpkg` | `npm` | npm | raw | yes | `https://unpkg.com/<name>[@<version>]/<entry or path>` |
| `jspm({ origin?, name? })` | `jspm` | `jspm` | npm | browser, esm-transform | yes | `https://ga.jspm.io/npm:<name>[@<version>]/<entry or path>` |
| `jsr({ origin?, name? })` | `jsr` | `esm.sh` | jsr | browser, esm-transform, types | no | `https://esm.sh/jsr/<name>[@<version>][/<path>]` |
| `jsr({ via: "jsr.io", origin?, name? })` | `jsr` | `jsr` | jsr | types, deno | no | `https://jsr.io/<name>/<version>/<path>`; throws without a path |
| `github({ name? })` | `github` | `npm` | github | raw | no | `https://cdn.jsdelivr.net/gh/<user>/<repo>[@<ref>]/<path>` |
| `github({ via: "esm.sh", name? })` | `github` | `esm.sh` | github | browser, esm-transform, types | no | `https://esm.sh/gh/<user>/<repo>[@<ref>][/<path>]` |
| `local({ base?, name?, build? })` | `local` | `npm` | npm | raw, offline | yes | `<base>/<name>/<entry or path>`, `base` default `/node_modules/`; no version (`needsVersion: false`) |
| `custom(template, opts?)` | the template's host | the template's host | npm | none | with `{entry}` | see [custom()](#custom) |
| `origin(o)` | `o.path` | `o.path` | npm | none | no | `https://<path><name><versionMarker><version>/<path>`; see [origin()](#origin) |

`esmSh`, `jsDelivr`, `unpkg`, `jspm` and `jsr` take `origin` to point them at a
self-hosted mirror (`github()` does not; `local()` takes `base`). The provider's
`name` is its identity for health, circuits, `exclude` and traces: two providers with the
same name share all of those.

Notes that follow from the table:

- `jspm()` is treated as a raw file CDN for entry lookup (it needs an entry), so
  CommonJS entries are skipped on it too, although ga.jspm.io transforms packages.
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

The object form gives the fallback **its own** `HealthRegistry` built from
`circuitBreaker`, used by its nodes instead of the router's. It uses `Date.now` unless
`circuitBreaker.now` is given.

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
  No trace event, no health failure.
- The hash differs from the expected one: records a health failure, traces
  `{ type: "fail", phase: "integrity", provider, url, error: "expected …, got …" }`, and
  rejects with `IntegrityError`.
- Otherwise the selection carries `integrity`, which `build()` writes into the import
  map's `integrity` field and the lockfile.

With no expected hash it only records what it downloaded: trust on first use. Wrap each
mirror (`race(verified(a), verified(b))`) so a bad one fails over. The download is in
addition to the probe, so a `"head"` probe plus `verified()` is two requests per
candidate; `verified()` downloads even with `probe: "none"`.

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
| `isOpen(name)` | the circuit is open now |
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
      "url": "https://esm.sh/react@19.2.0", "integrity": "sha384-…"
    }
  }
}
```

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
createLock(data?: { packages? }): { get(key), set(key, entry), toJSON() }
```

The in-memory lock the router uses. `set` keeps only the fields above; `toJSON()` returns
`{ lockfileVersion: 1, packages }` sorted by key.

## Import maps

### compileImportMap()

```ts
compileImportMap(resolved: Resolution[], scoped?: Record<string, Resolution[]>): ImportMap
```

`{ imports, scopes?, integrity? }`. Each Resolution maps `key → url`; a prefix key
(ending `/`) maps to `base` (or the URL without its file name). `integrity` maps URL →
hash for every Resolution with an `integrity` (prefix entries excluded at the top
level). `scopes` and `integrity` are omitted when empty. Two Resolutions that map one key
to **different** URLs (`react@18` and `react@19` both want `"react"`) throw a
`ResolutionError` naming the key and both URLs, in `imports` and inside each scope alike,
instead of keeping one silently; the same URL twice is fine. Give the second version its
own scope (`router.build(specifiers, { scopes })`). For scoped lists, each entry's
`key` is the key to use inside that scope.

### mergeImportMaps()

```ts
mergeImportMaps(...maps: ImportMap[]): ImportMap
```

Later maps win, per key; scopes merge per scope. Empty `scopes`/`integrity` are omitted.

## Registry helpers and CommonJS detection

### createRegistry()

```ts
createRegistry({ fetch? = globalThis.fetch, npm? = "https://registry.npmjs.org", jsr? = "https://jsr.io" }?): RegistryClient
```

| Method | Returns |
|---|---|
| `version({ registry, name, range })` | the exact version per the [resolution table](#resolution-versions-and-entry-files) |
| `entryInfo(name, version, subpath?)` | `{ file, esm, hasExports }` from `GET <npm>/<name>/<version>` |
| `entry(name, version, subpath?)` | `entryInfo(...).file` |

All memoized per client; failures are evicted. Errors are `ResolutionError`s as listed
under [Errors](#errors).

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
injectImportMap(map: ImportMap, { document? = globalThis.document }?): HTMLScriptElement
```

Creates `<script type="importmap">` with `JSON.stringify(map)` and inserts it before the
first `script[type="module"]` or existing `script[type="importmap"]`, or at the end of
`<head>`. Throws `Error("mport: injectImportMap needs a document")` without one. It has
to run before the first module import that uses the map resolves.

### startup()

```ts
startup(router, specifiers: string[], { scopes?, document? }?): Promise<{ importMap, lock }>
```

`router.build(specifiers, { scopes })`, then `injectImportMap(importMap)`. Afterwards plain
`import "react"` works natively, and nothing retries if a mirror goes down later.

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
| `parse(v)` | `{ major, minor, patch, pre: string[] }` or `null`; a leading `v` and `+build` metadata are accepted |
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

## The CLI

```
mport build   [specifier...] [--config file] [--out importmap.json] [--lock mport.lock.json] [--relock]
mport resolve <specifier> [--config file] [--trace] [--lock mport.lock.json] [--relock]
mport --help
```

Run it with `npx @johnhenry/mport …` or, once installed, `npx mport …`. It needs a
global `fetch` (Node 18+; the package declares Node >= 26).

| Flag | Short | Default | Meaning |
|---|---|---|---|
| `--config` | `-c` | `mport.config.mjs` in the working directory, if it exists | the config module |
| `--out` | `-o` | `importmap.json` | where `build` writes the import map |
| `--lock` | `-l` | `mport.lock.json` | the lockfile both commands read (if it exists) and `build` writes |
| `--relock` | | `false` | don't read the lockfile |
| `--trace` | | `false` | `resolve` prints the trace too |
| `--help` | `-h` | | print usage |

**The config module's default export** is either a router (anything with a `resolve`
function) or `{ routes?, specifiers?, scopes?, options? }`:

| Field | Default | Meaning |
|---|---|---|
| `routes` | `{ "*": [esmSh(), jsDelivr(), unpkg()] }` | passed to `createRouter` |
| `options` | `{}` | passed to `createRouter`, with `lock` set from `--lock` |
| `specifiers` | `[]` | what `build` resolves when none are given on the command line |
| `scopes` | none | passed to `build` |

With no config at all, the default routes are used. When the config exports a router,
`--lock` is **not** applied to it (pass `lock` to your own `createRouter`), though `build`
still writes the lockfile.

**`build`** resolves the specifiers, writes the import map and the lockfile (both as
two-space JSON with a trailing newline), and prints
`mport: wrote importmap.json (N imports) and mport.lock.json`. It fails if there are no
specifiers. **`resolve`** prints the Resolution as JSON without `module` and, unless
`--trace`, without `trace`; an unroutable specifier prints `{}`.

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
