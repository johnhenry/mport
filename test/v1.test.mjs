import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createV1 } from "../src/v1.mjs";
import { importerFor } from "../src/v1-importer.mjs";

// importer that serves some URLs and fails others, with optional latency
function fakeImporter({ serve = () => true, delay = () => 0 } = {}) {
  const calls = [];
  const importer = async (url, options) => {
    calls.push({ url, options });
    await new Promise((r) => setTimeout(r, delay(url)));
    if (!serve(url)) throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
    return { default: url };
  };
  importer.calls = calls;
  return importer;
}
const jsonFrom = (pkgs) => async (url) => {
  const hit = Object.entries(pkgs).find(([k]) => url.startsWith(k));
  if (!hit) throw new Error(`404 ${url}`);
  return { default: hit[1] };
};

test("mport(string) races the default origins and MPortURL returns [module, url, info]", async () => {
  const importer = fakeImporter({ delay: (u) => (u.includes("unpkg") ? 1 : 20) });
  const { MPortURL } = createV1({ importer, jsonImporter: jsonFrom({}) });
  const [mod, url, info] = await MPortURL()("lodash-es@4.17.21/lodash.js");
  assert.equal(url, "https://unpkg.com/lodash-es@4.17.21/lodash.js");
  assert.equal(mod.default, url);
  assert.equal(info.provider, "unpkg.com/");
  assert.ok(Array.isArray(info.trace));
  assert.deepEqual(importer.calls.map((c) => c.url).sort(), [
    "https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/lodash.js",
    "https://ga.jspm.io/npm:lodash-es@4.17.21/lodash.js",
    "https://unpkg.com/lodash-es@4.17.21/lodash.js",
  ]);
});

test("a fast failure no longer rejects the race (v1 used Promise.race)", async () => {
  const importer = fakeImporter({ serve: (u) => !u.includes("jsdelivr"), delay: (u) => (u.includes("jsdelivr") ? 0 : 10) });
  const { mport } = createV1({ importer, jsonImporter: jsonFrom({}) });
  const mod = await mport("lodash-es@4.17.21/lodash.js");
  assert.match(mod.default, /jspm|unpkg/);
});

test("scoped packages in string form (v1 split on the first @)", async () => {
  const importer = fakeImporter({ serve: (u) => u.includes("jsdelivr") });
  const { MPortURL } = createV1({ importer, jsonImporter: jsonFrom({}) });
  const [, url] = await MPortURL()("@scope/pkg@1.2.3/dist/x.js");
  assert.equal(url, "https://cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/dist/x.js");
});

test("object form, custom cdns, versionMarker/defaultVersion and varargs origins", async () => {
  const importer = fakeImporter();
  const { MPortURL, MPort } = createV1({ importer, jsonImporter: jsonFrom({}) });
  const [, url] = await MPortURL({ cdns: [{ path: "cdn.example/", versionMarker: "/v/", defaultVersion: "9" }] })({ name: "spintax", path: "src/index.mjs" });
  assert.equal(url, "https://cdn.example/spintax/v/latest/src/index.mjs", "v1 object form defaults version to latest");
  const [, url2] = await MPortURL("a.cdn/")("x@1/y.js");
  assert.equal(url2, "https://a.cdn/x@1/y.js", "varargs origins are honoured (v1 ignored them)");
  const mod = await MPort({ cdns: ["b.cdn/"] })("x@1/y.js");
  assert.equal(mod.default, "https://b.cdn/x@1/y.js");
});

test("import options are forwarded to import()", async () => {
  const importer = fakeImporter({ serve: (u) => u.includes("unpkg") });
  const { MPortURL } = createV1({ importer, jsonImporter: jsonFrom({}) });
  await MPortURL()("x@1/y.json", { with: { type: "json" } });
  assert.ok(importer.calls.every((c) => c.options?.with?.type === "json"));
});

test("the standard entry maps import options onto literal attributes (#5)", async () => {
  const data = "data:application/json,%7B%22a%22%3A1%7D";
  assert.deepEqual((await importerFor({ with: { type: "json" } })(data)).default, { a: 1 });
  for (const none of [undefined, {}, { with: {} }, { with: undefined }]) {
    assert.strictEqual(importerFor(none), importerFor(undefined), `${JSON.stringify(none)} means no attributes`);
  }
  // Node has no CSS modules; the rejection shows the attribute reached import()
  await assert.rejects(importerFor({ with: { type: "css" } })("data:text/css,a{}"), /css/);
  for (const bad of [{ with: { type: "text" } }, { with: { type: "json", mode: "x" } }, { with: { type: 1 } }, { with: "json" }, null, "json"]) {
    assert.throws(() => importerFor(bad), TypeError, JSON.stringify(bad));
  }
});

test("unsupported import attributes reject before anything is imported", async () => {
  const importer = fakeImporter();
  const jsonImporter = async () => assert.fail("no package.json is read");
  const { MPortURL } = createV1({ importerFor: (o) => (importerFor(o), importer), jsonImporter });
  await assert.rejects(MPortURL()("x@1/y.txt", { with: { type: "text" } }), (e) => e instanceof TypeError && /unsupported import attributes/.test(e.message));
  await assert.rejects(MPortURL()("x@1", { with: { type: "text" } }), TypeError);
  assert.equal(importer.calls.length, 0);
  await MPortURL()("x@1/y.json", { with: { type: "json" } });
  assert.ok(importer.calls.length > 0, "supported attributes still load");
});

test("path-less specifiers load package.json and import its ESM entry", async () => {
  const importer = fakeImporter();
  const jsonImporter = jsonFrom({ "https://unpkg.com/lodash-es@4.17.21/package.json": { main: "lodash.js", module: "./lodash.mjs" } });
  const { MPortURL } = createV1({ importer, jsonImporter });
  const [, url, info] = await MPortURL()("lodash-es@4.17.21");
  assert.equal(url, "https://unpkg.com/lodash-es@4.17.21/lodash.mjs");
  assert.equal(info.entry, "lodash.mjs");
});

test("useCache: 'localhost' stores and reuses the winning URL (v1 never matched)", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const importer = fakeImporter({ serve: (u) => u.includes("jspm") });
    const { MPortURL } = createV1({ importer, jsonImporter: jsonFrom({}) });
    const m = MPortURL({ useCache: "localhost" });
    await m("x@1/y.js");
    const before = importer.calls.length;
    const [, url, info] = await m("x@1/y.js");
    assert.equal(url, "https://ga.jspm.io/npm:x@1/y.js");
    assert.equal(info.cached, true);
    assert.equal(importer.calls.length, before + 1, "one direct import, no race");
    assert.deepEqual(JSON.parse(store.get("mport-cache")), { "x@1/y.js": url });
  } finally {
    delete globalThis.localStorage;
  }
});

test("firefox entry point contains no two-argument import()", async () => {
  const seen = new Set();
  const visit = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(new URL(file, import.meta.url), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /(?<![.\w$])import\s*\([^()]*,/, `${file} uses two-argument import()`);
    for (const [, dep] of code.matchAll(/from\s+"(\.\/[^"]+)"/g)) await visit(new URL(dep, new URL(file, import.meta.url)).href);
  };
  await visit("../src/firefox.mjs");
  assert.ok(seen.size > 5);
});
