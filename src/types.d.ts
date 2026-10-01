// Type declarations for @johnhenry/mport (the "." and "./firefox" entry points).
// "./core" is declared in core.d.ts, which re-exports everything here except the
// v1 functions (MPort, MPortURL, mport and the default export).
//
// The full reference, with defaults and behaviour, is docs/api.md. When you change
// an export, test/exports.test.mjs checks that these declarations name the same
// runtime exports, and `npm run typecheck` compiles test/types.check.ts against them.

// ---------------------------------------------------------------- v1 API

/** A package request in object form (v1 and v2). */
export interface MPortOptions {
  /** The name of the npm package to import */
  name: string;
  /** Package version, range or dist-tag. v1 uses "latest" when omitted; the v2 router resolves "latest". */
  version?: string;
  /** Optional sub-path within the package, e.g. 'dist/index.mjs'. Leading slashes are stripped. */
  path?: string;
}

/** Object specifier accepted by the v2 router: MPortOptions plus a registry (default "npm"). */
export interface SpecifierObject extends MPortOptions {
  registry?: Registry;
}

/** A v1 origin. `https://` is always prepended to `path`. */
export interface MPortOrigin {
  /** Origin prefix without protocol, e.g. "cdn.jsdelivr.net/npm/" */
  path: string;
  /** Separator between name and version (default "@") */
  versionMarker?: string;
  /**
   * Version used when the artifact has none (default "latest"). The v1 functions always
   * pass a version ("latest" when the specifier has none), so this only takes effect when
   * the origin is used as a provider in a router with `resolveVersions: false`.
   */
  defaultVersion?: string;
}

export interface MPortFactoryOptions {
  /** Origins to race (default DEFAULT_ORIGINS). Strings are shorthand for { path }. */
  cdns?: Array<string | MPortOrigin>;
  /** "localhost" stores each winning URL in localStorage and reuses it. Anything else: no cache. */
  useCache?: "localhost";
  /** localStorage key for useCache (default DEFAULT_CACHE_KEY, "mport-cache") */
  cacheKey?: string;
}

/**
 * Debug information: which CDN won and every attempt made. For a specifier with a
 * path it is the router's Resolution (without `module`); for a path-less specifier it
 * is { url, name, version, packageJson, entry, cached: false } and has no trace; for a
 * cache hit it is { url, cached: true, trace: [] }.
 */
export interface MPortInfo extends Partial<Omit<Resolution, "module">> {
  url: string;
  cached: boolean;
  /** package.json URL used for path-less specifiers */
  packageJson?: string;
}

export type MPortURLResult<T = any> = [module: T, url: string, info: MPortInfo];
export type MPortResult<T = any> = T;

type Input = string | MPortOptions;

export function MPort<T = any>(options?: MPortFactoryOptions): (input: Input, importOptions?: ImportCallOptions) => Promise<MPortResult<T>>;
export function MPort<T = any>(...origins: string[]): (input: Input, importOptions?: ImportCallOptions) => Promise<MPortResult<T>>;
export function MPortURL<T = any>(options?: MPortFactoryOptions): (input: Input, importOptions?: ImportCallOptions) => Promise<MPortURLResult<T>>;
export function MPortURL<T = any>(...origins: string[]): (input: Input, importOptions?: ImportCallOptions) => Promise<MPortURLResult<T>>;
export const mport: <T = any>(input: Input, importOptions?: ImportCallOptions) => Promise<T>;
export default mport;
/** ["cdn.jsdelivr.net/npm/", "ga.jspm.io/npm:", "unpkg.com/"] */
export const DEFAULT_ORIGINS: string[];
/** "mport-cache" */
export const DEFAULT_CACHE_KEY: string;

// ---------------------------------------------------------------- specifiers

export type Registry = "npm" | "jsr" | "github";

/** parseSpecifier()'s result. */
export interface ParsedSpecifier {
  /** the input as given */
  raw: string | SpecifierObject;
  registry: Registry;
  /** true when the specifier carried a registry prefix (npm:, jsr:, github:, gh:) */
  explicit: boolean;
  /** "react", "@scope/pkg", or "user/repo" for GitHub */
  name: string;
  /** version, range, dist-tag or git ref as written */
  range?: string;
  /** sub-path without leading slash ("" when none) */
  path: string;
  /** true for a trailing-slash prefix specifier ("lit/") */
  prefix: boolean;
}

export function parseSpecifier(input: string | SpecifierObject): ParsedSpecifier | null;
/** The import-map key: registry prefix (if explicit) + name + path (+ "/"), no version. */
export function keyOf(parsed: ParsedSpecifier): string;
/** false for relative ("./", "../"), absolute-path ("/"), URL ("x://"), data: and blob: specifiers */
export function isRoutable(specifier: string | object): boolean;

// ---------------------------------------------------------------- v2 router

/** The exact thing a provider turns into a URL. */
export interface Artifact {
  registry: Registry;
  name: string;
  /** exact version (or the raw range when the provider has needsVersion: false) */
  version?: string;
  path: string;
  /** resolved entry file, for providers with needsEntry */
  entry?: string;
  /** whether `entry` looks like an ES module (see entryInfo) */
  esm?: boolean;
  /** whether the package has an `exports` map (raw CDNs skip prefix specifiers for those) */
  hasExports?: boolean;
}

export interface TraceEvent {
  type: "lookup" | "resolved" | "probe" | "ok" | "selected" | "fail" | "skip" | "aborted";
  /** for "resolved": the exact version the registry lookup chose */
  version?: string;
  /** "import": router.import() failed to load a resolved URL; "integrity": verified() rejected it */
  phase?: "import" | "integrity";
  /** provider name, cache name, or "<registry> registry" for lookups */
  provider: string;
  /** the candidate URL; for lookup/resolved, a pseudo-URL such as "npm:react@^19" */
  url?: string;
  ms?: number;
  /** for "skip": why; for "aborted": "lost the race" when an uncancellable probe finished late */
  reason?: string;
  error?: string;
  /** for "ok" from cache() */
  cached?: boolean;
  /** timestamp from the router's `now()` */
  at?: number;
}

export interface Resolution {
  /** the specifier as given (for object specifiers: keyOf of the parsed request) */
  specifier: string;
  /** import-map key */
  key: string;
  /** the registry that actually served the package */
  registry: Registry;
  name: string;
  range?: string;
  version?: string;
  path: string;
  entry?: string;
  build: string;
  provider: string;
  url: string;
  /** directory URL for prefix specifiers ("lit/") */
  base?: string;
  integrity?: string;
  /** the imported module, when probe is "import" */
  module?: unknown;
  cached: boolean;
  trace: TraceEvent[];
}

export interface Node {
  kind: string;
  name: string;
  children?: Node[];
  weight?: number;
  select(request: ParsedSpecifier, ctx: unknown): Promise<unknown>;
}

export interface Provider extends Node {
  kind: "provider";
  build: string;
  registries: Registry[];
  capabilities: string[];
  needsEntry: boolean;
  needsVersion: boolean;
  /** false: skips prefix specifiers ("lit/") */
  prefix: boolean;
  url(artifact: Artifact): string;
  base(artifact: Artifact): string;
}

export type Match = string | RegExp | ((matchText: string) => boolean);
export type Route = Node | string | Array<Node | string | Array<Node | string>>;
export type Routes = Record<string, Route> | Array<{ match: Match; use: Route }>;

/** One lockfile entry: the Resolution fields that are recorded. */
export type LockEntry = Partial<Pick<Resolution,
  "specifier" | "registry" | "name" | "range" | "version" | "path" | "entry" | "build" | "provider" | "url" | "integrity">>;

export interface Lockfile {
  lockfileVersion: 1;
  packages: Record<string, LockEntry>;
}

/** An in-memory lockfile (router.lock, createLock()). */
export interface Lock {
  get(key: string): LockEntry | undefined;
  /** stores the known fields of `entry`, dropping undefined and "" values */
  set(key: string, entry: Partial<Resolution>): void;
  /** { lockfileVersion: 1, packages } with keys sorted */
  toJSON(): Lockfile;
}

export interface ImportMap {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  integrity?: Record<string, string>;
}

export type Probe = (url: string, o: { provider: Provider; signal?: AbortSignal }) => Promise<{ module?: unknown } | void>;

export interface CircuitBreakerOptions {
  /** consecutive failures before a provider's circuit opens (default 3) */
  failures?: number;
  /** how long it stays open: milliseconds, or "500ms" / "30s" / "1m" (default 30000) */
  reset?: number | string;
}

export interface RegistryClient {
  /** exact version for a parsed request; GitHub refs and exact versions pass through */
  version(parsed: Pick<ParsedSpecifier, "registry" | "name" | "range">): Promise<string | undefined>;
  /** entry file for an npm package version (and optional sub-path) */
  entry(name: string, version: string, subpath?: string): Promise<string>;
  /** entry file plus whether it is an ES module */
  entryInfo(name: string, version: string, subpath?: string): Promise<{ file: string; esm: boolean; hasExports: boolean }>;
}

export interface RouterOptions {
  /** how a candidate URL is checked (default "head") */
  probe?: "head" | "import" | "none" | Probe;
  /** a lockfile pinning versions, entries, builds and integrity */
  lock?: Lockfile;
  /** resolve ranges to exact versions through the registries (default true) */
  resolveVersions?: boolean;
  /** options for this router's own HealthRegistry (ignored when `health` is given) */
  circuitBreaker?: CircuitBreakerOptions;
  /** share provider health and open circuits with another router */
  health?: HealthRegistry;
  /** default target for prefer() (default "browser") */
  target?: string;
  /** capabilities every provider must have */
  capabilities?: string[];
  /** fetch implementation (default globalThis.fetch) */
  fetch?: typeof fetch;
  /** dynamic import used by probe "import" and router.import() (default url => import(url)) */
  importer?: (url: string) => Promise<unknown>;
  /** registry base URLs (defaults https://registry.npmjs.org and https://jsr.io) */
  registries?: { npm?: string; jsr?: string; fetch?: typeof fetch };
  /** a registry client to use instead of createRegistry({ fetch, ...registries }) */
  registry?: RegistryClient;
  /** called with every trace event, plus router.import()'s { type: "fail", phase: "import" } */
  onEvent?: (event: TraceEvent) => void;
  /** clock for health and traces (default Date.now) */
  now?: () => number;
  /** let raw file CDNs serve CommonJS entries (default false: they're skipped) */
  allowCommonJS?: boolean;
  /** exposed as router.name (default "mport") */
  name?: string;
}

export interface ResolveOptions {
  /** overrides the router's target for prefer() */
  target?: string;
  /** replaces the router's required capabilities */
  capabilities?: string[];
  /** expected SRI hash for verified() (overrides the lockfile's) */
  integrity?: string;
  /** provider names to skip */
  exclude?: Iterable<string>;
  /** only providers with this build may serve (overrides the lockfile's) */
  build?: string;
  signal?: AbortSignal;
  /** ignore the lockfile for this call */
  relock?: boolean;
  /** replaces (does not add to) the router's onEvent for this call */
  onEvent?: (event: TraceEvent) => void;
}

export interface BuildOptions {
  /** scope URL → { import-map key: specifier } */
  scopes?: Record<string, Record<string, string>>;
  signal?: AbortSignal;
}

export interface BuildResult {
  importMap: ImportMap;
  /** every resolution this router has made so far, not only this build's */
  lock: Lockfile;
}

export interface Router {
  name: string;
  health: HealthRegistry;
  /** what this router has resolved; build() returns lock.toJSON() */
  lock: Lock;
  /** null for unroutable (relative, URL, non-package scheme) or unmatched specifiers */
  resolve(specifier: string | SpecifierObject, options?: ResolveOptions): Promise<Resolution | null>;
  /** resolve and import, failing over to another provider when the import itself fails */
  import<T = any>(specifier: string | SpecifierObject, options?: ResolveOptions): Promise<T>;
  build(specifiers: string[], options?: BuildOptions): Promise<BuildResult>;
}

export function createRouter(routes: Routes, options?: RouterOptions): Router;
export function route(match: Match, use: Route): { match: Match; use: Route };

// ---------------------------------------------------------------- providers

export interface ProviderDefinition {
  name: string;
  /** what the provider serves; providers with equal builds are mirrors (default: name) */
  build?: string;
  /** default ["npm"] */
  registries?: Registry[];
  /** default [] */
  capabilities?: string[];
  /** resolve the package's entry file before building the URL (default false) */
  needsEntry?: boolean;
  /** resolve the exact version before building the URL (default true) */
  needsVersion?: boolean;
  /** serves a directory for prefix specifiers like "lit/" (default true; false skips them) */
  prefix?: boolean;
  url(artifact: Artifact): string;
  /** directory URL for prefix specifiers (default: url() with empty path/entry, plus "/") */
  base?(artifact: Artifact): string;
}

export function provider(def: ProviderDefinition): Provider;
/** `esTarget`: the `?target=` esm.sh is pinned to so bytes (and integrity) don't vary by User-Agent (default "es2022"; null: don't pin) */
export function esmSh(o?: { origin?: string; name?: string; esTarget?: string | null }): Provider;
export function jsDelivr(o?: { origin?: string; esm?: boolean; name?: string }): Provider;
export function unpkg(o?: { origin?: string; name?: string }): Provider;
export function jspm(o?: { origin?: string; name?: string }): Provider;
export function jsr(o?: { via?: "esm.sh" | "jsr.io"; origin?: string; name?: string; esTarget?: string | null }): Provider;
export function github(o?: { via?: "jsdelivr" | "esm.sh"; name?: string; esTarget?: string | null }): Provider;
export function local(o?: { base?: string; name?: string; build?: string }): Provider;
export function custom(template: string, o?: { name?: string; build?: string; registries?: Registry[]; capabilities?: string[] }): Provider;
export function origin(o: string | MPortOrigin): Provider;

// ---------------------------------------------------------------- strategies

/** A Map, a Storage (localStorage), or anything with get/set. */
export type CacheStore = Pick<Map<string, unknown>, "get" | "set"> | Storage;

export function fallback(...nodes: Array<Node | Node[]>): Node;
export function fallback(o: { providers: Node[]; circuitBreaker?: CircuitBreakerOptions & { now?: () => number } }): Node;
export function race(...nodes: Array<Node | Node[]>): Node;
export function adaptive(...nodes: Array<Node | [Node, number]>): Node;
export function weighted(node: Node, weight: number): Node;
export function prefer(byTarget: Record<string, Node>): Node;
export function verified(node: Node, o?: { algorithm?: "sha256" | "sha384" | "sha512" }): Node;
/** `ttl`: milliseconds or a duration string ("30s", "5m"); records older than that are re-resolved. Default: never expire. */
export function cache(o?: { store?: CacheStore; name?: string; prefix?: string; ttl?: number | string }): Node;
export function sri(data: BufferSource, algorithm?: "sha256" | "sha384" | "sha512"): Promise<string>;

export interface HealthState {
  ok: number;
  fail: number;
  /** consecutive failures */
  streak: number;
  /** smoothed latency in ms (0.7 × previous + 0.3 × latest) */
  latency?: number;
  /** timestamp until which the circuit is open (0 = closed) */
  openUntil: number;
  healthy: boolean;
}

export class HealthRegistry {
  constructor(o?: CircuitBreakerOptions & { now?: () => number });
  /** consecutive failures that open a circuit */
  threshold: number;
  /** open duration in ms */
  reset: number;
  now: () => number;
  /** `keepStreak`: count the success but leave the failure streak and circuit alone (until `settle`) */
  success(name: string, ms?: number, o?: { keepStreak?: boolean }): void;
  /** a deferred success is confirmed: reset the streak and close the circuit */
  settle(name: string): void;
  failure(name: string): void;
  isOpen(name: string): boolean;
  /** a view sharing this registry's state but judging circuits by other settings */
  scoped(o?: CircuitBreakerOptions & { now?: () => number }): HealthRegistry;
  /** (ok + 1) / (ok + fail + 1) */
  successRate(name: string): number;
  latency(name: string): number | undefined;
  snapshot(): Record<string, HealthState>;
}

/** Every provider in a fallback or race failed or was skipped. `errors` holds each one. */
export class RoutingError extends AggregateError { trace?: TraceEvent[] }
/** A node declined without trying (unsupported registry, excluded, build mismatch, missing capability, open circuit, CommonJS, prefix unsupported, cache miss or expiry). */
export class SkipError extends Error { trace?: TraceEvent[] }
/** verified() got a non-OK response or bytes whose hash differs from the pinned one. */
export class IntegrityError extends Error { trace?: TraceEvent[] }
/** The package or version cannot exist: unknown package, unsatisfiable range, unreachable registry, unroutable specifier in build(). */
export class ResolutionError extends Error { trace?: TraceEvent[] }

// ---------------------------------------------------------------- registry, import maps, lockfiles, runtime

export function createRegistry(o?: { fetch?: typeof fetch; npm?: string; jsr?: string }): RegistryClient;
export function entryOf(pkg: Record<string, unknown>, subpath?: string): string;
export function entryInfo(pkg: Record<string, unknown>, subpath?: string): { file: string; esm: boolean; hasExports: boolean };
export function resolveExports(exportsField: unknown, subpath?: string): string | undefined;

export function compileImportMap(resolved: Array<Pick<Resolution, "key" | "url"> & Partial<Resolution>>, scoped?: Record<string, Array<Pick<Resolution, "key" | "url"> & Partial<Resolution>>>): ImportMap;
export function mergeImportMaps(...maps: ImportMap[]): ImportMap;

export function createLock(data?: Partial<Lockfile>): Lock;
/** Lockfile key: the specifier as written, normalized (explicit prefix kept, "gh:" → "github:", no trailing "/"). */
export function lockKey(parsed: ParsedSpecifier): string;

export function injectImportMap(map: ImportMap, o?: { document?: Document }): HTMLScriptElement;
export function startup(router: Router, specifiers: string[], o?: { scopes?: Record<string, Record<string, string>>; document?: Document }): Promise<BuildResult>;
export function createImporter(router: Router): <T = any>(specifier: string | SpecifierObject, options?: ResolveOptions) => Promise<T>;

// ---------------------------------------------------------------- semver

export namespace semver {
  interface Version { major: number; minor: number; patch: number; pre: string[] }
  function parse(v: string): Version | null;
  function valid(v: string): boolean;
  function compare(a: string | Version, b: string | Version): -1 | 0 | 1;
  function satisfies(version: string, range: string): boolean;
  function maxSatisfying(versions: Iterable<string>, range: string): string | null;
}
