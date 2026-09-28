// Deterministic resolution: specifier + range → exact version (and, for raw
// file CDNs, an entry file). This half never depends on which CDN is up.
import { valid, maxSatisfying } from "./semver.mjs";

export class ResolutionError extends Error {
  name = "ResolutionError";
}

const json = async (fetch, url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new ResolutionError(`mport: ${url} responded ${res.status}`);
  return res.json();
};

const encodeNpm = (name) => name.replace("/", "%2F");

export function createRegistry({
  fetch = globalThis.fetch,
  npm = "https://registry.npmjs.org",
  jsr = "https://jsr.io",
} = {}) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn().catch((e) => (memo.delete(key), Promise.reject(e))));
    return memo.get(key);
  };

  const pick = (name, range, versions, tags) => {
    if (tags?.[range]) return tags[range];
    if (range === undefined || range === "" || range === "latest") {
      if (tags?.latest) return tags.latest;
    }
    const found = maxSatisfying(versions, range || "*");
    if (!found) throw new ResolutionError(`mport: no version of ${name} satisfies "${range}"`);
    return found;
  };

  return {
    /** Exact version for a parsed specifier. GitHub refs pass through untouched. */
    version(parsed) {
      const { registry, name, range } = parsed;
      if (registry === "github") return Promise.resolve(range);
      if (range && valid(range)) return Promise.resolve(range);
      if (registry === "jsr") {
        return once(`jsr:${name}@${range}`, async () => {
          const meta = await json(fetch, `${jsr}/${name}/meta.json`);
          const versions = Object.keys(meta.versions ?? {}).filter((v) => !meta.versions[v].yanked);
          return pick(name, range, versions, meta.latest ? { latest: meta.latest } : {});
        });
      }
      return once(`npm:${name}@${range}`, async () => {
        const meta = await json(fetch, `${npm}/${encodeNpm(name)}`, {
          headers: { accept: "application/vnd.npm.install-v1+json" },
        });
        return pick(name, range, Object.keys(meta.versions ?? {}), meta["dist-tags"]);
      });
    },

    /** Entry file of an npm package version, from exports → module → main. */
    entry(name, version) {
      return once(`entry:${name}@${version}`, async () => {
        const pkg = await json(fetch, `${npm}/${encodeNpm(name)}/${version}`);
        return entryOf(pkg);
      });
    },
  };
}

const CONDITIONS = ["browser", "import", "module", "default"];

export function entryOf(pkg) {
  const fromExports = (e) => {
    if (typeof e === "string") return e;
    if (Array.isArray(e)) return e.map(fromExports).find(Boolean);
    if (e && typeof e === "object") {
      if ("." in e) return fromExports(e["."]);
      for (const c of CONDITIONS) if (c in e) {
        const r = fromExports(e[c]);
        if (r) return r;
      }
    }
    return undefined;
  };
  const file = fromExports(pkg.exports) ?? pkg.module ?? pkg.browser_module ??
    (typeof pkg.browser === "string" ? pkg.browser : undefined) ?? pkg.main ?? "index.js";
  return file.replace(/^\.?\//, "");
}
