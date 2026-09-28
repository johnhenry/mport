// ---------------------------------------------------------------- v1 API

export interface MPortOptions {
  /** The name of the npm package to import */
  name: string;
  /** Package version or tag (default: 'latest') */
  version?: string;
  /** Optional sub-path within the package, e.g. 'dist/index.mjs' */
  path?: string;
}

export interface MPortOrigin {
  /** Origin prefix without protocol, e.g. "cdn.jsdelivr.net/npm/" */
  path: string;
  /** Separator between name and version (default "@") */
  versionMarker?: string;
  /** Version used when none is given (default "latest") */
  defaultVersion?: string;
}

export interface MPortFactoryOptions {
  cdns?: Array<string | MPortOrigin>;
  useCache?: "localhost";
  cacheKey?: string;
}

/** Debug information: which CDN won and every attempt made. */
export interface MPortInfo extends Partial<Resolution> {
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
export const DEFAULT_ORIGINS: string[];
export const DEFAULT_CACHE_KEY: string;

// ---------------------------------------------------------------- v2 router

export type Registry = "npm" | "jsr" | "github";

export interface Artifact {
  registry: Registry;
  name: string;
  version?: string;
  path: string;
  entry?: string;
}

export interface TraceEvent {
  type: "lookup" | "resolved" | "probe" | "ok" | "fail" | "skip" | "aborted";
  /** for "resolved": the exact version the registry lookup chose */
  version?: string;
  /** "import": router.import() failed to load a resolved URL; "integrity": verified() rejected it */
  phase?: "import" | "integrity";
  provider: string;
  url?: string;
  ms?: number;
  reason?: string;
  error?: string;
  cached?: boolean;
  at?: number;
}

export interface Resolution {
  specifier: string;
  key: string;
  registry: Registry;
  name: string;
  range?: string;
  version?: string;
  path: string;
  entry?: string;
  build: string;
  provider: string;
  url: string;
  base?: string;
  integrity?: string;
  module?: unknown;
  cached: boolean;
  trace: TraceEvent[];
}

export interface Node {
  kind: string;
  name: string;
  children?: Node[];
  weight?: number;
  select(request: unknown, ctx: unknown): Promise<unknown>;
}

export interface Provider extends Node {
  kind: "provider";
  build: string;
  registries: Registry[];
  capabilities: string[];
  needsEntry: boolean;
  needsVersion: boolean;
  url(artifact: Artifact): string;
  base(artifact: Artifact): string;
}

export type Route = Node | string | Array<Node | string>;
export type Routes = Record<string, Route> | Array<{ match: string | RegExp | ((s: string) => boolean); use: Route }>;

export interface Lockfile {
  lockfileVersion: 1;
  packages: Record<string, Partial<Resolution>>;
}

export interface ImportMap {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  integrity?: Record<string, string>;
}

export interface RouterOptions {
  probe?: "head" | "import" | "none" | ((url: string, o: { provider: Provider; signal?: AbortSignal }) => Promise<{ module?: unknown } | void>);
  lock?: Lockfile;
  resolveVersions?: boolean;
  circuitBreaker?: { failures?: number; reset?: number | string };
  /** share provider health and open circuits with another router */
  health?: HealthRegistry;
  target?: string;
  capabilities?: string[];
  fetch?: typeof fetch;
  importer?: (url: string) => Promise<unknown>;
  registries?: { npm?: string; jsr?: string };
  onEvent?: (event: TraceEvent) => void;
  now?: () => number;
  name?: string;
}

export interface ResolveOptions {
  target?: string;
  capabilities?: string[];
  integrity?: string;
  exclude?: Iterable<string>;
  build?: string;
  signal?: AbortSignal;
  relock?: boolean;
  onEvent?: (event: TraceEvent) => void;
}

export interface Router {
  name: string;
  health: HealthRegistry;
  resolve(specifier: string | MPortOptions, options?: ResolveOptions): Promise<Resolution | null>;
  import<T = any>(specifier: string, options?: ResolveOptions): Promise<T>;
  build(specifiers: string[], options?: { scopes?: Record<string, Record<string, string>>; signal?: AbortSignal }): Promise<{ importMap: ImportMap; lock: Lockfile }>;
}

export function createRouter(routes: Routes, options?: RouterOptions): Router;
export function route(match: string | RegExp | ((s: string) => boolean), use: Route): { match: typeof match; use: Route };

export function provider(def: Partial<Provider> & { name: string; url(a: Artifact): string }): Provider;
export function esmSh(o?: { origin?: string; name?: string }): Provider;
export function jsDelivr(o?: { origin?: string; esm?: boolean; name?: string }): Provider;
export function unpkg(o?: { origin?: string; name?: string }): Provider;
export function jspm(o?: { origin?: string; name?: string }): Provider;
export function jsr(o?: { via?: "esm.sh" | "jsr.io"; origin?: string; name?: string }): Provider;
export function github(o?: { via?: "jsdelivr" | "esm.sh"; name?: string }): Provider;
export function local(o?: { base?: string; name?: string; build?: string }): Provider;
export function custom(template: string, o?: { name?: string; build?: string; registries?: Registry[]; capabilities?: string[] }): Provider;
export function origin(o: string | MPortOrigin): Provider;

export function fallback(...nodes: Node[]): Node;
export function fallback(o: { providers: Node[]; circuitBreaker?: { failures?: number; reset?: number | string } }): Node;
export function race(...nodes: Node[]): Node;
export function adaptive(...nodes: Array<Node | [Node, number]>): Node;
export function weighted(node: Node, weight: number): Node;
export function prefer(byTarget: Record<string, Node>): Node;
export function verified(node: Node, o?: { algorithm?: "sha256" | "sha384" | "sha512" }): Node;
export function cache(o?: { store?: Map<string, unknown> | Storage; name?: string; prefix?: string }): Node;
export function sri(data: BufferSource, algorithm?: "sha256" | "sha384" | "sha512"): Promise<string>;

export class HealthRegistry {
  constructor(o?: { failures?: number; reset?: number | string; now?: () => number });
  success(name: string, ms?: number): void;
  failure(name: string): void;
  isOpen(name: string): boolean;
  successRate(name: string): number;
  latency(name: string): number | undefined;
  snapshot(): Record<string, { ok: number; fail: number; streak: number; latency?: number; openUntil: number; healthy: boolean }>;
}
export class RoutingError extends AggregateError { trace?: TraceEvent[] }
export class SkipError extends Error {}
export class IntegrityError extends Error {}
export class ResolutionError extends Error {}

export function entryOf(pkg: Record<string, unknown>, subpath?: string): string;
export function resolveExports(exportsField: unknown, subpath?: string): string | undefined;
export function createRegistry(o?: { fetch?: typeof fetch; npm?: string; jsr?: string }): { version(parsed: object): Promise<string | undefined>; entry(name: string, version: string, subpath?: string): Promise<string> };
export function parseSpecifier(input: string | MPortOptions): { registry: Registry; explicit: boolean; name: string; range?: string; path: string; prefix: boolean } | null;
export function compileImportMap(resolved: Resolution[], scoped?: Record<string, Resolution[]>): ImportMap;
export function mergeImportMaps(...maps: ImportMap[]): ImportMap;
export function injectImportMap(map: ImportMap, o?: { document?: Document }): HTMLScriptElement;
export function startup(router: Router, specifiers: string[], o?: { scopes?: Record<string, Record<string, string>>; document?: Document }): Promise<{ importMap: ImportMap; lock: Lockfile }>;
export function createImporter(router: Router): <T = any>(specifier: string, options?: ResolveOptions) => Promise<T>;
