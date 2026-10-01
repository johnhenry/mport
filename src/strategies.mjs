// Routing strategies. Every node — a provider or a combinator — implements
//   select(request, ctx) → Promise<{ url, provider, build, artifact, module?, integrity? }>
// and rejects when it cannot serve the request. Combinators compose nodes:
//
//   fallback(cache(), race(esmSh(), jsDelivr()), unpkg())
//
// Transport is adaptive (which mirror answers); resolution is not — the
// version and build are fixed by the router before any node runs.

export class RoutingError extends AggregateError {
  name = "RoutingError";
}
/** A node declined without trying (unsupported registry, open circuit, build mismatch…). */
export class SkipError extends Error {
  name = "SkipError";
}
export class IntegrityError extends Error {
  name = "IntegrityError";
}

const isAbort = (e, signal) => signal?.aborted || e?.name === "AbortError";

/** Record one attempt in ctx.trace and pass it to ctx.onEvent. */
export const note = (ctx, event) => {
  const e = { ...event, at: ctx.now?.() };
  ctx.trace?.push(e);
  try { ctx.onEvent?.(e); } catch {}
};

const skip = (ctx, p, reason) => {
  note(ctx, { type: "skip", provider: p.name, reason });
  return new SkipError(`${p.name}: ${reason}`);
};

/** Provider selection: filters, builds the URL, probes it and records health. */
export async function select(p, req, ctx) {
  // A bare scoped specifier ("@std/path") that reaches a JSR-only provider is read
  // as a JSR package; explicit prefixes ("npm:@std/path") are never reinterpreted.
  const registry = p.registries.includes(req.registry) ? req.registry
    : !req.explicit && p.registries.includes("jsr") && req.name.startsWith("@") ? "jsr"
    : null;
  if (!registry) throw skip(ctx, p, `no ${req.registry} support`);
  if (ctx.exclude?.has(p.name)) throw skip(ctx, p, "excluded");
  if (ctx.build && ctx.build !== p.build) throw skip(ctx, p, `serves build "${p.build}", locked to "${ctx.build}"`);
  const missing = (ctx.capabilities ?? []).filter((c) => !p.capabilities.includes(c));
  if (missing.length) throw skip(ctx, p, `lacks ${missing.join(", ")}`);
  const health = ctx.health;
  if (health?.isOpen(p.name)) throw skip(ctx, p, "circuit open");

  if (req.prefix && p.prefix === false) throw skip(ctx, p, "serves no directory (prefix) mapping");
  const artifact = await ctx.artifact(p, registry);
  if (req.prefix && p.needsEntry && artifact.hasExports) {
    throw skip(ctx, p, `${req.name} has an exports map, so a directory prefix on a raw file CDN would 404 its subpaths (use an ESM-transforming CDN, or map each subpath)`);
  }
  if (artifact.skip) throw skip(ctx, p, artifact.skip);
  if (artifact.esm === false && !ctx.allowCommonJS) {
    throw skip(ctx, p, `${artifact.entry} is CommonJS; raw file CDNs can't serve it to browsers (use an ESM-transforming CDN, or allowCommonJS)`);
  }
  const url = p.url(artifact);
  if (ctx.probeMode === "none") {
    // Nothing was checked, so record a selection, not a success (and no health data).
    note(ctx, { type: "selected", provider: p.name, url });
    return { url, provider: p.name, build: p.build, artifact };
  }
  const t0 = ctx.now();
  note(ctx, { type: "probe", provider: p.name, url });
  try {
    const { module } = (await ctx.probe(url, { provider: p, signal: ctx.signal })) ?? {};
    const ms = ctx.now() - t0;
    health?.success(p.name, ms, { keepStreak: ctx.deferStreak });
    // A probe that can't be cancelled (import) may finish after the race was decided.
    if (ctx.signal?.aborted) note(ctx, { type: "aborted", provider: p.name, url, ms, reason: "lost the race" });
    else note(ctx, { type: "ok", provider: p.name, url, ms });
    return { url, provider: p.name, build: p.build, artifact, module };
  } catch (e) {
    const aborted = isAbort(e, ctx.signal);
    if (!aborted) health?.failure(p.name);
    note(ctx, { type: aborted ? "aborted" : "fail", provider: p.name, url, ms: ctx.now() - t0, error: aborted ? undefined : String(e?.message ?? e) });
    throw e;
  }
}

const toNode = (n) => {
  if (typeof n === "string") throw new TypeError("mport: wrap URL strings with custom() inside strategies");
  if (!n || typeof n.select !== "function") throw new TypeError("mport: not a provider or strategy");
  return n;
};

/** 2. Ordered fallback: try each node in turn. Also accepts { providers, circuitBreaker }. */
export function fallback(...args) {
  let nodes = args;
  let health;
  if (args.length === 1 && args[0] && !args[0].select && Array.isArray(args[0].providers)) {
    nodes = args[0].providers;
    health = args[0].circuitBreaker ? new HealthRegistry(args[0].circuitBreaker) : undefined;
  }
  nodes = nodes.flat().map(toNode);
  return {
    kind: "fallback",
    name: `fallback(${nodes.map((n) => n.name).join(",")})`,
    children: nodes,
    async select(req, ctx) {
      const c = health ? { ...ctx, health } : ctx;
      const errors = [];
      for (const node of nodes) {
        try {
          return await node.select(req, c);
        } catch (e) {
          // once the caller aborts, report the abort, not whatever the node was holding
          if (ctx.signal?.aborted) throw ctx.signal.reason ?? e;
          if (e?.name === "AbortError" || e?.name === "ResolutionError") throw e;
          errors.push(e);
        }
      }
      throw new RoutingError(errors, `mport: no provider could serve ${req.raw ?? req.name}`);
    },
  };
}

/** 3. Race: probe every node concurrently; the first success wins, the rest are aborted. */
export function race(...nodes) {
  nodes = nodes.flat().map(toNode);
  return {
    kind: "race",
    name: `race(${nodes.map((n) => n.name).join(",")})`,
    children: nodes,
    async select(req, ctx) {
      const ac = new AbortController();
      const onAbort = () => ac.abort(ctx.signal.reason);
      ctx.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const winner = await Promise.any(nodes.map((n) => n.select(req, { ...ctx, signal: ac.signal })));
        ac.abort();
        return winner;
      } catch (e) {
        if (ctx.signal?.aborted) throw ctx.signal.reason ?? e;
        const resolution = e.errors?.find((x) => x?.name === "ResolutionError");
        if (resolution) throw resolution;
        throw new RoutingError(e.errors ?? [e], `mport: every provider failed for ${req.raw ?? req.name}`);
      } finally {
        ctx.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Attach a weight for adaptive(). */
export const weighted = (node, weight) => ({ ...toNode(node), weight });

/**
 * 4. Adaptive: order nodes by weight × success rate ÷ latency, then fall back
 * through them in that order. Deterministic for a given health state.
 */
export function adaptive(...args) {
  const nodes = args.map((n) => (Array.isArray(n) ? weighted(n[0], n[1]) : toNode(n)));
  return {
    kind: "adaptive",
    name: `adaptive(${nodes.map((n) => n.name).join(",")})`,
    children: nodes,
    select(req, ctx) {
      const h = ctx.health;
      const score = (n) => (n.weight ?? 1) * (h ? h.successRate(n.name) : 1) / (1 + (h?.latency(n.name) ?? 0) / 100);
      const ordered = nodes.map((n, i) => [n, score(n), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([n]) => n);
      return fallback(...ordered).select(req, ctx);
    },
  };
}

/** 7. Capability routing: pick a node by the request's target (ctx.target, default "browser"). */
export function prefer(byTarget) {
  const entries = Object.entries(byTarget).map(([k, n]) => [k, toNode(n)]);
  const map = Object.fromEntries(entries);
  return {
    kind: "prefer",
    name: `prefer(${Object.keys(map).join(",")})`,
    children: entries.map(([, n]) => n),
    select(req, ctx) {
      const node = map[ctx.target] ?? map.default;
      if (!node) return Promise.reject(new SkipError(`prefer: nothing for target "${ctx.target}"`));
      return node.select(req, ctx);
    },
  };
}

/**
 * Subresource integrity. Fetches the selected URL, computes its SRI hash and,
 * when the lockfile (or ctx.integrity) pins one, rejects on mismatch. Wrap each
 * mirror — race(verified(a), verified(b)) — to fail over on a bad mirror.
 */
export function verified(node, { algorithm = "sha384" } = {}) {
  node = toNode(node);
  return {
    kind: "verified",
    name: `verified(${node.name})`,
    children: [node],
    async select(req, ctx) {
      const r = await node.select(req, ctx);
      const res = await ctx.fetch(r.url, { signal: ctx.signal });
      if (!res.ok) throw new IntegrityError(`mport: ${r.url} responded ${res.status}`);
      const integrity = await sri(await res.arrayBuffer(), algorithm);
      const expected = ctx.integrity;
      if (expected && expected !== integrity) {
        ctx.health?.failure(r.provider);
        note(ctx, { type: "fail", phase: "integrity", provider: r.provider, url: r.url, error: `expected ${expected}, got ${integrity}` });
        throw new IntegrityError(`mport: integrity mismatch for ${r.url}: expected ${expected}, got ${integrity}`);
      }
      return { ...r, integrity };
    },
  };
}

export async function sri(buffer, algorithm = "sha384") {
  const name = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[algorithm];
  if (!name) throw new TypeError(`mport: unsupported integrity algorithm ${algorithm}`);
  const digest = new Uint8Array(await crypto.subtle.digest(name, buffer));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return `${algorithm}-${btoa(bin)}`;
}

/**
 * A remembered-resolution source. The router writes every successful
 * resolution into each cache() in its tree; on a hit the stored URL is reused
 * without probing. `store` is a Map or a Storage (localStorage).
 */
export function cache({ store = new Map(), name = "cache", prefix = "mport:", ttl } = {}) {
  const maxAge = ttl === undefined ? undefined : typeof ttl === "string" ? parseDuration(ttl) : ttl;
  const kv = typeof store.getItem === "function"
    ? {
        get: (k) => { try { const v = store.getItem(prefix + k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } },
        set: (k, v) => { try { store.setItem(prefix + k, JSON.stringify(v)); } catch {} },
      }
    : store;
  return {
    kind: "cache",
    name,
    store: kv,
    async select(req, ctx) {
      const hit = kv.get(ctx.cacheKey());
      if (hit && maxAge !== undefined && !(ctx.now() - hit.cachedAt <= maxAge)) {
        note(ctx, { type: "skip", provider: name, reason: "expired" });
        throw new SkipError("cache: expired");
      }
      if (!hit) { note(ctx, { type: "skip", provider: name, reason: "miss" }); throw new SkipError("cache: miss"); }
      if (ctx.build && hit.build !== ctx.build) throw new SkipError("cache: build mismatch");
      if (ctx.exclude?.has(hit.provider) || ctx.health?.isOpen(hit.provider)) throw new SkipError("cache: provider unavailable");
      note(ctx, { type: "ok", provider: name, url: hit.url, cached: true });
      return { ...hit, cached: true };
    },
  };
}

/** 6. Health tracking with a circuit breaker per provider. */
export class HealthRegistry {
  #state = new Map();
  constructor({ failures = 3, reset = 30_000, now = () => Date.now() } = {}) {
    this.threshold = failures;
    this.reset = typeof reset === "string" ? parseDuration(reset) : reset;
    this.now = now;
  }
  #get(name) {
    let s = this.#state.get(name);
    if (!s) this.#state.set(name, (s = { ok: 0, fail: 0, streak: 0, latency: undefined, openUntil: 0 }));
    return s;
  }
  /** `keepStreak`: count the success but leave the failure streak alone (see `settle`). */
  success(name, ms, { keepStreak = false } = {}) {
    const s = this.#get(name);
    s.ok++;
    if (!keepStreak) {
      s.streak = 0;
      s.openUntil = 0;
    }
    if (Number.isFinite(ms)) s.latency = s.latency === undefined ? ms : s.latency * 0.7 + ms * 0.3;
  }
  /** A deferred success is confirmed (the import completed): reset the streak and close the circuit. */
  settle(name) {
    const s = this.#get(name);
    s.streak = 0;
    s.openUntil = 0;
  }
  failure(name) {
    const s = this.#get(name);
    s.fail++;
    if (++s.streak >= this.threshold) s.openUntil = this.now() + this.reset;
  }
  isOpen(name) {
    return (this.#state.get(name)?.openUntil ?? 0) > this.now();
  }
  successRate(name) {
    const { ok = 0, fail = 0 } = this.#state.get(name) ?? {};
    return (ok + 1) / (ok + fail + 1);
  }
  latency(name) {
    return this.#state.get(name)?.latency;
  }
  snapshot() {
    return Object.fromEntries([...this.#state].map(([k, v]) => [k, { ...v, healthy: !this.isOpen(k) }]));
  }
}

export function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/.exec(String(s).trim());
  if (!m) throw new TypeError(`mport: bad duration "${s}"`);
  return +m[1] * ({ ms: 1, s: 1000, m: 60_000 }[m[2] ?? "ms"]);
}
