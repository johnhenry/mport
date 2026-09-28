// A fake network: map URL → status | body | (url, init) => Response.
export function fakeFetch(table = {}, { delays = {}, log = [] } = {}) {
  const fetch = async (url, init = {}) => {
    url = String(url);
    log.push({ url, method: init.method ?? "GET" });
    const wait = Object.entries(delays).find(([k]) => url.startsWith(k))?.[1] ?? 0;
    if (wait) {
      await new Promise((res, rej) => {
        const t = setTimeout(res, wait);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    const hit = table[url] ?? Object.entries(table).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
    if (hit === undefined) return new Response("not found", { status: 404 });
    if (typeof hit === "function") return hit(url, init);
    if (typeof hit === "number") return new Response(hit < 400 ? "ok" : "err", { status: hit });
    return new Response(typeof hit === "string" ? hit : JSON.stringify(hit), { status: 200 });
  };
  fetch.log = log;
  return fetch;
}

export const NPM = "https://registry.npmjs.org";

export const registryFixtures = {
  [`${NPM}/react`]: { "dist-tags": { latest: "19.2.0", next: "20.0.0-rc.1" }, versions: { "18.3.1": {}, "19.0.0": {}, "19.2.0": {}, "20.0.0-rc.1": {} } },
  // (Real React is CommonJS; these fixtures are marked as ES modules so routing tests can use raw CDNs.
  // `cjs-only` below is the realistic CommonJS case.)
  [`${NPM}/react/19.2.0`]: { name: "react", version: "19.2.0", type: "module", main: "index.js" },
  [`${NPM}/react/18.3.1`]: { name: "react", version: "18.3.1", type: "module", main: "index.js" },
  [`${NPM}/cjs-only`]: { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
  [`${NPM}/cjs-only/1.0.0`]: { name: "cjs-only", version: "1.0.0", main: "index.js", exports: { ".": { require: "./index.js", default: "./index.js" } } },
  [`${NPM}/preact`]: { "dist-tags": { latest: "10.29.8" }, versions: { "10.29.8": {} } },
  [`${NPM}/preact/10.29.8`]: {
    module: "dist/preact.module.js",
    exports: {
      ".": { types: "./src/index.d.ts", browser: "./dist/preact.module.js", import: "./dist/preact.mjs", require: "./dist/preact.js" },
      "./hooks": { import: "./hooks/dist/hooks.mjs", require: "./hooks/dist/hooks.js" },
      "./compat/*": { import: "./compat/dist/*.mjs" },
      "./package.json": "./package.json",
    },
  },
  [`${NPM}/lit`]: { "dist-tags": { latest: "3.3.1" }, versions: { "3.3.1": {} } },
  [`${NPM}/lit/3.3.1`]: { type: "module", exports: { ".": { types: "./index.d.ts", default: "./index.js" } } },
  [`${NPM}/@scope%2Fpkg`]: { "dist-tags": { latest: "1.2.3" }, versions: { "1.0.0": {}, "1.2.3": {} } },
  [`${NPM}/@scope%2Fpkg/1.2.3`]: { module: "./dist/pkg.mjs", main: "dist/pkg.cjs" },
  "https://jsr.io/@std/path/meta.json": { latest: "1.1.0", versions: { "1.0.0": {}, "1.1.0": {}, "1.2.0": { yanked: true } } },
};

export const clock = () => {
  let t = 0;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  return now;
};
