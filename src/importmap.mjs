// Compile routing decisions into a standard import map. The browser never needs
// to know mport exists: this is the routing table in its native form.

import { ResolutionError } from "./registry.mjs";

const put = (target, r, where = "imports", key = r.key) => {
  const url = key.endsWith("/") ? r.base ?? r.url.replace(/[^/]*$/, "") : r.url;
  if (key in target && target[key] !== url) {
    throw new ResolutionError(
      `mport: conflicting resolutions for "${key}" in ${where}: ${target[key]} and ${url}. ` +
      `An import map maps a key to one URL; give the other version its own scope (build(specifiers, { scopes })).`,
    );
  }
  target[key] = url;
};

/**
 * @param {Array} resolved router.resolve() results
 * @param {Record<string, Array>} [scoped] scope URL → resolved results (with .key)
 */
export function compileImportMap(resolved, scoped = {}) {
  const map = { imports: {} };
  const integrity = {};
  for (const r of resolved) {
    put(map.imports, r);
    if (r.integrity && !r.key.endsWith("/")) integrity[r.url] = r.integrity;
  }
  const scopes = {};
  for (const [scope, list] of Object.entries(scoped)) {
    scopes[scope] = {};
    for (const r of list) {
      put(scopes[scope], r, `scope ${scope}`);
      if (r.integrity && !r.key.endsWith("/")) integrity[r.url] = r.integrity;
    }
  }
  if (Object.keys(scopes).length) map.scopes = scopes;
  if (Object.keys(integrity).length) map.integrity = integrity;
  return map;
}

/** Merge import maps; later maps win. */
export function mergeImportMaps(...maps) {
  const out = { imports: {}, scopes: {}, integrity: {} };
  for (const m of maps) {
    Object.assign(out.imports, m.imports);
    for (const [s, v] of Object.entries(m.scopes ?? {})) out.scopes[s] = { ...out.scopes[s], ...v };
    Object.assign(out.integrity, m.integrity);
  }
  for (const k of ["scopes", "integrity"]) if (!Object.keys(out[k]).length) delete out[k];
  return out;
}
