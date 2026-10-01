import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRouter, createRegistry, local, esmSh, jsDelivr } from "../src/core.mjs";
import { installedRegistry } from "../src/node.mjs";
import { fakeFetch, registryFixtures, NPM } from "./helpers.mjs";

// a node_modules with a package that is NOT on npm, one that is (at a different version), and a scoped one
async function nodeModules() {
  const root = await mkdtemp(join(tmpdir(), "mport-installed-"));
  const put = async (name, pkg) => {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, "package.json"), JSON.stringify(pkg));
  };
  await put("@scope/unpublished", { name: "@scope/unpublished", version: "0.3.1", type: "module", exports: { ".": "./src/index.js", "./util": "./src/util.js" } });
  await put("react", { name: "react", version: "18.3.1", type: "module", main: "index.js" });
  await put("legacy", { name: "legacy", version: "1.0.0", main: "index.js" });
  return root;
}

test("local() with installedRegistry serves a package that is not on npm (issue #1)", async () => {
  const root = await nodeModules();
  const fetch = fakeFetch({}); // every URL is a 404, as the npm registry is for an unpublished package
  const registry = installedRegistry({ root });
  const router = createRouter({ "*": local({ base: "/node_modules/" }) }, { probe: "none", fetch, registry });
  const { importMap, lock } = await router.build(["@scope/unpublished", "@scope/unpublished/util"]);
  assert.deepEqual(importMap.imports, {
    "@scope/unpublished": "/node_modules/@scope/unpublished/src/index.js",
    "@scope/unpublished/util": "/node_modules/@scope/unpublished/src/util.js",
  });
  assert.equal(lock.packages["@scope/unpublished"].version, "0.3.1");
  assert.deepEqual(fetch.log, [], "nothing asked the network");
});

test("without it the same build fails, which is what the issue reported", async () => {
  const router = createRouter({ "*": local() }, { probe: "none", fetch: fakeFetch({}) });
  await assert.rejects(router.build(["@scope/unpublished"]), /not found in the registry/);
});

test("a published package resolves to the INSTALLED version, not the registry's latest", async () => {
  const root = await nodeModules();
  const fetch = fakeFetch(registryFixtures); // the registry says react@19.2.0 is latest
  const router = createRouter({ "*": local() }, { probe: "none", fetch, registry: installedRegistry({ root }) });
  const r = await router.resolve("react");
  assert.equal(r.version, undefined, "local() builds its URL without a version");
  assert.equal(router.lock.toJSON().packages.react.version, "18.3.1");
  assert.equal(r.url, "/node_modules/react/index.js");
  assert.equal(fetch.log.length, 0);
});

test("a range the installed version does not satisfy is a ResolutionError", async () => {
  const root = await nodeModules();
  const registry = installedRegistry({ root });
  await assert.rejects(registry.version({ registry: "npm", name: "react", range: "^19" }), (e) => e.name === "ResolutionError" && /18\.3\.1 is installed.*does not satisfy "\^19"/.test(e.message));
  assert.equal(await registry.version({ registry: "npm", name: "react", range: "^18" }), "18.3.1");
  assert.equal(await registry.version({ registry: "npm", name: "react", range: "latest" }), "18.3.1");
  assert.equal(await registry.version({ registry: "npm", name: "react" }), "18.3.1");
  const router = createRouter({ "*": local() }, { probe: "none", fetch: fakeFetch({}), registry });
  await assert.rejects(router.resolve("react@^19"), (e) => e.name === "ResolutionError", "one ResolutionError, not one failure per provider");
});

test("a package that is not installed is a ResolutionError, or goes to `fallback`", async () => {
  const root = await nodeModules();
  const strict = installedRegistry({ root });
  await assert.rejects(strict.version({ registry: "npm", name: "lit" }), (e) => e.name === "ResolutionError" && /lit is not installed under/.test(e.message));
  const fetch = fakeFetch(registryFixtures);
  const mixed = installedRegistry({ root, fallback: createRegistry({ fetch }) });
  const router = createRouter({ "@scope/*": local(), "*": esmSh() }, { probe: "none", fetch, registry: mixed });
  const { importMap } = await router.build(["@scope/unpublished", "lit"]);
  assert.equal(importMap.imports["@scope/unpublished"], "/node_modules/@scope/unpublished/src/index.js");
  assert.equal(importMap.imports.lit, "https://esm.sh/lit@3.3.1?target=es2022", "lit comes from the registry");
  assert.ok(fetch.log.every((l) => l.url.startsWith(NPM)), "only the uninstalled package touched the network");
});

test("entry detection follows the installed manifest: CommonJS is still skipped on a raw provider", async () => {
  const root = await nodeModules();
  const router = createRouter({ "*": [local(), jsDelivr()] }, { probe: "none", fetch: fakeFetch({}), registry: installedRegistry({ root }) });
  const r = await router.resolve("legacy").catch((e) => e);
  assert.equal(r.name, "RoutingError", "no provider can serve a CommonJS entry");
  assert.match(r.trace.find((e) => e.type === "skip").reason, /CommonJS/);
});

test("root may be a file: URL; a broken package.json is a ResolutionError naming the file", async () => {
  const root = await nodeModules();
  await mkdir(join(root, "broken"));
  await writeFile(join(root, "broken", "package.json"), "{ nope");
  const registry = installedRegistry({ root: pathToFileURL(root + "/") });
  assert.equal(await registry.version({ registry: "npm", name: "@scope/unpublished" }), "0.3.1");
  await assert.rejects(registry.version({ registry: "npm", name: "broken" }), (e) => e.name === "ResolutionError" && /broken.package\.json is not valid JSON/.test(e.message));
  assert.throws(() => installedRegistry({}), TypeError);
});

test("manifest(), entry() and info() answer from disk; a different version than installed is refused", async () => {
  const root = await nodeModules();
  const registry = installedRegistry({ root });
  assert.equal((await registry.manifest("react", "18.3.1")).name, "react");
  assert.equal(await registry.entry("@scope/unpublished", "0.3.1", "util"), "src/util.js");
  assert.deepEqual(await registry.info("npm", "react"), { versions: ["18.3.1"], tags: { latest: "18.3.1" }, deprecated: new Set() });
  await assert.rejects(registry.manifest("react", "19.0.0"), /19\.0\.0 was asked for, but 18\.3\.1 is what is installed/);
});

test("a lockfile pin for a version that is not installed fails clearly instead of serving the wrong files", async () => {
  const root = await nodeModules();
  const lock = { lockfileVersion: 1, packages: { react: { specifier: "react", registry: "npm", version: "19.0.0", build: "npm" } } };
  const router = createRouter({ "*": local() }, { probe: "none", fetch: fakeFetch({}), registry: installedRegistry({ root }), lock });
  await assert.rejects(router.resolve("react"), /19\.0\.0 was asked for, but 18\.3\.1 is what is installed/);
});
