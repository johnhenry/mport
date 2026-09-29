// An import map names one URL and the browser never retries it. router.import()
// resolves AND imports; when the import itself fails it excludes that provider and
// resolves again. Without a pin it may switch builds (esm.sh → jsDelivr's +esm); a
// lockfile pin or `build` keeps it on one build, so it fails instead.
import assert from "node:assert/strict";
import { createRouter, createImporter, esmSh, jsDelivr } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

// esm.sh passes the availability check but its modules fail to evaluate.
const importer = async (url) => {
  if (url.startsWith("https://esm.sh/")) throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  return { default: `module from ${url}` };
};
const routes = { "*": [esmSh(), jsDelivr({ esm: true })] };
const events = [];
const router = createRouter(routes, { fetch: offlineFetch(registry), probe: "none", importer, onEvent: (e) => events.push(`${e.type}${e.phase ? `/${e.phase}` : ""}:${e.provider}`) });

const load = createImporter(router); // the same function as router.import
const react = await load("react@^19");
assert.equal(react.default, "module from https://cdn.jsdelivr.net/npm/react@19.2.0/+esm");
assert.deepEqual(events.filter((e) => !e.includes("registry")), [
  "selected:esm.sh", "fail/import:esm.sh", "skip:esm.sh", "selected:jsdelivr-esm",
]);
assert.equal(router.health.snapshot()["esm.sh"].fail, 1, "an import failure counts against the provider");

// Pinned to the esm.sh build, there is nowhere to fail over to.
await assert.rejects(router.import("react@^19", { build: "esm.sh" }), (e) => e.name === "RoutingError");
const locked = createRouter(routes, {
  fetch: offlineFetch(registry), probe: "none", importer,
  lock: { lockfileVersion: 1, packages: { "react@^19": { version: "19.2.0", build: "esm.sh" } } },
});
await assert.rejects(locked.import("react@^19"), (e) => e.name === "RoutingError" && e.errors.length === 2);

// Unroutable specifiers are imported as they are.
assert.deepEqual(await createRouter(routes, { importer: async (u) => ({ u }) }).import("./local.js"), { u: "./local.js" });

console.log("08 ok:", events.join(" → "));
