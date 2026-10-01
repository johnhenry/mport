// A real Rollup build whose bare imports are resolved through a mport router.
// "external" mode leaves the CDN URL in the bundle; "importmap" mode keeps the bare
// import and emits the import map that maps it. (Vite works the same way through
// @johnhenry/mport/vite and injects the map into index.html.)
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rollup } from "rollup";
import { createRouter, esmSh } from "@johnhenry/mport";
import mportRollup from "@johnhenry/mport/rollup";
import { offlineFetch, registry } from "./_offline.mjs";

const dir = await mkdtemp(join(tmpdir(), "mport-rollup-"));
try {
  await writeFile(join(dir, "main.js"), `import { createElement } from "react";\nimport "./side.js";\nexport const el = createElement("p");\n`);
  await writeFile(join(dir, "side.js"), `console.log("bundled, not routed");\n`);
  const router = () => createRouter({ "*": esmSh() }, { fetch: offlineFetch(registry), probe: "none" });
  const bundle = async (plugin) => (await (await rollup({ input: join(dir, "main.js"), plugins: [plugin] })).generate({ format: "es" })).output;

  const [external] = await bundle(mportRollup(router(), { versions: { react: "^19" } }));
  assert.deepEqual(external.imports, ["https://esm.sh/react@19.2.0?target=es2022"]);
  assert.match(external.code, /bundled, not routed/);

  const out = await bundle(mportRollup(router(), { mode: "importmap", versions: { react: "^19" } }));
  assert.deepEqual(out.find((o) => o.type === "chunk").imports, ["react"]);
  const map = JSON.parse(out.find((o) => o.fileName === "importmap.json").source);
  assert.deepEqual(map.imports, { react: "https://esm.sh/react@19.2.0?target=es2022" });
  console.log("16 ok:", external.imports[0]);
} finally {
  await rm(dir, { recursive: true, force: true });
}
