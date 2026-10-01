// Type declarations for @johnhenry/mport/node (Node only: reads the disk).
import type { RegistryClient } from "./types.js";

export interface InstalledRegistryOptions {
  /** the directory holding the packages (`<root>/<name>/package.json`), usually `<project>/node_modules`; a path or a `file:` URL */
  root: string | URL;
  /** a registry client asked about packages that are not installed under `root` (default: they are a `ResolutionError`) */
  fallback?: RegistryClient | false;
}

/** A registry client answering from installed packages instead of npm. Pass it as `createRouter(routes, { registry })`. */
export function installedRegistry(options: InstalledRegistryOptions): Required<RegistryClient> & { readonly root: string };
