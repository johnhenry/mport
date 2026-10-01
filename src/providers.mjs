// Providers turn an exact artifact (registry, name, version, path) into a URL.
//
// `build` identifies what the provider serves. Two providers are mirrors of the
// same artifact only when their builds match: jsDelivr and unpkg both serve the
// raw npm files ("npm"), while esm.sh and jspm transform packages, so their
// output is a different artifact even for the same version.

import { select } from "./strategies.mjs";

const join = (...parts) => parts.filter(Boolean).join("/");
// the file to request: a resolved entry (root or exports-mapped sub-path) wins
const sub = (a) => a.entry || a.path;

export function provider({
  name,
  build = name,
  registries = ["npm"],
  capabilities = [],
  needsEntry = false,
  needsVersion = true,
  prefix = true,
  url,
  base,
}) {
  if (typeof url !== "function") throw new TypeError(`mport: provider "${name}" needs a url() function`);
  return {
    kind: "provider",
    name,
    build,
    registries,
    capabilities,
    needsEntry,
    needsVersion,
    prefix,
    url,
    base: base ?? ((a) => url({ ...a, path: "", entry: "" }).replace(/\/?$/, "/")),
    select(req, ctx) {
      return select(this, req, ctx);
    },
  };
}

// esm.sh builds for the requester's User-Agent unless told a target, so an unpinned URL
// serves different bytes to different browsers and breaks a pinned integrity hash.
// `esTarget` pins it (`?target=es2022`); `null` leaves esm.sh to choose.
export const esmSh = ({ origin = "https://esm.sh", name = "esm.sh", esTarget = "es2022" } = {}) => {
  const root = (a) => {
    const reg = a.registry === "jsr" ? "jsr/" : a.registry === "github" ? "gh/" : "";
    return `${origin}/${reg}${a.name}${a.version ? `@${a.version}` : ""}`;
  };
  return provider({
    name,
    build: "esm.sh",
    registries: ["npm", "jsr", "github"],
    capabilities: ["browser", "esm-transform", "types"],
    url: (a) => `${root(a)}${a.path ? `/${a.path}` : ""}${esTarget ? `?target=${esTarget}` : ""}`,
    // a directory can't carry a query, so prefix mappings stay unpinned
    base: (a) => `${root(a)}/`,
  });
};

export const jsDelivr = ({ origin = "https://cdn.jsdelivr.net", esm = false, name } = {}) =>
  provider({
    name: name ?? (esm ? "jsdelivr-esm" : "jsdelivr"),
    build: esm ? "jsdelivr-esm" : "npm",
    registries: esm ? ["npm"] : ["npm", "github"],
    capabilities: esm ? ["browser", "esm-transform"] : ["raw"],
    needsEntry: !esm,
    prefix: !esm,
    url: (a) => {
      const dir = a.registry === "github" ? "gh" : "npm";
      const ver = a.version ? `@${a.version}` : "";
      if (esm) return `${origin}/npm/${a.name}${ver}${a.path ? `/${a.path}` : ""}/+esm`;
      return `${origin}/${dir}/${a.name}${ver}/${sub(a) ?? ""}`;
    },
  });

export const unpkg = ({ origin = "https://unpkg.com", name = "unpkg" } = {}) =>
  provider({
    name,
    build: "npm",
    capabilities: ["raw"],
    needsEntry: true,
    url: (a) => `${origin}/${a.name}${a.version ? `@${a.version}` : ""}/${sub(a) ?? ""}`,
  });

export const jspm = ({ origin = "https://ga.jspm.io", name = "jspm" } = {}) =>
  provider({
    name,
    build: "jspm",
    capabilities: ["browser", "esm-transform"],
    needsEntry: true,
    url: (a) => `${origin}/npm:${a.name}${a.version ? `@${a.version}` : ""}/${sub(a) ?? ""}`,
  });

/** JSR packages, served browser-ready through esm.sh by default. */
export const jsr = ({ via = "esm.sh", origin, name = "jsr", esTarget } = {}) => {
  if (via === "jsr.io") {
    const o = origin ?? "https://jsr.io";
    return provider({
      name,
      build: "jsr",
      registries: ["jsr"],
      capabilities: ["types", "deno"],
      url: (a) => {
        if (!a.path) throw new Error(`mport: jsr.io needs an explicit file path for ${a.name}`);
        return `${o}/${a.name}/${a.version}/${a.path}`;
      },
    });
  }
  return { ...esmSh({ origin: origin ?? "https://esm.sh", name, ...(esTarget !== undefined && { esTarget }) }), registries: ["jsr"] };
};

/** GitHub repositories (`github:user/repo@ref/path`), via jsDelivr or esm.sh. */
export const github = ({ via = "jsdelivr", name = "github", esTarget } = {}) =>
  via === "esm.sh"
    ? { ...esmSh({ name, ...(esTarget !== undefined && { esTarget }) }), registries: ["github"] }
    : { ...jsDelivr({ name }), registries: ["github"], needsEntry: false };

/** Files served by your own origin, e.g. a vendored node_modules. */
export const local = ({ base = "/node_modules/", name = "local", build = "npm" } = {}) =>
  provider({
    name,
    build,
    capabilities: ["raw", "offline"],
    needsEntry: true,
    needsVersion: false,
    url: (a) => `${base.replace(/\/?$/, "/")}${join(a.name, sub(a))}`,
  });

/**
 * A custom origin. Either a template with {name} {version} {path} {entry}
 * {scope} {bare} placeholders, or a base URL ("https://x/"), which becomes
 * "https://x/<name>[@<version>]/<path>".
 */
export function custom(template, { name, build, registries = ["npm"], capabilities = [] } = {}) {
  const hasVersion = !template.includes("{") || template.includes("{version}");
  const hasEntry = template.includes("{entry}");
  const fill = (a) => {
    const [scope, bare] = a.name.startsWith("@") ? a.name.split("/") : ["", a.name];
    const vals = { name: a.name, version: a.version ?? "", path: a.path ?? "", entry: sub(a) ?? "", scope, bare };
    return template.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
  };
  const plain = (a) =>
    `${template.replace(/\/?$/, "/")}${a.name}${a.version ? `@${a.version}` : ""}${a.path ? `/${a.path}` : ""}`;
  const host = (() => { try { return new URL(template.split("{")[0]).host; } catch { return template; } })();
  return provider({
    name: name ?? host,
    build: build ?? host,
    registries,
    capabilities,
    needsEntry: hasEntry,
    needsVersion: hasVersion,
    url: template.includes("{") ? fill : plain,
  });
}

/**
 * mport v1 origin objects: { path: "cdn.jsdelivr.net/npm/", versionMarker?, defaultVersion? }.
 * `https://` is always prepended.
 */
export function origin(o) {
  const { path, versionMarker = "@", defaultVersion = "latest" } = typeof o === "string" ? { path: o } : o;
  return provider({
    name: path,
    build: path,
    needsVersion: false,
    url: (a) => `https://${path}${a.name}${versionMarker}${a.version ?? defaultVersion}/${a.path ?? ""}`,
  });
}

export const DEFAULT_ORIGINS = ["cdn.jsdelivr.net/npm/", "ga.jspm.io/npm:", "unpkg.com/"];
