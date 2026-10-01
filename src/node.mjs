// Node-only entry point (`@johnhenry/mport/node`). The core is browser code with no
// imports from node:; anything that touches the disk lives here instead.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { entryInfo, ResolutionError } from "./registry.mjs";
import { valid, satisfies } from "./semver.mjs";

const toPath = (root) => (root instanceof URL || String(root).startsWith("file:") ? fileURLToPath(root) : String(root));

/**
 * A registry client that answers from packages installed on disk (`<root>/<name>/package.json`)
 * instead of the npm registry, for `createRouter(routes, { registry })`. It is what makes
 * `local()` work for a package that is not on npm (installed from git, `file:`, a workspace) and
 * makes a published one resolve to the INSTALLED version rather than the registry's `latest`.
 *
 * @param {object} options
 * @param {string|URL} options.root the directory holding the packages, usually `<project>/node_modules`
 * @param {object|false} [options.fallback=false] a registry client (e.g. `createRegistry()`) asked about packages that are
 *   not installed under `root`; by default they are a `ResolutionError`
 */
export function installedRegistry({ root, fallback = false } = {}) {
  if (!root) throw new TypeError("mport: installedRegistry needs a root (the node_modules directory)");
  const dir = toPath(root);
  const manifests = new Map(); // name → Promise<package.json | null>
  const read = (name) => {
    if (!manifests.has(name)) {
      manifests.set(name, readFile(join(dir, name, "package.json"), "utf8").then(
        (text) => {
          try { return JSON.parse(text); } catch (e) { throw new ResolutionError(`mport: ${join(dir, name, "package.json")} is not valid JSON (${e.message})`, { cause: e }); }
        },
        (e) => {
          if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
          throw e;
        },
      ));
    }
    return manifests.get(name);
  };
  const need = async (name, reg = "npm") => {
    const pkg = reg === "npm" ? await read(name) : null;
    if (pkg) {
      if (typeof pkg.version !== "string" || !valid(pkg.version)) {
        throw new ResolutionError(`mport: ${join(dir, name, "package.json")} has no valid "version" (${JSON.stringify(pkg.version)})`);
      }
      return pkg;
    }
    return null;
  };
  const missing = (name) => new ResolutionError(`mport: ${name} is not installed under ${dir} (no ${join(name, "package.json")})`);

  const self = {
    /** the directory packages are read from */
    root: dir,
    async version(parsed) {
      const pkg = await need(parsed.name, parsed.registry);
      if (!pkg) {
        if (fallback) return fallback.version(parsed);
        throw missing(parsed.name);
      }
      const { range } = parsed;
      // a dist-tag ("latest") names whatever is installed; a range must be satisfied by it
      if (range && !/^[A-Za-z][\w.-]*$/.test(range) && !satisfies(pkg.version, range)) {
        throw new ResolutionError(`mport: ${parsed.name}@${pkg.version} is installed under ${dir}, which does not satisfy "${range}"`);
      }
      return pkg.version;
    },
    async info(reg, name) {
      const pkg = await need(name, reg === "jsr" ? "jsr" : "npm");
      if (!pkg) {
        if (fallback) return fallback.info(reg, name);
        throw missing(name);
      }
      return { versions: [pkg.version], tags: { latest: pkg.version }, deprecated: new Set() };
    },
    async manifest(name, version) {
      const pkg = await need(name);
      if (!pkg) {
        if (fallback) return fallback.manifest(name, version);
        throw missing(name);
      }
      if (version !== undefined && pkg.version !== version) {
        if (fallback) return fallback.manifest(name, version);
        throw new ResolutionError(`mport: ${name}@${version} was asked for, but ${pkg.version} is what is installed under ${dir}`);
      }
      return pkg;
    },
    async entryInfo(name, version, subpath = "") {
      const pkg = await self.manifest(name, version);
      return entryInfo(pkg, subpath);
    },
    async entry(name, version, subpath = "") {
      return (await self.entryInfo(name, version, subpath)).file;
    },
  };
  return self;
}
