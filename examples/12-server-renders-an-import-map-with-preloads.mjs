// A server (no DOM) can turn a build into HTML: the import map as a <script>, and a
// <link rel="modulepreload"> per module with its integrity hash. Two versions of one
// key can't share an import map, so build() refuses instead of keeping one silently.
import assert from "node:assert/strict";
import { createRouter, esmSh, verified, renderImportMap, renderModulePreload } from "@johnhenry/mport";
import { offlineFetch, registry, allUp } from "./_offline.mjs";

const router = createRouter({ "*": verified(esmSh()) }, { fetch: offlineFetch({ ...registry, ...allUp }) });
const { importMap } = await router.build(["react@^19", "lit/"]);

// The import map first: Firefox ignores one that follows a modulepreload (test/browser/runtime.spec.mjs).
const head = `${renderImportMap(importMap)}\n${renderModulePreload(importMap)}`;
assert.match(head, /^<script type="importmap">.*<\/script>\n<link rel="modulepreload" href="https:\/\/esm\.sh\/react@19\.2\.0\?target=es2022" integrity="sha384-[^"]+" crossorigin="anonymous">/s);
assert.ok(!head.includes('href="https://esm.sh/lit@3.3.1/"'), "a prefix mapping is a directory, not a module to preload");

await assert.rejects(router.build(["react@18.3.1", "react@^19"]), /conflicting resolutions for "react".*scope/);
const ok = await router.build(["react@^19"], { scopes: { "https://legacy.example.com/": { react: "react@18.3.1" } } });
assert.equal(ok.importMap.scopes["https://legacy.example.com/"].react, "https://esm.sh/react@18.3.1?target=es2022");

console.log("12 ok:", head.split("\n").length, "head lines");
