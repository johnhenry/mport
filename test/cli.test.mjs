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
  assert.deepEqual(map.imports, { react: "https://esm.sh/react@19.2.0?target=es2022", "lit/": "https://esm.sh/lit@3.3.1/" });
  const lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.equal(lock.packages["react@19.2.0"].provider, "esm.sh");
  assert.match(out[0], /2 imports/);

  const printed = [];
  await main(["resolve", "react@19.2.0", "--trace"], { cwd: dir, log: (s) => printed.push(s) });
  const r = JSON.parse(printed[0]);
  assert.equal(r.url, "https://esm.sh/react@19.2.0?target=es2022");
  assert.deepEqual(r.trace.map((e) => e.type), ["selected"]);
});

const setup = async (config) => {
  const dir = await mkdtemp(join(tmpdir(), "mport-cli-"));
  const src = new URL("../src/core.mjs", import.meta.url).href;
  const helpers = new URL("./helpers.mjs", import.meta.url).href;
  await writeFile(join(dir, "mport.config.mjs"), `
    import { createRouter, esmSh } from ${JSON.stringify(src)};
    import { fakeFetch, registryFixtures } from ${JSON.stringify(helpers)};
    const fetch = fakeFetch(registryFixtures);
    ${config}
  `);
  return dir;
};
const pinned = { lockfileVersion: 1, packages: { "react@^19": { specifier: "react@^19", registry: "npm", version: "19.0.0", build: "esm.sh" } } };

test("12. a config function receives { lock } and --relock ignores it", async () => {
  const dir = await setup(`export default ({ lock }) => createRouter({ "*": esmSh() }, { fetch, probe: "none", lock });`);
  await writeFile(join(dir, "mport.lock.json"), JSON.stringify(pinned));
  await main(["build", "react@^19"], { cwd: dir, log() {} });
  let map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  assert.equal(map.imports.react, "https://esm.sh/react@19.0.0?target=es2022", "the committed pin is honoured");
  await main(["build", "react@^19", "--relock"], { cwd: dir, log() {} });
  map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  assert.equal(map.imports.react, "https://esm.sh/react@19.2.0?target=es2022", "--relock resolves afresh");
  assert.equal(JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8")).packages["react@^19"].version, "19.2.0");
});

test("12. a prebuilt router refuses --lock/--relock and never overwrites the lock file", async () => {
  const dir = await setup(`export default createRouter({ "*": esmSh() }, { fetch, probe: "none" });`);
  const lockText = JSON.stringify(pinned);
  await writeFile(join(dir, "mport.lock.json"), lockText);
  await assert.rejects(main(["build", "react@^19", "--lock", "mport.lock.json"], { cwd: dir, log() {} }), /--lock has no effect.*prebuilt router/);
  await assert.rejects(main(["build", "react@^19", "--relock"], { cwd: dir, log() {} }), /--relock has no effect/);
  const out = [];
  assert.equal(await main(["build", "react@^19"], { cwd: dir, log: (s) => out.push(s) }), 0);
  assert.match(out[0], /was not written because mport.config.mjs exports a prebuilt router/);
  assert.equal(await readFile(join(dir, "mport.lock.json"), "utf8"), lockText, "left untouched");
  assert.equal(JSON.parse(await readFile(join(dir, "importmap.json"), "utf8")).imports.react, "https://esm.sh/react@19.2.0?target=es2022");
});
