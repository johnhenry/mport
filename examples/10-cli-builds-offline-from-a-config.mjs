// The `mport` CLI reads mport.config.mjs, writes importmap.json and mport.lock.json,
// and on the next run pins versions from that lockfile. The config's `options` go to
// createRouter, so here a fake fetch keeps it offline.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "mport-example-"));
const offline = new URL("./_offline.mjs", import.meta.url).href;
await writeFile(join(dir, "mport.config.mjs"), `
  import { esmSh, jsDelivr, jsr } from "@johnhenry/mport";
  import { offlineFetch, registry, allUp } from ${JSON.stringify(offline)};
  export default {
    routes: { "*": [esmSh(), jsDelivr()], "@std/*": jsr() },
    specifiers: ["react@^19", "lit/", "@std/path@^1"],
    options: { fetch: offlineFetch({ ...registry, ...allUp }) },
  };
`);
// The config imports "@johnhenry/mport"; link this repo in as if it were installed.
await mkdir(join(dir, "node_modules", "@johnhenry"), { recursive: true });
await symlink(fileURLToPath(new URL("..", import.meta.url)), join(dir, "node_modules", "@johnhenry", "mport"));

const bin = fileURLToPath(new URL("../bin/mport.mjs", import.meta.url));
const run = (...args) => promisify(execFile)(process.execPath, [bin, ...args], { cwd: dir });
try {
  const { stdout } = await run("build");
  assert.match(stdout, /wrote importmap\.json \(3 imports\) and mport\.lock\.json/);
  const map = JSON.parse(await readFile(join(dir, "importmap.json"), "utf8"));
  assert.deepEqual(map.imports, {
    react: "https://esm.sh/react@19.2.0",
    "lit/": "https://esm.sh/lit@3.3.1/",
    "@std/path": "https://esm.sh/jsr/@std/path@1.1.0",
  });

  // Edit the lockfile by hand: the next resolve honours the pin.
  const lockPath = join(dir, "mport.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.packages["react@^19"].version = "19.0.0";
  await writeFile(lockPath, JSON.stringify(lock));
  const resolved = JSON.parse((await run("resolve", "react@^19", "--trace")).stdout);
  assert.equal(resolved.url, "https://esm.sh/react@19.0.0");
  assert.ok(!resolved.trace.some((e) => e.type === "lookup"), "no registry lookup for a pinned version");

  // --relock ignores it.
  assert.equal(JSON.parse((await run("resolve", "react@^19", "--relock")).stdout).version, "19.2.0");

  // Errors go to stderr with exit code 1.
  await assert.rejects(run("frobnicate"), (e) => e.code === 1 && /unknown command "frobnicate"/.test(e.stderr));
  console.log("10 ok:", JSON.stringify(map.imports));
} finally {
  await rm(dir, { recursive: true, force: true });
}
