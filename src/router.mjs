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
import { fallback, HealthRegistry, SkipError, RoutingError, note } from "./strategies.mjs";
import { custom } from "./providers.mjs";
import { compileImportMap } from "./importmap.mjs";
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
  } = options;

  const table = (Array.isArray(routes) ? routes : Object.entries(routes).map(([match, use]) => ({ match, use })))
    .map(({ match, use }, i) => ({ match, node: toNode(use), i, ...compilePattern(match) }));
  if (!Array.isArray(routes)) table.sort((a, b) => b.rank - a.rank || a.i - b.i);

  const caches = table.flatMap(({ node }) => [...walk(node)].filter((n) => n.kind === "cache"));
  // Pass `health` to share provider health (and open circuits) between routers.
  const health = options.health ?? new HealthRegistry({ now, ...circuitBreaker });
  const pins = createLock(lockData); // read-only: what the caller's lockfile pins
  const lock = createLock(lockData); // what this router has resolved (written back by build())
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
        versions.set(reg, pinned?.version !== undefined ? Promise.resolve(pinned.version)
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
        entries.set(reg, pinned?.entry ? Promise.resolve(pinned.entry)
          : reg === "npm" ? registry.entry(req.name, await getVersion(reg), req.path)
          : Promise.resolve(undefined));
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
      fetch,
      now,
      probe: probeFn,
      trace: [],
      onEvent: opts.onEvent ?? onEvent,
      async artifact(p, reg = req.registry) {
        const v = p.needsVersion ? await getVersion(reg) : req.range;
        const e = p.needsEntry && needsFile ? await getEntry(reg) : undefined;
        return { registry: reg, name: req.name, version: v, path: req.path, entry: e };
      },
      async cacheKey() {
        const v = resolveVersions || pinned ? await getVersion() : req.range;
        return `${req.registry}:${req.name}@${v ?? ""}/${req.path}`;
      },
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
      const cacheKey = await ctx.cacheKey();
      const { module, trace, ...storable } = out;
      for (const c of caches) c.store.set(cacheKey, storable);
    }
    lock.set(key, out);
    return out;
  }

  /** Runtime fallback: import through the router, retrying other mirrors of the same build. */
  async function importModule(specifier, opts = {}) {
    const exclude = new Set(opts.exclude ?? []);
    const errors = [];
    let build; // failover stays on mirrors of the first build chosen
    for (;;) {
      let r;
      try {
        r = await resolve(specifier, { ...opts, exclude, build: opts.build ?? build });
      } catch (e) {
        throw errors.length ? new RoutingError([...errors, e], `mport: could not import ${specifier}`) : e;
      }
      if (r === null) return importer(specifier);
      if (r.module) return r.module;
      build ??= r.build;
      try {
        return await importer(r.url);
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
    resolve,
    import: importModule,
    /** Resolve many specifiers and compile an import map plus lockfile. */
    async build(specifiers, { scopes = {}, signal } = {}) {
      const resolved = await Promise.all(specifiers.map(async (s) => {
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
      return { importMap: compileImportMap(resolved.filter(Boolean), scoped), lock: lock.toJSON() };
    },
  };
}

// Registry lookups and import probes are shared/memoized, so they can't take a
// per-call signal; instead the caller's await rejects as soon as it aborts.
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
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
