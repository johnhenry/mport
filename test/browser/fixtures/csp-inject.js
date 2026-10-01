// Classic script: loads mport, injects the import map as an inline script and imports through it.
// (A classic script, so the map is added before any module of the page has loaded.)
import("/src/core.mjs").then((mport) => {
  const map = { imports: { dep: "/test/browser/fixtures/csp-dep.mjs" } };
  window.mapText = mport.importMapText(map);
  mport.injectImportMap(map);
  return import("dep");
}).then((m) => { window.result = m.default; }, (e) => { window.failure = String(e); });
