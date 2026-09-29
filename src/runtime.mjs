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

export function injectImportMap(importMap, { document = globalThis.document } = {}) {
  if (!document) throw new Error("mport: injectImportMap needs a document");
  const el = document.createElement("script");
  el.type = "importmap";
  el.textContent = JSON.stringify(importMap);
  const first = document.querySelector('script[type="module"], script[type="importmap"]');
  (first?.parentNode ?? document.head).insertBefore(el, first ?? null);
  return el;
}

/** Resolve `specifiers`, inject the import map, and return { importMap, lock }. */
export async function startup(router, specifiers, { scopes, document } = {}) {
  const result = await router.build(specifiers, { scopes });
  injectImportMap(result.importMap, { document });
  return result;
}

/** A dynamic-import function with mirror failover. */
export const createImporter = (router) => (specifier, opts) => router.import(specifier, opts);
