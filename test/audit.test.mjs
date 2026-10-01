import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRouter, compileImportMap, esmSh, jsDelivr, unpkg, jspm, local, origin, fallback, race, verified, cache, HealthRegistry,
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
  assert.equal(r.url, "https://esm.sh/react@^19?target=es2022");
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

test("7. two versions of one key throw instead of silently keeping one", async () => {
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  await assert.rejects(router.build(["react@18.3.1", "react@19.2.0"]), (e) => {
    assert.equal(e.name, "ResolutionError");
    assert.match(e.message, /conflicting resolutions for "react"/);
    assert.match(e.message, /scope/);
    return true;
  });
  // the same URL twice, and the scopes the message points to, are fine
  const ok2 = await router.build(["react@^19", "react@19.2.0"], { scopes: { "https://old.example/": { react: "react@18.3.1" } } });
  assert.deepEqual(ok2.importMap.imports, { react: "https://esm.sh/react@19.2.0?target=es2022" });
  // inside one scope the same rule applies
  assert.throws(() => compileImportMap([], { "/x/": [{ key: "a", url: "u1" }, { key: "a", url: "u2" }] }), /in scope \/x\//);
});

test("8. a prefix specifier skips jsDelivr({esm:true}) with a reason and the route falls through", async () => {
  const fetch = fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/"), ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter({ "*": [jsDelivr({ esm: true }), esmSh()] }, { fetch });
  const r = await router.resolve("lit/");
  assert.equal(r.provider, "esm.sh");
  assert.equal(r.base, "https://esm.sh/lit@3.3.1/");
  assert.ok(r.trace.some((e) => e.type === "skip" && e.provider === "jsdelivr-esm" && /prefix/.test(e.reason)));
  assert.ok(!fetch.log.some((l) => l.url.includes("jsdelivr")), "never probed");
});

test("9. raw CDNs skip a prefix specifier when the package has an exports map", async () => {
  const fetch = fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/"), ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter({ "*": [jsDelivr(), unpkg(), esmSh()] }, { fetch });
  const r = await router.resolve("lit/"); // lit has "exports"
  assert.equal(r.provider, "esm.sh");
  assert.equal(r.trace.filter((e) => e.type === "skip" && /exports map/.test(e.reason)).length, 2);
  // a package without an exports map keeps its directory mapping
  const plain = await router.resolve("@scope/pkg/");
  assert.equal(plain.provider, "jsdelivr");
  assert.equal(plain.base, "https://cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/");
  // a non-prefix specifier of the same package is unaffected
  assert.equal((await router.resolve("lit")).provider, "jsdelivr");
});

test("11. the latest dist-tag wins when it satisfies the range; deprecated versions are passed over", async () => {
  const { createRegistry } = await import("../src/registry.mjs");
  const meta = (latest, versions) => ({ "dist-tags": { latest }, versions });
  const fetch = fakeFetch({
    [`${NPM}/tagged`]: meta("1.1.0", { "1.0.0": {}, "1.1.0": {}, "1.2.0-x": {}, "1.3.0": {} }),
    [`${NPM}/dep`]: meta("2.0.0", { "1.0.0": {}, "1.1.0": { deprecated: "broken" }, "1.2.0": { deprecated: "broken" } }),
    [`${NPM}/alldep`]: meta("1.1.0", { "1.0.0": { deprecated: "x" }, "1.1.0": { deprecated: "x" } }),
    [`${NPM}/pre`]: meta("1.0.0", { "1.0.0": {}, "2.0.0-rc.1": {}, "2.0.0-rc.2": {} }),
  });
  const reg = createRegistry({ fetch });
  const v = (name, range) => reg.version({ registry: "npm", name, range });
  assert.equal(await v("tagged", "^1"), "1.1.0", "latest satisfies ^1, so it beats the higher 1.3.0 (as npm does)");
  assert.equal(await v("tagged", "^1.2"), "1.3.0", "latest doesn't satisfy: highest match");
  assert.equal(await v("dep", "^1"), "1.0.0", "deprecated versions are skipped when others match");
  assert.equal(await v("alldep", "^1"), "1.1.0", "but used when nothing else does");
  assert.equal(await v("pre", ">=2.0.0-rc.0"), "2.0.0-rc.2", "prerelease ranges still pick the highest");
});

test("13. fallback({ providers, circuitBreaker }) records into the router's health, on the router's clock", async () => {
  const now = clock();
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": 503, ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter(
    { "*": fallback({ providers: [esmSh(), jsDelivr()], circuitBreaker: { failures: 1, reset: "10s" } }) },
    { fetch, now },
  );
  const a = await router.resolve("react@19.2.0");
  assert.equal(a.provider, "jsdelivr");
  assert.equal(router.health.snapshot()["esm.sh"].fail, 1, "visible in router.health");
  assert.equal(router.health.isOpen("esm.sh"), false, "the router's own threshold (3) hasn't been reached");
  const b = await router.resolve("react@19.2.0");
  assert.ok(b.trace.some((e) => e.type === "skip" && e.provider === "esm.sh" && e.reason === "circuit open"), "the fallback's threshold (1) opened it");
  now.advance(10_001); // the router's clock, not Date.now()
  const c = await router.resolve("react@19.2.0");
  assert.ok(c.trace.some((e) => e.type === "probe" && e.provider === "esm.sh"), "closed again after reset");
});

test("13. router.import() failures and a fallback's circuit share one state", async () => {
  const importer = async () => { throw new Error("boom"); };
  const router = createRouter(
    { "*": fallback({ providers: [esmSh()], circuitBreaker: { failures: 1 } }) },
    { fetch: fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/") }), importer },
  );
  await assert.rejects(router.import("react@19.2.0"));
  const r = await router.resolve("react@19.2.0").catch((e) => e);
  assert.equal(r.name, "RoutingError");
  assert.ok(r.trace.some((e) => e.reason === "circuit open"), "one failed import opened the fallback's 1-failure circuit");
});

test("14a. esm.sh URLs pin ?target= (integrity can't depend on the User-Agent); null opts out; prefixes stay bare", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const r = createRouter({ "*": esmSh() }, { fetch, probe: "none" });
  assert.equal((await r.resolve("react@19.2.0/jsx-runtime")).url, "https://esm.sh/react@19.2.0/jsx-runtime?target=es2022");
  assert.equal((await r.resolve("jsr:@std/path@1.0.0")).url, "https://esm.sh/jsr/@std/path@1.0.0?target=es2022");
  assert.equal((await r.resolve("lit/")).base, "https://esm.sh/lit@3.3.1/", "a directory can't carry a query");
  const es2020 = createRouter({ "*": esmSh({ esTarget: "es2020" }) }, { fetch, probe: "none" });
  assert.equal((await es2020.resolve("react@19.2.0")).url, "https://esm.sh/react@19.2.0?target=es2020");
  const bare = createRouter({ "*": esmSh({ esTarget: null }) }, { fetch, probe: "none" });
  assert.equal((await bare.resolve("react@19.2.0")).url, "https://esm.sh/react@19.2.0");
});

test("14c. verified() with the default head probe downloads once per candidate (no HEAD + GET)", async () => {
  const log = [];
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": "export default 1" }, { log });
  const router = createRouter({ "*": verified(esmSh()) }, { fetch });
  const r = await router.resolve("react@19.2.0");
  assert.match(r.integrity, /^sha384-/);
  assert.deepEqual(log.filter((l) => l.url.startsWith("https://esm.sh/")).map((l) => l.method), ["GET"]);
  assert.deepEqual(r.trace.map((e) => e.type).filter((t) => t !== "lookup" && t !== "resolved"), ["probe", "ok"]);
  assert.equal(router.health.snapshot()["esm.sh"].ok, 1);
  // a bad response fails over, is traced and counts against the provider
  const bad = createRouter({ "*": [verified(esmSh()), verified(jsDelivr())] }, {
    fetch: fakeFetch({ ...registryFixtures, "https://esm.sh/*": 503, ...ok("https://cdn.jsdelivr.net/") }),
  });
  const b = await bad.resolve("react@19.2.0");
  assert.equal(b.provider, "jsdelivr");
  assert.equal(bad.health.snapshot()["esm.sh"].fail, 1);
  // a cache hit under verified() is still re-hashed
  const gets = [];
  const store = new Map();
  const c = createRouter({ "*": verified(fallback(cache({ store }), esmSh())) }, {
    fetch: fakeFetch({ ...registryFixtures, "https://esm.sh/*": "export default 1" }, { log: gets }),
  });
  await c.resolve("react@19.2.0");
  gets.length = 0;
  const second = await c.resolve("react@19.2.0");
  assert.equal(second.cached, true);
  assert.deepEqual(gets.map((l) => l.method), ["GET"], "hashed again, once");
});

test("15. integrity is skipped for prefix keys at the top level and in scopes alike", () => {
  const entry = (key, url) => ({ key, url, integrity: `sha384-${key}` });
  const map = compileImportMap(
    [entry("a", "https://x/a.js"), { ...entry("lit/", "https://x/lit.js"), base: "https://x/lit/" }],
    { "/s/": [entry("b", "https://x/b.js"), { ...entry("lit/", "https://x/lit2.js"), base: "https://x/lit2/" }] },
  );
  assert.deepEqual(map.integrity, { "https://x/a.js": "sha384-a", "https://x/b.js": "sha384-b" });
});
