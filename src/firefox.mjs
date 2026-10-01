// @ts-self-types="./types.d.ts"
// Firefox entry point. Older SpiderMonkey rejects any two-argument import()
// at parse time, so this file (and everything it imports) uses only the
// one-argument form. package.json files are fetched instead of imported, so
// path-less specifiers work here too; per-call import options are ignored.
import { createV1 } from "./v1.mjs";

const { MPort, MPortURL, mport } = createV1({
  importer: (url) => import(url),
  jsonImporter: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mport: ${url} responded ${res.status}`);
    return { default: await res.json() };
  },
});

export * from "./core.mjs";
export { MPort, MPortURL, mport };
export default mport;
