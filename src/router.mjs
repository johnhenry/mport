// The router: match a specifier to a route, resolve it deterministically,
// then let the route's strategy pick a transport.
//
//   const router = createRouter({
//     "*": [esmSh(), jsDelivr(), unpkg()],        // array = fallback(...)
//     "@std/*": jsr(),
//     "@internal/*": "https://modules.example.com/", // string = custom(...)
//   });
//
// Routes may also be an array of { match, use } (first match wins), e.g. built
// with route(match, use). In the object form, exact keys beat globs and longer
// globs beat shorter ones; "*" is the catch-all.

import { parseSpecifier, keyOf } from "./specifier.mjs";
import { createRegistry, ResolutionError } from "./registry.mjs";
import { valid } from "./semver.mjs";
import { fallback, HealthRegistry, SkipError, RoutingError, IntegrityError, note } from "./strategies.mjs";
import { custom } from "./providers.mjs";
import { compileImportMap } from "./importmap.mjs";
import { planConflicts } from "./conflicts.mjs";
import { walkGraph } from "./graph.mjs";
import { createLock, lockKey } from "./lock.mjs";

export const route = (match, use) => ({ match, use });

const toNode = (use) => {
  if (typeof use === "string") return custom(use);
  if (Array.isArray(use)) return fallback(...use.map(toNode));
  return use;
};

function compilePattern(match) {
  if (match instanceof RegExp) return { test: (s) => match.test(s), rank: 1 };
  if (typeof match === "function") return { test: match, rank: 1 };
  if (match === "*") return { test: () => true, rank: 0 };
  if (match.endsWith("*")) {
    const p = match.slice(0, -1);
    return { test: (s) => s.startsWith(p), rank: 1 + p.length };
  }
  return { test: (s) => s === match, rank: Infinity };
}

/** Text a route pattern is matched against: the specifier minus its version. */
const matchText = (req) =>
  `${req.explicit ? `${req.registry}:` : ""}${req.name}${req.path ? `/${req.path}` : ""}`;

function* walk(node) {
  yield node;
  for (const c of node.children ?? []) yield* walk(c);
}

const defaultProbe = (fetch) => async (url, { signal }) => {
  let res = await fetch(url, { method: "HEAD", redirect: "follow", signal });
  if (res.status === 405 || res.status === 501) res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`mport: ${url} responded ${res.status}`);
  return {};
};

/**
 * @param {object|Array} routes
 * @param {object} [options]
 * @param {"head"|"import"|"none"|Function} [options.probe="head"] how a candidate URL is checked
 * @param {object} [options.lock] a lockfile (see lock.mjs) pinning versions, builds and integrity
 * @param {boolean} [options.resolveVersions=true] resolve ranges to exact versions via registries
 * @param {object} [options.circuitBreaker] { failures, reset } for this router's health registry
 * @param {HealthRegistry} [options.health] share an existing health registry instead
 * @param {string} [options.target="browser"] default target for prefer()
 * @param {Function} [options.fetch] fetch implementation (tests, proxies)
 * @param {Function} [options.importer] dynamic import implementation for probe "import"
 * @param {boolean} [options.allowCommonJS=false] let raw file CDNs serve packages whose entry is CommonJS (browsers can't import those)
 */
export function createRouter(routes, options = {}) {
  const {
    probe = "head",
    lock: lockData,
    resolveVersions = true,
    circuitBreaker,
    target = "browser",
    capabilities,
    fetch = (...a) => globalThis.fetch(...a),
    importer = (url) => import(url),
    registry = createRegistry({ fetch, ...options.registries }),
    now = () => Date.now(),
    name = "mport",
    onEvent,
    allowCommonJS = false,
  } = options;

  const table = (Array.isArray(routes) ? routes : Object.entries(routes).map(([match, use]) => ({ match, use })))
    .map(({ match, use }, i) => ({ match, node: toNode(use), i, ...compilePattern(match) }));
  if (!Array.isArray(routes)) table.sort((a, b) => b.rank - a.rank || a.i - b.i);

  const caches = table.flatMap(({ node }) => [...walk(node)].filter((n) => n.kind === "cache"));
  // Pass `health` to share provider health (and open circuits) between routers.
  const health = options.health ?? new HealthRegistry({ now, ...circuitBreaker });
  const pins = createLock(lockData); // read-only: what the caller's lockfile pins
  const lock = createLock(); // what this router has resolved (written back by build()); starts empty so stale pins are pruned
  const probeFn =
    typeof probe === "function" ? probe
    : probe === "none" ? async () => ({})
    : probe === "import" ? async (url) => ({ module: await importer(url) })
    : defaultProbe(fetch);

  const match = (req) => {
    const full = matchText(req);
    const bare = req.explicit ? matchText({ ...req, explicit: false }) : null;
    return table.find((r) => r.test(full) || (bare !== null && r.test(bare)));
  };

  async function resolve(specifier, opts = {}) {
    opts.signal?.throwIfAborted();
    const req = parseSpecifier(specifier);
    if (!req) return null;
    const hit = match(req);
    if (!hit) return null;

    const key = lockKey(req);
    const pinned = opts.relock ? undefined : pins.get(key);
    const versions = new Map();
    const getVersion = (reg = req.registry) => {
      if (!versions.has(reg)) {
        // a pin counts only if it is an exact version (or a git ref): older locks recorded the range
        const pin = pinned?.version !== undefined && (reg === "github" || valid(pinned.version)) ? pinned.version : undefined;
        versions.set(reg, pin !== undefined ? Promise.resolve(pin)
          : resolveVersions ? lookup(reg)
          : Promise.resolve(req.range));
      }
      return versions.get(reg);
    };
    // Registry lookups appear in the trace as lookup → resolved / fail.
    const lookup = async (reg) => {
      // exact versions and GitHub refs need no network lookup
      if (reg === "github" || (req.range && valid(req.range))) return registry.version({ ...req, registry: reg });
      const url = `${reg}:${req.name}@${req.range ?? "latest"}`;
      const t0 = now();
      note(ctx, { type: "lookup", provider: `${reg} registry`, url });
      try {
        const version = await registry.version({ ...req, registry: reg });
        note(ctx, { type: "resolved", provider: `${reg} registry`, url, version, ms: now() - t0 });
        return version;
      } catch (e) {
        note(ctx, { type: "fail", provider: `${reg} registry`, url, ms: now() - t0, error: String(e?.message ?? e) });
        throw e;
      }
    };
    const entries = new Map();
    const getEntry = async (reg = req.registry) => {
      if (!entries.has(reg)) {
        entries.set(reg, (async () => {
          if (pinned?.entry) return { file: pinned.entry, esm: true };
          if (reg !== "npm") return undefined;
          const version = await getVersion(reg);
          // With resolveVersions: false the version may still be a range or tag, which
          // the registry can't map to a package.json: report that instead of asking it.
          if (!version || !valid(version)) return { unresolved: version ?? "latest" };
          return registry.entryInfo(req.name, version, req.path);
        })());
      }
      return entries.get(reg);
    };
    // Raw file CDNs need a real file: the root entry, or a sub-path that isn't
    // already a file name mapped through the package's exports.
    const needsFile = !req.path || !/\.[a-z0-9]+$/i.test(req.path);

    const ctx = {
      target: opts.target ?? target,
      capabilities: opts.capabilities ?? capabilities,
      build: opts.build ?? pinned?.build,
      integrity: opts.integrity ?? pinned?.integrity,
      exclude: opts.exclude == null || opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude),
      signal: opts.signal,
      health,
      // router.import(): a passing probe doesn't reset the failure streak; a completed import does
      deferStreak: opts._import === true,
      fetch,
      now,
      probe: probeFn,
      probeMode: typeof probe === "function" ? "custom" : probe,
      allowCommonJS,
      trace: [],
      onEvent: opts.onEvent ?? onEvent,
      async artifact(p, reg = req.registry) {
        const v = p.needsVersion ? await getVersion(reg) : req.range;
        const info = p.needsEntry && needsFile ? await getEntry(reg) : undefined;
        const a = { registry: reg, name: req.name, version: v, path: req.path, entry: info?.file, esm: info?.esm, hasExports: info?.hasExports };
        // what the lockfile may call "version": only a version that was actually resolved
        const resolved = p.needsVersion ? v : info || pinned?.version !== undefined ? await getVersion(reg) : undefined;
        if (resolved !== undefined && (reg === "github" || valid(resolved))) a.resolvedVersion = resolved;
        if (info?.unresolved !== undefined) a.skip = `needs an exact version to find its entry file, but "${info.unresolved}" is not one (resolveVersions: false)`;
        return a;
      },
      // The specifier as written, never its resolved version: a hit must not need the
      // network. The route and target keep differently-routed requests apart, and a
      // lockfile pin is part of the request (a new pin is a different resolution).
      cacheKey: () => [ctx.target, hit.node.name, key + (req.prefix ? "/" : ""), pinned?.version ?? ""].join("|"),
    };

    let result;
    try {
      result = await abortable(hit.node.select(req, ctx), opts.signal);
    } catch (e) {
      if (e && typeof e === "object") e.trace = ctx.trace;
      throw e;
    }
    const out = {
      specifier: typeof specifier === "string" ? specifier : keyOf(req),
      key: keyOf(req),
      registry: result.artifact?.registry ?? req.registry,
      name: req.name,
      range: req.range,
      version: result.artifact?.version ?? result.version,
      path: req.path,
      entry: result.artifact?.entry,
      build: result.build,
      provider: result.provider,
      url: result.url,
      integrity: result.integrity ?? pinned?.integrity,
      module: result.module,
      cached: result.cached ?? false,
      trace: ctx.trace,
    };
    if (req.prefix) out.base = baseOf(hit.node, result, out);
    if (!result.cached && caches.length) {
      const { module, trace, ...storable } = out;
      storable.artifact = result.artifact;
      storable.cachedAt = now();
      for (const c of caches) c.store.set(ctx.cacheKey(), storable);
    }
    lock.set(key, { ...out, version: result.artifact?.resolvedVersion });
    return out;
  }

  /** Runtime fallback: import through the router; a CDN whose import fails is excluded and the next is tried (same build only if a lockfile or opts.build pins it). */
  async function importModule(specifier, opts = {}) {
    const exclude = new Set(opts.exclude ?? []);
    const errors = [];
    // Failover may switch builds (esm.sh → jsDelivr) unless something pins one:
    // the lockfile (via pins in resolve) or an explicit opts.build.
    for (;;) {
      let r;
      try {
        r = await resolve(specifier, { ...opts, exclude, _import: true });
      } catch (e) {
        throw errors.length ? new RoutingError([...errors, e], `mport: could not import ${specifier}`) : e;
      }
      if (r === null) return importer(specifier);
      if (r.module) {
        health.settle(r.provider);
        return r.module;
      }
      try {
        const module = await importer(r.url);
        health.settle(r.provider);
        return module;
      } catch (e) {
        errors.push(e);
        health.failure(r.provider);
        exclude.add(r.provider);
        const event = { type: "fail", phase: "import", provider: r.provider, url: r.url, error: String(e?.message ?? e), at: now() };
        try { (opts.onEvent ?? onEvent)?.(event); } catch {}
      }
    }
  }

  return {
    name,
    health,
    lock,
    /** the registry client resolving versions (createRegistry() unless `registry` was given) */
    registry,
    resolve,
    import: importModule,
    /**
     * Resolve many specifiers and compile an import map plus lockfile.
     * `conflicts`: "error" (default) throws when two specifiers map one key to different URLs;
     * "scope" keeps the first and scopes the others to the packages that depend on them.
     * `graph`: also fetch each module, follow its static imports and record every file's
     * integrity (see graph.mjs); `true` or { maxFiles, maxDepth, dynamic, origins, algorithm }.
     */
    async build(specifiers, { scopes = {}, signal, conflicts = "error", graph = false } = {}) {
      if (conflicts !== "error" && conflicts !== "scope") throw new TypeError(`mport: build option conflicts must be "error" or "scope", got ${JSON.stringify(conflicts)}`);
      let resolved = await Promise.all(specifiers.map(async (s) => {
        const r = await resolve(s, { signal });
        if (r === null) throw new ResolutionError(`mport: no route for "${s}" (relative, URL, non-package or unmatched specifier)`);
        return r;
      }));
      const scoped = {};
      for (const [scope, map] of Object.entries(scopes)) {
        scoped[scope] = await Promise.all(
          Object.entries(map).map(async ([key, spec]) => {
            const r = await resolve(spec, { signal });
            if (r === null) throw new ResolutionError(`mport: no route for "${spec}" in scope ${scope}`);
            return { ...r, key };
          }),
        );
      }
      let report = [];
      if (conflicts === "scope") {
        const plan = await planConflicts(resolved, {
          manifest: registry.manifest?.bind(registry),
          rootOf: (r) => rootOf(r),
        });
        resolved = plan.resolved;
        report = plan.report;
        for (const [scope, list] of Object.entries(plan.scopes)) (scoped[scope] ??= []).push(...list);
        for (const c of report) {
          try { onEvent?.({ type: "conflict", provider: "build", reason: `${c.key}: kept ${c.kept.url}; ${c.scoped.length} scoped, ${c.unscoped.length} unreachable`, at: now() }); } catch {}
        }
      }
      let files;
      let graphReport;
      if (graph) {
        const roots = [...resolved, ...Object.values(scoped).flat()].filter((r) => !r.key.endsWith("/"));
        ({ files, report: graphReport } = await lockGraph(roots, graph === true ? {} : graph, signal));
      }
      return {
        importMap: compileImportMap(resolved, scoped, { integrity: files }),
        lock: lock.toJSON(),
        conflicts: report,
        ...(graphReport && { graph: graphReport }),
      };
    },
  };

  // Walk each root's import graph, hash every file, check against the lockfile's recorded
  // hashes, and write the new ones into the router's lock (and each root's `integrity`).
  async function lockGraph(allRoots, options, signal) {
    const emit = (root, event) => {
      const e = { provider: root.provider, ...event, at: now() };
      try { onEvent?.(e); } catch {}
    };
    // A provider such as local() maps to an origin-relative URL ("/node_modules/x/index.js"):
    // there is nothing to fetch it from at build time, so it is reported, not walked.
    const fetchable = (r) => { try { const u = new URL(r.url); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };
    const roots = allRoots.filter(fetchable);
    const notFetched = allRoots.filter((r) => !fetchable(r)).map((r) => ({
      url: r.url, from: r.specifier, reason: "not an absolute http(s) URL, so it was not fetched and has no integrity",
    }));
    const { files, truncated, bare, skipped } = await walkGraph(roots, {
      ...options,
      fetch,
      signal,
      expect: (url) => pins.getFile(url),
      report: (root, event) => emit(roots.find((r) => new URL(r.url).href === new URL(root.url).href) ?? root, event),
    });
    for (const [url, integrity] of files) lock.setFile(url, integrity);
    for (const r of roots) {
      const entry = files.get(new URL(r.url).href);
      if (entry === undefined) continue;
      if (r.integrity && r.integrity !== entry) {
        throw new IntegrityError(`mport: integrity mismatch for ${r.url}: expected ${r.integrity}, got ${entry}`);
      }
      r.integrity = entry;
      const key = lockKey(parseSpecifier(r.specifier));
      const rec = lock.get(key);
      if (rec) lock.set(key, { ...rec, integrity: entry });
    }
    return { files: Object.fromEntries(files), report: { files: files.size, truncated, bare: [...bare].sort(), skipped: [...notFetched, ...skipped] } };
  }

  /** The directory URL of the package a Resolution points into (what an import-map scope is keyed by). */
  function rootOf(r) {
    for (const { node } of table) {
      for (const n of walk(node)) {
        if (n.kind === "provider" && n.name === r.provider) return n.base({ registry: r.registry, name: r.name, version: r.version, path: "", entry: "" });
      }
    }
    return r.url.replace(/[^/]*$/, "");
  }
}

// Registry lookups and import probes are shared/memoized, so they can't take a
// per-call signal; instead the caller's await rejects as soon as it aborts.
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {}); // the caller gets the abort reason; don't leak the inner rejection
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function baseOf(node, result, out) {
  for (const n of walk(node)) {
    if (n.kind === "provider" && n.name === result.provider) {
      return n.base({ registry: out.registry, name: out.name, version: out.version, path: "", entry: "" });
    }
  }
  return out.url.replace(/[^/]*$/, "");
}

export { SkipError, RoutingError };
