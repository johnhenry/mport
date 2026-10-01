import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRouter, esmSh, jsDelivr, unpkg, jspm, local, origin, fallback, race, verified, cache, HealthRegistry,
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

test("3. unversioned providers don't write the range into the lock as a version", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  // origin() serves the range as written: nothing was resolved
  const v1 = createRouter({ "*": origin("cdn.example.com/npm/") }, { fetch, probe: "none" });
  const r = await v1.resolve("react@^19");
  assert.equal(r.url, "https://cdn.example.com/npm/react@^19/");
  assert.equal(v1.lock.toJSON().packages["react@^19"].version, undefined);
  // local() had to resolve the version to find the entry, so the lock records that
  const l = createRouter({ "*": local() }, { fetch, probe: "none" });
  await l.resolve("react@^19");
  assert.equal(l.lock.toJSON().packages["react@^19"].version, "19.2.0");
  // a stale lock that recorded the range is not treated as exact
  const stale = { packages: { "react@^19": { version: "^19", registry: "npm" } } };
  const again = createRouter({ "*": esmSh() }, { fetch, probe: "none", lock: stale });
  assert.equal((await again.resolve("react@^19")).version, "19.2.0");
});

test("4. the output lock holds only this build's resolutions; the input lock only pins", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const input = { lockfileVersion: 1, packages: {
    "gone@1": { specifier: "gone@1", registry: "npm", version: "1.0.0", build: "esm.sh" },
    "react@^19": { specifier: "react@^19", registry: "npm", version: "19.0.0", build: "esm.sh", provider: "esm.sh" },
  } };
  const router = createRouter({ "*": esmSh() }, { fetch, probe: "none", lock: input });
  assert.deepEqual(router.lock.toJSON().packages, {});
  const { lock } = await router.build(["react@^19"]);
  assert.deepEqual(Object.keys(lock.packages), ["react@^19"]);
  assert.equal(lock.packages["react@^19"].version, "19.0.0", "the pin is still honoured");
});

test("5+6. cache() hits offline, keep entry/registry, and respect a ttl", async () => {
  const store = new Map();
  const now = clock();
  const routes = () => ({ "*": fallback(cache({ store, ttl: "1m" }), jsDelivr()) });
  const first = createRouter(routes(), { fetch: fakeFetch({ ...registryFixtures, ...ok("https://cdn.jsdelivr.net/") }), now });
  const a = await first.resolve("react@^19");
  assert.equal(a.cached, false);
  assert.equal(a.entry, "index.js");

  // a second router, no network at all: the key is the specifier as written
  const dead = fakeFetch({}, { log: [] });
  const offline = createRouter(routes(), { fetch: (...x) => { dead.log.push(x); throw new Error("offline"); }, now });
  const b = await offline.resolve("react@^19");
  assert.equal(b.cached, true);
  assert.equal(dead.log.length, 0, "no request, not even a registry lookup");
  assert.equal(b.url, a.url);
  assert.equal(b.entry, "index.js", "entry survives a cache hit");
  assert.equal(b.registry, "npm");
  assert.equal(b.version, "19.2.0");
  assert.equal(offline.lock.toJSON().packages["react@^19"].entry, "index.js", "and reaches the lock");

  // a different range is a different request
  await assert.rejects(offline.resolve("react@^18"));
  // after the ttl the entry is expired
  now.advance(61_000);
  const c = createRouter(routes(), { fetch: fakeFetch({ ...registryFixtures, ...ok("https://cdn.jsdelivr.net/") }), now });
  const r = await c.resolve("react@^19");
  assert.equal(r.cached, false);
  assert.ok(r.trace.some((e) => e.type === "skip" && e.reason === "expired"));
});
