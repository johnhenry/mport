// build(specs, { dependencies }): add the manifest `dependencies` of each resolved package as
// routed entries of their own.
//
// A raw file CDN (jsDelivr, unpkg) or local() serves a package's files as published, so its own
// bare imports ("import 'dompurify'") only work if the page's import map has them, and the map
// only has what was asked for. This reads each package's manifest and asks for the rest, to a
// bounded depth. Providers that rewrite imports themselves (esm.sh, jsDelivr +esm, jspm, jsr)
// already point a package at its dependencies' URLs, so they are not expanded.
import { satisfies } from "./semver.mjs";

// a registry range or tag (not workspace:, file:, git URLs, aliases or paths); no "/" because the
// range becomes part of a specifier ("name@range")
const REGISTRY_RANGE = /^(?![a-z]+:|\.|\/|git|github|http)[^/]*$/i;

const fits = (version, range) => {
  try { return version !== undefined && satisfies(version, range); } catch { return false; }
};

export const DEFAULT_DEPENDENCY_DEPTH = 5;

/**
 * @param {Array} resolved the top-level Resolutions
 * @param {object} deps
 * @param {Function} deps.resolve router.resolve
 * @param {Function} deps.manifest registry.manifest(name, version)
 * @param {(r) => boolean} deps.isRaw does r's provider serve files as published (so its imports stay bare)?
 * @param {(r) => string|undefined} deps.versionOf the exact version of a Resolution
 * @param {number} deps.maxDepth
 * @param {AbortSignal} [deps.signal]
 * @param {Function} [deps.emit] called with each report entry's event
 * @returns {Promise<{ resolved: Array, report: object }>}
 */
export async function addDependencies(resolved, { resolve, manifest, isRaw, versionOf, maxDepth, signal, emit = () => {} }) {
  const all = [...resolved];
  const byKey = new Map(); // key → Resolutions holding it (explicit and added)
  const hold = (r) => byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  all.forEach(hold);
  const report = { added: [], skipped: [], truncated: [], maxDepth };
  const attempted = new Set(); // "name@range": one resolution per distinct request
  const walked = new Set(); // "name@version": a package is read once, whoever depends on it
  let level = resolved.map((r) => ({ r, depth: 0 }));

  while (level.length) {
    const next = [];
    for (const { r, depth } of level) {
      signal?.throwIfAborted();
      if (r.registry !== "npm") continue;
      if (!isRaw(r)) {
        // a package may be listed several times (sub-paths); say it once
        if (!report.skipped.some((s) => s.from === r.name && s.provider === r.provider && s.reason === "rewrites its own imports")) {
          report.skipped.push({ from: r.name, provider: r.provider, reason: "rewrites its own imports" });
        }
        continue;
      }
      const version = versionOf(r);
      if (!version) {
        report.skipped.push({ from: r.name, provider: r.provider, reason: "no exact version to read the manifest of" });
        continue;
      }
      const id = `${r.name}@${version}`;
      if (walked.has(id)) continue;
      walked.add(id);
      let pkg;
      try {
        pkg = await manifest(r.name, version);
      } catch (e) {
        signal?.throwIfAborted();
        report.skipped.push({ from: id, provider: r.provider, reason: `manifest unavailable: ${e?.message ?? e}` });
        continue;
      }
      for (const [name, range] of Object.entries(pkg?.dependencies ?? {})) {
        if (name === r.name) continue;
        if (typeof range !== "string" || !REGISTRY_RANGE.test(range)) {
          report.skipped.push({ name, range, from: id, reason: `not a registry range: ${JSON.stringify(range)}` });
          continue;
        }
        const held = byKey.get(name);
        if (held?.some((h) => { const v = versionOf(h); return v === undefined || fits(v, range); })) continue; // already there, and the range allows it
        const spec = `${name}@${range}`;
        if (attempted.has(spec)) continue;
        if (depth + 1 > maxDepth) {
          report.truncated.push({ name, range, from: id, depth: depth + 1, limit: maxDepth });
          emit({ type: "truncated", reason: `${spec} (needed by ${id}) is deeper than dependencyDepth ${maxDepth}` });
          continue;
        }
        attempted.add(spec);
        let dep;
        try {
          dep = await resolve(spec, { signal });
        } catch (e) {
          signal?.throwIfAborted();
          report.skipped.push({ name, range, from: id, reason: String(e?.message ?? e) });
          emit({ type: "fail", reason: `${spec} (needed by ${id}): ${e?.message ?? e}` });
          continue;
        }
        if (dep === null) {
          report.skipped.push({ name, range, from: id, reason: "no route matches it" });
          continue;
        }
        const entry = { specifier: spec, key: dep.key, version: versionOf(dep), url: dep.url, provider: dep.provider, from: id, range, depth: depth + 1 };
        report.added.push(entry);
        emit({ type: "dependency", reason: `${spec} -> ${dep.url} (needed by ${id}, depth ${depth + 1})` });
        all.push(dep);
        hold(dep);
        next.push({ r: dep, depth: depth + 1 });
      }
    }
    level = next;
  }
  return { resolved: all, report };
}
