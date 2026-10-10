// @ts-self-types="./types.d.ts"
import { createV1 } from "./v1.mjs";
import { importerFor, json } from "./v1-importer.mjs";

const { MPort, MPortURL, mport } = createV1({ importerFor, jsonImporter: json });

export * from "./core.mjs";
export { MPort, MPortURL, mport };
export default mport;
