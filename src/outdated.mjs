// What a lockfile could move to. For every locked npm/JSR package: the version it is
// locked at (`current`), the newest version its own range allows (`wanted`) and the
// registry's `latest` dist-tag (`latest`). Nothing is written.
import { pickVersion } from "./registry.mjs";
import { compare, valid } from "./semver.mjs";

const newer = (a, b) => {
  try { return a !== undefined && b !== undefined && compare(a, b) > 0; } catch { return false; }
};

/** Lockfile entries (key, entry) selected by `names`: a lock key, a specifier or a package name; none given = all. */
export function selectEntries(lock, names = []) {
  const all = Object.entries(lock?.packages ?? {});
  if (!names.length) return all;
  return all.filter(([key, e]) => names.includes(key) || names.includes(e.specifier) || names.includes(e.name));
}

/**
 * @param {object} lock a parsed lockfile
 * @param {{ registry: { info: Function }, names?: string[], signal?: AbortSignal }} options
 * @returns {Promise<{ outdated: Array, skipped: Array }>} `outdated`: rows where `updatable` or `behindLatest`;
 *   `skipped`: entries it can't judge (GitHub refs, no resolved version, a failed lookup), with a reason
 */
export async function outdated(lock, { registry, names = [], signal } = {}) {
  if (typeof registry?.info !== "function") throw new TypeError("mport: outdated() needs a registry client with info() (createRegistry())");
  const rows = [];
  const skipped = [];
  await Promise.all(selectEntries(lock, names).map(async ([key, e], i) => {
    const reg = e.registry ?? "npm";
    if (reg === "github") return void (skipped[i] = { key, reason: "GitHub refs have no registry to ask" });
    if (!e.version || !valid(e.version)) return void (skipped[i] = { key, reason: "no exact version is locked" });
    try {
      signal?.throwIfAborted();
      const info = await registry.info(reg, e.name);
      const wanted = valid(e.range ?? "") ? e.range : pickVersion(e.name, e.range, info);
      const latest = info.tags?.latest ?? pickVersion(e.name, undefined, info);
      const updatable = newer(wanted, e.version);
      const behindLatest = newer(latest, e.version);
      if (updatable || behindLatest) {
        rows[i] = { key, specifier: e.specifier ?? key, registry: reg, name: e.name, range: e.range, current: e.version, wanted, latest, updatable, behindLatest };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      skipped[i] = { key, reason: String(err?.message ?? err) };
    }
  }));
  return { outdated: rows.filter(Boolean), skipped: skipped.filter(Boolean) };
}
