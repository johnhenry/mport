// verified() hashes the entry file only, and on esm.sh that is a stub. `graph: true`
// walks the static imports behind it and records an integrity hash for every file: as
// the import map's `integrity` and as the lockfile's `files`. A later build refuses a
// file whose bytes changed.
import assert from "node:assert/strict";
import { createRouter, esmSh } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

const files = {
  "https://esm.sh/react@19.2.0?target=es2022": 'export * from "/react@19.2.0/es2022/react.mjs";',
  "https://esm.sh/react@19.2.0/es2022/react.mjs": 'import "/scheduler@0.27.0/es2022/scheduler.mjs";export default 1;',
  "https://esm.sh/scheduler@0.27.0/es2022/scheduler.mjs": "export const tick = () => {};",
};
const make = (table, o = {}) => createRouter({ "*": esmSh() }, { fetch: offlineFetch({ ...registry, ...table }), probe: "none", ...o });

const { importMap, lock, graph } = await make(files).build(["react@^19"], { graph: true });
assert.deepEqual(Object.keys(importMap.integrity).sort(), Object.keys(files).sort(), "every file of the graph, not just the stub");
assert.deepEqual(lock.files, importMap.integrity);
assert.equal(graph.files, 3);

// the committed lockfile now guards every file
const tampered = { ...files, "https://esm.sh/scheduler@0.27.0/es2022/scheduler.mjs": "export const tick = () => steal();" };
await assert.rejects(make(tampered, { lock }).build(["react@^19"], { graph: true }), (e) => e.name === "IntegrityError" && /scheduler\.mjs/.test(e.message));

// bounded: a walk cut short says so
const events = [];
const cut = await make(files, { onEvent: (e) => events.push(e) }).build(["react@^19"], { graph: { maxFiles: 2 } });
assert.equal(cut.graph.truncated[0].reason, "maxFiles");
assert.equal(events.find((e) => e.type === "truncated").skipped, 1);

console.log("14 ok:", Object.keys(importMap.integrity).length, "files hashed");
