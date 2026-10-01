// Integrity manifests for html-modules graphs: htmlGraph(), build({ html }), integrityManifest(), the CLI flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouter, esmSh, htmlGraph, integrityManifest, sri } from "../src/core.mjs";
import { main } from "../bin/mport.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const O = "https://ui.example/kit/";
const hash = (text) => sri(new TextEncoder().encode(text));
const table = () => ({
  [`${O}app.html`]: `<html-import-settings base="./parts/"></html-import-settings>
    <html-import src="./card.html" as="card"></html-import>
    <html-import src="./logic.js" as="logic"></html-import>
    <html-import src="../shared/theme.html" as="theme" load="lazy"></html-import>
    <html-import src="https://elsewhere.example/x.html" as="x"></html-import>
    <html-import src="@scope/bare.html" as="bare"></html-import>
    <html-import src="/kit/shared/theme.html#dup" as="dup"></html-import>
    <html-export name="app-root"><template><!-- <html-import src="./commented.html"></html-import> -->app</template></html-export>
    <html-export src="./barrel.html"></html-export>`, // re-exports resolve against the settings base too
  [`${O}parts/card.html`]: `<html-import src="../app.html" as="app"></html-import><html-export name="card-x"><template>c</template></html-export>`, // a cycle
  [`${O}parts/logic.js`]: `import "./helper.js"; export const x = 1;`,
  [`${O}parts/helper.js`]: `export const h = 1;`,
  [`${O}shared/theme.html`]: `<html-export name="theme-x"><template>t</template></html-export>`,
  [`${O}parts/barrel.html`]: `<html-export src="./card.html"></html-export>`,
});
const graphUrls = [`${O}app.html`, `${O}parts/barrel.html`, `${O}parts/card.html`, `${O}parts/helper.js`, `${O}parts/logic.js`, `${O}shared/theme.html`];

test("htmlGraph: imports, re-exports, lazy imports, <html-import-settings base> and the JavaScript they import, each hashed once", async () => {
  const log = [];
  const g = await htmlGraph(`${O}app.html`, { fetch: fakeFetch(table(), { log }) });
  assert.deepEqual(Object.keys(g.integrity), graphUrls, "sorted by URL; commented-out imports are not followed");
  for (const [url, h] of Object.entries(g.integrity)) assert.equal(h, await hash(table()[url]), url);
  assert.equal(g.files, 6);
  assert.deepEqual(g.bare, ["@scope/bare.html"]);
  assert.deepEqual(g.skipped.map((s) => [s.url, s.reason]), [["https://elsewhere.example/x.html", "other origin"]]);
  assert.deepEqual(g.truncated, []);
  assert.equal(log.length, 6, "the cycle and the two spellings of theme.html are one fetch each");
});

test("htmlGraph: the manifest is the import map's integrity shape (absolute URL → sha384-…), and several roots share one walk", async () => {
  const g = await htmlGraph([`${O}app.html`, `${O}parts/barrel.html`], { fetch: fakeFetch(table()) });
  assert.equal(g.files, 6);
  for (const [url, h] of Object.entries(g.integrity)) {
    assert.ok(new URL(url).href === url);
    assert.match(h, /^sha384-[A-Za-z0-9+/]+=*$/);
  }
  const g512 = await htmlGraph(`${O}shared/theme.html`, { fetch: fakeFetch(table()), algorithm: "sha512" });
  assert.match(g512.integrity[`${O}shared/theme.html`], /^sha512-/);
});

test("htmlGraph: a root or file that cannot be fetched or read fails; bounds report truncation; roots are validated", async () => {
  await assert.rejects(htmlGraph(`${O}missing.html`, { fetch: fakeFetch(table()) }), (e) => e.name === "IntegrityError" && /could not fetch .*missing\.html to hash it: it responded 404/.test(e.message));
  await assert.rejects(htmlGraph(`${O}bad.html`, { fetch: fakeFetch({ [`${O}bad.html`]: `<html-export name="x"><template>a</template><template>b</template></html-export>` }) }), (e) => e.name === "IntegrityError" && /could not read the HTML module .*bad\.html/.test(e.message));
  const cut = await htmlGraph(`${O}app.html`, { fetch: fakeFetch(table()), maxFiles: 2 });
  assert.equal(cut.files, 2);
  assert.equal(cut.truncated[0].reason, "maxFiles");
  const shallow = await htmlGraph(`${O}app.html`, { fetch: fakeFetch(table()), maxDepth: 0 });
  assert.deepEqual(Object.keys(shallow.integrity), [`${O}app.html`]);
  await assert.rejects(htmlGraph([], {}), TypeError);
  await assert.rejects(htmlGraph("./app.html", { fetch: fakeFetch(table()) }), /absolute URLs/);
  await assert.rejects(htmlGraph("file:///a.html", { fetch: fakeFetch(table()) }), /http\(s\)/);
  await assert.rejects(htmlGraph(`${O}app.html`, { fetch: fakeFetch(table()), scan: "no" }), /option scan must be a function/);
});

test("htmlGraph: scan can be passed instead of the optional peer", async () => {
  const seen = [];
  const scan = (source, url) => { seen.push(url); return { imports: [{ src: "./b.html" }], exports: [], importSettings: undefined }; };
  const g = await htmlGraph(`${O}a.html`, { fetch: fakeFetch({ [`${O}a.html`]: "A", [`${O}b.html`]: "B" }), scan: (s, u) => (u.endsWith("b.html") ? { imports: [], exports: [] } : scan(s, u)) });
  assert.deepEqual(Object.keys(g.integrity), [`${O}a.html`, `${O}b.html`]);
  assert.deepEqual(seen, [`${O}a.html`]);
});

test("build({ html }): the hashes join the import map's integrity and the lockfile's files, next to a JavaScript graph", async () => {
  const jsEntry = "https://esm.sh/react@19.2.0?target=es2022";
  const t = { ...registryFixtures, ...table(), [jsEntry]: "export default 1;" };
  const router = createRouter({ "*": esmSh() }, { fetch: fakeFetch(t), probe: "none" });
  const { importMap, lock, html, graph } = await router.build(["react@19.2.0"], { graph: true, html: [`${O}app.html`] });
  assert.deepEqual(Object.keys(importMap.integrity).sort(), [jsEntry, ...graphUrls].sort());
  assert.deepEqual(lock.files, importMap.integrity);
  assert.equal(html.files, 6);
  assert.equal(graph.files, 1);
  assert.deepEqual(integrityManifest({ importMap, lock }), Object.fromEntries(Object.entries(importMap.integrity).sort(([a], [b]) => (a < b ? -1 : 1))));
  assert.deepEqual(integrityManifest(importMap), integrityManifest(lock));
});

test("build({ html }) alone needs no specifiers; options object form; a later build refuses a tampered file, relock accepts it", async () => {
  const make = (t, o = {}) => createRouter({ "*": esmSh() }, { fetch: fakeFetch({ ...registryFixtures, ...t }), probe: "none", ...o });
  const first = await make(table()).build([], { html: { roots: [`${O}app.html`], maxDepth: 10 } });
  assert.deepEqual(Object.keys(first.importMap.integrity), graphUrls);
  assert.deepEqual(first.importMap.imports, {});
  const tampered = { ...table(), [`${O}parts/helper.js`]: "export const h = steal();" };
  await assert.rejects(make(tampered, { lock: first.lock }).build([], { html: [`${O}app.html`] }), (e) => e.name === "IntegrityError" && /helper\.js/.test(e.message));
  const accepted = await make(tampered).build([], { html: [`${O}app.html`] });
  assert.notEqual(accepted.importMap.integrity[`${O}parts/helper.js`], first.importMap.integrity[`${O}parts/helper.js`]);
});

test("build({ html }) validates its roots", async () => {
  const router = createRouter({ "*": esmSh() }, { fetch: fakeFetch(registryFixtures), probe: "none" });
  await assert.rejects(router.build([], { html: [] }), /build option html must be an array of HTML module URLs/);
  await assert.rejects(router.build([], { html: ["./a.html"] }), /absolute URLs/);
  await assert.rejects(router.build([], { html: "https://x.test/a.html" }), TypeError);
});

test("the CLI: build --html writes the graph into the map and lock, --manifest writes the bare manifest; a build with neither specifiers nor html still errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mport-html-"));
  const src = new URL("../src/core.mjs", import.meta.url).href;
  const helpers = new URL("./helpers.mjs", import.meta.url).href;
  await writeFile(join(dir, "mport.config.mjs"), `
    import { createRouter, esmSh } from ${JSON.stringify(src)};
    import { fakeFetch } from ${JSON.stringify(helpers)};
    const fx = {
      "${O}app.html": '<html-import src="./dep.html" as="d"></html-import>',
      "${O}dep.html": '<html-export name="dep-x"><template>d</template></html-export>',
    };
    export default ({ lock }) => createRouter({ "*": esmSh() }, { fetch: fakeFetch(fx), probe: "none", lock });
  `);
  const out = [];
  await main(["build", "--html", `${O}app.html`, "--manifest", "integrity.json"], { cwd: dir, log: (s) => out.push(s) });
  assert.match(out.at(-1), /\(2 HTML module graph files hashed\); integrity manifest integrity\.json/);
  const map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(dir, "integrity.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest), [`${O}app.html`, `${O}dep.html`]);
  assert.deepEqual(manifest, map.integrity);
  assert.deepEqual(lock.files, manifest);
  const cut = [];
  await main(["build", "--html", `${O}app.html`, "--relock"], { cwd: dir, log: (s) => cut.push(s) });
  await assert.rejects(main(["build"], { cwd: dir, log() {} }), /no specifiers/);
});
