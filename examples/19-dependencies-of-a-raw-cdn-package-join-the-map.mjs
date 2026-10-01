// A raw file CDN (jsDelivr, unpkg) and local() serve a package's files as published, so a
// package that does `import("dompurify")` needs "dompurify" in the import map, and the map holds
// only what build() was asked for. `dependencies: true` reads each package's manifest and adds
// its `dependencies` as routed entries: ranges respected, depth bounded, everything reported.
// esm.sh rewrites a module's imports itself, so it is not expanded.
import assert from "node:assert/strict";
import { createRouter, jsDelivr, esmSh } from "@johnhenry/mport";
import { offlineFetch, NPM } from "./_offline.mjs";

const pkg = (name, version, dependencies = {}) => ({
  [`${NPM}/${name}`]: { "dist-tags": { latest: version }, versions: { [version]: {} } },
  [`${NPM}/${name}/${version}`]: { name, version, type: "module", main: "index.js", dependencies },
});
const table = {
  ...pkg("safe-fragment", "1.0.0", { dompurify: "^3.0.0", "node-only": "file:../node-only" }),
  ...pkg("dompurify", "3.2.0", { "trusted-types": "^2" }),
  ...pkg("trusted-types", "2.0.0"),
};
const make = (provider) => createRouter({ "*": provider }, { fetch: offlineFetch(table), probe: "none" });

// Without it the map has only the entry, and `import("dompurify")` inside safe-fragment fails in the browser.
const bare = await make(jsDelivr()).build(["safe-fragment@1.0.0"]);
assert.deepEqual(Object.keys(bare.importMap.imports), ["safe-fragment"]);

// With it, the dependencies join (transitively, bounded by dependencyDepth), and the result says what happened.
const { importMap, dependencies, lock } = await make(jsDelivr()).build(["safe-fragment@1.0.0"], { dependencies: true });
assert.deepEqual(importMap.imports, {
  "safe-fragment": "https://cdn.jsdelivr.net/npm/safe-fragment@1.0.0/index.js",
  "dompurify": "https://cdn.jsdelivr.net/npm/dompurify@3.2.0/index.js",
  "trusted-types": "https://cdn.jsdelivr.net/npm/trusted-types@2.0.0/index.js",
});
assert.deepEqual(dependencies.added.map((d) => `${d.specifier} <- ${d.from} (depth ${d.depth})`), [
  "dompurify@^3.0.0 <- safe-fragment@1.0.0 (depth 1)",
  "trusted-types@^2 <- dompurify@3.2.0 (depth 2)",
]);
assert.equal(dependencies.skipped[0].name, "node-only", "a file: range is reported, not guessed at");
assert.ok(lock.packages["dompurify@^3.0.0"], "added entries are locked, so a lockfile reproduces the build");

const shallow = await make(jsDelivr()).build(["safe-fragment@1.0.0"], { dependencies: true, dependencyDepth: 1 });
assert.deepEqual(shallow.dependencies.truncated.map((t) => t.name), ["trusted-types"], "what the depth bound cut off is reported");

// esm.sh serves a module with its imports already rewritten to URLs: nothing to add, and it says so.
const esm = await make(esmSh()).build(["safe-fragment@1.0.0"], { dependencies: true });
assert.deepEqual(Object.keys(esm.importMap.imports), ["safe-fragment"]);
assert.equal(esm.dependencies.skipped[0].reason, "rewrites its own imports");

console.log("19 ok:", Object.keys(importMap.imports).join(", "));
