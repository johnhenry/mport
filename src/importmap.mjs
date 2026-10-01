// Compile routing decisions into a standard import map. The browser never needs
// to know mport exists: this is the routing table in its native form.

import { ResolutionError } from "./registry.mjs";

/** The URL a Resolution puts under `key`: a prefix key maps to the directory (`base`), any other to the module. */
export const mapUrl = (r, key = r.key) => (key.endsWith("/") ? r.base ?? r.url.replace(/[^/]*$/, "") : r.url);

const put = (target, r, where = "imports", key = r.key) => {
  const url = mapUrl(r, key);
  if (key in target && target[key] !== url) {
    throw new ResolutionError(
      `mport: conflicting resolutions for "${key}" in ${where}: ${target[key]} and ${url}. ` +
      `An import map maps a key to one URL; give the other version its own scope (build(specifiers, { scopes })), or build with { conflicts: "scope" } to scope it to the packages that depend on it.`,
    );
  }
  target[key] = url;
};

/**
 * @param {Array} resolved router.resolve() results
 * @param {Record<string, Array>} [scoped] scope URL → resolved results (with .key)
 * @param {{ integrity?: Record<string,string> }} [extra] more URL → hash entries (the files of an import graph)
 */
export function compileImportMap(resolved, scoped = {}, { integrity: extra } = {}) {
  const map = { imports: {} };
  const integrity = { ...extra };
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

// ------------------------------------------------------------ server-side rendering
// Strings for a server-rendered page, the counterpart of runtime.mjs's DOM injection.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * `<script type="importmap">` for an import map, as an HTML string. The JSON is escaped
 * (`<`, U+2028, U+2029) so that no URL or key can end the script element early.
 * Place it before the first module script. `nonce` adds a CSP nonce attribute.
 */
export function renderImportMap(importMap, { nonce } = {}) {
  const json = JSON.stringify(importMap)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="importmap"${nonce ? ` nonce="${esc(nonce)}"` : ""}>${json}</script>`;
}

/**
 * The modules an import map points at, as `{ href, integrity? }`: every distinct
 * non-prefix URL in `imports` and `scopes`, in order, with its hash from `integrity`.
 */
export function modulePreloads(importMap) {
  const urls = new Set();
  const add = (map) => { for (const v of Object.values(map ?? {})) if (typeof v === "string" && !v.endsWith("/")) urls.add(v); };
  add(importMap.imports);
  for (const m of Object.values(importMap.scopes ?? {})) add(m);
  return [...urls].map((href) => {
    const integrity = importMap.integrity?.[href];
    return integrity ? { href, integrity } : { href };
  });
}

/**
 * `<link rel="modulepreload">` tags (one per line) for an import map's modules, so the
 * browser starts fetching them before the importing script runs. Carries `integrity`
 * where the map has it. `crossorigin` defaults to "anonymous" (what CDNs need).
 * Place these AFTER `renderImportMap()`: Firefox ignores an import map that follows a modulepreload.
 */
export function renderModulePreload(importMap, { crossorigin = "anonymous", nonce } = {}) {
  return modulePreloads(importMap).map(({ href, integrity }) =>
    `<link rel="modulepreload" href="${esc(href)}"${integrity ? ` integrity="${esc(integrity)}"` : ""}` +
    `${crossorigin ? ` crossorigin="${esc(crossorigin)}"` : ""}${nonce ? ` nonce="${esc(nonce)}"` : ""}>`,
  ).join("\n");
}
