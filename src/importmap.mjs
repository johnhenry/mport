// Compile routing decisions into a standard import map. The browser never needs
// to know mport exists: this is the routing table in its native form.

const put = (target, r, key = r.key) => {
  if (key.endsWith("/")) target[key] = r.base ?? r.url.replace(/[^/]*$/, "");
  else target[key] = r.url;
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
      put(scopes[scope], r);
      if (r.integrity) integrity[r.url] = r.integrity;
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
