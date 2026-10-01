// Two specifiers that want one import-map key at different URLs used to be an error.
// `conflicts: "scope"` keeps the first listed version in `imports` and scopes the other
// to the packages whose registry manifests depend on it (a scope is a URL prefix of the
// importing module, so lib-a's own files see react 18 while everything else sees 19).
import assert from "node:assert/strict";
import { createRouter, jsDelivr } from "@johnhenry/mport";
import { offlineFetch, registry, NPM } from "./_offline.mjs";

const table = {
  ...registry,
  [`${NPM}/react/18.3.1`]: { name: "react", version: "18.3.1", type: "module", main: "index.js" },
  [`${NPM}/react/19.2.0`]: { name: "react", version: "19.2.0", type: "module", main: "index.js" },
  [`${NPM}/lib-a`]: { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
  [`${NPM}/lib-a/1.0.0`]: { name: "lib-a", version: "1.0.0", type: "module", main: "index.js", dependencies: { react: "^18.2.0" } },
};
const make = () => createRouter({ "*": jsDelivr() }, { fetch: offlineFetch(table), probe: "none" });
const specifiers = ["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"];

// Default: an error that points at the fix.
await assert.rejects(make().build(specifiers), (e) => e.name === "ResolutionError" && /conflicting resolutions for "react"/.test(e.message));

const { importMap, conflicts } = await make().build(specifiers, { conflicts: "scope" });
assert.equal(importMap.imports.react, "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js");
assert.deepEqual(importMap.scopes, {
  "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/": { react: "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js" },
});
assert.equal(conflicts[0].scoped[0].dependent, "lib-a@1.0.0");
assert.deepEqual(conflicts[0].unscoped, [], "every version is reachable from somewhere");

// A version nothing depends on is reported, not silently dropped.
const orphan = await make().build(["react@19.2.0", "react@18.3.1"], { conflicts: "scope" });
assert.equal(orphan.importMap.scopes, undefined);
assert.deepEqual(orphan.conflicts[0].unscoped.map((u) => u.specifier), ["react@18.3.1"]);

console.log("13 ok:", JSON.stringify(importMap.scopes));
