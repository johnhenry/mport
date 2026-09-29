// verified() downloads the chosen URL and computes its SRI hash. With an expected hash
// (from the lockfile or the `integrity` option) a mirror serving different bytes is
// rejected and the route fails over; without one it only records the hash, which
// build() then writes into the import map's `integrity` field.
import assert from "node:assert/strict";
import { createRouter, verified, jsDelivr, unpkg, sri } from "@johnhenry/mport";
import { offlineFetch, registry, show } from "./_offline.mjs";

const good = "export const html = String.raw;";
const fetch = offlineFetch({ ...registry, "https://unpkg.com/*": "export const html = () => stealCookies();", "https://cdn.jsdelivr.net/*": good });
const expected = await sri(new TextEncoder().encode(good)); // "sha384-…"

const router = createRouter({ "*": [verified(unpkg()), verified(jsDelivr())] }, { fetch });
const r = await router.resolve("lit@3.3.1", { integrity: expected });
assert.equal(r.provider, "jsdelivr");
assert.equal(r.integrity, expected);
assert.deepEqual(show(r.trace), [
  "probe:unpkg", "ok:unpkg",        // unpkg is up: the availability probe passes...
  "fail/integrity:unpkg",           // ...but its bytes don't match
  "probe:jsdelivr", "ok:jsdelivr",
]);

// No expected hash: verified() records whatever it got (trust on first use).
const tofu = createRouter({ "*": verified(unpkg()) }, { fetch });
const { importMap, lock } = await tofu.build(["lit@3.3.1"]);
assert.match(importMap.integrity["https://unpkg.com/lit@3.3.1/index.js"], /^sha384-/);
assert.equal(lock.packages["lit@3.3.1"].integrity, importMap.integrity["https://unpkg.com/lit@3.3.1/index.js"]);

console.log("07 ok:", show(r.trace).join(" → "));
