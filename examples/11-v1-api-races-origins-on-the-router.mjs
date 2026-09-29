// The 1.x API is a thin layer over the router: MPortURL() races the origins by
// importing from each, and the first import to SUCCEED wins (1.x used Promise.race, so
// one fast failure rejected everything). Node can't import https: URLs, so this uses
// createV1(), the internal factory both entry points are built from, with a fake
// importer; in a browser or Deno, `import { MPortURL } from "@johnhenry/mport"` is
// the same function with the real import().
import assert from "node:assert/strict";
import { createV1 } from "../src/v1.mjs";

const importer = async (url) => {
  await new Promise((res) => setTimeout(res, url.includes("jsdelivr") ? 1 : url.includes("jspm") ? 10 : 20));
  if (url.includes("jsdelivr")) throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  return { default: url };
};
const { mport, MPort, MPortURL } = createV1({ importer, jsonImporter: async () => { throw new Error("offline"); } });

const [module, url, info] = await MPortURL()("lodash-es@4.17.21/lodash.js");
assert.equal(url, "https://ga.jspm.io/npm:lodash-es@4.17.21/lodash.js", "jsDelivr failed fastest; jspm answered first");
assert.equal(module.default, url);
assert.equal(info.provider, "ga.jspm.io/npm:");
assert.ok(info.trace.some((e) => e.type === "fail" && e.provider === "cdn.jsdelivr.net/npm/"));

// Scoped names parse (1.x split on the first "@"), and origin arguments are honoured.
const [, scoped] = await MPortURL("unpkg.com/")("@scope/pkg@1.2.3/dist/x.js");
assert.equal(scoped, "https://unpkg.com/@scope/pkg@1.2.3/dist/x.js");
assert.equal((await MPort({ cdns: [{ path: "esm.run/", versionMarker: "@" }] })({ name: "x", version: "1", path: "y.js" })).default, "https://esm.run/x@1/y.js");
assert.equal((await mport("x@1/y.js")).default, "https://ga.jspm.io/npm:x@1/y.js");

console.log("11 ok:", url);
