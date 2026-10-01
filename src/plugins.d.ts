// Shared types for the bundler plugins: @johnhenry/mport/vite and @johnhenry/mport/rollup.
// Structural, so this package needs neither vite nor rollup to compile against it.
import type { Router, BuildOptions, BuildResult } from "./types.js";

export interface PluginOptions {
  /**
   * "external" (default): a bare import becomes the CDN URL in the output.
   * "importmap": it stays bare and the build produces the import map that maps it
   * (Rollup: an `importmap.json` asset; Vite: injected into index.html).
   */
  mode?: "external" | "importmap";
  /** package name → range for imports that carry no version, e.g. { react: "^19" } (default: whatever the router's lockfile or registry says is latest) */
  versions?: Record<string, string>;
  /** read ranges from package.json (`true`: package.json in the project root, or a path); `versions` wins over it */
  packageJson?: boolean | string;
  /** leave these to the bundler: package names or exact import sources, a RegExp on the source, or a predicate */
  exclude?: string[] | RegExp | ((source: string) => boolean);
  /** specifiers always included in the import map (importmap mode), e.g. ones only `router.import()` uses */
  specifiers?: string[];
  /** options for `router.build()` that produces the import map (importmap mode): `conflicts`, `graph`, `scopes` */
  build?: Omit<BuildOptions, "signal">;
}

/** What `plugin.api` exposes: the routing state of one plugin instance. */
export interface PluginApi {
  mode: "external" | "importmap";
  /** the import-map specifiers routed so far plus the `specifiers` option */
  specifiers(): string[];
  /** `router.build()` over `specifiers()` */
  importMap(): Promise<BuildResult>;
  /** the CSP hash source (`'sha256-…'`) of the inline `<script type="importmap">` the Vite plugin injects, for `script-src` on a static site */
  importMapHash(options?: { algorithm?: "sha256" | "sha384" | "sha512" }): Promise<string>;
}

export type { Router };
