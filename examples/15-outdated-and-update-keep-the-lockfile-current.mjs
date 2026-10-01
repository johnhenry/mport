// `mport outdated` compares each locked version with what the specifier's range allows
// ("wanted") and the registry's `latest`; `mport update [name…]` re-resolves entries
// within their ranges and rewrites the lockfile. Run as the real CLI, offline.
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
  import { createRouter, esmSh } from "@johnhenry/mport";
  import { offlineFetch, registry } from ${JSON.stringify(offline)};
  const fetch = offlineFetch(registry);
  export default ({ lock }) => createRouter({ "*": esmSh() }, { fetch, probe: "none", lock });
`);
await mkdir(join(dir, "node_modules", "@johnhenry"), { recursive: true });
await symlink(fileURLToPath(new URL("..", import.meta.url)), join(dir, "node_modules", "@johnhenry", "mport"));

const bin = fileURLToPath(new URL("../bin/mport.mjs", import.meta.url));
const run = (...args) => promisify(execFile)(process.execPath, [bin, ...args], { cwd: dir });
try {
  // A lockfile that has fallen behind: react ^18 and ^19 are locked at 18.3.1 and 19.0.0.
  await run("build", "react@^18", "react@^19", "--conflicts", "scope");
  const lockPath = join(dir, "mport.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.packages["react@^19"].version = "19.0.0";
  await writeFile(lockPath, JSON.stringify(lock));

  const { outdated } = JSON.parse((await run("outdated", "--json")).stdout);
  assert.deepEqual(outdated.map((r) => [r.specifier, r.current, r.wanted, r.latest]), [
    ["react@^18", "18.3.1", "18.3.1", "19.2.0"],   // in range, but a newer major exists
    ["react@^19", "19.0.0", "19.2.0", "19.2.0"],   // the range allows a newer version
  ]);

  // Update only the ^19 entry; the ^18 entry stays where it is.
  const { stdout } = await run("update", "react@^19");
  assert.match(stdout, /react@\^19: 19\.0\.0 -> 19\.2\.0/);
  const after = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(after.packages["react@^19"].version, "19.2.0");
  assert.equal(after.packages["react@^18"].version, "18.3.1");

  const second = JSON.parse((await run("outdated", "--json")).stdout);
  assert.deepEqual(second.outdated.map((r) => r.specifier), ["react@^18"], "only the major bump is left");
  console.log("15 ok:", second.outdated.map((r) => `${r.specifier} ${r.current} -> latest ${r.latest}`).join(", "));
} finally {
  await rm(dir, { recursive: true, force: true });
}
