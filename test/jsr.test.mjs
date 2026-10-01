// jsr.json must mirror package.json (name, version, exports) and every entry point must point JSR at its declaration file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));

test("jsr.json: same name and version as package.json, exports mirror package.json", async () => {
  const [pkg, jsr] = await Promise.all([read("package.json"), read("jsr.json")]);
  assert.equal(jsr.name, pkg.name);
  assert.equal(jsr.version, pkg.version);
  const exports = Object.fromEntries(Object.entries(pkg.exports).filter(([k]) => k !== "./package.json").map(([k, v]) => [k, v.default]));
  assert.deepEqual(jsr.exports, exports);
});

test("jsr.json: every entry point declares its types with @ts-self-types, the same file package.json's `types` names", async () => {
  const [pkg, jsr] = await Promise.all([read("package.json"), read("jsr.json")]);
  for (const [key, file] of Object.entries(jsr.exports)) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const declared = /^\/\/ @ts-self-types="([^"]+)"/m.exec(source)?.[1];
    assert.ok(declared, `${file} needs a // @ts-self-types="<its .d.ts>" comment (JSR needs types for a JavaScript entry point)`);
    const types = pkg.exports[key].types;
    assert.equal(new URL(declared, new URL(`../${file}`, import.meta.url)).href, new URL(`../${types}`, import.meta.url).href, `${file}: @ts-self-types matches the "types" of "${key}"`);
  }
});
