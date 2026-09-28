import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../bin/mport.mjs";

test("mport build writes an import map and lockfile from a config; resolve prints JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mport-cli-"));
  const src = new URL("../src/core.mjs", import.meta.url).href;
  await writeFile(join(dir, "mport.config.mjs"), `
    import { esmSh } from ${JSON.stringify(src)};
    export default {
      routes: { "*": esmSh() },
      specifiers: ["react@19.2.0", "lit@3.3.1/"],
      options: { probe: "none", resolveVersions: true },
    };
  `);
  const out = [];
  assert.equal(await main(["build"], { cwd: dir, log: (s) => out.push(s) }), 0);
  const map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  assert.deepEqual(map.imports, { react: "https://esm.sh/react@19.2.0", "lit/": "https://esm.sh/lit@3.3.1/" });
  const lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.equal(lock.packages["npm:react@19.2.0"].provider, "esm.sh");
  assert.match(out[0], /2 imports/);

  const printed = [];
  await main(["resolve", "react@19.2.0", "--trace"], { cwd: dir, log: (s) => printed.push(s) });
  const r = JSON.parse(printed[0]);
  assert.equal(r.url, "https://esm.sh/react@19.2.0");
  assert.deepEqual(r.trace.map((e) => e.type), ["probe", "ok"]);
});
