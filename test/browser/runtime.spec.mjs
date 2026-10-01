// The browser runtime on all three engines: injectImportMap, startup, createImporter,
// injectModulePreload, and what a real engine does with the import maps mport builds
// (scopes, integrity). Every CDN and registry request is answered by the stubs.
import { test, expect } from "@playwright/test";
import { installStubs } from "./stubs.mjs";

const FIXTURE = "/test/browser/fixtures/blank.html";

// every test gets its own stub CDN; pass `state` to change its behaviour (see stubs.mjs)
const setup = async (context, page, state) => {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const stubs = await installStubs(context, state);
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.ready === true);
  return stubs;
};

// Run module code in the page (so it sees the import map installed so far) and return what it
// passes to `done(value)`. A module that fails to load, or throws, rejects with the reason.
const runModule = (page, code) =>
  page.evaluate((code) => new Promise((resolve, reject) => {
    window.__done = resolve;
    const s = document.createElement("script");
    s.type = "module";
    s.onerror = () => reject(new Error("module script failed to load"));
    // static imports must stay at the top level of the module
    const imports = code.split("\n").filter((l) => /^import /.test(l)).join("\n");
    s.textContent = `${imports}\nconst done = (v) => window.__done(v);\ntry { ${code.replace(/^import .*$/gm, "")} } catch (e) { done({ error: String(e) }); }`;
    window.addEventListener("error", (e) => e.filename === "" || reject(new Error(e.message)), { once: true });
    document.body.append(s);
  }), code);

test("injectImportMap puts a standard import map ahead of the module scripts and the engine honours it", async ({ page, context }) => {
  await setup(context, page);
  const info = await page.evaluate(() => {
    const el = window.mport.injectImportMap({ imports: { demo: "https://esm.sh/lit@3.3.1?target=es2022" } });
    const scripts = [...document.scripts];
    return { type: el.type, text: el.textContent, before: scripts.indexOf(el) < scripts.findIndex((s) => s.type === "module") };
  });
  expect(info.type).toBe("importmap");
  expect(JSON.parse(info.text).imports.demo).toBe("https://esm.sh/lit@3.3.1?target=es2022");
  expect(info.before).toBe(true);
  expect(await runModule(page, `import demo from "demo";\ndone(demo);`)).toBe("stub:lit");
});

test("startup() resolves, injects the import map, and native bare imports then work", async ({ page, context }) => {
  await setup(context, page);
  const result = await page.evaluate(async () => {
    const { createRouter, esmSh, startup } = window.mport;
    const router = createRouter({ "*": esmSh() }, { probe: "none" });
    const { importMap, lock } = await startup(router, ["lit@^3", "nanoid@^5", "lit@^3/decorators.js"]);
    return { imports: importMap.imports, lockKeys: Object.keys(lock.packages), injected: !!document.querySelector('script[type="importmap"]') };
  });
  expect(result.injected).toBe(true);
  expect(result.imports.lit).toBe("https://esm.sh/lit@3.3.1?target=es2022");
  expect(result.imports["lit/decorators.js"]).toBe("https://esm.sh/lit@3.3.1/decorators.js?target=es2022");
  expect(result.lockKeys).toEqual(["lit@^3", "lit@^3/decorators.js", "nanoid@^5"]);
  expect(await runModule(page, `import lit from "lit";\nimport { nanoid } from "nanoid";\ndone([lit, nanoid(8)]);`)).toEqual(["stub:lit", "stubbed-"]);
});

test("createImporter() fails over when a CDN answers but its module is broken", async ({ page, context }) => {
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

test("conflicts: 'scope' makes each package resolve its own version in a real engine", async ({ page, context }) => {
  await setup(context, page);
  const map = await page.evaluate(async () => {
    const { createRouter, jsDelivr } = window.mport;
    const router = createRouter({ "*": jsDelivr() }, { probe: "none" });
    const { importMap, conflicts } = await router.build(["vendor-core@2.0.0", "vendor-core@1.0.0", "vendor-ui@1.0.0"], { conflicts: "scope" });
    window.mport.injectImportMap(importMap);
    return { importMap, conflicts };
  });
  expect(map.importMap.scopes).toEqual({ "https://cdn.jsdelivr.net/npm/vendor-ui@1.0.0/": { "vendor-core": "https://cdn.jsdelivr.net/npm/vendor-core@1.0.0/index.js" } });
  expect(map.conflicts[0].scoped[0].dependent).toBe("vendor-ui@1.0.0");
  // the page's own code sees core 2; vendor-ui's file, under its scope, sees core 1
  expect(await runModule(page, `import core from "vendor-core";\nimport ui from "vendor-ui";\ndone([core, ui]);`)).toEqual(["core-2.0.0", "ui+core-1.0.0"]);
});

// A two-file graph on esm.sh's pattern: a stub entry that re-exports from an absolute path.
const ENTRY = "https://esm.sh/lit@3.3.1?target=es2022";
const DEEP = "https://esm.sh/lit@3.3.1/es2022/lit.mjs";
const graphBytes = (deep) => (url) => {
  const u = url.href;
  if (u === ENTRY) return 'export { default } from "/lit@3.3.1/es2022/lit.mjs";';
  if (u === DEEP) return deep;
  return undefined;
};

test("graph: the whole import graph is hashed into the map and the engine loads it", async ({ page, context }) => {
  await setup(context, page, { tamper: graphBytes('export default "deep:lit";') });
  const { integrity } = await page.evaluate(async () => {
    const { createRouter, esmSh } = window.mport;
    const router = createRouter({ "*": esmSh() }, { probe: "none" });
    const { importMap, graph } = await router.build(["lit@^3"], { graph: true });
    window.mport.injectImportMap(importMap);
    return { integrity: importMap.integrity, files: graph.files };
  });
  expect(Object.keys(integrity).sort()).toEqual([DEEP, ENTRY]);
  expect(Object.values(integrity).every((h) => h.startsWith("sha384-"))).toBe(true);
  expect(await runModule(page, `import lit from "lit";\ndone(lit);`)).toBe("deep:lit");
});

test("graph: a file that changes after hashing is refused by engines that enforce import-map integrity", async ({ page, context }) => {
  const state = { tamper: graphBytes('export default "deep:lit";') };
  await setup(context, page, state);
  await page.evaluate(async () => {
    const { createRouter, esmSh } = window.mport;
    const router = createRouter({ "*": esmSh() }, { probe: "none" });
    const { importMap } = await router.build(["lit@^3"], { graph: true });
    // an unrelated module with a wrong hash tells us whether this engine enforces integrity at all
    importMap.imports.control = "https://esm.sh/nanoid@5.1.5?target=es2022";
    importMap.integrity["https://esm.sh/nanoid@5.1.5?target=es2022"] = "sha384-" + "A".repeat(64);
    window.mport.injectImportMap(importMap);
  });
  // the bytes behind the deep file change after the build (a compromised CDN)
  state.tamper = graphBytes('export default "evil";');
  const control = await runModule(page, `import c from "control";\ndone(c);`).then((v) => ({ loaded: v }), () => ({ refused: true }));
  const enforces = control.refused === true;
  const lit = await runModule(page, `import lit from "lit";\ndone(lit);`).then((v) => ({ loaded: v }), () => ({ refused: true }));
  test.info().annotations.push({ type: "import-map integrity", description: enforces ? "enforced by this engine" : "ignored by this engine" });
  if (enforces) expect(lit).toEqual({ refused: true });
  else expect(lit).toEqual({ loaded: "evil" });
});
