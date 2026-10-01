// Shared core of the Vite and Rollup plugins (Node side; these entry points are for
// build tooling, not the browser). A bundler hands us each bare import; we resolve it
// through a router and either
//   mode "external"  leave the import in the bundle as the CDN URL, or
//   mode "importmap" leave it bare and produce the import map that maps it.
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { builtinModules } from "node:module";
import { parseSpecifier } from "./specifier.mjs";

const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));
// a package.json range a registry can resolve (not workspace:, file:, git URLs, aliases or paths)
const REGISTRY_RANGE = /^(?![a-z]+:|\.|\/|git|github|http)/i;

const MODES = ["external", "importmap"];

export function createBundlerCore(router, options = {}) {
  if (!router || typeof router.resolve !== "function" || typeof router.build !== "function") {
    throw new TypeError("mport: the bundler plugins need a router (createRouter(...))");
  }
  const {
    mode = "external",
    versions = {},
    packageJson = false,
    exclude,
    specifiers = [],
    build: buildOptions = {},
  } = options;
  if (!MODES.includes(mode)) throw new TypeError(`mport: plugin option mode must be "external" or "importmap", got ${JSON.stringify(mode)}`);

  let ranges = { ...versions };
  const excluded = (source, name) => {
    if (typeof exclude === "function") return !!exclude(source);
    if (exclude instanceof RegExp) return exclude.test(source);
    return Array.isArray(exclude) && (exclude.includes(source) || exclude.includes(name));
  };
  const collected = new Map(); // versioned specifier → Promise<Resolution|null>
  const wanted = new Set(); // specifiers whose resolution should be in the import map

  const specifierFor = (parsed) => {
    const range = parsed.range ?? ranges[parsed.name];
    const reg = parsed.explicit ? `${parsed.registry}:` : "";
    return `${reg}${parsed.name}${range ? `@${range}` : ""}${parsed.path ? `/${parsed.path}` : ""}`;
  };

  return {
    mode,
    /** Read dependency ranges from a package.json (explicit `versions` win). Call once the project root is known. */
    async loadPackageJson(root = process.cwd()) {
      if (!packageJson) return;
      const file = resolvePath(root, packageJson === true ? "package.json" : packageJson);
      const pkg = JSON.parse(await readFile(file, "utf8"));
      const deps = { ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.dependencies };
      const fromPkg = Object.fromEntries(Object.entries(deps).filter(([, r]) => typeof r === "string" && REGISTRY_RANGE.test(r)));
      ranges = { ...fromPkg, ...versions };
    },

    /**
     * What a bundler's resolveId should return for `source`: `{ id, external: true }` for a
     * bare package import the router routes, `null` for anything else (relative paths, URLs,
     * `node:` and Node built-ins, excluded packages, specifiers no route matches).
     */
    async resolveId(source) {
      if (typeof source !== "string" || source.startsWith("\0")) return null;
      const bare = source.replace(/^node:/, "");
      if (source.startsWith("node:") || BUILTINS.has(bare) || BUILTINS.has(bare.split("/")[0])) return null;
      let parsed;
      try { parsed = parseSpecifier(source); } catch { return null; }
      if (!parsed || parsed.prefix) return null;
      if (excluded(source, parsed.name)) return null;
      const spec = specifierFor(parsed);
      if (!collected.has(spec)) collected.set(spec, router.resolve(spec));
      const r = await collected.get(spec);
      if (r === null) return null; // no route matches: leave it to the bundler
      wanted.add(spec);
      return { id: mode === "external" ? r.url : source, external: true };
    },

    /** Every specifier routed so far plus the `specifiers` option, in a stable order. */
    specifiers: () => [...new Set([...specifiers, ...wanted])].sort(),

    /** The import map (and lockfile) for what was routed: `router.build()` over `specifiers()`. */
    async importMap() {
      return router.build(this.specifiers(), buildOptions);
    },
  };
}
