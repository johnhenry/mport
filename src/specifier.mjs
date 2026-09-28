// Parse module specifiers into a registry-neutral request.
//
//   "react"                   → { registry: "npm", name: "react" }
//   "react@^19/jsx-runtime"   → { registry: "npm", name: "react", range: "^19", path: "jsx-runtime" }
//   "@scope/pkg@1.2.3/x.js"   → { registry: "npm", name: "@scope/pkg", range: "1.2.3", path: "x.js" }
//   "npm:lodash-es@4"         → { registry: "npm", explicit: true, ... }
//   "jsr:@std/path@1"         → { registry: "jsr", name: "@std/path", range: "1" }
//   "github:user/repo@v1/a.js" (or "gh:") → { registry: "github", name: "user/repo", range: "v1", path: "a.js" }
//
// Relative, absolute-path and URL specifiers are not routable and return null.

const PREFIXES = { "npm:": "npm", "jsr:": "jsr", "github:": "github", "gh:": "github" };

export const isRoutable = (specifier) =>
  typeof specifier === "object" ||
  !(/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:\/\/|data:|blob:)/i.test(specifier));

export function parseSpecifier(input) {
  if (input && typeof input === "object") {
    const { name, version, path = "", registry = "npm" } = input;
    if (!name) throw new TypeError("mport: object specifier requires a name");
    return {
      raw: input,
      registry,
      explicit: false,
      name,
      range: version || undefined,
      path: stripSlashes(path),
      prefix: false,
    };
  }
  if (typeof input !== "string" || !input) {
    throw new TypeError(`mport: invalid specifier ${JSON.stringify(input)}`);
  }
  if (!isRoutable(input)) return null;

  let rest = input;
  let registry = "npm";
  let explicit = false;
  for (const [p, r] of Object.entries(PREFIXES)) {
    if (rest.startsWith(p)) {
      registry = r;
      explicit = true;
      rest = rest.slice(p.length);
      break;
    }
  }
  const prefix = rest.endsWith("/");
  if (prefix) rest = rest.slice(0, -1);

  // name is "user/repo" for github, "@scope/name" for scoped, else "name"
  const segments = rest.split("/");
  const twoPart = registry === "github" || rest.startsWith("@");
  if (twoPart && segments.length < 2) {
    throw new TypeError(`mport: specifier "${input}" needs a scope/owner and a name`);
  }
  const head = twoPart ? `${segments[0]}/${segments[1]}` : segments[0];
  const tail = segments.slice(twoPart ? 2 : 1).join("/");

  // the version lives on the last name segment: "@scope/pkg@1.2" or "pkg@1.2"
  const at = head.indexOf("@", head.startsWith("@") ? 1 : 0);
  const name = at === -1 ? head : head.slice(0, at);
  const range = at === -1 ? undefined : head.slice(at + 1) || undefined;
  if (registry === "jsr" && !name.startsWith("@")) {
    throw new TypeError(`mport: JSR packages are scoped ("jsr:@scope/name"), got "${input}"`);
  }
  return { raw: input, registry, explicit, name, range, path: tail, prefix };
}

// The import-map key a parsed specifier compiles to: versions are dropped,
// registry prefixes and sub-paths are kept.
export function keyOf(parsed) {
  const reg = parsed.explicit ? `${parsed.registry === "github" ? "github" : parsed.registry}:` : "";
  const path = parsed.path ? `/${parsed.path}` : "";
  return `${reg}${parsed.name}${path}${parsed.prefix ? "/" : ""}`;
}

const stripSlashes = (s) => String(s).replace(/^\/+/, "");
