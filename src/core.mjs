// Everything in mport v2 except the default-export importer, shared by the
// standard and Firefox entry points.
export { createRouter, route } from "./router.mjs";
export { parseSpecifier, keyOf, isRoutable } from "./specifier.mjs";
export {
  provider, esmSh, jsDelivr, unpkg, jspm, jsr, github, local, custom, origin, DEFAULT_ORIGINS,
} from "./providers.mjs";
export {
  fallback, race, adaptive, weighted, prefer, verified, cache, sri,
  HealthRegistry, RoutingError, SkipError, IntegrityError,
} from "./strategies.mjs";
export { createRegistry, entryOf, entryInfo, resolveExports, ResolutionError } from "./registry.mjs";
export { compileImportMap, mergeImportMaps } from "./importmap.mjs";
export { createLock, lockKey } from "./lock.mjs";
export { injectImportMap, startup, createImporter } from "./runtime.mjs";
export * as semver from "./semver.mjs";
export { DEFAULT_CACHE_KEY } from "./v1.mjs";
