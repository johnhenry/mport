import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, esmSh, jsDelivr, jspm, compileImportMap } from "../src/core.mjs";
import { fakeFetch, registryFixtures, NPM } from "./helpers.mjs";

const fixtures = {
  ...registryFixtures,
  [`${NPM}/lib-a`]: { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
  [`${NPM}/lib-a/1.0.0`]: { name: "lib-a", version: "1.0.0", type: "module", main: "index.js", dependencies: { react: "^18.2.0" } },
  [`${NPM}/lib-b`]: { "dist-tags": { latest: "2.0.0" }, versions: { "2.0.0": {} } },
  [`${NPM}/lib-b/2.0.0`]: { name: "lib-b", version: "2.0.0", type: "module", main: "index.js", peerDependencies: { react: ">=19" } },
  [`${NPM}/lib-c`]: { "dist-tags": { latest: "3.0.0" }, versions: { "3.0.0": {} } },
  [`${NPM}/lib-c/3.0.0`]: { name: "lib-c", version: "3.0.0", type: "module", main: "index.js", dependencies: { react: "*" } },
  [`${NPM}/lib-d`]: { "dist-tags": { latest: "4.0.0" }, versions: { "4.0.0": {} } },
  [`${NPM}/lib-d/4.0.0`]: { name: "lib-d", version: "4.0.0", type: "module", main: "index.js", dependencies: { react: "^17" } },
  [`${NPM}/react/18.3.1`]: { name: "react", version: "18.3.1", type: "module", main: "index.js" },
};
const raw = () => createRouter({ "*": jsDelivr() }, { probe: "none", fetch: fakeFetch(fixtures) });

test("conflicts: 'scope' gives each dependent the version its manifest asks for", async () => {
  const events = [];
  const router = createRouter({ "*": jsDelivr() }, { probe: "none", fetch: fakeFetch(fixtures), onEvent: (e) => events.push(e) });
  // react@19 is listed first, so it owns the unscoped slot; lib-a wants ^18, lib-b wants >=19
  const { importMap, conflicts } = await router.build(["react@19.2.0", "react@18.3.1", "lib-a@1.0.0", "lib-b@2.0.0"], { conflicts: "scope" });
  assert.equal(importMap.imports.react, "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js");
  assert.deepEqual(importMap.scopes, {
    "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/": { react: "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js" },
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "react");
  assert.deepEqual(conflicts[0].kept, { specifier: "react@19.2.0", url: "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js" });
  assert.deepEqual(conflicts[0].scoped.map((s) => [s.dependent, s.range, s.scope]), [["lib-a@1.0.0", "^18.2.0", "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/"]]);
  assert.deepEqual(conflicts[0].unscoped, []);
  assert.ok(events.some((e) => e.type === "conflict" && /react/.test(e.reason)));
});

test("conflicts: the first listed specifier wins the unscoped slot, in either order", async () => {
  const { importMap } = await raw().build(["react@18.3.1", "react@19.2.0", "lib-a@1.0.0", "lib-b@2.0.0"], { conflicts: "scope" });
  assert.equal(importMap.imports.react, "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js");
  assert.deepEqual(importMap.scopes, {
    "https://cdn.jsdelivr.net/npm/lib-b@2.0.0/": { react: "https://cdn.jsdelivr.net/npm/react@19.2.0/index.js" },
  });
});

test("conflicts: a dependent whose range the unscoped version satisfies gets no scope; one nothing satisfies is reported nowhere", async () => {
  const router = raw();
  const { importMap, conflicts } = await router.build(["react@19.2.0", "react@18.3.1", "lib-c@3.0.0", "lib-d@4.0.0"], { conflicts: "scope" });
  assert.equal(importMap.scopes, undefined, "* is satisfied by the unscoped 19; ^17 matches neither");
  assert.deepEqual(conflicts[0].scoped, []);
  assert.deepEqual(conflicts[0].unscoped, [{ specifier: "react@18.3.1", url: "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js" }], "the loser nobody reaches is listed");
});

test("conflicts: default is error; an invalid mode is a TypeError", async () => {
  await assert.rejects(raw().build(["react@18.3.1", "react@19.2.0"]), /conflicting resolutions for "react"/);
  await assert.rejects(raw().build(["react@18.3.1", "react@19.2.0"], { conflicts: "error" }), /conflicting resolutions/);
  await assert.rejects(raw().build(["react"], { conflicts: "merge" }), TypeError);
});

test("conflicts: no conflict, no scopes, empty report; explicit scopes still combine", async () => {
  const router = raw();
  const a = await router.build(["react@19.2.0", "lib-a@1.0.0"], { conflicts: "scope" });
  assert.equal(a.importMap.scopes, undefined);
  assert.deepEqual(a.conflicts, []);
  const b = await raw().build(["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"], {
    conflicts: "scope",
    scopes: { "/legacy/": { react: "react@18.3.1" } },
  });
  assert.deepEqual(Object.keys(b.importMap.scopes).sort(), ["/legacy/", "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/"]);
});

test("conflicts: scopes follow the provider's package directory (jspm) and apply to sub-path keys", async () => {
  const router = createRouter({ "*": jspm() }, { probe: "none", fetch: fakeFetch(fixtures) });
  const { importMap } = await router.build(["react@19.2.0/x.js", "react@18.3.1/x.js", "lib-a@1.0.0"], { conflicts: "scope" });
  assert.deepEqual(importMap.imports["react/x.js"], "https://ga.jspm.io/npm:react@19.2.0/x.js");
  assert.deepEqual(importMap.scopes, { "https://ga.jspm.io/npm:lib-a@1.0.0/": { "react/x.js": "https://ga.jspm.io/npm:react@18.3.1/x.js" } });
});

test("conflicts: integrity of a scoped version lands in the map", async () => {
  const { importMap } = await createRouter({ "*": jsDelivr() }, {
    probe: "none",
    fetch: fakeFetch(fixtures),
    lock: { lockfileVersion: 1, packages: { "react@18.3.1": { integrity: "sha384-OLD" } } },
  }).build(["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"], { conflicts: "scope" });
  assert.equal(importMap.integrity["https://cdn.jsdelivr.net/npm/react@18.3.1/index.js"], "sha384-OLD");
});

test("conflicts: esm.sh packages are scoped too (harmless: their files import by URL)", async () => {
  const router = createRouter({ "*": esmSh() }, { probe: "none", fetch: fakeFetch(fixtures) });
  const { importMap } = await router.build(["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"], { conflicts: "scope" });
  assert.deepEqual(importMap.scopes, { "https://esm.sh/lib-a@1.0.0/": { react: "https://esm.sh/react@18.3.1?target=es2022" } });
});

test("conflicts: a missing manifest just means no dependents are found", async () => {
  const router = createRouter({ "*": esmSh() }, {
    probe: "none",
    fetch: fakeFetch({ ...fixtures, [`${NPM}/lib-a/1.0.0`]: 500 }),
  });
  const { importMap, conflicts } = await router.build(["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"], { conflicts: "scope" });
  assert.equal(importMap.scopes, undefined);
  assert.equal(conflicts[0].unscoped.length, 1);
});

test("compileImportMap's conflict error mentions conflicts: 'scope'", () => {
  assert.throws(() => compileImportMap([{ key: "a", url: "u1" }, { key: "a", url: "u2" }]), /conflicts: "scope"/);
});
