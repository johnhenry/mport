// Type declarations for @johnhenry/mport/core: everything in the main entry point
// except the v1 functions (MPort, MPortURL, mport, default). See types.d.ts.
export {
  createRouter, route,
  parseSpecifier, keyOf, isRoutable,
  provider, esmSh, jsDelivr, unpkg, jspm, jsr, github, local, custom, origin, DEFAULT_ORIGINS,
  fallback, race, adaptive, weighted, prefer, verified, cache, sri,
  HealthRegistry, RoutingError, SkipError, IntegrityError,
  createRegistry, entryOf, entryInfo, resolveExports, ResolutionError,
  compileImportMap, mergeImportMaps,
  createLock, lockKey,
  injectImportMap, startup, createImporter,
  semver,
  DEFAULT_CACHE_KEY,
} from "./types.js";

export type {
  MPortOptions, SpecifierObject, MPortOrigin, Registry, ParsedSpecifier, Artifact, TraceEvent, Resolution,
  Node, Provider, ProviderDefinition, Match, Route, Routes, LockEntry, Lockfile, Lock, ImportMap, Probe,
  CircuitBreakerOptions, RegistryClient, RouterOptions, ResolveOptions, BuildOptions, BuildResult, Router,
  CacheStore, HealthState,
} from "./types.js";
