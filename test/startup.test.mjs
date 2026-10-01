import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, esmSh, startup } from "../src/core.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const fakeDocument = () => {
  const added = [];
  return {
    added,
    baseURI: "http://localhost/",
    createElement: () => ({}),
    querySelector: () => null,
    head: { insertBefore: (el) => added.push(el) },
  };
};
const router = () => createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });

test("startup(): builds, injects the map into the document it is given, and returns the build result", async () => {
  const document = fakeDocument();
  const r = await startup(router(), ["react@^19"], { document, conflicts: "scope" });
  assert.equal(r.importMap.imports.react, "https://esm.sh/react@19.2.0?target=es2022");
  assert.equal(document.added.length, 1);
  assert.equal(JSON.parse(document.added[0].textContent).imports.react, r.importMap.imports.react);
  assert.deepEqual(r.conflicts, []);
});

test("startup(): in the real (global) document it rejects, with the result, when the engine ignored the map; otherwise it resolves", async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    // Node's import.meta.resolve knows nothing of the injected map, which is what a browser that
    // ignores a late import map looks like
    await assert.rejects(startup(router(), ["react@^19"]), (e) => {
      assert.match(e.message, /ignored the import map startup\(\) injected/);
      assert.match(e.message, /renderImportMap\(\)/);
      assert.equal(e.result.importMap.imports.react, "https://esm.sh/react@19.2.0?target=es2022");
      assert.deepEqual(Object.keys(e.result.lock.packages), ["react@^19"]);
      return true;
    });
    assert.equal(doc.added.length, 1, "the map was still injected");
    // a map whose first key the engine does resolve to the mapped URL is honoured ("node:fs" maps to itself)
    const honoured = { build: async () => ({ importMap: { imports: { "node:fs": "node:fs" } }, lock: {}, conflicts: [] }) };
    assert.equal((await startup(honoured, [])).importMap.imports["node:fs"], "node:fs");
    // a prefix-only map has nothing to check
    const prefixOnly = { build: async () => ({ importMap: { imports: { "lit/": "https://esm.sh/lit@3/" } }, lock: {}, conflicts: [] }) };
    await startup(prefixOnly, []);
  } finally {
    delete globalThis.document;
  }
});
