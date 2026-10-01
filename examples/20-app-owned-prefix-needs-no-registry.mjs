// Your own code can be routed like a package: `components/button.js` maps to /components/button.js
// on your origin. custom("/components/{path}") has no {version} and no {entry}, so it needs no
// registry lookup at all, and `build: "app"` keeps it apart from CDN mirrors in the lockfile.
import assert from "node:assert/strict";
import { createRouter, custom, esmSh } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

const fetch = offlineFetch(registry);
const router = createRouter(
  { "components/*": custom("/components/{path}", { name: "app", build: "app" }), "*": esmSh() },
  { fetch, probe: "none" },
);
const { importMap, lock } = await router.build(["components/button.js", "components/", "react@^19"]);

assert.deepEqual(importMap.imports, {
  "components/button.js": "/components/button.js",
  "components/": "/components/",
  "react": "https://esm.sh/react@19.2.0?target=es2022",
});
// only react was looked up: nothing asked a registry about "components"
assert.deepEqual(fetch.log.map((l) => l.url), ["https://registry.npmjs.org/react"]);
assert.equal(lock.packages["components/button.js"].build, "app");

console.log("20 ok:", JSON.stringify(importMap.imports));
