// Deterministic resolution: specifier + range → exact version (and, for raw
// file CDNs, an entry file). This half never depends on which CDN is up.
import { valid, maxSatisfying } from "./semver.mjs";

export class ResolutionError extends Error {
  name = "ResolutionError";
}

const json = async (fetch, url, init) => {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ResolutionError(`mport: registry lookup failed for ${url} (${e?.message ?? e})`, { cause: e });
  }
  if (res.status === 404) throw new ResolutionError(`mport: not found in the registry: ${url}`);
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

    /**
     * File for an npm package version: the root entry (exports → module → main),
     * or a sub-path mapped through the package's exports ("preact/hooks" →
     * "hooks/dist/hooks.module.js").
     */
    entry(name, version, subpath = "") {
      return once(`entry:${name}@${version}/${subpath}`, async () => {
        const pkg = await json(fetch, `${npm}/${encodeNpm(name)}/${version}`);
        return entryOf(pkg, subpath);
      });
    },
  };
}

const CONDITIONS = ["browser", "import", "module", "default"];

const pickConditions = (e) => {
  if (typeof e === "string") return e;
  if (Array.isArray(e)) return e.map(pickConditions).find(Boolean);
  if (e && typeof e === "object") {
    for (const c of CONDITIONS) if (c in e) {
      const r = pickConditions(e[c]);
      if (r) return r;
    }
  }
  return undefined;
};

const clean = (file) => file.replace(/^\.?\//, "");

/** Map "." or "./sub" through an exports field, including "./*" patterns. */
export function resolveExports(exportsField, subpath = "") {
  if (exportsField == null) return undefined;
  const target = subpath ? `./${subpath}` : ".";
  const isMap = typeof exportsField === "object" && !Array.isArray(exportsField) &&
    Object.keys(exportsField).some((k) => k.startsWith("."));
  if (!isMap) return subpath ? undefined : pickConditions(exportsField);
  if (target in exportsField) return pickConditions(exportsField[target]);
  let best;
  for (const [key, value] of Object.entries(exportsField)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const [pre, post] = [key.slice(0, star), key.slice(star + 1)];
    if (target.startsWith(pre) && target.endsWith(post) && target.length >= key.length - 1) {
      if (!best || pre.length > best.pre.length) best = { pre, post, value };
    }
  }
  if (!best) return undefined;
  const match = target.slice(best.pre.length, target.length - best.post.length);
  return pickConditions(best.value)?.replaceAll("*", match);
}

export function entryOf(pkg, subpath = "") {
  if (subpath) return clean(resolveExports(pkg.exports, subpath) ?? subpath);
  const file = resolveExports(pkg.exports) ?? pkg.module ?? pkg.browser_module ??
    (typeof pkg.browser === "string" ? pkg.browser : undefined) ?? pkg.main ?? "index.js";
  return clean(file);
}
