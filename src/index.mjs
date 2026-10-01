// @ts-self-types="./types.d.ts"
import { createV1 } from "./v1.mjs";

const { MPort, MPortURL, mport } = createV1({
  importer: (url, options) => (options === undefined ? import(url) : import(url, options)),
  jsonImporter: (url) => import(url, { with: { type: "json" } }),
});

export * from "./core.mjs";
export { MPort, MPortURL, mport };
export default mport;
