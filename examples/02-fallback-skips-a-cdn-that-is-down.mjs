// fallback() (the array shorthand) tries providers in order. A CDN that answers 503
// is a failure; a provider that can't serve the registry is skipped without a request.
import assert from "node:assert/strict";
import { createRouter, esmSh, jsr, jsDelivr, unpkg } from "@johnhenry/mport";
import { offlineFetch, registry, allUp, show } from "./_offline.mjs";

const fetch = offlineFetch({ ...registry, ...allUp, "https://esm.sh/*": 503 });
const router = createRouter({ "*": [esmSh(), jsr(), jsDelivr(), unpkg()] }, { fetch }); // probe: "head" (default)

const lit = await router.resolve("lit@^3");
assert.equal(lit.provider, "jsdelivr");
assert.equal(lit.url, "https://cdn.jsdelivr.net/npm/lit@3.3.1/index.js", "raw CDNs get the entry file from exports");
assert.deepEqual(show(lit.trace), [
  "lookup:npm registry", "resolved:npm registry",
  "probe:esm.sh", "fail:esm.sh",
  "skip:jsr (no npm support)",
  "probe:jsdelivr", "ok:jsdelivr",
]);
assert.equal(router.health.snapshot()["esm.sh"].fail, 1, "the failure is recorded against esm.sh");

// When everything fails, the rejection is a RoutingError with one error per provider
// and the same trace attached.
const down = createRouter({ "*": [esmSh(), unpkg()] }, { fetch: offlineFetch({ ...registry, "https://esm.sh/*": 503, "https://unpkg.com/*": 500 }) });
await assert.rejects(down.resolve("lit@3.3.1"), (e) => e.name === "RoutingError" && e.errors.length === 2 && e.trace.length === 4);

console.log("02 ok:", show(lit.trace).join(" → "));
