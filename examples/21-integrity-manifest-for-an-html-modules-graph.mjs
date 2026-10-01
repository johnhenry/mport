// An html-modules page loads <html-import src> and <html-export src> files that reference each other. htmlGraph()
// (and build({ html })) walks that graph, hashes every file and returns an integrity manifest: URL -> sha384, the same
// shape as an import map's `integrity`. Give it to html-modules as createHTMLModules({ integrity, strict: true }) and a
// tampered file anywhere in the graph is refused. Reading the HTML needs the optional peer @johnhenry/html-modules.
import assert from "node:assert/strict";
import { createRouter, esmSh, htmlGraph, integrityManifest } from "@johnhenry/mport";
import { offlineFetch, registry } from "./_offline.mjs";

const files = {
  "https://ui.example/app.html": '<html-import src="./card.html" as="card"></html-import><html-import src="./logic.js" as="logic"></html-import>',
  "https://ui.example/card.html": '<html-export name="ui-card"><template>card</template></html-export><html-export src="./icon.html"></html-export>',
  "https://ui.example/icon.html": '<html-export name="ui-icon"><template>icon</template></html-export>',
  "https://ui.example/logic.js": 'import "./util.js"; export const ready = true;',
  "https://ui.example/util.js": "export const util = 1;",
};

const { integrity, files: count } = await htmlGraph("https://ui.example/app.html", { fetch: offlineFetch(files) });
assert.equal(count, 5, "HTML modules, their re-exports, and the JavaScript they import");
assert.deepEqual(Object.keys(integrity), Object.keys(files).sort());
assert.ok(Object.values(integrity).every((h) => h.startsWith("sha384-")));

// the same hashes, as part of a build: the import map's `integrity` and the lockfile's `files`
const make = (table, o = {}) => createRouter({ "*": esmSh() }, { fetch: offlineFetch({ ...registry, ...table }), probe: "none", ...o });
const { importMap, lock } = await make(files).build([], { html: ["https://ui.example/app.html"] });
assert.deepEqual(importMap.integrity, integrity);
assert.deepEqual(lock.files, integrity);
assert.deepEqual(integrityManifest({ importMap }), integrity);

// the committed lockfile now guards the graph: a changed file rejects the next build
const tampered = { ...files, "https://ui.example/icon.html": '<html-export name="ui-icon"><template><img src=x onerror=steal()></template></html-export>' };
await assert.rejects(make(tampered, { lock }).build([], { html: ["https://ui.example/app.html"] }), (e) => e.name === "IntegrityError" && /icon\.html/.test(e.message));

console.log("21 ok:", count, "files in the manifest");
