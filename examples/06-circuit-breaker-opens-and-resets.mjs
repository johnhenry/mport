// After `failures` consecutive failures a provider's circuit opens and it is skipped
// without a request until `reset` has passed. After that one more failure reopens it
// at once; a success closes it.
import assert from "node:assert/strict";
import { createRouter, esmSh, unpkg, HealthRegistry } from "@johnhenry/mport";
import { offlineFetch, registry, allUp } from "./_offline.mjs";

let t = 0;
const now = () => t;
const log = [];
const fetch = offlineFetch({ ...registry, ...allUp, "https://esm.sh/*": 500 }, { log });
const router = createRouter({ "*": [esmSh(), unpkg()] }, { fetch, now, circuitBreaker: { failures: 2, reset: "30s" } });

await router.resolve("lit@3.3.1");
await router.resolve("preact@10.29.8");
assert.equal(router.health.isOpen("esm.sh"), true);

const before = log.filter((l) => l.url.startsWith("https://esm.sh")).length;
const r = await router.resolve("lit@3.3.1");
assert.equal(r.trace[0].reason, "circuit open");
assert.equal(log.filter((l) => l.url.startsWith("https://esm.sh")).length, before, "no request while open");

t += 30_001;
assert.equal(router.health.isOpen("esm.sh"), false, "closed again after reset");
const snap = router.health.snapshot()["esm.sh"];
assert.equal(snap.streak, 2, "the streak survives the reset, so the next failure reopens it immediately");

// A second router can share the same health (and open circuits).
const other = createRouter({ "*": [esmSh(), unpkg()] }, { fetch, health: router.health });
assert.equal(other.health, router.health);

// The registry on its own:
const h = new HealthRegistry({ failures: 1, reset: 1000, now });
h.failure("x");
assert.equal(h.isOpen("x"), true);
h.success("x", 40);
assert.deepEqual(h.snapshot().x, { ok: 1, fail: 1, streak: 0, latency: 40, openUntil: 0, healthy: true });

console.log("06 ok: esm.sh circuit opened after 2 failures and closed after 30s");
