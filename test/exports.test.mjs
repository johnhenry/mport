// The declared exports (src/types.d.ts, src/core.d.ts) must name exactly the runtime
// exports of each entry point, so the types cannot silently drift from the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (f) => readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
const sorted = (xs) => [...new Set(xs)].sort();

function declaredValues(dts) {
  const code = dts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const names = [...code.matchAll(/^export (?:declare )?(?:function|const|class|namespace) (\w+)/gm)].map((m) => m[1]);
  if (/^export default /m.test(code)) names.push("default");
  for (const [, list] of code.matchAll(/^export \{([^}]*)\} from/gm)) {
    names.push(...list.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return sorted(names);
}

test("types.d.ts declares exactly the exports of the main and firefox entry points", async () => {
  const declared = declaredValues(await read("types.d.ts"));
  assert.deepEqual(declared, sorted(Object.keys(await import("../src/index.mjs"))));
  assert.deepEqual(declared, sorted(Object.keys(await import("../src/firefox.mjs"))));
});

test("core.d.ts declares exactly the exports of the core entry point", async () => {
  assert.deepEqual(declaredValues(await read("core.d.ts")), sorted(Object.keys(await import("../src/core.mjs"))));
});

test("semver namespace declares the runtime semver functions", async () => {
  const dts = await read("types.d.ts");
  const block = /export namespace semver \{([\s\S]*?)\n\}/.exec(dts)[1];
  const declared = sorted([...block.matchAll(/function (\w+)/g)].map((m) => m[1]));
  assert.deepEqual(declared, sorted(Object.keys((await import("../src/core.mjs")).semver)));
});

test("package.json exports point at files that exist", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [sub, target] of Object.entries(pkg.exports)) {
    for (const file of typeof target === "string" ? [target] : Object.values(target)) {
      await assert.doesNotReject(readFile(new URL(`../${file}`, import.meta.url)), `${sub} → ${file}`);
    }
  }
});
