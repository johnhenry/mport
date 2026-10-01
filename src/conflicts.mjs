// Automatic import-map scopes for conflicting versions.
//
// An import map maps one key to one URL per scope. When two specifiers want the same
// key at different URLs (react@18 and react@19), the unscoped `imports` slot can hold
// only one. The other is only reachable if the modules that need it are *scoped*: a
// scope is a URL prefix matched against the importing module's own URL, so
//
//   "scopes": { "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/": { "react": "<react 18 url>" } }
//
// makes every file under lib-a@1.0.0/ resolve "react" to 18 while the page itself and
// everything else keep the unscoped version. Which package needs which version is
// read from the registry manifests of the packages in the build (their `dependencies`,
// `peerDependencies` and `optionalDependencies` ranges), not guessed.
import { satisfies } from "./semver.mjs";
import { mapUrl } from "./importmap.mjs";

const DEP_FIELDS = ["optionalDependencies", "peerDependencies", "dependencies"];

const fits = (version, range) => {
  try { return version !== undefined && satisfies(version, range); } catch { return false; }
};

/**
 * @param {Array} resolved top-level Resolutions, in the order the specifiers were given
 * @param {{ manifest?: Function, rootOf: Function }} deps
 * @returns {Promise<{ resolved: Array, scopes: Record<string, Array>, report: Array }>}
 *   `resolved` has one Resolution per key (the first listed wins the unscoped slot);
 *   `scopes` maps a scope URL to extra Resolutions (each with its `key`).
 */
export async function planConflicts(resolved, { manifest, rootOf }) {
  const groups = new Map();
  for (const r of resolved) {
    const g = groups.get(r.key) ?? [];
    if (!g.some((x) => mapUrl(x) === mapUrl(r))) g.push(r);
    groups.set(r.key, g);
  }
  const conflicting = [...groups.values()].filter((g) => g.length > 1);
  if (!conflicting.length) return { resolved, scopes: {}, report: [] };

  // every distinct package build in the request is a potential dependent
  const seen = new Set();
  const dependents = resolved.filter((r) => r.registry === "npm" && r.version && !seen.has(r.url) && seen.add(r.url));
  const manifests = new Map();
  const manifestOf = (d) => {
    const k = `${d.name}@${d.version}`;
    if (!manifests.has(k)) manifests.set(k, Promise.resolve(manifest?.(d.name, d.version)).catch(() => undefined));
    return manifests.get(k);
  };

  const scopes = {};
  const report = [];
  const drop = new Set();
  const id = (r, key = r.key) => `${key}\0${mapUrl(r)}`;
  for (const group of conflicting) {
    const [winner, ...losers] = group;
    for (const l of losers) drop.add(id(l));
    const entry = {
      key: winner.key,
      kept: { specifier: winner.specifier, url: mapUrl(winner) },
      scoped: [],
      unscoped: [],
    };
    const reached = new Set();
    for (const d of dependents) {
      if (d.name === winner.name) continue;
      const pkg = await manifestOf(d);
      if (!pkg) continue;
      const deps = Object.assign({}, ...DEP_FIELDS.map((f) => pkg[f]));
      const range = deps[winner.name];
      if (typeof range !== "string") continue;
      const pick = group.find((c) => fits(c.version, range));
      if (!pick || pick === winner) continue; // the unscoped version already satisfies it (or nothing does)
      const scope = rootOf(d);
      (scopes[scope] ??= []).push({ ...pick, key: winner.key });
      reached.add(pick);
      entry.scoped.push({ specifier: pick.specifier, url: mapUrl(pick, winner.key), scope, dependent: `${d.name}@${d.version}`, range });
    }
    entry.unscoped = losers.filter((l) => !reached.has(l)).map((l) => ({ specifier: l.specifier, url: mapUrl(l) }));
    report.push(entry);
  }
  return { resolved: resolved.filter((r) => !drop.has(id(r))), scopes, report };
}
