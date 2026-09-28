// Lockfile: pins each requested specifier to an exact version, entry file and
// build so resolution is reproducible. The URL/provider are recorded for
// reference; on the next run any mirror of the same build may serve it.
//
// {
//   "lockfileVersion": 1,
//   "packages": {
//     "npm:react@^19": { "specifier": "react@^19", "version": "19.2.0",
//       "build": "esm.sh", "provider": "esm.sh", "url": "https://esm.sh/react@19.2.0",
//       "integrity": "sha384-…" }
//   }
// }

export const lockKey = (req) => `${req.registry}:${req.name}@${req.range ?? ""}${req.path ? `/${req.path}` : ""}`;

const FIELDS = ["specifier", "registry", "name", "range", "version", "path", "entry", "build", "provider", "url", "integrity"];

export function createLock(data) {
  const packages = new Map(Object.entries(data?.packages ?? {}));
  return {
    get: (key) => packages.get(key),
    set(key, entry) {
      const rec = {};
      for (const f of FIELDS) if (entry[f] !== undefined && entry[f] !== "") rec[f] = entry[f];
      packages.set(key, rec);
    },
    toJSON: () => ({
      lockfileVersion: 1,
      packages: Object.fromEntries([...packages].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    }),
  };
}
