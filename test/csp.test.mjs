// CSP hashes for the inline import map (issue #2): a static site cannot use a nonce, so the page's
// script-src carries 'sha256-…' of the exact text between the tags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  renderImportMap, renderImportMapCsp, importMapText, importMapHash, cspHash, injectImportMap,
} from "../src/core.mjs";

const reference = (text, algorithm = "sha256") => `'${algorithm}-${createHash(algorithm).update(text, "utf8").digest("base64")}'`;
const bodyOf = (html) => /^<script[^>]*>([\s\S]*)<\/script>$/.exec(html)[1];

const plain = { imports: { react: "https://esm.sh/react@19.2.0?target=es2022", "lit/": "https://esm.sh/lit@3.3.1/" }, integrity: { "https://esm.sh/react@19.2.0?target=es2022": "sha384-abc" } };
// everything renderImportMap escapes, plus non-ASCII and a quote, so a wrong hash would show
const nasty = { imports: { "a</script><script>x": "https://x.test/a\u2028b\u2029c?q=\"é€😀", "ünï/": "https://x.test/ü/" } };

test("cspHash matches known vectors and node:crypto, quotes included", async () => {
  assert.equal(await cspHash(""), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  for (const alg of ["sha256", "sha384", "sha512"]) assert.equal(await cspHash("a€😀\n", alg), reference("a€😀\n", alg));
  await assert.rejects(cspHash("x", "md5"), /sha256, sha384 or sha512/);
});

test("importMapHash is the hash of the exact bytes between the tags of renderImportMap()", async () => {
  for (const map of [plain, nasty, { imports: {} }]) {
    const html = renderImportMap(map);
    assert.equal(await importMapHash(map), reference(bodyOf(html)));
    assert.equal(importMapText(map), bodyOf(html), "importMapText is the rendered body");
    for (const alg of ["sha384", "sha512"]) assert.equal(await importMapHash(map, { algorithm: alg }), reference(bodyOf(html), alg));
  }
});

test("the escapes are in the hashed text: nothing can end the script early", async () => {
  const html = renderImportMap(nasty);
  assert.equal(html.match(/<\/script>/g).length, 1);
  assert.ok(!/[\u2028\u2029]/.test(html));
  assert.ok(bodyOf(html).includes("\\u003c/script>"));
  // and the JSON still parses back to the same map
  assert.deepEqual(JSON.parse(bodyOf(html)), nasty);
});

test("renderImportMapCsp returns the html, the hash and the text, consistently; a nonce changes the tag, not the hash", async () => {
  const r = await renderImportMapCsp(plain);
  assert.equal(r.html, renderImportMap(plain));
  assert.equal(r.text, bodyOf(r.html));
  assert.equal(r.hash, reference(r.text));
  const n = await renderImportMapCsp(plain, { nonce: "abc123", algorithm: "sha384" });
  assert.match(n.html, /^<script type="importmap" nonce="abc123">/);
  assert.equal(n.hash, reference(n.text, "sha384"));
  assert.equal(n.text, r.text);
});

test("injectImportMap sets the same text, so the same hash allows a DOM-injected map; it can carry a nonce", async () => {
  const document = { createElement: () => ({}), querySelector: () => null, head: { insertBefore() {} } };
  const el = injectImportMap(nasty, { document, nonce: "n1" });
  assert.equal(el.textContent, importMapText(nasty));
  assert.equal(await importMapHash(nasty), reference(el.textContent));
  assert.equal(el.nonce, "n1");
  assert.equal(injectImportMap(plain, { document }).nonce, undefined);
});
