import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRouter, route, esmSh, jsDelivr, unpkg, jspm, jsr, github, local, custom,
  fallback, race, adaptive, weighted, prefer, verified, cache, sri, SkipError,
} from "../src/core.mjs";
import { fakeFetch, registryFixtures, clock } from "./helpers.mjs";

const ok = (prefix) => ({ [`${prefix}*`]: "export default 1" });

test("1. static routing with deterministic version resolution", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const router = createRouter({ "*": esmSh() }, { fetch, probe: "none" });
  const r = await router.resolve("react@^19");
  assert.equal(r.url, "https://esm.sh/react@19.2.0");
  assert.equal(r.version, "19.2.0");
  assert.equal(r.provider, "esm.sh");
  assert.equal((await router.resolve("react")).version, "19.2.0", "latest dist-tag");
  assert.equal((await router.resolve("react@next")).version, "20.0.0-rc.1", "named dist-tag");
});

test("route specificity: exact > longer glob > shorter glob > *", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const router = createRouter({
    "*": unpkg(),
    "@scope/*": esmSh(),
    "@scope/p*": jspm(),
    "react": "https://modules.example.com/",
  }, { fetch, probe: "none" });
  assert.equal((await router.resolve("lit")).provider, "unpkg");
  assert.equal((await router.resolve("@scope/pkg")).provider, "jspm");
  assert.equal((await router.resolve("react@19.2.0")).url, "https://modules.example.com/react@19.2.0");
});

test("array routes: first match wins; unmatched and relative specifiers → null", async () => {
  const router = createRouter([route("@std/*", jsr()), route("react", esmSh())], { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal(await router.resolve("lit"), null);
  assert.equal(await router.resolve("./local.js"), null);
  assert.equal((await router.resolve("jsr:@std/path@^1")).url, "https://esm.sh/jsr/@std/path@1.1.0");
});

test("raw CDNs resolve the entry file from exports → module → main", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const router = createRouter({ "*": jsDelivr() }, { fetch, probe: "none" });
  assert.equal((await router.resolve("lit")).url, "https://cdn.jsdelivr.net/npm/lit@3.3.1/index.js");
  assert.equal((await router.resolve("@scope/pkg")).url, "https://cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/dist/pkg.mjs");
  assert.equal((await router.resolve("lit@3.3.1/decorators.js")).url, "https://cdn.jsdelivr.net/npm/lit@3.3.1/decorators.js");
});

test("registry prefixes route to registry-aware providers", async () => {
  const router = createRouter({ "npm:*": esmSh(), "jsr:*": jsr(), "github:*": github() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal((await router.resolve("npm:react@19.2.0")).url, "https://esm.sh/react@19.2.0");
  assert.equal((await router.resolve("github:johnhenry/mport@v2/src/index.mjs")).url, "https://cdn.jsdelivr.net/gh/johnhenry/mport@v2/src/index.mjs");
});

test("2. ordered fallback skips failing and unsupported providers", async () => {
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": 503, ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter({ "*": [esmSh(), jsr(), jsDelivr(), unpkg()] }, { fetch });
  const r = await router.resolve("react@19.2.0");
  assert.equal(r.provider, "jsdelivr");
  assert.deepEqual(r.trace.map((e) => `${e.type}:${e.provider}`), [
    "probe:esm.sh", "fail:esm.sh", "skip:jsr", "probe:jsdelivr", "ok:jsdelivr",
  ]);
});

test("3. race: fastest success wins, fast failures don't sink it, losers are aborted", async () => {
  const fetch = fakeFetch(
    { ...registryFixtures, "https://esm.sh/*": 500, ...ok("https://cdn.jsdelivr.net/"), ...ok("https://unpkg.com/") },
    { delays: { "https://cdn.jsdelivr.net/": 5, "https://unpkg.com/": 50 } },
  );
  const router = createRouter({ "*": race(esmSh(), jsDelivr(), unpkg()) }, { fetch });
  const r = await router.resolve("react@19.2.0");
  assert.equal(r.provider, "jsdelivr");
  await new Promise((res) => setTimeout(res, 10)); // losers settle after the winner returns
  assert.ok(r.trace.some((e) => e.type === "aborted" && e.provider === "unpkg"));
  assert.equal(router.health.snapshot().unpkg?.fail ?? 0, 0, "aborted losers are not failures");
});

test("race rejects with every error when all fail", async () => {
  const router = createRouter({ "*": race(esmSh(), unpkg()) }, { fetch: fakeFetch({ ...registryFixtures }) });
  await assert.rejects(router.resolve("react@19.2.0"), (e) => e.name === "RoutingError" && e.errors.length === 2 && e.trace.length > 0);
});

test("4. adaptive orders by weight and health", async () => {
  const fetch = fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/"), ...ok("https://unpkg.com/"), ...ok("https://cdn.jsdelivr.net/") });
  const router = createRouter({ "*": adaptive([esmSh(), 1], weighted(jsDelivr(), 5), [unpkg(), 3]) }, { fetch });
  assert.equal((await router.resolve("react@19.2.0")).provider, "jsdelivr");
  for (let i = 0; i < 20; i++) router.health.failure("jsdelivr"), router.health.success("jsdelivr");
  assert.equal((await router.resolve("react@18.3.1")).provider, "unpkg");
});

test("5. same artifact, many mirrors: a lock pins the build, so only same-build mirrors serve it", async () => {
  const fetch = fakeFetch({ ...registryFixtures, "https://cdn.jsdelivr.net/*": 503, ...ok("https://unpkg.com/"), ...ok("https://esm.sh/"), ...ok("https://ga.jspm.io/") });
  const first = createRouter({ "*": [jsDelivr(), unpkg()] }, { fetch });
  const { lock } = await first.build(["react@^19"]);
  assert.equal(lock.packages["npm:react@^19"].build, "npm");
  assert.equal(lock.packages["npm:react@^19"].provider, "unpkg");

  const next = createRouter({ "*": [esmSh(), jspm(), jsDelivr(), unpkg()] }, { fetch, lock });
  const r = await next.resolve("react@^19");
  assert.equal(r.provider, "unpkg", "esm.sh and jspm are different builds");
  assert.equal(r.version, "19.2.0");
  assert.ok(r.trace.some((e) => e.type === "skip" && e.provider === "esm.sh" && /locked/.test(e.reason)));
});

test("lock pins versions without touching the registry", async () => {
  const log = [];
  const fetch = fakeFetch({ ...ok("https://esm.sh/") }, { log });
  const lock = { packages: { "npm:react@^19": { version: "19.0.0", build: "esm.sh" } } };
  const r = await createRouter({ "*": esmSh() }, { fetch, lock }).resolve("react@^19");
  assert.equal(r.url, "https://esm.sh/react@19.0.0");
  assert.ok(!log.some((l) => l.url.includes("registry.npmjs.org")));
});

test("6. circuit breaker opens after repeated failures and resets", async () => {
  const now = clock();
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": 500, ...ok("https://unpkg.com/") });
  const router = createRouter({ "*": [esmSh(), unpkg()] }, { fetch, now, circuitBreaker: { failures: 2, reset: "30s" } });
  await router.resolve("react@19.2.0");
  await router.resolve("react@18.3.1");
  assert.equal(router.health.isOpen("esm.sh"), true);
  const r = await router.resolve("lit@3.3.1");
  assert.equal(r.trace[0].reason, "circuit open");
  now.advance(30_001);
  assert.equal(router.health.isOpen("esm.sh"), false);
});

test("fallback({ providers, circuitBreaker }) keeps its own health", async () => {
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": 500, ...ok("https://unpkg.com/") });
  const node = fallback({ providers: [esmSh(), unpkg()], circuitBreaker: { failures: 1, reset: 1000 } });
  const router = createRouter({ "*": node }, { fetch });
  await router.resolve("react@19.2.0");
  const r = await router.resolve("react@18.3.1");
  assert.equal(r.trace[0].reason, "circuit open");
});

test("7. capability routing with prefer() and required capabilities", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const router = createRouter({ "*": prefer({ browser: esmSh(), raw: jsDelivr(), default: unpkg() }) }, { fetch, probe: "none" });
  assert.equal((await router.resolve("react@19.2.0")).provider, "esm.sh");
  assert.equal((await router.resolve("react@19.2.0", { target: "raw" })).provider, "jsdelivr");
  assert.equal((await router.resolve("react@19.2.0", { target: "node" })).provider, "unpkg");

  const strict = createRouter({ "*": [unpkg(), esmSh()] }, { fetch, probe: "none", capabilities: ["esm-transform"] });
  assert.equal((await strict.resolve("react@19.2.0")).provider, "esm.sh");
});

test("verified() computes SRI and rejects a mismatching mirror", async () => {
  const body = "export default 42";
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": body, "https://unpkg.com/*": "tampered" });
  const expected = await sri(new TextEncoder().encode(body));
  const router = createRouter({ "*": [verified(unpkg()), verified(esmSh())] }, { fetch });
  const r = await router.resolve("react@19.2.0", { integrity: expected });
  assert.equal(r.provider, "esm.sh");
  assert.equal(r.integrity, expected);
  assert.ok(r.trace.some((e) => e.type === "ok" && e.provider === "unpkg"), "probe succeeded, integrity did not");
});

test("cache() serves remembered resolutions without probing", async () => {
  const log = [];
  const fetch = fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/") }, { log });
  const store = new Map();
  const router = createRouter({ "*": fallback(cache({ store }), esmSh()) }, { fetch });
  await router.resolve("react@19.2.0");
  const probes = log.filter((l) => l.method === "HEAD").length;
  const r = await router.resolve("react@19.2.0");
  assert.equal(r.cached, true);
  assert.equal(log.filter((l) => l.method === "HEAD").length, probes);
  assert.equal(store.size, 1);
});

test("custom templates and local()", async () => {
  const router = createRouter({
    "@company/*": custom("https://modules.company.com/{bare}.js"),
    "*": local({ base: "https://app.test/vendor" }),
  }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal((await router.resolve("@company/foo")).url, "https://modules.company.com/foo.js");
  assert.equal((await router.resolve("lit")).url, "https://app.test/vendor/lit/index.js");
});

test("router.import() fails over to another mirror at runtime", async () => {
  const fetch = fakeFetch({ ...registryFixtures });
  const imported = [];
  const importer = async (url) => {
    imported.push(url);
    if (url.startsWith("https://cdn.jsdelivr.net/")) throw new TypeError("Failed to fetch dynamically imported module");
    return { default: url };
  };
  const router = createRouter({ "*": [jsDelivr(), unpkg()] }, { fetch, probe: "none", importer });
  const events = [];
  const mod = await router.import("react@19.2.0", { onEvent: (e) => events.push(`${e.type}${e.phase ? `/${e.phase}` : ""}:${e.provider}`) });
  assert.equal(mod.default, "https://unpkg.com/react@19.2.0/index.js");
  assert.equal(imported.length, 2);
  assert.deepEqual(events, ["selected:jsdelivr", "fail/import:jsdelivr", "skip:jsdelivr", "selected:unpkg"]);
});

test("onEvent receives the same events as trace", async () => {
  const events = [];
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures), onEvent: (e) => events.push(e.type) });
  await router.resolve("react@19.2.0");
  assert.deepEqual(events, ["selected"], "probe: \"none\" selects without claiming a probe succeeded");
});

test("registry lookups appear in the trace", async () => {
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  const r = await router.resolve("react@^19");
  assert.deepEqual(r.trace.map((e) => `${e.type}:${e.provider}`), ["lookup:npm registry", "resolved:npm registry", "selected:esm.sh"]);
  assert.equal(r.trace[1].version, "19.2.0");
  const exact = await router.resolve("react@19.2.0");
  assert.equal(exact.trace[0].type, "selected", "exact versions skip the lookup");
});

test("an unknown package is one ResolutionError, not a failure per provider", async () => {
  const log = [];
  const fetch = fakeFetch({ ...registryFixtures }, { log });
  const router = createRouter({ "*": [esmSh(), jsDelivr(), unpkg()] }, { fetch });
  await assert.rejects(router.resolve("@nope/missing"), (e) => e.name === "ResolutionError" && /not found/.test(e.message) && e.trace.at(-1).type === "fail");
  assert.equal(log.filter((l) => l.url.includes("registry.npmjs.org")).length, 1);
  const raced = createRouter({ "*": race(esmSh(), unpkg()) }, { fetch });
  await assert.rejects(raced.resolve("@nope/missing"), { name: "ResolutionError" });
  assert.deepEqual(router.health.snapshot(), {}, "no provider was blamed");
});

test("raw CDNs map sub-paths through package exports", async () => {
  const router = createRouter({ "*": [jsDelivr(), esmSh()] }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal((await router.resolve("preact@^10")).url, "https://cdn.jsdelivr.net/npm/preact@10.29.8/dist/preact.module.js", "browser condition wins");
  assert.equal((await router.resolve("preact@^10/hooks")).url, "https://cdn.jsdelivr.net/npm/preact@10.29.8/hooks/dist/hooks.mjs");
  assert.equal((await router.resolve("preact@^10/compat/client")).url, "https://cdn.jsdelivr.net/npm/preact@10.29.8/compat/dist/client.mjs", "wildcard");
  assert.equal((await router.resolve("preact@^10/dist/preact.js")).url, "https://cdn.jsdelivr.net/npm/preact@10.29.8/dist/preact.js", "file paths are left alone");
  const esm = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal((await esm.resolve("preact@^10/hooks")).url, "https://esm.sh/preact@10.29.8/hooks", "esm.sh resolves sub-paths itself");
});

test("routers can share a health registry", async () => {
  const fetch = fakeFetch({ ...registryFixtures, "https://esm.sh/*": 500, ...ok("https://unpkg.com/") });
  const a = createRouter({ "*": [esmSh(), unpkg()] }, { fetch, circuitBreaker: { failures: 1 } });
  await a.resolve("react@19.2.0");
  const b = createRouter({ "*": [esmSh(), unpkg()] }, { fetch, health: a.health });
  assert.equal((await b.resolve("react@18.3.1")).trace[0].reason, "circuit open");
});

test("exclude accepts any iterable", async () => {
  const router = createRouter({ "*": [esmSh(), unpkg()] }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  assert.equal((await router.resolve("react@19.2.0", { exclude: ["esm.sh"] })).provider, "unpkg");
});

test("abort: a pre-aborted signal rejects immediately; aborting mid-lookup rejects promptly", async () => {
  const router = createRouter({ "*": esmSh() }, { fetch: fakeFetch({ ...registryFixtures, ...ok("https://esm.sh/") }, { delays: { "https://registry.npmjs.org/": 200 } }) });
  const done = new AbortController();
  done.abort(new Error("stop"));
  await assert.rejects(router.resolve("react@^19", { signal: done.signal }), /stop/);
  const ac = new AbortController();
  const t0 = Date.now();
  const p = router.resolve("react@^19", { signal: ac.signal });
  setTimeout(() => ac.abort(new Error("later")), 10);
  await assert.rejects(p, /later/);
  assert.ok(Date.now() - t0 < 150, "did not wait for the slow registry");
});

test("build() rejects specifiers it cannot route instead of dropping them", async () => {
  const router = createRouter({ "react": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  await assert.rejects(router.build(["react@19.2.0", "lit"]), (e) => e.name === "ResolutionError" && /"lit"/.test(e.message));
  await assert.rejects(router.build(["./x.js"]), /no route/);
});

test("verified() mismatches are recorded in the trace", async () => {
  const fetch = fakeFetch({ ...registryFixtures, "https://unpkg.com/*": "tampered", "https://esm.sh/*": "good" });
  const expected = await sri(new TextEncoder().encode("good"));
  const r = await createRouter({ "*": [verified(unpkg()), verified(esmSh())] }, { fetch }).resolve("react@19.2.0", { integrity: expected });
  assert.ok(r.trace.some((e) => e.type === "fail" && e.phase === "integrity" && e.provider === "unpkg"));
});

test("fallback reports the abort reason, not a skipped node's error", async () => {
  const ac = new AbortController();
  const node = {
    kind: "test", name: "aborter",
    async select() { ac.abort(new Error("user cancelled")); throw new SkipError("aborter: skipped"); },
  };
  const router = createRouter({ "*": fallback(node, esmSh()) }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  await assert.rejects(router.resolve("react@19.2.0", { signal: ac.signal }), /user cancelled/);
});

test("raw CDNs skip CommonJS entries; ESM-transforming CDNs still serve them", async () => {
  const fetch = fakeFetch(registryFixtures);
  const router = createRouter({ "*": [jsDelivr(), unpkg(), esmSh()] }, { probe: "none", fetch });
  const r = await router.resolve("cjs-only@1");
  assert.equal(r.provider, "esm.sh");
  assert.deepEqual(r.trace.filter((e) => e.type === "skip").map((e) => e.provider), ["jsdelivr", "unpkg"]);
  assert.match(r.trace.find((e) => e.type === "skip").reason, /CommonJS/);
  const lenient = createRouter({ "*": jsDelivr() }, { probe: "none", fetch, allowCommonJS: true });
  assert.equal((await lenient.resolve("cjs-only@1")).url, "https://cdn.jsdelivr.net/npm/cjs-only@1.0.0/index.js");
});

test("probe \"none\" records no health data", async () => {
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(registryFixtures) });
  await router.resolve("react@19.2.0");
  assert.deepEqual(router.health.snapshot(), {});
});

test("an import probe that finishes after the race is decided is traced as lost, not ok", async () => {
  const importer = (url) => new Promise((res) => setTimeout(() => res({ url }), url.includes("unpkg") ? 5 : 40));
  const router = createRouter({ "*": race(jsDelivr(), unpkg()) }, { probe: "import", importer, fetch: fakeFetch(registryFixtures) });
  const r = await router.resolve("react@19.2.0");
  assert.equal(r.provider, "unpkg");
  await new Promise((res) => setTimeout(res, 60));
  const loser = r.trace.filter((e) => e.provider === "jsdelivr").at(-1);
  assert.equal(loser.type, "aborted");
  assert.equal(loser.reason, "lost the race");
});

test("entryInfo tells ESM from CommonJS", async () => {
  const { entryInfo } = await import("../src/registry.mjs");
  assert.deepEqual(entryInfo({ main: "index.js" }), { file: "index.js", esm: false });
  assert.deepEqual(entryInfo({ type: "module", main: "index.js" }), { file: "index.js", esm: true });
  assert.deepEqual(entryInfo({ main: "index.js", module: "dist/x.module.js" }), { file: "dist/x.module.js", esm: true });
  assert.deepEqual(entryInfo({ exports: { ".": { browser: "./dist/p.module.js", require: "./dist/p.js" } } }), { file: "dist/p.module.js", esm: true });
  assert.deepEqual(entryInfo({ exports: { ".": { browser: { import: "./b.js", require: "./b.cjs" } } } }), { file: "b.js", esm: true });
  assert.deepEqual(entryInfo({ exports: { ".": { default: "./index.js" } } }), { file: "index.js", esm: false });
  assert.deepEqual(entryInfo({ exports: "./x.cjs", type: "module" }), { file: "x.cjs", esm: false });
  assert.deepEqual(entryInfo({ exports: { "./hooks": { import: "./hooks/h.js" } } }, "hooks"), { file: "hooks/h.js", esm: true });
});
