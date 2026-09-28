// The mport 1.x API, implemented on the v2 router: a runtime race between CDN
// origins, probing by importing. The import functions are injected so the
// Firefox entry point never contains two-argument import() syntax.

import { parseSpecifier } from "./specifier.mjs";
import { createRouter } from "./router.mjs";
import { race } from "./strategies.mjs";
import { origin, DEFAULT_ORIGINS } from "./providers.mjs";
import { entryOf } from "./registry.mjs";

export const DEFAULT_CACHE_KEY = "mport-cache";

// MPortURL({ cdns, cacheKey, useCache }) or MPortURL(...originStrings)
function options(args) {
  if (args.length && args.every((a) => typeof a === "string")) return { cdns: args };
  return args[0] ?? {};
}

export function createV1({ importer, jsonImporter }) {
  const MPortURL = (...args) => {
    const { cdns = [], cacheKey = DEFAULT_CACHE_KEY, useCache } = options(args);
    const list = (cdns.length ? cdns : DEFAULT_ORIGINS).map((o) => (typeof o === "string" ? { path: o } : o));
    const providers = list.map(origin);

    const storage = () => (useCache === "localhost" ? globalThis.localStorage : undefined);
    const readCache = (name) => {
      try {
        const url = JSON.parse(storage()?.getItem(cacheKey) ?? "{}")[name];
        return url && list.some((o) => url.startsWith(`https://${o.path}`)) ? url : undefined;
      } catch {
        return undefined;
      }
    };
    const writeCache = (name, url) => {
      try {
        const s = storage();
        if (!s) return;
        const all = JSON.parse(s.getItem(cacheKey) ?? "{}");
        all[name] = url;
        s.setItem(cacheKey, JSON.stringify(all));
      } catch {}
    };

    return async (input, importOptions) => {
      const load = (url) => importer(url, importOptions);
      const cacheName = typeof input === "object" ? JSON.stringify(input) : input;
      const cached = readCache(cacheName);
      if (cached) return [await load(cached), cached, { url: cached, cached: true, trace: [] }];

      const req = parseSpecifier(input);
      const spec = { name: req.name, version: req.range ?? "latest", path: req.path };

      if (spec.path) {
        const router = createRouter({ "*": race(...providers) }, {
          probe: "import",
          importer: load,
          resolveVersions: false,
          circuitBreaker: { failures: Infinity },
        });
        const { module, ...info } = await router.resolve(spec);
        writeCache(cacheName, info.url);
        return [module, info.url, info];
      }

      // No path: race each origin's package.json, then import its entry file.
      const pkgUrls = providers.map((p) => p.url({ ...spec, path: "package.json" }));
      const [pkg, pkgUrl] = await Promise.any(pkgUrls.map(async (u) => [(await jsonImporter(u)).default, u]))
        .catch((e) => Promise.reject(new AggregateError(e.errors, `mport: could not load ${req.name}`)));
      const url = `${pkgUrl.slice(0, pkgUrl.lastIndexOf("/package.json"))}/${entryOf(pkg)}`;
      const module = await load(url);
      writeCache(cacheName, url);
      return [module, url, { url, name: req.name, version: spec.version, packageJson: pkgUrl, entry: entryOf(pkg), cached: false }];
    };
  };

  // Like MPortURL, but returns the module without the URL
  const MPort = (...args) => {
    const m = MPortURL(...args);
    return async (...a) => (await m(...a))[0];
  };

  return { MPort, MPortURL, mport: MPort() };
}
