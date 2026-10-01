// Type declarations for @johnhenry/mport/vite.
import type { Router } from "./types.js";
import type { PluginOptions, PluginApi } from "./plugins.js";

export interface VitePluginOptions extends PluginOptions {
  /** also resolve in the dev server (default false: production builds only). "external" mode only. */
  dev?: boolean;
}

/** A Vite plugin (structurally; assignable to vite's `Plugin`). */
export interface MportVitePlugin {
  name: "mport";
  enforce: "pre";
  api: PluginApi;
  apply(config: unknown, env: { command: "build" | "serve" }): boolean;
  configResolved(config: { root: string }): Promise<void>;
  resolveId(source: string, importer?: string, options?: { ssr?: boolean }): Promise<{ id: string; external: true } | null> | null;
  transformIndexHtml: {
    order: "post";
    handler(): Promise<Array<{ tag: string; attrs: Record<string, string>; children: string; injectTo: "head-prepend" }> | undefined>;
  };
}

export function mportVite(router: Router, options?: VitePluginOptions): MportVitePlugin;
export default mportVite;
