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
