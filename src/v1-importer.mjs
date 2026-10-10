// The standard entry point's importers for the v1 API. Only src/index.mjs
// imports this file: the Firefox entry must never reach a two-argument import().
//
// Every import() here has literal attributes. A variable second argument
// (`import(url, options)`) cannot be analysed statically, and Rollup (so Vite 7
// and older) warned about it in every build that imported the package (#5).
// The per-call import options of mport()/MPort()/MPortURL() are therefore
// mapped onto a fixed set: no attributes, { type: "json" } or { type: "css" }.

const plain = (url) => import(url);
export const json = (url) => import(url, { with: { type: "json" } });
const css = (url) => import(url, { with: { type: "css" } });

// importOptions -> (url) => Promise<module>. Throws a TypeError, before anything
// is imported, for options it cannot pass on.
export function importerFor(options) {
  if (options === undefined) return plain;
  if (options === null || typeof options !== "object") throw new TypeError("mport: import options must be an object");
  const attributes = options.with;
  if (attributes === undefined) return plain;
  if (attributes === null || typeof attributes !== "object") throw new TypeError("mport: import options' `with` must be an object");
  const keys = Object.keys(attributes);
  if (keys.length === 0) return plain;
  if (keys.length === 1 && keys[0] === "type") {
    if (attributes.type === "json") return json;
    if (attributes.type === "css") return css;
  }
  throw new TypeError(
    `mport: unsupported import attributes ${JSON.stringify(attributes)}; ` +
      `the v1 API passes { type: "json" } and { type: "css" } (use createRouter({ importer }) for others)`,
  );
}
