import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, esmSh, verified, sri, parseImports } from "../src/core.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const ENTRY = "https://esm.sh/react@19.2.0?target=es2022";
const graph = () => ({
  [ENTRY]: `export * from "/react@19.2.0/es2022/react.mjs";\nexport { default } from "/react@19.2.0/es2022/react.mjs";`,
  "https://esm.sh/react@19.2.0/es2022/react.mjs":
    `import"/scheduler@0.27.0/es2022/scheduler.mjs";import h from"./helper.mjs";import l from"left-pad";import o from"https://other.example/x.js";\n// import nope from "/commented.mjs"\nexport default h;`,
  "https://esm.sh/scheduler@0.27.0/es2022/scheduler.mjs": `import "../../react@19.2.0/es2022/react.mjs"; export const s = 1;`, // a cycle
  "https://esm.sh/react@19.2.0/es2022/helper.mjs": `export default 1;`,
});
const make = (table, o = {}) => {
  const log = [];
  const fetch = fakeFetch({ ...registryFixtures, ...table }, { log });
  return { log, router: createRouter({ "*": esmSh() }, { fetch, probe: "none", ...o }) };
};

test("parseImports: static forms, minified output, and things that only look like imports", () => {
  assert.deepEqual(parseImports(`import a from "a"; import {b as c} from './b.js'; import * as n from '../c'; import "side"; export * from "/e.js"; export {x} from "f"; export * as q from "g"; export {y}; export default 1; import j from "./j.json" with {type:"json"}`),
    ["a", "./b.js", "../c", "side", "/e.js", "f", "g", "./j.json"]);
  assert.deepEqual(parseImports(`import{a as b}from"/x.mjs";export{c}from"./y.mjs";const u=x/2;import.meta.url;a.import("zz")`), ["/x.mjs", "./y.mjs"]);
  assert.deepEqual(parseImports("const s = \"import z from 'no'\"; // import q from 'no'\n/* import w from 'no' */ const r = /import x from 'no'/; const t = `import y from 'no' ${ \"}\" + import('no') }`;"), []);
  assert.deepEqual(parseImports(`import def, { from } from "m1"; import from from "m2"; ({ import: 1 })`), ["m1", "m2"]);
  assert.deepEqual(parseImports(`import("a");import("b",{});import(c)`), []);
  assert.deepEqual(parseImports(`import("a");import("b",{});import(c);x=a/b/c;import"d"`, { dynamic: true }), ["a", "b", "d"]);
});

test("graph: every file of the static import graph is hashed, in the map and the lock", async () => {
  const { router, log } = make(graph());
  const { importMap, lock, graph: g } = await router.build(["react@19.2.0"], { graph: true });
  const urls = Object.keys(importMap.integrity).sort();
  assert.deepEqual(urls, [
    ENTRY,
    "https://esm.sh/react@19.2.0/es2022/helper.mjs",
    "https://esm.sh/react@19.2.0/es2022/react.mjs",
    "https://esm.sh/scheduler@0.27.0/es2022/scheduler.mjs",
  ].sort());
  assert.equal(importMap.integrity[ENTRY], await sri(new TextEncoder().encode(graph()[ENTRY])));
  assert.deepEqual(lock.files, importMap.integrity);
  assert.equal(lock.packages["react@19.2.0"].integrity, importMap.integrity[ENTRY], "the entry's hash is also the package's");
  assert.deepEqual(g.bare, ["left-pad"]);
  assert.deepEqual(g.skipped.map((s) => [s.url, s.reason]), [["https://other.example/x.js", "other origin"]]);
  assert.equal(g.files, 4);
  assert.deepEqual(g.truncated, []);
  // the cycle terminates and each file is fetched once
  assert.equal(log.filter((l) => l.url.includes("scheduler")).length, 1);
});

test("graph: off by default (no extra requests, no files in the lock)", async () => {
  const { router, log } = make(graph());
  const { importMap, lock, graph: g } = await router.build(["react@19.2.0"]);
  assert.equal(importMap.integrity, undefined);
  assert.equal(lock.files, undefined);
  assert.equal(g, undefined);
  assert.equal(log.filter((l) => l.url.startsWith("https://esm.sh")).length, 0);
});

test("graph: a later build refuses a file that no longer matches the lock; --relock (no lock) accepts it", async () => {
  const first = await make(graph()).router.build(["react@19.2.0"], { graph: true });
  const tampered = { ...graph(), "https://esm.sh/react@19.2.0/es2022/helper.mjs": `export default "evil";` };
  const events = [];
  const { router } = make(tampered, { lock: first.lock, onEvent: (e) => events.push(e) });
  await assert.rejects(router.build(["react@19.2.0"], { graph: true }), (e) => {
    assert.equal(e.name, "IntegrityError");
    assert.match(e.message, /helper\.mjs: expected sha384-/);
    return true;
  });
  assert.ok(events.some((e) => e.type === "fail" && e.phase === "integrity" && /helper\.mjs/.test(e.url)));
  // same bytes: fine, and the lock is reproduced exactly
  const again = await make(graph(), { lock: first.lock }).router.build(["react@19.2.0"], { graph: true });
  assert.deepEqual(again.lock, first.lock);
  // without the lock the new bytes are simply recorded
  const fresh = await make(tampered).router.build(["react@19.2.0"], { graph: true });
  assert.notEqual(fresh.lock.files["https://esm.sh/react@19.2.0/es2022/helper.mjs"], first.lock.files["https://esm.sh/react@19.2.0/es2022/helper.mjs"]);
});

test("graph: a file that cannot be fetched fails the build instead of being left unhashed", async () => {
  const t = graph();
  delete t["https://esm.sh/react@19.2.0/es2022/helper.mjs"];
  await assert.rejects(make(t).router.build(["react@19.2.0"], { graph: true }), (e) => e.name === "IntegrityError" && /helper\.mjs to hash it: it responded 404/.test(e.message));
});

test("graph: maxFiles and maxDepth bound the walk, and the truncation is a trace event", async () => {
  const events = [];
  const { router } = make(graph(), { onEvent: (e) => events.push(e) });
  const { importMap, graph: g } = await router.build(["react@19.2.0"], { graph: { maxFiles: 2 } });
  assert.equal(Object.keys(importMap.integrity).length, 2);
  assert.equal(g.truncated.length, 1);
  assert.deepEqual({ reason: g.truncated[0].reason, limit: g.truncated[0].limit, skipped: g.truncated[0].skipped }, { reason: "maxFiles", limit: 2, skipped: 2 });
  const ev = events.find((e) => e.type === "truncated");
  assert.equal(ev.phase, "graph");
  assert.equal(ev.reason, "maxFiles");
  assert.equal(ev.url, ENTRY);

  const r2 = make(graph());
  const d = await r2.router.build(["react@19.2.0"], { graph: { maxDepth: 1 } });
  assert.deepEqual(Object.keys(d.importMap.integrity).sort(), [ENTRY, "https://esm.sh/react@19.2.0/es2022/react.mjs"].sort());
  assert.equal(d.graph.truncated[0].reason, "maxDepth");
  const t = await make(graph()).router.build(["react@19.2.0"], { graph: { maxDepth: 0 } });
  assert.equal(Object.keys(t.importMap.integrity).length, 1);
});

test("graph: composes with verified(): a pinned entry hash that disagrees with the bytes is refused", async () => {
  const table = { ...registryFixtures, ...graph() };
  const router = createRouter({ "*": verified(esmSh()) }, { fetch: fakeFetch(table), probe: "none" });
  const { lock, importMap } = await router.build(["react@19.2.0"], { graph: true });
  assert.equal(importMap.integrity[ENTRY], lock.packages["react@19.2.0"].integrity);
  const bad = { lockfileVersion: 1, packages: { "react@19.2.0": { ...lock.packages["react@19.2.0"], integrity: "sha384-wrong" } } };
  await assert.rejects(
    createRouter({ "*": verified(esmSh()) }, { fetch: fakeFetch(table), probe: "none", lock: bad }).build(["react@19.2.0"], { graph: true }),
    /integrity mismatch/,
  );
});

test("graph: dynamic import() literals are followed only on request", async () => {
  const t = { ...graph(), "https://esm.sh/react@19.2.0/es2022/helper.mjs": `export default 1; export const lazy = () => import("./lazy.mjs");`, "https://esm.sh/react@19.2.0/es2022/lazy.mjs": "export {}" };
  const plain = await make(t).router.build(["react@19.2.0"], { graph: true });
  assert.ok(!("https://esm.sh/react@19.2.0/es2022/lazy.mjs" in plain.lock.files));
  const dyn = await make(t).router.build(["react@19.2.0"], { graph: { dynamic: true } });
  assert.ok("https://esm.sh/react@19.2.0/es2022/lazy.mjs" in dyn.lock.files);
});

test("graph: prefix specifiers have no module to walk and are left out", async () => {
  const { router } = make(graph());
  const { importMap, graph: g } = await router.build(["lit/"], { graph: true });
  assert.equal(importMap.integrity, undefined);
  assert.equal(g.files, 0);
});
