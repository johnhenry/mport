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

test("13. build --conflicts scope (or config.conflicts) scopes conflicting versions instead of failing", async () => {
  const dir = await setup(`
    import { jsDelivr } from ${JSON.stringify(new URL("../src/core.mjs", import.meta.url).href)};
    const fx = {
      ...registryFixtures,
      "https://registry.npmjs.org/lib-a": { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
      "https://registry.npmjs.org/lib-a/1.0.0": { type: "module", main: "index.js", dependencies: { react: "^18" } },
    };
    export default ({ lock }) => ({ routes: { "*": jsDelivr() }, options: { fetch: fakeFetch(fx), probe: "none", lock } });
  `);
  const specs = ["react@19.2.0", "react@18.3.1", "lib-a@1.0.0"];
  await assert.rejects(main(["build", ...specs], { cwd: dir, log() {} }), /conflicting resolutions for "react"/);
  await main(["build", ...specs, "--conflicts", "scope"], { cwd: dir, log() {} });
  const map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  assert.deepEqual(map.scopes, { "https://cdn.jsdelivr.net/npm/lib-a@1.0.0/": { react: "https://cdn.jsdelivr.net/npm/react@18.3.1/index.js" } });
});

test("14. build --graph hashes the whole import graph into the map and the lock; --max-files warns when it cuts the walk short", async () => {
  const dir = await setup(`
    const fx = {
      ...registryFixtures,
      "https://esm.sh/react@19.2.0?target=es2022": 'export * from "/react@19.2.0/es2022/react.mjs";',
      "https://esm.sh/react@19.2.0/es2022/react.mjs": 'import "./a.mjs";',
      "https://esm.sh/react@19.2.0/es2022/a.mjs": "export {}",
    };
    export default ({ lock }) => createRouter({ "*": esmSh() }, { fetch: fakeFetch(fx), probe: "none", lock });
  `);
  const out = [];
  await main(["build", "react@19.2.0", "--graph"], { cwd: dir, log: (s) => out.push(s) });
  assert.match(out.at(-1), /\(3 files hashed\)/);
  const map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.equal(Object.keys(map.integrity).length, 3);
  assert.deepEqual(lock.files, map.integrity);

  const cut = [];
  await main(["build", "react@19.2.0", "--graph", "--max-files", "1", "--relock"], { cwd: dir, log: (s) => cut.push(s) });
  assert.match(cut[0], /warning: the import graph of https:\/\/esm\.sh\/react@19\.2\.0\?target=es2022 was cut short at maxFiles 1 \(1 file\(s\) not hashed\)/);
});

const upgradable = async (extra = "") => {
  const dir = await setup(`
    const fx = {
      ...registryFixtures,
      "https://registry.npmjs.org/old-pkg": { "dist-tags": { latest: "2.0.0" }, versions: { "1.0.0": {}, "1.5.0": {}, "2.0.0": {} } },
      "https://registry.npmjs.org/old-pkg/1.5.0": { type: "module" },
      "https://registry.npmjs.org/old-pkg/1.0.0": { type: "module" },
      "https://registry.npmjs.org/old-pkg/2.0.0": { type: "module" },
    };
    export default ({ lock }) => createRouter({ "*": esmSh() }, { fetch: fakeFetch(fx), probe: "none", lock });
    ${extra}
  `);
  const entry = (specifier, name, range, version) => ({ specifier, registry: "npm", name, range, version, build: "esm.sh", provider: "esm.sh" });
  const lock = {
    lockfileVersion: 1,
    packages: {
      "react@^19": entry("react@^19", "react", "^19", "19.0.0"),
      "old-pkg@^1": entry("old-pkg@^1", "old-pkg", "^1", "1.0.0"),
      "lit@3.3.1": entry("lit@3.3.1", "lit", "3.3.1", "3.3.1"),
      "github:a/b@v1": { specifier: "github:a/b@v1", registry: "github", name: "a/b", version: "v1" },
    },
  };
  await writeFile(join(dir, "mport.lock.json"), JSON.stringify(lock, null, 2));
  return dir;
};

test("15. mport outdated lists what the range allows and the latest overall; --json is machine-readable", async () => {
  const dir = await upgradable();
  const out = [];
  assert.equal(await main(["outdated"], { cwd: dir, log: (s) => out.push(s) }), 0);
  assert.match(out[0], /^package\s+current\s+wanted\s+latest$/);
  assert.match(out.join("\n"), /old-pkg@\^1\s+1\.0\.0\s+1\.5\.0\s+2\.0\.0/);
  assert.match(out.join("\n"), /react@\^19\s+19\.0\.0\s+19\.2\.0\s+19\.2\.0/);
  assert.ok(!out.some((l) => l.startsWith("lit@")), "an up-to-date package is not listed");
  assert.match(out.at(-1), /skipped github:a\/b@v1: GitHub refs have no registry/);

  const json = [];
  await main(["outdated", "--json"], { cwd: dir, log: (s) => json.push(s) });
  const { outdated, skipped } = JSON.parse(json[0]);
  const old = outdated.find((r) => r.name === "old-pkg");
  assert.deepEqual(old, { key: "old-pkg@^1", specifier: "old-pkg@^1", registry: "npm", name: "old-pkg", range: "^1", current: "1.0.0", wanted: "1.5.0", latest: "2.0.0", updatable: true, behindLatest: true });
  assert.equal(outdated.length, 2);
  assert.equal(skipped.length, 1);

  // by name, and nothing outdated
  const one = [];
  await main(["outdated", "react", "--json"], { cwd: dir, log: (s) => one.push(s) });
  assert.deepEqual(JSON.parse(one[0]).outdated.map((r) => r.name), ["react"]);
  const none = [];
  await main(["outdated", "lit"], { cwd: dir, log: (s) => none.push(s) });
  assert.match(none[0], /everything in the lockfile is up to date/);
});

test("15. mport outdated fails clearly with no lockfile", async () => {
  const dir = await setup(`export default createRouter({ "*": esmSh() }, { fetch, probe: "none" });`);
  await assert.rejects(main(["outdated"], { cwd: dir, log() {} }), /no lockfile at mport\.lock\.json/);
  await assert.rejects(main(["update"], { cwd: dir, log() {} }), /no lockfile/);
});

test("15. mport update re-resolves the named entries only and rewrites the lockfile", async () => {
  const dir = await upgradable();
  const out = [];
  await main(["update", "react"], { cwd: dir, log: (s) => out.push(s) });
  assert.match(out[0], /react@\^19: 19\.0\.0 -> 19\.2\.0/);
  assert.match(out[1], /wrote mport\.lock\.json; run `mport build`/);
  let lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.equal(lock.packages["react@^19"].version, "19.2.0");
  assert.equal(lock.packages["old-pkg@^1"].version, "1.0.0", "not named, so left pinned");
  assert.equal(lock.packages["lit@3.3.1"].version, "3.3.1");

  const json = [];
  await main(["update", "--json"], { cwd: dir, log: (s) => json.push(s) });
  const r = JSON.parse(json[0]);
  assert.deepEqual(r.updated, [{ key: "old-pkg@^1", specifier: "old-pkg@^1", name: "old-pkg", from: "1.0.0", to: "1.5.0" }]);
  assert.equal(r.written, true);
  lock = JSON.parse(await readFile(join(dir, "mport.lock.json"), "utf8"));
  assert.equal(lock.packages["old-pkg@^1"].version, "1.5.0", "the range's newest, not the latest overall");

  const again = [];
  await main(["update"], { cwd: dir, log: (s) => again.push(s) });
  assert.match(again[0], /already at the newest version their range allows/);
  await assert.rejects(main(["update", "nonesuch"], { cwd: dir, log() {} }), /no locked entry matches "nonesuch"/);
  await assert.rejects(main(["update", "--relock"], { cwd: dir, log() {} }), /--relock is what update does/);
});

test("15. mport update refuses a prebuilt router", async () => {
  const dir = await setup(`export default createRouter({ "*": esmSh() }, { fetch, probe: "none" });`);
  await writeFile(join(dir, "mport.lock.json"), JSON.stringify({ lockfileVersion: 1, packages: { "react@^19": { ...pinned.packages["react@^19"], name: "react", range: "^19" } } }));
  await assert.rejects(main(["update"], { cwd: dir, log() {} }), /prebuilt router/);
  const out = [];
  await main(["outdated", "--json"], { cwd: dir, log: (s) => out.push(s) });
  assert.equal(JSON.parse(out[0]).outdated[0].wanted, "19.2.0", "outdated only reads, so a prebuilt router is fine");
});
