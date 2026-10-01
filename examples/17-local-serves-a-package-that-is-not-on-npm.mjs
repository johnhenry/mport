// local() maps imports to your own origin (`/node_modules/…`), but it still needs a version
// and an entry file, and by default asks the npm registry for them: a package installed from
// git (not on npm) is a 404. installedRegistry() answers those lookups from the installed
// package.json instead, so the import map is built from what is really on disk.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouter, local } from "@johnhenry/mport";
import { installedRegistry } from "@johnhenry/mport/node";
import { offlineFetch } from "./_offline.mjs";

// a node_modules/ holding a package that was never published (installed from git)
const root = await mkdtemp(join(tmpdir(), "mport-installed-"));
await mkdir(join(root, "@acme", "widgets"), { recursive: true });
await writeFile(join(root, "@acme", "widgets", "package.json"), JSON.stringify({
  name: "@acme/widgets", version: "0.4.2", type: "module",
  exports: { ".": "./src/index.js", "./button": "./src/button.js" },
}));

const fetch = offlineFetch({}); // the registry knows nothing about @acme/widgets: every URL is a 404

// Without it: the registry lookup fails, exactly as in johnhenry/mport#1.
await assert.rejects(
  createRouter({ "*": local() }, { fetch: offlineFetch({}), probe: "none" }).build(["@acme/widgets"]),
  /not found in the registry/,
);

// With it: version and entry come from <root>/@acme/widgets/package.json.
const router = createRouter({ "*": local({ base: "/node_modules/" }) }, {
  fetch, probe: "none", registry: installedRegistry({ root }),
});
const { importMap, lock } = await router.build(["@acme/widgets", "@acme/widgets/button"]);
assert.deepEqual(importMap.imports, {
  "@acme/widgets": "/node_modules/@acme/widgets/src/index.js",
  "@acme/widgets/button": "/node_modules/@acme/widgets/src/button.js",
});
assert.equal(lock.packages["@acme/widgets"].version, "0.4.2", "the lockfile records the installed version");
assert.equal(fetch.log.length, 0, "nothing touched the network");

// A range the installed copy does not satisfy is an error, not a silent mismatch.
await assert.rejects(router.resolve("@acme/widgets@^1"), /0\.4\.2 is installed.*does not satisfy "\^1"/);

console.log("17 ok:", JSON.stringify(importMap.imports));
