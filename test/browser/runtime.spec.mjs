// The browser runtime on all three engines: injectImportMap, startup, createImporter,
// injectModulePreload, renderImportMap/renderModulePreload in server-rendered HTML, and what
// each engine does with the import maps mport builds (scopes, integrity). Every CDN and
// registry request is answered by the stubs, never by the network.
import { test, expect } from "@playwright/test";
import { createRouter, jsDelivr, esmSh, renderImportMap, renderModulePreload } from "../../src/core.mjs";
import { installStubs, installPages, stubFetch } from "./stubs.mjs";

const FIXTURE = "/test/browser/fixtures/blank.html";

// Firefox (as of 155) ignores an import map added after any module has loaded: it logs
// "Import maps are not allowed after a module load or preload has started". Chromium and
// WebKit accept it (the capability test below fails if an engine changes, so the docs get updated).
const acceptsLateMaps = (browserName) => browserName !== "firefox";

// every test gets its own stub CDN; pass `state` to change its behaviour (see stubs.mjs)
const setup = async (context, page, state) => {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const stubs = await installStubs(context, state);
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.ready === true);
  return stubs;
};

// Run module code in the page (so it sees the import map installed so far) and return what it
// passes to `done(value)`. A module that fails to load rejects.
const runModule = (page, code) =>
  page.evaluate((code) => new Promise((resolve, reject) => {
    window.__done = resolve;
    const s = document.createElement("script");
    s.type = "module";
    s.onerror = () => reject(new Error("module script failed to load"));
    // static imports must stay at the top level of the module
    const imports = code.split("\n").filter((l) => /^import /.test(l)).join("\n");
    s.textContent = `${imports}\nconst done = (v) => window.__done(v);\ntry { ${code.replace(/^import .*$/gm, "")} } catch (e) { done({ error: String(e) }); }`;
    document.body.append(s);
  }), code);

test("injectImportMap puts a standard import map ahead of the module scripts", async ({ page, context, browserName }) => {
  await setup(context, page);
  const info = await page.evaluate(() => {
    const el = window.mport.injectImportMap({ imports: { demo: "https://esm.sh/lit@3.3.1?target=es2022" } });
    const scripts = [...document.scripts];
    return { type: el.type, text: el.textContent, before: scripts.indexOf(el) < scripts.findIndex((s) => s.type === "module") };
  });
  expect(info.type).toBe("importmap");
  expect(JSON.parse(info.text).imports.demo).toBe("https://esm.sh/lit@3.3.1?target=es2022");
  expect(info.before).toBe(true);
  const imported = runModule(page, `import demo from "demo";\ndone(demo);`);
  if (acceptsLateMaps(browserName)) expect(await imported).toBe("stub:lit");
  else await expect(imported).rejects.toThrow("failed to load");
});

test("late import maps: Chromium and WebKit take one after a module has loaded, Firefox does not", async ({ page, context, browserName }) => {
  await setup(context, page);
  const warnings = [];
  page.on("console", (m) => warnings.push(m.text()));
  await page.evaluate(() => window.mport.injectImportMap({ imports: { demo: "https://esm.sh/lit@3.3.1?target=es2022" } }));
  const accepted = await runModule(page, `import demo from "demo";\ndone(demo);`).then((v) => v === "stub:lit", () => false);
  test.info().annotations.push({ type: "late import map", description: accepted ? "accepted" : "ignored" });
  expect(accepted).toBe(acceptsLateMaps(browserName));
  if (!accepted) expect(warnings.join("\n")).toMatch(/Import maps are not allowed after a module load/);
});

test("startup() resolves and injects the import map; where the engine ignores a late map it says so", async ({ page, context, browserName }) => {
  await setup(context, page);
  const result = await page.evaluate(async () => {
    const { createRouter, esmSh, startup } = window.mport;
    const router = createRouter({ "*": esmSh() }, { probe: "none" });
    try {
      const { importMap, lock } = await startup(router, ["lit@^3", "nanoid@^5", "lit@^3/decorators.js"]);
      return { importMap, lockKeys: Object.keys(lock.packages) };
    } catch (e) {
      return { error: e.message, importMap: e.result?.importMap, lockKeys: Object.keys(e.result?.lock.packages ?? {}) };
    }
  });
  expect(result.importMap.imports.lit).toBe("https://esm.sh/lit@3.3.1?target=es2022");
  expect(result.importMap.imports["lit/decorators.js"]).toBe("https://esm.sh/lit@3.3.1/decorators.js?target=es2022");
  expect(result.lockKeys).toEqual(["lit@^3", "lit@^3/decorators.js", "nanoid@^5"]);
  expect(await page.evaluate(() => !!document.querySelector('script[type="importmap"]'))).toBe(true);
  if (acceptsLateMaps(browserName)) {
    expect(result.error).toBeUndefined();
    expect(await runModule(page, `import lit from "lit";\nimport { nanoid } from "nanoid";\ndone([lit, nanoid(8)]);`)).toEqual(["stub:lit", "stubbed-"]);
  } else {
    expect(result.error).toMatch(/ignored the import map startup\(\) injected.*renderImportMap\(\)/);
  }
});

test("createImporter() fails over when a CDN answers but its module is broken (no import map involved)", async ({ page, context }) => {
  await setup(context, page, { broken: new Set(["esm.sh"]) });
  const out = await page.evaluate(async () => {
    const { createRouter, esmSh, jsDelivr, createImporter } = window.mport;
    const events = [];
    const router = createRouter({ "*": [esmSh(), jsDelivr({ esm: true })] }, { onEvent: (e) => events.push(e) });
    const load = createImporter(router);
    const mod = await load("nanoid@^5");
    return { id: mod.nanoid(6), failed: events.filter((e) => e.type === "fail" && e.phase === "import").map((e) => e.provider), ok: events.filter((e) => e.type === "ok").map((e) => e.provider) };
  });
  expect(out.id).toBe("stubbe");
  expect(out.failed).toEqual(["esm.sh"]);
  expect(out.ok).toContain("jsdelivr-esm");
});

test("injectModulePreload() adds modulepreload links with integrity, and the engine fetches them", async ({ page, context }) => {
  const { requests } = await setup(context, page);
  const links = await page.evaluate(() => {
    const url = "https://esm.sh/lit@3.3.1?target=es2022";
    const els = window.mport.injectModulePreload({ imports: { lit: url, "lit/": "https://esm.sh/lit@3.3.1/" }, integrity: { [url]: "sha384-AAAA" } });
    return els.map((l) => ({ rel: l.rel, href: l.href, integrity: l.getAttribute("integrity"), crossorigin: l.getAttribute("crossorigin"), inHead: l.parentNode === document.head }));
  });
  expect(links).toEqual([{ rel: "modulepreload", href: "https://esm.sh/lit@3.3.1?target=es2022", integrity: "sha384-AAAA", crossorigin: "anonymous", inHead: true }]);
  // (the bogus hash may make the engine drop the response, but it must have asked)
  await expect.poll(() => requests.some((r) => r.url === "https://esm.sh/lit@3.3.1?target=es2022")).toBe(true);
});

// ---- server-rendered pages: the import map is in the HTML before any module runs, so every
// ---- engine honours it. The map is built in Node with the same stub network.

const page = (map, script, { preload = false } = {}) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>generated</title>${renderImportMap(map)}${preload ? renderModulePreload(map) : ""}</head>` +
  `<body><script type="module">${script}</script></body></html>`;
const result = (p) => p.waitForFunction(() => "__result" in window).then(() => p.evaluate(() => window.__result));

test("server-rendered map with conflicts: 'scope': each package resolves its own version in a real engine", async ({ page: p, context }) => {
  const router = createRouter({ "*": jsDelivr() }, { probe: "none", fetch: stubFetch() });
  const { importMap, conflicts } = await router.build(["vendor-core@2.0.0", "vendor-core@1.0.0", "vendor-ui@1.0.0"], { conflicts: "scope" });
  expect(importMap.scopes).toEqual({ "https://cdn.jsdelivr.net/npm/vendor-ui@1.0.0/": { "vendor-core": "https://cdn.jsdelivr.net/npm/vendor-core@1.0.0/index.js" } });
  expect(conflicts[0].scoped[0].dependent).toBe("vendor-ui@1.0.0");
  await installStubs(context);
  await installPages(context, { scopes: page(importMap, `
    import core from "vendor-core";
    import ui from "vendor-ui";
    window.__result = [core, ui];`) });
  await p.goto("/__gen/scopes.html");
  // the page's own code sees core 2; vendor-ui's file, under its scope, sees core 1
  expect(await result(p)).toEqual(["core-2.0.0", "ui+core-1.0.0"]);
});

// A two-file graph on esm.sh's pattern: a stub entry that re-exports from an absolute path.
const ENTRY = "https://esm.sh/lit@3.3.1?target=es2022";
const DEEP = "https://esm.sh/lit@3.3.1/es2022/lit.mjs";
const graphBytes = (deep) => (url) => (url.href === ENTRY ? 'export { default } from "/lit@3.3.1/es2022/lit.mjs";' : url.href === DEEP ? deep : undefined);
const buildGraph = async () => {
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: stubFetch({ tamper: graphBytes('export default "deep:lit";') }) });
  return router.build(["lit@^3"], { graph: true });
};

test("graph: the whole import graph is hashed into the map and every engine loads it", async ({ page: p, context }) => {
  const { importMap, graph } = await buildGraph();
  expect(Object.keys(importMap.integrity).sort()).toEqual([DEEP, ENTRY]);
  expect(graph.files).toBe(2);
  await installPages(context, { graph: page(importMap, `
    const m = await import("lit");
    window.__result = m.default;`, { preload: true }) });
  const { requests } = await installStubs(context, { tamper: graphBytes('export default "deep:lit";') });
  await p.goto("/__gen/graph.html");
  expect(await result(p)).toBe("deep:lit"); // every engine accepts matching hashes
  expect(requests.some((r) => r.url === ENTRY)).toBe(true);
});

test("graph: a file that changes after hashing is refused by engines that enforce import-map integrity", async ({ page: p, context }) => {
  const { importMap } = await buildGraph();
  // an unrelated module with a wrong hash tells us whether this engine enforces integrity at all
  importMap.imports.control = "https://esm.sh/nanoid@5.1.5?target=es2022";
  importMap.integrity["https://esm.sh/nanoid@5.1.5?target=es2022"] = "sha384-" + "A".repeat(64);
  // the CDN now serves different bytes for the deep file (a compromised or changed mirror)
  await installStubs(context, { tamper: graphBytes('export default "evil";') });
  await installPages(context, { tamper: page(importMap, `
    const r = {};
    try { await import("control"); r.control = "loaded"; } catch { r.control = "refused"; }
    try { r.lit = "loaded:" + (await import("lit")).default; } catch { r.lit = "refused"; }
    window.__result = r;`) });
  await p.goto("/__gen/tamper.html");
  const r = await result(p);
  const enforces = r.control === "refused";
  test.info().annotations.push({ type: "import-map integrity", description: enforces ? "enforced by this engine" : "ignored by this engine" });
  expect(r.lit).toBe(enforces ? "refused" : "loaded:evil");
});
