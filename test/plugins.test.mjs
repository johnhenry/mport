// Real builds: Rollup and Vite run in Node against a temp project; only the router's
// registry/CDN traffic is the fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { rollup } from "rollup";
import { build as viteBuild } from "vite";
import { createRouter, esmSh, jsr } from "../src/core.mjs";
import mportRollup, { mportRollup as namedRollup } from "../src/rollup.mjs";
import mportVite, { mportVite as namedVite } from "../src/vite.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const router = (o = {}) => createRouter({ "*": esmSh(), "@std/*": jsr() }, { probe: "none", fetch: fakeFetch(registryFixtures), ...o });
const REACT = "https://esm.sh/react@19.2.0?target=es2022";
const JSX = "https://esm.sh/react@19.2.0/jsx-runtime?target=es2022";

const project = async (files) => {
  const dir = await mkdtemp(join(tmpdir(), "mport-plugin-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
};
const MAIN = `import React from "react";
import { jsx } from "react/jsx-runtime";
import fs from "node:fs";
import { helper } from "./helper.js";
export default [React, jsx, helper, fs];
`;

const bundle = async (plugin, dir, { onwarn } = {}) => {
  const b = await rollup({ input: join(dir, "main.js"), plugins: [plugin], onwarn: onwarn ?? (() => {}), external: ["node:fs"] });
  return (await b.generate({ format: "es" })).output;
};

test("both entry points export the plugin by name and as default", () => {
  assert.equal(mportRollup, namedRollup);
  assert.equal(mportVite, namedVite);
  assert.throws(() => mportRollup({}), /need a router/);
  assert.throws(() => mportRollup(router(), { mode: "inline" }), /mode must be "external" or "importmap"/);
});

test("rollup: bare imports become CDN URLs; relative, node: and bundled code are untouched", async () => {
  const dir = await project({ "main.js": MAIN, "helper.js": "export const helper = 1;" });
  const [chunk] = await bundle(mportRollup(router(), { versions: { react: "^19" } }), dir);
  assert.match(chunk.code, new RegExp(`from ['"]${REACT.replace(/[?.]/g, "\\$&")}['"]`));
  assert.match(chunk.code, new RegExp(`from ['"]${JSX.replace(/[?.]/g, "\\$&")}['"]`));
  assert.match(chunk.code, /from ['"]node:fs['"]/);
  assert.match(chunk.code, /const helper = 1/, "the local module was bundled");
  assert.deepEqual([...chunk.imports].sort(), [JSX, "node:fs", REACT].sort());
});

test("rollup: ranges come from package.json when asked, explicit versions win", async () => {
  const dir = await project({
    "main.js": MAIN, "helper.js": "export const helper = 1;",
    "package.json": JSON.stringify({ dependencies: { react: "18.3.1", local: "workspace:*" } }),
  });
  const [a] = await bundle(mportRollup(router(), { packageJson: join(dir, "package.json") }), dir);
  assert.ok(a.imports.includes("https://esm.sh/react@18.3.1?target=es2022"));
  const [b] = await bundle(mportRollup(router(), { packageJson: join(dir, "package.json"), versions: { react: "19.2.0" } }), dir);
  assert.ok(b.imports.includes(REACT));
});

test("rollup: importmap mode keeps bare imports and emits importmap.json", async () => {
  const dir = await project({ "main.js": MAIN, "helper.js": "export const helper = 1;" });
  const out = await bundle(mportRollup(router(), { mode: "importmap", versions: { react: "^19" }, specifiers: ["lit@3.3.1"] }), dir);
  const [chunk, asset] = [out.find((o) => o.type === "chunk"), out.find((o) => o.fileName === "importmap.json")];
  assert.deepEqual([...chunk.imports].sort(), ["node:fs", "react", "react/jsx-runtime"]);
  const map = JSON.parse(asset.source);
  assert.deepEqual(map.imports, { lit: "https://esm.sh/lit@3.3.1?target=es2022", react: REACT, "react/jsx-runtime": JSX });
});

test("rollup: exclude and unrouted specifiers are left to Rollup", async () => {
  const dir = await project({ "main.js": MAIN, "helper.js": "export const helper = 1;" });
  const warnings = [];
  const [chunk] = await bundle(mportRollup(router(), { versions: { react: "^19" }, exclude: ["react/jsx-runtime"] }), dir, { onwarn: (w) => warnings.push(w.code) });
  assert.deepEqual([...chunk.imports].sort(), [REACT, "node:fs", "react/jsx-runtime"].sort());
  // a router with no route for react matches nothing
  const none = await bundle(mportRollup(createRouter({ "@std/*": jsr() }, { probe: "none", fetch: fakeFetch(registryFixtures) })), dir, { onwarn: (w) => warnings.push(w.code) });
  assert.ok(none[0].imports.includes("react"));
  assert.ok(warnings.includes("UNRESOLVED_IMPORT"));
});

const viteRun = async (dir, plugin) => {
  const result = await viteBuild({ root: dir, configFile: false, logLevel: "silent", plugins: [plugin], build: { write: false, minify: false } });
  const out = (Array.isArray(result) ? result[0] : result).output;
  return { js: out.find((o) => o.type === "chunk" && o.isEntry), html: out.find((o) => o.fileName === "index.html")?.source.toString(), out };
};
const page = (extra = {}) => project({
  "index.html": `<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>`,
  "main.js": `import React from "react";\nimport { jsx } from "react/jsx-runtime";\nimport { helper } from "./helper.js";\nconsole.log(React, jsx, helper);\n`,
  "helper.js": "export const helper = 1;",
  ...extra,
});

test("vite: a production build imports the CDN URLs", async () => {
  const dir = await page();
  const { js } = await viteRun(dir, mportVite(router(), { versions: { react: "^19" } }));
  assert.ok(js.code.includes(REACT), js.code);
  assert.ok(js.code.includes(JSX));
  assert.ok(!js.code.includes("helper.js"), "local code is bundled, not imported");
});

test("vite: importmap mode injects the import map before the module script", async () => {
  const dir = await page({ "package.json": JSON.stringify({ dependencies: { react: "^19" } }) });
  const { js, html } = await viteRun(dir, mportVite(router(), { mode: "importmap", packageJson: true }));
  assert.match(js.code, /from\s*["']react["']/);
  const m = /<script type="importmap">([^<]*)<\/script>/.exec(html);
  assert.ok(m, html);
  assert.deepEqual(JSON.parse(m[1]).imports, { react: REACT, "react/jsx-runtime": JSX });
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), "the import map precedes the first module script");
});

test("vite: build conflicts/graph options reach build() in importmap mode", async () => {
  const dir = await page();
  const files = { [REACT]: 'export * from "/react@19.2.0/es2022/react.mjs";', "https://esm.sh/react@19.2.0/es2022/react.mjs": "export default 1", [JSX]: "export const jsx = 1" };
  const r = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch({ ...registryFixtures, ...files }) });
  const { html } = await viteRun(dir, mportVite(r, { mode: "importmap", versions: { react: "^19" }, build: { graph: true } }));
  const map = JSON.parse(/<script type="importmap">([^<]*)<\/script>/.exec(html)[1]);
  assert.deepEqual(Object.keys(map.integrity).sort(), [REACT, "https://esm.sh/react@19.2.0/es2022/react.mjs", JSX].sort());
});

test("vite: the dev server is left alone by default; dev + importmap is refused", () => {
  const plugin = mportVite(router());
  assert.equal(plugin.apply({}, { command: "serve" }), false);
  assert.equal(plugin.apply({}, { command: "build" }), true);
  assert.equal(mportVite(router(), { dev: true }).apply({}, { command: "serve" }), true);
  assert.throws(() => mportVite(router(), { dev: true, mode: "importmap" }), /mode "external" only/);
  assert.equal(plugin.resolveId("react", undefined, { ssr: true }), null, "SSR builds are not rewritten to URLs");
});

test("vite: api.importMapHash() is the CSP hash of the exact script text Vite wrote into index.html", async () => {
  const dir = await page({ "package.json": JSON.stringify({ dependencies: { react: "^19" } }) });
  const plugin = mportVite(router(), { mode: "importmap", packageJson: true });
  const { html } = await viteRun(dir, plugin);
  const body = /<script type="importmap">([^<]*)<\/script>/.exec(html)[1];
  const expected = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
  assert.equal(await plugin.api.importMapHash(), expected);
  assert.match(await plugin.api.importMapHash({ algorithm: "sha384" }), /^'sha384-/);
});
