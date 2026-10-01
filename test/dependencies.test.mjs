// build(specs, { dependencies }): the packages a raw-file-CDN package imports by bare name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, jsDelivr, unpkg, esmSh, local } from "../src/core.mjs";
import { fakeFetch, NPM } from "./helpers.mjs";

const pkg = (name, versions, manifests) => ({
  [`${NPM}/${name.replace("/", "%2F")}`]: { "dist-tags": { latest: versions.at(-1) }, versions: Object.fromEntries(versions.map((v) => [v, {}])) },
  ...Object.fromEntries(Object.entries(manifests).map(([v, m]) => [`${NPM}/${name.replace("/", "%2F")}/${v}`, { name, version: v, type: "module", main: "index.js", ...m }])),
});

// safe-fragment loads dompurify through a dynamic import("dompurify"); dompurify has no dependencies of its own
const table = {
  ...pkg("safe-fragment", ["1.0.0"], { "1.0.0": { dependencies: { dompurify: "^3.0.0" }, peerDependencies: { react: "*" }, devDependencies: { vitest: "1" } } }),
  ...pkg("dompurify", ["2.5.0", "3.2.0"], { "2.5.0": {}, "3.2.0": {} }),
  // a -> b -> c -> d -> e -> f -> g, and a cycle h <-> i
  ...pkg("a", ["1.0.0"], { "1.0.0": { dependencies: { b: "1" } } }),
  ...pkg("b", ["1.0.0"], { "1.0.0": { dependencies: { c: "1" } } }),
  ...pkg("c", ["1.0.0"], { "1.0.0": { dependencies: { d: "1" } } }),
  ...pkg("d", ["1.0.0"], { "1.0.0": { dependencies: { e: "1" } } }),
  ...pkg("e", ["1.0.0"], { "1.0.0": { dependencies: { f: "1" } } }),
  ...pkg("f", ["1.0.0"], { "1.0.0": { dependencies: { g: "1" } } }),
  ...pkg("g", ["1.0.0"], { "1.0.0": {} }),
  ...pkg("h", ["1.0.0"], { "1.0.0": { dependencies: { i: "1" } } }),
  ...pkg("i", ["1.0.0"], { "1.0.0": { dependencies: { h: "1" } } }),
  // odd dependency ranges
  ...pkg("odd", ["1.0.0"], { "1.0.0": { dependencies: { "from-git": "github:user/repo", "from-file": "file:../x", "aliased": "npm:other@1", "ws": "workspace:*", dompurify: "^3" } } }),
  // needs a version dompurify@3 does not satisfy
  ...pkg("old-fragment", ["1.0.0"], { "1.0.0": { dependencies: { dompurify: "^2.4.0" } } }),
  // a dependency a raw CDN can't serve
  ...pkg("needs-cjs", ["1.0.0"], { "1.0.0": { dependencies: { "cjs-dep": "1", dompurify: "^3" } } }),
  [`${NPM}/cjs-dep`]: { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
  [`${NPM}/cjs-dep/1.0.0`]: { name: "cjs-dep", version: "1.0.0", main: "index.js" },
  // a dependency with a dependency on the same package (and one that is not published)
  ...pkg("vanished-parent", ["1.0.0"], { "1.0.0": { dependencies: { "not-published": "1" } } }),
  // lib-a wants react 18, lib-b wants react 19
  ...pkg("react", ["18.3.1", "19.2.0"], { "18.3.1": {}, "19.2.0": {} }),
  ...pkg("lib-a", ["1.0.0"], { "1.0.0": { dependencies: { react: "^18" } } }),
  ...pkg("lib-b", ["1.0.0"], { "1.0.0": { dependencies: { react: "^19" } } }),
};
const router = (routes = { "*": jsDelivr() }, o = {}) => createRouter(routes, { probe: "none", fetch: fakeFetch(table), ...o });
const DOMPURIFY = "https://cdn.jsdelivr.net/npm/dompurify@3.2.0/index.js";

test("without the option an entry's own bare imports are not in the map (the problem)", async () => {
  const { importMap, dependencies } = await router().build(["safe-fragment@1.0.0"]);
  assert.deepEqual(Object.keys(importMap.imports), ["safe-fragment"]);
  assert.equal(dependencies, undefined);
});

test("dependencies: true adds the manifest's dependencies, resolved by range, and reports them", async () => {
  const r = router();
  const { importMap, dependencies, lock } = await r.build(["safe-fragment@1.0.0"], { dependencies: true });
  assert.deepEqual(importMap.imports, { "safe-fragment": "https://cdn.jsdelivr.net/npm/safe-fragment@1.0.0/index.js", dompurify: DOMPURIFY });
  assert.deepEqual(dependencies.added, [{ specifier: "dompurify@^3.0.0", key: "dompurify", version: "3.2.0", url: DOMPURIFY, provider: "jsdelivr", from: "safe-fragment@1.0.0", range: "^3.0.0", depth: 1 }]);
  assert.deepEqual(dependencies.skipped, []);
  assert.deepEqual(dependencies.truncated, []);
  assert.equal(lock.packages["dompurify@^3.0.0"].version, "3.2.0", "an added entry is locked like any other");
});

test("only `dependencies`: peer and dev dependencies are not added", async () => {
  const { importMap } = await router().build(["safe-fragment@1.0.0"], { dependencies: "prod" });
  assert.ok(!("react" in importMap.imports) && !("vitest" in importMap.imports));
});

test("it works on unpkg, and local() with installed manifests", async () => {
  const { importMap } = await router({ "*": unpkg() }).build(["safe-fragment@1.0.0"], { dependencies: true });
  assert.equal(importMap.imports.dompurify, "https://unpkg.com/dompurify@3.2.0/index.js");
  const l = router({ "*": local() });
  const built = await l.build(["safe-fragment@1.0.0"], { dependencies: true });
  assert.deepEqual(built.importMap.imports, { "safe-fragment": "/node_modules/safe-fragment/index.js", dompurify: "/node_modules/dompurify/index.js" });
  assert.equal(built.dependencies.added[0].version, "3.2.0", "local() maps without a version; the report and the lock have the exact one");
  assert.equal(built.lock.packages["dompurify@^3.0.0"].version, "3.2.0");
});

test("a dependency that is already in the build and satisfies the range is not added twice", async () => {
  const { importMap, dependencies } = await router().build(["dompurify@3.2.0", "safe-fragment@1.0.0"], { dependencies: true });
  assert.deepEqual(dependencies.added, []);
  assert.equal(importMap.imports.dompurify, DOMPURIFY);
});

test("transitive dependencies are followed, each package's manifest is read once, and cycles terminate", async () => {
  const fetch = fakeFetch(table);
  const { importMap, dependencies } = await createRouter({ "*": jsDelivr() }, { probe: "none", fetch }).build(["h@1", "a@1"], { dependencies: true, dependencyDepth: 10 });
  assert.deepEqual(Object.keys(importMap.imports).sort(), ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  assert.deepEqual(dependencies.added.map((d) => `${d.key}:${d.depth}`), ["i:1", "b:1", "c:2", "d:3", "e:4", "f:5", "g:6"]);
  for (const name of ["h", "i", "b"]) assert.equal(fetch.log.filter((l) => l.url === `${NPM}/${name}/1.0.0`).length, 1, `${name}'s manifest is fetched once`);
});

test("the depth is bounded (default 5) and what was cut off is reported, not hidden", async () => {
  const { importMap, dependencies } = await router().build(["a@1"], { dependencies: true });
  assert.deepEqual(Object.keys(importMap.imports), ["a", "b", "c", "d", "e", "f"], "a is depth 0; f is depth 5");
  assert.deepEqual(dependencies.truncated, [{ name: "g", range: "1", from: "f@1.0.0", depth: 6, limit: 5 }]);
  assert.equal(dependencies.maxDepth, 5);
  const shallow = await router().build(["a@1"], { dependencies: true, dependencyDepth: 1 });
  assert.deepEqual(Object.keys(shallow.importMap.imports), ["a", "b"]);
  assert.equal(shallow.dependencies.truncated[0].name, "c");
  const none = await router().build(["a@1"], { dependencies: true, dependencyDepth: 0 });
  assert.deepEqual(Object.keys(none.importMap.imports), ["a"]);
  assert.equal(none.dependencies.truncated.length, 1);
});

test("ranges that are not registry ranges are skipped with a reason; the rest still resolve", async () => {
  const { importMap, dependencies } = await router().build(["odd@1.0.0"], { dependencies: true });
  assert.deepEqual(Object.keys(importMap.imports).sort(), ["dompurify", "odd"]);
  assert.deepEqual(dependencies.skipped.map((s) => [s.name, s.reason]), [
    ["from-git", 'not a registry range: "github:user/repo"'],
    ["from-file", 'not a registry range: "file:../x"'],
    ["aliased", 'not a registry range: "npm:other@1"'],
    ["ws", 'not a registry range: "workspace:*"'],
  ]);
});

test("a range the existing entry does not satisfy meets the existing conflicts handling", async () => {
  // default: an error that names the key and the fix
  await assert.rejects(router().build(["safe-fragment@1.0.0", "old-fragment@1.0.0"], { dependencies: true }),
    (e) => e.name === "ResolutionError" && /conflicting resolutions for "dompurify"/.test(e.message));
  // conflicts: "scope": the first keeps imports, the other package gets a scope with its own version
  const { importMap, conflicts } = await router().build(["safe-fragment@1.0.0", "old-fragment@1.0.0"], { dependencies: true, conflicts: "scope" });
  assert.equal(importMap.imports.dompurify, DOMPURIFY);
  assert.deepEqual(importMap.scopes, { "https://cdn.jsdelivr.net/npm/old-fragment@1.0.0/": { dompurify: "https://cdn.jsdelivr.net/npm/dompurify@2.5.0/index.js" } });
  assert.equal(conflicts[0].scoped[0].dependent, "old-fragment@1.0.0");
});

test("two dependents with different react ranges are scoped, not merged", async () => {
  const { importMap } = await router().build(["lib-a@1.0.0", "lib-b@1.0.0"], { dependencies: true, conflicts: "scope" });
  assert.equal(importMap.imports.react, "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js");
  assert.deepEqual(importMap.scopes, { "https://cdn.jsdelivr.net/npm/lib-b@1.0.0/": { react: "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js" } });
});

test("a dependency that cannot be resolved is reported in skipped, and the others still resolve", async () => {
  const { importMap, dependencies } = await router().build(["needs-cjs@1.0.0", "vanished-parent@1.0.0"], { dependencies: true });
  assert.deepEqual(Object.keys(importMap.imports).sort(), ["dompurify", "needs-cjs", "vanished-parent"]);
  const reasons = Object.fromEntries(dependencies.skipped.map((s) => [s.name, s.reason]));
  assert.match(reasons["cjs-dep"], /CommonJS|every provider/i);
  assert.match(reasons["not-published"], /not found in the registry/);
});

test("providers that rewrite imports themselves are not expanded, and the report says why", async () => {
  for (const route of [esmSh(), jsDelivr({ esm: true })]) {
    const fetch = fakeFetch(table);
    const { importMap, dependencies } = await createRouter({ "*": route }, { probe: "none", fetch }).build(["safe-fragment@1.0.0"], { dependencies: true });
    assert.deepEqual(Object.keys(importMap.imports), ["safe-fragment"]);
    assert.deepEqual(dependencies.added, []);
    assert.deepEqual(dependencies.skipped, [{ from: "safe-fragment", provider: route.name, reason: "rewrites its own imports" }]);
    assert.ok(!fetch.log.some((l) => l.url === `${NPM}/safe-fragment/1.0.0`), "no manifest was fetched for it");
  }
});

test("a mixed route expands only the raw-CDN packages", async () => {
  const { importMap, dependencies } = await router({ "safe-fragment": jsDelivr(), "*": esmSh() }).build(["safe-fragment@1.0.0"], { dependencies: true });
  assert.equal(importMap.imports.dompurify, "https://esm.sh/dompurify@3.2.0?target=es2022", "the dependency is routed like any specifier");
  assert.equal(dependencies.added[0].provider, "esm.sh");
});

test("events: each addition is an onEvent `dependency` event", async () => {
  const events = [];
  await router({ "*": jsDelivr() }, { onEvent: (e) => events.push(e) }).build(["safe-fragment@1.0.0"], { dependencies: true });
  const e = events.find((x) => x.type === "dependency");
  assert.equal(e.provider, "build");
  assert.equal(e.phase, "dependencies");
  assert.match(e.reason, /dompurify@\^3\.0\.0 -> https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@3\.2\.0\/index\.js \(needed by safe-fragment@1\.0\.0, depth 1\)/);
});

test("graph integrity covers the added packages, and a lockfile reproduces the build", async () => {
  const files = { [DOMPURIFY]: "export default 1", "https://cdn.jsdelivr.net/npm/safe-fragment@1.0.0/index.js": "export default 2" };
  const first = createRouter({ "*": jsDelivr() }, { probe: "none", fetch: fakeFetch({ ...table, ...files }) });
  const built = await first.build(["safe-fragment@1.0.0"], { dependencies: true, graph: true });
  assert.ok(built.importMap.integrity[DOMPURIFY]);
  // second router, lockfile only: the pinned versions need no registry
  const fetch = fakeFetch({ ...table, ...files });
  const again = createRouter({ "*": jsDelivr() }, { probe: "none", fetch, lock: built.lock });
  const rebuilt = await again.build(["safe-fragment@1.0.0"], { dependencies: true, graph: true });
  assert.deepEqual(rebuilt.importMap, built.importMap);
});

test("option validation", async () => {
  await assert.rejects(router().build(["a@1"], { dependencies: "dev" }), /dependencies must be false, true or "prod"/);
  await assert.rejects(router().build(["a@1"], { dependencies: true, dependencyDepth: -1 }), /dependencyDepth must be a non-negative integer/);
  const bare = createRouter({ "*": jsDelivr() }, { probe: "none", registry: { version: async () => "1.0.0", entry: async () => "index.js", entryInfo: async () => ({ file: "index.js", esm: true }) } });
  await assert.rejects(bare.build(["a@1.0.0"], { dependencies: true }), /needs a registry client with manifest/);
});

test("an aborted signal stops the walk", async () => {
  const ac = new AbortController();
  const p = router().build(["a@1"], { dependencies: true, signal: ac.signal });
  ac.abort(new Error("stop"));
  await assert.rejects(p, /stop/);
});
