// A static site (GitHub Pages, any CDN) has no per-response nonce, so a strict
// Content-Security-Policy has to allow the inline <script type="importmap"> by HASH, and
// the hash must be of the exact text between the tags. renderImportMapCsp() returns the
// HTML and that hash together, from the same string, so they cannot drift apart.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRouter, esmSh, renderImportMapCsp, importMapHash } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

const router = createRouter({ "*": esmSh() }, { fetch: offlineFetch(registry), probe: "none" });
const { importMap } = await router.build(["react@^19", "lit/"]);

const { html, hash, text } = await renderImportMapCsp(importMap);
const page = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https://esm.sh ${hash}">
${html}
<script type="module" src="./main.js"></script>`;

// what a browser computes for the script element's text: SHA-256 of its UTF-8 bytes, base64
const emitted = /<script type="importmap">([^<]*)<\/script>/.exec(page)[1];
assert.equal(emitted, text);
assert.equal(hash, `'sha256-${createHash("sha256").update(emitted, "utf8").digest("base64")}'`);
assert.equal(await importMapHash(importMap), hash, "importMapHash() is the same value without rendering");

// a different algorithm, and any change to the map changes the hash
assert.match(await importMapHash(importMap, { algorithm: "sha384" }), /^'sha384-/);
assert.notEqual(await importMapHash({ imports: { ...importMap.imports, extra: "https://esm.sh/x" } }), hash);

console.log("18 ok:", hash);
