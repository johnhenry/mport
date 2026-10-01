import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, outdated, pickVersion } from "../src/core.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const lock = (packages) => ({ lockfileVersion: 1, packages });

test("outdated(): wanted is the range's newest, latest the dist-tag; JSR and failures are handled", async () => {
  const log = [];
  const registry = createRegistry({ fetch: fakeFetch(registryFixtures, { log }) });
  const { outdated: rows, skipped } = await outdated(lock({
    "react@^18": { specifier: "react@^18", registry: "npm", name: "react", range: "^18", version: "18.3.1" },
    "react@^19": { specifier: "react@^19", registry: "npm", name: "react", range: "^19", version: "19.0.0" },
    "react@19.2.0": { specifier: "react@19.2.0", registry: "npm", name: "react", range: "19.2.0", version: "19.2.0" },
    "@std/path@^1": { specifier: "@std/path@^1", registry: "jsr", name: "@std/path", range: "^1", version: "1.0.0" },
    "ghost@1": { specifier: "ghost@1", registry: "npm", name: "ghost", range: "1", version: "1.0.0" },
    "x@1": { specifier: "x@1", registry: "npm", name: "x", range: "1" },
  }), { registry });
  assert.deepEqual(rows.map((r) => [r.key, r.current, r.wanted, r.latest, r.updatable, r.behindLatest]), [
    ["react@^18", "18.3.1", "18.3.1", "19.2.0", false, true],
    ["react@^19", "19.0.0", "19.2.0", "19.2.0", true, true],
    ["@std/path@^1", "1.0.0", "1.1.0", "1.1.0", true, true],
  ]);
  assert.deepEqual(skipped.map((s) => s.key).sort(), ["ghost@1", "x@1"]);
  assert.match(skipped.find((s) => s.key === "ghost@1").reason, /not found in the registry/);
  assert.equal(log.filter((l) => l.url === "https://registry.npmjs.org/react").length, 1, "one lookup per package, whatever the ranges");
});

test("outdated(): a registry client without info() is a TypeError; pickVersion follows npm's rules", async () => {
  await assert.rejects(outdated(lock({}), { registry: {} }), TypeError);
  const info = { versions: ["1.0.0", "1.1.0", "2.0.0-rc.1"], tags: { latest: "1.1.0", next: "2.0.0-rc.1" }, deprecated: new Set(["1.1.0"]) };
  assert.equal(pickVersion("p", "next", info), "2.0.0-rc.1");
  assert.equal(pickVersion("p", undefined, info), "1.1.0");
  assert.equal(pickVersion("p", "^1", info), "1.0.0", "a deprecated version is passed over");
  assert.equal(pickVersion("p", "^1", { ...info, deprecated: new Set() }), "1.1.0", "latest wins when it satisfies the range");
  assert.throws(() => pickVersion("p", "^3", info), /no version of p satisfies "\^3"/);
});
