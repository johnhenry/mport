// A lockfile pins each specifier's version AND build. Next time the same version comes
// back without asking the registry, and only mirrors of the same build may serve it:
// jsDelivr and unpkg both serve the raw "npm" build, esm.sh and jspm do not.
import assert from "node:assert/strict";
import { createRouter, esmSh, jspm, jsDelivr, unpkg } from "@johnhenry/mport";
import { offlineFetch, registry, allUp, show } from "./_offline.mjs";

// Day 1: jsDelivr is down, unpkg serves lit's raw files. build() records that.
const day1 = createRouter({ "*": [jsDelivr(), unpkg()] }, { fetch: offlineFetch({ ...registry, ...allUp, "https://cdn.jsdelivr.net/*": 503 }) });
const { lock } = await day1.build(["lit@^3"]);
assert.deepEqual(lock.packages["lit@^3"], {
  specifier: "lit@^3", registry: "npm", name: "lit", range: "^3", version: "3.3.1",
  entry: "index.js", build: "npm", provider: "unpkg", url: "https://unpkg.com/lit@3.3.1/index.js",
});

// Day 2: a different route table, everything up, the lockfile passed back in.
const log = [];
const fetch = offlineFetch({ ...registry, ...allUp }, { log });
const day2 = createRouter({ "*": [esmSh(), jspm(), jsDelivr(), unpkg()] }, { fetch, lock });
const r = await day2.resolve("lit@^3");
assert.equal(r.version, "3.3.1");
assert.equal(r.provider, "jsdelivr", "a mirror of the locked build, not the provider that served it last time");
assert.deepEqual(show(r.trace).slice(0, 2), [
  'skip:esm.sh (serves build "esm.sh", locked to "npm")',
  'skip:jspm (serves build "jspm", locked to "npm")',
]);
assert.ok(!log.some((l) => l.url.startsWith("https://registry.npmjs.org")), "version and entry came from the lock");

// relock: true ignores the lockfile for one call.
const fresh = await day2.resolve("lit@^3", { relock: true });
assert.equal(fresh.provider, "esm.sh");

console.log("05 ok:", show(r.trace).join(" → "));
