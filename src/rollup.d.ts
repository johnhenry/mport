// Type declarations for @johnhenry/mport/rollup.
import type { Router } from "./types.js";
import type { PluginOptions, PluginApi } from "./plugins.js";

export interface RollupPluginOptions extends PluginOptions {
  /** importmap mode: file name of the emitted import map asset (default "importmap.json") */
  fileName?: string;
}

/** A Rollup plugin (structurally; assignable to rollup's `Plugin`). */
export interface MportRollupPlugin {
  name: "mport";
  api: PluginApi;
  buildStart(): Promise<void>;
  resolveId(source: string): Promise<{ id: string; external: true } | null>;
  generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: string }): string }): Promise<void>;
}

export function mportRollup(router: Router, options?: RollupPluginOptions): MportRollupPlugin;
export default mportRollup;
