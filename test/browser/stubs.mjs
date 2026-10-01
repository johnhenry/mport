// Hermetic CDN and registry for the browser tests. Playwright answers every request to
// the hosts below from here; any other off-origin request is aborted, so a test that
// would reach the real network fails instead of depending on it.
//
// Registry fixtures are shaped like npm's endpoints. Package bodies are tiny modules,
// byte-identical across hosts for one package (so a hash recorded from one CDN matches
// another's), except Preact and htm, which are the real files from node_modules so the
// app example actually renders.
import { readFileSync } from "node:fs";

const nm = (p) => readFileSync(new URL(`../../node_modules/${p}`, import.meta.url), "utf8");
const preactVersion = JSON.parse(nm("preact/package.json")).version;
const htmVersion = JSON.parse(nm("htm/package.json")).version;
const preactManifest = JSON.parse(nm("preact/package.json"));

export const CDN_HOSTS = ["esm.sh", "cdn.jsdelivr.net", "unpkg.com", "ga.jspm.io"];
export const API_HOSTS = ["registry.npmjs.org", "jsr.io"];

const packument = (latest, versions, tags = {}) => ({ "dist-tags": { latest, ...tags }, versions: Object.fromEntries(versions.map((v) => [v, {}])) });

const REGISTRY = {
  "react": packument("19.2.0", ["18.3.1", "19.0.0", "19.2.0"]),
  "react/19.2.0": { name: "react", version: "19.2.0", main: "index.js" },
  "react/18.3.1": { name: "react", version: "18.3.1", main: "index.js" },
  "preact": packument(preactVersion, [preactVersion]),
  [`preact/${preactVersion}`]: preactManifest,
  "htm": packument(htmVersion, [htmVersion]),
  [`htm/${htmVersion}`]: { name: "htm", version: htmVersion, module: "dist/htm.module.js", main: "dist/htm.js" },
  "lit": packument("3.3.1", ["3.3.1"]),
  "lit/3.3.1": { name: "lit", version: "3.3.1", type: "module", exports: { ".": { default: "./index.js" }, "./decorators.js": { default: "./decorators.js" } } },
  "nanoid": packument("5.1.5", ["5.1.4", "5.1.5"]),
  "nanoid/5.1.5": { name: "nanoid", version: "5.1.5", type: "module", exports: { ".": { default: "./index.js" } } },
  "lodash-es": packument("4.17.21", ["4.17.21"]),
  "lodash-es/4.17.21": { name: "lodash-es", version: "4.17.21", type: "module", module: "lodash.js", main: "lodash.js" },
  "@scope%2Fpkg": packument("1.2.3", ["1.2.3"]),
  "@scope%2Fpkg/1.2.3": { name: "@scope/pkg", version: "1.2.3", type: "module", module: "dist/pkg.mjs" },
  // for the scope and integrity tests: ES modules that keep bare imports on raw CDNs
  "vendor-core": packument("2.0.0", ["1.0.0", "2.0.0"]),
  "vendor-core/1.0.0": { name: "vendor-core", version: "1.0.0", type: "module", main: "index.js" },
  "vendor-core/2.0.0": { name: "vendor-core", version: "2.0.0", type: "module", main: "index.js" },
  "vendor-ui": packument("1.0.0", ["1.0.0"]),
  "vendor-ui/1.0.0": { name: "vendor-ui", version: "1.0.0", type: "module", main: "index.js", dependencies: { "vendor-core": "^1" } },
  "@preact%2Fsignals-core": packument("1.8.0", ["1.8.0"]),
  "@preact%2Fsignals-core/1.8.0": { name: "@preact/signals-core", version: "1.8.0", type: "module", module: "dist/signals-core.module.js" },
};
const JSR = { "/@std/path/meta.json": { latest: "1.1.0", versions: { "1.0.0": {}, "1.1.0": {} } } };

// small modules, one per package, identical whichever CDN serves them
const BODIES = {
  "lodash-es": `const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
export default { chunk, sum }; export { chunk, sum };`,
  "nanoid": `export const nanoid = (n = 21) => "stubbed-nanoid-id".padEnd(n, "x").slice(0, n);\nexport default nanoid;`,
  "@preact/signals-core": `export const signal = (value) => ({ value });\nexport default signal;`,
  "lit": `export const html = (s, ...v) => ({ s, v });\nexport default "stub:lit";`,
  "vendor-core": (version) => `export default ${JSON.stringify(`core-${version}`)};`,
  "vendor-ui": () => `import core from "vendor-core";\nexport default "ui+" + core;`,
  "react": `export const createElement = (type, props) => ({ type, props });\nexport default { createElement };`,
};
const generic = (name) => `export default ${JSON.stringify(`stub:${name}`)};`;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "cache-control": "no-store" };

// "name" and "version" out of a CDN path: /npm/react@19.2.0/…, /npm:react@19/…, /@scope/pkg@1/…, /react@19/…
const PKG = /(?:\/npm\/|\/npm:|\/(?:jsr\/)?)(@[^/@]+\/[^/@?]+|[^/@?+]+)@([^/?]+)/;
export const packageOf = (path) => {
  const m = PKG.exec(path);
  return m && { name: m[1], version: m[2] };
};

const js = (body) => ({ type: "text/javascript; charset=utf-8", body });
const json = (value, status = 200) => ({ status, type: "application/json", body: JSON.stringify(value) });

/** What the stub CDN serves for a path on `host` (undefined: not found). */
export function cdnResponse(host, pathname) {
  const pkg = packageOf(pathname);
  if (!pkg) return undefined;
  const { name, version } = pkg;
  if (pathname.endsWith("/package.json")) return json({ name, version, ...(REGISTRY[`${name.replace("/", "%2F")}/${version}`] ?? { module: "index.js" }) });
  // real Preact and htm, rewritten the way esm.sh and jsDelivr rewrite their dependencies
  if (name === "preact" || name === "htm") {
    const esmSh = host === "esm.sh";
    const root = esmSh ? `/preact@${version}/es2022/preact.mjs` : `/npm/preact@${version}/+esm`;
    const files = {
      preact: nm("preact/dist/preact.module.js"),
      hooks: nm("preact/hooks/dist/hooks.module.js").replace('from"preact"', `from"${root}"`),
      htm: nm("htm/dist/htm.module.js"),
    };
    const sub = pathname.slice(pathname.indexOf(`@${version}`) + version.length + 1);
    if (esmSh) {
      if (/^\/(preact|htm)@[^/]+$/.test(pathname)) return js(`export * from "/${name}@${version}/es2022/${name}.mjs"; ${name === "htm" ? `export { default } from "/htm@${version}/es2022/htm.mjs";` : ""}`);
      if (pathname.endsWith("/hooks")) return js(`export * from "/preact@${version}/es2022/hooks.mjs";`);
      if (pathname.endsWith("/es2022/preact.mjs")) return js(files.preact);
      if (pathname.endsWith("/es2022/hooks.mjs")) return js(files.hooks);
      if (pathname.endsWith("/es2022/htm.mjs")) return js(files.htm);
    } else if (pathname.startsWith("/npm/")) {
      if (sub === "/+esm") return js(name === "htm" ? files.htm : files.preact);
      if (sub === "/hooks/+esm") return js(files.hooks);
    }
    return js(generic(name)); // raw files on other CDNs are only probed, never executed
  }
  const body = BODIES[name];
  return js(typeof body === "function" ? body(version) : body ?? generic(name));
}

/**
 * What the stub network answers for a URL: `{ status, type, body }`. `state` (all optional, and
 * changeable while a test runs): `down` (hosts that answer 503), `broken` (hosts whose JS
 * modules answer a syntax error), `tamper(url)` (replacement bytes for one URL).
 */
export function respond(urlString, state = {}) {
  const url = new URL(urlString);
  const text = (status, body) => ({ status, type: "text/plain", body });
  if (state.down?.has(url.hostname)) return text(503, "down");
  if (url.hostname === "registry.npmjs.org") {
    const hit = REGISTRY[decodeURIComponent(url.pathname.slice(1)).replace(/^(@[^/]+)\//, "$1%2F")];
    return hit ? json(hit) : text(404, "not found");
  }
  if (url.hostname === "jsr.io") return JSR[url.pathname] ? json(JSR[url.pathname]) : text(404, "not found");
  const tampered = state.tamper?.(url);
  if (tampered !== undefined) return { status: 200, ...js(tampered) };
  const hit = cdnResponse(url.hostname, url.pathname);
  if (!hit) return text(404, "not found");
  if (state.broken?.has(url.hostname) && hit.type.startsWith("text/javascript")) return { status: 200, type: hit.type, body: "export default (;" };
  return { status: hit.status ?? 200, type: hit.type, body: hit.body };
}

/** The same stub network as a `fetch`, for building import maps in Node (outside any browser). */
export const stubFetch = (state = {}) => async (input, init = {}) => {
  const { status, type, body } = respond(String(input), state);
  return new Response(init.method === "HEAD" ? null : body, { status, headers: { "content-type": type } });
};

/**
 * Answer every CDN and registry request from the stubs (see `respond`); abort any other off-origin request.
 * @param {import("@playwright/test").BrowserContext|import("@playwright/test").Page} target
 * @returns {{ requests: Array<{ method: string, url: string }>, state: object }}
 */
export async function installStubs(target, state = {}) {
  state.down ??= new Set();
  state.broken ??= new Set();
  const requests = [];
  const known = [...CDN_HOSTS, ...API_HOSTS];
  await target.route((url) => !known.includes(url.hostname) && url.hostname !== "127.0.0.1" && url.hostname !== "localhost", (route) => route.abort());
  await target.route((url) => known.includes(url.hostname), async (route) => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url() });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const { status, type, body } = respond(request.url(), state);
    return route.fulfill({ status, headers: { ...CORS, "content-type": type }, body: request.method() === "HEAD" ? "" : body });
  });
  return { requests, state };
}

/**
 * Serve generated pages at /__gen/<name>.html: `pages[name]` is the HTML, which may be set
 * (or replaced) while a test runs. For pages whose import map must be in the HTML before
 * any module runs, as in a server-rendered page.
 */
export async function installPages(target, pages = {}) {
  await target.route((url) => url.pathname.startsWith("/__gen/"), (route) => {
    const name = new URL(route.request().url()).pathname.replace("/__gen/", "").replace(/\.html$/, "");
    const html = pages[name];
    return html === undefined ? route.fulfill({ status: 404, body: "no such page" }) : route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html });
  });
  return pages;
}
