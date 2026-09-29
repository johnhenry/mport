// race() probes every provider at once. The first SUCCESS wins (a fast failure does
// not sink the race), the slower ones are aborted, and aborted losers are not counted
// as failures in the health registry.
import assert from "node:assert/strict";
import { createRouter, race, esmSh, jsDelivr, unpkg } from "@johnhenry/mport";
import { offlineFetch, registry, allUp, show } from "./_offline.mjs";

const fetch = offlineFetch(
  { ...registry, ...allUp, "https://esm.sh/*": 500 },
  { delays: { "https://cdn.jsdelivr.net/": 5, "https://unpkg.com/": 60 } },
);
const router = createRouter({ "*": race(esmSh(), jsDelivr(), unpkg()) }, { fetch });

const r = await router.resolve("lit@3.3.1");
assert.equal(r.provider, "jsdelivr", "esm.sh failed first, jsDelivr answered next");
await new Promise((res) => setTimeout(res, 20)); // the aborted probe settles after the winner returns
assert.ok(show(r.trace).includes("aborted:unpkg"));
const health = router.health.snapshot();
assert.equal(health["esm.sh"].fail, 1);
assert.equal(health.unpkg, undefined, "an aborted loser has no health entry at all");

// With probe: "import" the probe can't be cancelled; a loser that finishes after the
// race was decided is traced as aborted with reason "lost the race", never as ok.
const importer = (url) => new Promise((res) => setTimeout(() => res({ url }), url.includes("unpkg") ? 5 : 30));
const imports = createRouter({ "*": race(jsDelivr(), unpkg()) }, { probe: "import", importer, fetch: offlineFetch(registry) });
const won = await imports.resolve("lit@3.3.1");
await new Promise((res) => setTimeout(res, 50));
assert.equal(won.provider, "unpkg");
assert.deepEqual(won.module, { url: won.url }, "probe: \"import\" returns the module it imported");
assert.ok(show(won.trace).includes("aborted:jsdelivr (lost the race)"));

console.log("03 ok:", show(r.trace).join(" → "));
