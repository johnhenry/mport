import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, esmSh, jsDelivr, mergeImportMaps, injectImportMap } from "../src/core.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

test("build() compiles exact, prefix and scoped mappings plus a lockfile", async () => {
  const router = createRouter({ "*": esmSh(), "lit*": jsDelivr() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  const { importMap, lock } = await router.build(["react@^19", "lit/", "npm:react@18.3.1"], {
    scopes: { "https://legacy.example.com/": { react: "react@18.3.1" } },
  });
  assert.deepEqual(importMap.imports, {
    "react": "https://esm.sh/react@19.2.0",
    "lit/": "https://cdn.jsdelivr.net/npm/lit@3.3.1/",
    "npm:react": "https://esm.sh/react@18.3.1",
  });
  assert.deepEqual(importMap.scopes, { "https://legacy.example.com/": { react: "https://esm.sh/react@18.3.1" } });
  assert.equal(lock.lockfileVersion, 1);
  assert.equal(lock.packages["npm:react@^19"].version, "19.2.0");
  assert.equal(lock.packages["npm:react@^19"].url, "https://esm.sh/react@19.2.0");
});

test("mergeImportMaps: later maps win", () => {
  const m = mergeImportMaps({ imports: { a: "1", b: "1" } }, { imports: { b: "2" }, scopes: { "/x/": { a: "3" } } });
  assert.deepEqual(m, { imports: { a: "1", b: "2" }, scopes: { "/x/": { a: "3" } } });
});

test("injectImportMap inserts before the first module script", () => {
  const inserted = [];
  const first = { parentNode: { insertBefore: (el, ref) => inserted.push([el, ref]) } };
  const document = {
    createElement: () => ({}),
    querySelector: () => first,
    head: null,
  };
  const el = injectImportMap({ imports: { a: "b" } }, { document });
  assert.equal(el.type, "importmap");
  assert.equal(el.textContent, '{"imports":{"a":"b"}}');
  assert.deepEqual(inserted, [[el, first]]);
});
