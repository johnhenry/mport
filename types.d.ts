export interface MPortOptions {
  /** The name of the npm package to import */
  name: string;
  /** Package version or tag (default: 'latest') */
  version?: string;
  /** Optional sub-path within the package, e.g. 'dist/index.mjs' */
  path?: string;
}

export type MPortURLResult<T = any> = [T, string];
export type MPortResult<T = any> = T;

/**
 * Creates an MPort importer function.
 * @param origins - One or more CDN origin prefixes (defaults to jsDelivr, JSPM, Unpkg).
 * @returns A function to import modules by specifier or options.
 * - this function returns the imported module
 */
export default function MPort<T = any>(
  ...origins: string[]
): (input: string | MPortOptions) => Promise<MPortResult<T>>;

/**
 * Creates an MPortURL importer function.
 * @param origins - One or more CDN origin prefixes (defaults to jsDelivr, JSPM, Unpkg).
 * @returns A function to import modules by specifier or options.
 *  - this function returns a tuple of the imported module and the URL used to fetch it
 */
export default function MPortURL<T = any>(
  ...origins: string[]
): (input: string | MPortOptions) => Promise<MPortURLResult<T>>;

declare module "mport" {
  export { MPort, MPortURL };
  export default MPort;
}
