// Browser helpers.
//
// Import maps can only name one URL per specifier and must be in the document
// before the first module import resolves, so there are two runtime modes:
//
//   startup()        resolve up front, inject <script type="importmap">, then
//                    plain `import "react"` works natively. If a mirror goes
//                    down after that, the browser will not retry — import maps
//                    have no fallback hook.
//   createImporter() `await load("react")` goes through the router every time
//                    and retries the next CDN when an import fails (staying on
//                    one build only if a lockfile or `build` option pins it).

import { modulePreloads } from "./importmap.mjs";

export function injectImportMap(importMap, { document = globalThis.document } = {}) {
  if (!document) throw new Error("mport: injectImportMap needs a document");
  const el = document.createElement("script");
  el.type = "importmap";
  el.textContent = JSON.stringify(importMap);
  const first = document.querySelector('script[type="module"], script[type="importmap"]');
  (first?.parentNode ?? document.head).insertBefore(el, first ?? null);
  return el;
}

/** Add `<link rel="modulepreload">` elements for the map's modules to the document head. */
export function injectModulePreload(importMap, { document = globalThis.document, crossorigin = "anonymous" } = {}) {
  if (!document) throw new Error("mport: injectModulePreload needs a document");
  return modulePreloads(importMap).map(({ href, integrity }) => {
    const el = document.createElement("link");
    el.rel = "modulepreload";
    el.href = href;
    if (integrity) el.integrity = integrity;
    if (crossorigin) el.crossOrigin = crossorigin;
    document.head.appendChild(el);
    return el;
  });
}

// Did the engine take the import map? Firefox (as of 155) ignores one added after any module
// has loaded, which is always the case when mport itself is a module: bare imports then fail with a
// confusing error. import.meta.resolve() applies the current import map, so asking it for a key
// the map defines tells us. Only checked against the real document (a stand-in has no engine behind it).
function honoured(map, doc) {
  try {
    const key = Object.keys(map.imports ?? {}).find((k) => !k.endsWith("/"));
    if (!key || typeof import.meta.resolve !== "function") return true;
    return import.meta.resolve(key) === new URL(map.imports[key], doc.baseURI).href;
  } catch {
    return false;
  }
}

/**
 * Resolve `specifiers` (build options such as `scopes` and `conflicts` pass through), inject the
 * import map, and return the build result. Rejects, with the result as `error.result`, if the
 * browser ignored the map (see `honoured`).
 */
export async function startup(router, specifiers, { document: doc = globalThis.document, ...buildOptions } = {}) {
  const result = await router.build(specifiers, buildOptions);
  injectImportMap(result.importMap, { document: doc });
  if (doc && doc === globalThis.document && !honoured(result.importMap, doc)) {
    throw Object.assign(new Error(
      "mport: this browser ignored the import map startup() injected. Firefox does not allow an import map once any module " +
      "has loaded (it warns \"Import maps are not allowed after a module load or preload has started\"), and mport is itself a module. " +
      "Put the map in the HTML before any module script (renderImportMap()), or load packages with createImporter().",
    ), { result });
  }
  return result;
}

/** A dynamic-import function with mirror failover. */
export const createImporter = (router) => (specifier, opts) => router.import(specifier, opts);
