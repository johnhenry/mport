import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRouter, esmSh, jsDelivr, unpkg, jspm, local, fallback, race, verified, cache, HealthRegistry,
} from "../src/core.mjs";
import { fakeFetch, registryFixtures, clock, NPM } from "./helpers.mjs";

const ok = (prefix) => ({ [`${prefix}*`]: "export default 1" });

test("1. an import that keeps failing after a passing probe opens the circuit", async () => {
  const importer = async () => { throw new Error("syntax error"); };
  const router = createRouter({ "*": esmSh() }, {
    fetch: fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/") }), importer, circuitBreaker: { failures: 2 },
  });
  await assert.rejects(router.import("react@19.2.0"));
  assert.equal(router.health.isOpen("esm.sh"), false);
  await assert.rejects(router.import("react@19.2.0"));
  assert.equal(router.health.isOpen("esm.sh"), true);
});

test("1. a successful import resets the failure streak", async () => {
  let fail = true;
  const importer = async () => { if (fail) throw new Error("boom"); return { default: 1 }; };
  const router = createRouter({ "*": esmSh() }, {
    fetch: fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/") }), importer, circuitBreaker: { failures: 2 },
  });
  await assert.rejects(router.import("react@19.2.0"));
  fail = false;
  await router.import("react@19.2.0");
  fail = true;
  await assert.rejects(router.import("react@19.2.0"));
  assert.equal(router.health.isOpen("esm.sh"), false, "streak was reset by the good import");
});

test("2. resolveVersions:false skips entry-needing providers instead of asking the registry about a range", async () => {
  const fetch = fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/"), ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter({ "*": [jsDelivr(), unpkg(), esmSh()] }, { fetch, resolveVersions: false });
  const r = await router.resolve("react@^19");
  assert.equal(r.provider, "esm.sh");
  assert.equal(r.url, "https://esm.sh/react@^19");
  const skips = r.trace.filter((e) => e.type === "skip");
  assert.equal(skips.length, 2);
  assert.match(skips[0].reason, /exact version/);
  assert.ok(!fetch.log.some((l) => l.url.startsWith(NPM)), "no registry request was made");
  // an exact version needs no lookup, so raw CDNs still work
  const exact = await router.resolve("react@19.2.0");
  assert.equal(exact.url, "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js");
});
