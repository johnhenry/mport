// Lockfile: pins each requested specifier to an exact version, entry file and
// build so resolution is reproducible. The URL/provider are recorded for
// reference; on the next run any mirror of the same build may serve it.
//
// {
//   "lockfileVersion": 1,
//   "packages": {
//     "react@^19": { "specifier": "react@^19", "registry": "npm", "version": "19.2.0",
//       "build": "esm.sh", "provider": "esm.sh", "url": "https://esm.sh/react@19.2.0",
//       "integrity": "sha384-…" }
//   }
// }
//
// Keys are the specifier as written, normalized: a registry prefix appears only
// when the specifier had one ("npm:react@^19", "jsr:@std/path@^1",
// "github:user/repo@v1"), a trailing "/" is dropped, and "gh:" is spelled
// "github:". The registry that actually served a package is the entry's
// `registry` field, so a bare "@std/path@^1" routed to JSR is keyed
// "@std/path@^1" with `registry: "jsr"`, not under an npm-looking key.

export const lockKey = (req) => {
  const registry = req.explicit ? `${req.registry}:` : "";
  const range = req.range ? `@${req.range}` : "";
  return `${registry}${req.name}${range}${req.path ? `/${req.path}` : ""}`;
};

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
