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
    // In browsers the npm registry's 404 for an unknown package carries no CORS
    // header, so "doesn't exist" and "network down" look the same from here.
    throw new ResolutionError(
      `mport: couldn't look up ${url}: the package may not exist (browsers see the registry's 404 as a network/CORS error) or the registry is unreachable (${e?.message ?? e})`,
      { cause: e },
    );
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
    let found;
    try {
      found = maxSatisfying(versions, range || "*");
    } catch (e) {
      // not a dist-tag and not a range ("react@beta" when there is no beta tag)
      throw new ResolutionError(`mport: ${name} has no dist-tag "${range}" and it is not a valid range`, { cause: e });
    }
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
      return this.entryInfo(name, version, subpath).then((info) => info.file);
    },

    /** { file, esm } for an npm package version (see `entryInfo`). */
    entryInfo(name, version, subpath = "") {
      return once(`entry:${name}@${version}/${subpath}`, async () => {
        const pkg = await json(fetch, `${npm}/${encodeNpm(name)}/${version}`);
        return entryInfo(pkg, subpath);
      });
    },
  };
}

const CONDITIONS = ["browser", "import", "module", "default"];

// Returns { file, condition } so callers can tell an ESM entry from a CommonJS one.
const pickWithCondition = (e, condition = null) => {
  if (typeof e === "string") return { file: e, condition };
  if (Array.isArray(e)) return e.map((x) => pickWithCondition(x, condition)).find(Boolean);
  if (e && typeof e === "object") {
    for (const c of CONDITIONS) if (c in e) {
      // an inner "import"/"module" condition is the strongest ESM signal, so it wins
      const r = pickWithCondition(e[c], c === "import" || c === "module" ? c : condition ?? c);
      if (r) return r;
    }
  }
  return undefined;
};
const pickConditions = (e) => pickWithCondition(e)?.file;

const clean = (file) => file.replace(/^\.?\//, "");

/** Map "." or "./sub" through an exports field, including "./*" patterns. */
export function resolveExports(exportsField, subpath = "") {
  return resolveExportsWithCondition(exportsField, subpath)?.file;
}

function resolveExportsWithCondition(exportsField, subpath = "") {
  if (exportsField == null) return undefined;
  const target = subpath ? `./${subpath}` : ".";
  const isMap = typeof exportsField === "object" && !Array.isArray(exportsField) &&
    Object.keys(exportsField).some((k) => k.startsWith("."));
  if (!isMap) return subpath ? undefined : pickWithCondition(exportsField);
  if (target in exportsField) return pickWithCondition(exportsField[target]);
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
  const picked = pickWithCondition(best.value);
  return picked && { ...picked, file: picked.file.replaceAll("*", match) };
}

export function entryOf(pkg, subpath = "") {
  return entryInfo(pkg, subpath).file;
}

/**
 * The file to import for a package (or sub-path) plus whether it is an ES
 * module. Raw file CDNs serve files as published, so a CommonJS entry (e.g.
 * React's index.js) cannot be imported in a browser from them.
 *   esm: true  — .mjs; an "import"/"module" export condition; the "module"/"browser_module" field;
 *                "type": "module"; or an ESM-by-convention name (*.module.js, *.esm.js, …/esm/…)
 *   esm: false — .cjs, or any other .js entry in a package without "type": "module" (a heuristic:
 *                pass `allowCommonJS` to the router when a raw CDN is known to be fine)
 */
export function entryInfo(pkg, subpath = "") {
  const typeModule = pkg.type === "module";
  const moduleField = pkg.module && clean(pkg.module);
  const judge = (file, condition) => {
    if (/\.mjs$/.test(file)) return true;
    if (/\.cjs$/.test(file)) return false;
    if (condition === "import" || condition === "module") return true;
    if (typeModule || clean(file) === moduleField) return true;
    // "browser"/"default" builds that are ESM by convention: *.module.js, *.esm.js, …/esm/…
    return /(\.|\/)(module|esm|es)(\.[a-z]+)?\.js$|\/(esm|es|module)\//.test(file);
  };
  const viaExports = resolveExportsWithCondition(pkg.exports, subpath);
  const hasExports = pkg.exports != null;
  if (viaExports) return { file: clean(viaExports.file), esm: judge(viaExports.file, viaExports.condition), hasExports };
  if (subpath) return { file: clean(subpath), esm: judge(subpath, null), hasExports };
  if (pkg.module) return { file: clean(pkg.module), esm: !/\.cjs$/.test(pkg.module), hasExports };
  if (pkg.browser_module) return { file: clean(pkg.browser_module), esm: true, hasExports };
  const file = (typeof pkg.browser === "string" ? pkg.browser : undefined) ?? pkg.main ?? "index.js";
  return { file: clean(file), esm: judge(file, null), hasExports };
}
