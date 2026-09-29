// Raw file CDNs (jsDelivr, unpkg, jspm, local) serve files as published, and a browser
// can't import CommonJS. React's entry is CommonJS, so those providers are skipped with
// a reason and the route falls through to an ESM-transforming CDN. allowCommonJS turns
// the check off. Preact's exports map points at ES modules, so raw CDNs serve it.
import assert from "node:assert/strict";
import { createRouter, jsDelivr, unpkg, esmSh, entryInfo } from "@johnhenry/mport";
import { offlineFetch, registry, show } from "./_offline.mjs";

const fetch = offlineFetch(registry);
const router = createRouter({ "*": [jsDelivr(), unpkg(), esmSh()] }, { fetch, probe: "none" });

const react = await router.resolve("react@^19");
assert.equal(react.provider, "esm.sh");
assert.deepEqual(react.trace.filter((e) => e.type === "skip").map((e) => e.provider), ["jsdelivr", "unpkg"]);
assert.match(react.trace.find((e) => e.type === "skip").reason, /index\.js is CommonJS/);

const preact = await router.resolve("preact@^10/hooks");
assert.equal(preact.url, "https://cdn.jsdelivr.net/npm/preact@10.29.8/hooks/dist/hooks.mjs", "sub-path mapped through exports");

const lenient = createRouter({ "*": jsDelivr() }, { fetch, probe: "none", allowCommonJS: true });
assert.equal((await lenient.resolve("react@^19")).url, "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js");

// The detection rules, as entryInfo() applies them to a package.json:
assert.deepEqual(entryInfo({ main: "index.js" }), { file: "index.js", esm: false });
assert.deepEqual(entryInfo({ type: "module", main: "index.js" }), { file: "index.js", esm: true });
assert.deepEqual(entryInfo({ main: "index.js", module: "dist/x.js" }), { file: "dist/x.js", esm: true });
assert.deepEqual(entryInfo({ exports: { ".": { require: "./a.cjs", import: "./a.js" } } }), { file: "a.js", esm: true });
assert.deepEqual(entryInfo({ main: "dist/lib.esm.js" }), { file: "dist/lib.esm.js", esm: true }, "ESM by naming convention");

console.log("04 ok:", show(react.trace).join(" → "));
