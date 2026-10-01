// router.build() resolves a list of specifiers and compiles a standard import map
// (exact, prefix and scoped entries) plus a lockfile. A specifier it can't route is
// a ResolutionError, not a silently missing entry.
import assert from "node:assert/strict";
import { createRouter, esmSh, jsDelivr, jsr, mergeImportMaps } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

const router = createRouter(
  { "*": esmSh(), "lit*": [jsDelivr(), esmSh()], "@std/*": jsr() },
  { fetch: offlineFetch(registry), probe: "none" },
);
const { importMap, lock } = await router.build(
  ["react@^19", "react@^19/jsx-runtime", "lit/", "npm:preact@10", "@std/path@^1"],
  { scopes: { "https://legacy.example.com/": { react: "react@18.3.1" } } },
);
assert.deepEqual(importMap, {
  imports: {
    "react": "https://esm.sh/react@19.2.0?target=es2022",
    "react/jsx-runtime": "https://esm.sh/react@19.2.0/jsx-runtime?target=es2022",
    // lit has an exports map, so raw jsDelivr skips the "lit/" directory mapping (its subpaths would 404)
    "lit/": "https://esm.sh/lit@3.3.1/",
    "npm:preact": "https://esm.sh/preact@10.29.8?target=es2022",
    "@std/path": "https://esm.sh/jsr/@std/path@1.1.0?target=es2022",
  },
  scopes: { "https://legacy.example.com/": { react: "https://esm.sh/react@18.3.1?target=es2022" } },
});
// Lockfile keys are the specifiers as written (prefix only if you wrote one, no
// trailing "/"); `registry` says which registry actually served each one.
assert.deepEqual(Object.keys(lock.packages), [
  "@std/path@^1", "lit", "npm:preact@10", "react@18.3.1", "react@^19", "react@^19/jsx-runtime",
]);
assert.equal(lock.packages["@std/path@^1"].registry, "jsr");

await assert.rejects(router.build(["./app.js"]), (e) => e.name === "ResolutionError" && /no route/.test(e.message));

// Later maps win when merging.
assert.deepEqual(mergeImportMaps(importMap, { imports: { react: "/vendor/react.js" } }).imports.react, "/vendor/react.js");

console.log("09 ok:", JSON.stringify(importMap.imports));
