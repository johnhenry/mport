import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpecifier, keyOf } from "../src/specifier.mjs";

const p = (s) => {
  const { raw, ...rest } = parseSpecifier(s);
  return rest;
};

test("bare, versioned and sub-path npm specifiers", () => {
  assert.deepEqual(p("react"), { registry: "npm", explicit: false, name: "react", range: undefined, path: "", prefix: false });
  assert.deepEqual(p("react@^19/jsx-runtime"), { registry: "npm", explicit: false, name: "react", range: "^19", path: "jsx-runtime", prefix: false });
  assert.equal(p("lodash-es@4.17.21/lodash.js").path, "lodash.js");
});

test("scoped packages keep their scope (v1 split on every @)", () => {
  assert.deepEqual(p("@scope/pkg"), { registry: "npm", explicit: false, name: "@scope/pkg", range: undefined, path: "", prefix: false });
  const s = p("@scope/pkg@1.2.3/dist/x.js");
  assert.equal(s.name, "@scope/pkg");
  assert.equal(s.range, "1.2.3");
  assert.equal(s.path, "dist/x.js");
});

test("registry prefixes", () => {
  assert.equal(p("npm:lodash-es@4").registry, "npm");
  assert.equal(p("npm:lodash-es@4").explicit, true);
  assert.deepEqual([p("jsr:@std/path@1").registry, p("jsr:@std/path@1").name, p("jsr:@std/path@1").range], ["jsr", "@std/path", "1"]);
  const g = p("gh:johnhenry/mport@main/src/index.mjs");
  assert.deepEqual([g.registry, g.name, g.range, g.path], ["github", "johnhenry/mport", "main", "src/index.mjs"]);
  assert.throws(() => parseSpecifier("jsr:path"), /scoped/);
});

test("prefix specifiers and keys", () => {
  const s = parseSpecifier("lodash-es@4/");
  assert.equal(s.prefix, true);
  assert.equal(keyOf(s), "lodash-es/");
  assert.equal(keyOf(parseSpecifier("npm:react@19/jsx-runtime")), "npm:react/jsx-runtime");
  assert.equal(keyOf(parseSpecifier("@scope/pkg@1")), "@scope/pkg");
});

test("object form and unroutable specifiers", () => {
  assert.deepEqual(p({ name: "spintax", version: "1.1.2", path: "/src/index.mjs" }),
    { registry: "npm", explicit: false, name: "spintax", range: "1.1.2", path: "src/index.mjs", prefix: false });
  for (const s of ["./x.js", "../x.js", "/x.js", "https://esm.sh/react", "data:text/javascript,1"]) {
    assert.equal(parseSpecifier(s), null, s);
  }
});
