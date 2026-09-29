// Shared by the numbered examples: a fake network so they run offline and give the
// same answer every time. `offlineFetch(table)` maps URL (or "prefix*") → status code,
// body string, JSON object or (url, init) => Response; anything else is a 404.
// The registry fixtures below are shaped like the real npm/JSR metadata endpoints
// mport reads (abbreviated packuments, per-version package.json, JSR meta.json).

export const NPM = "https://registry.npmjs.org";

export const registry = {
  [`${NPM}/react`]: { "dist-tags": { latest: "19.2.0", next: "20.0.0-rc.1" }, versions: { "18.3.1": {}, "19.0.0": {}, "19.2.0": {}, "20.0.0-rc.1": {} } },
  // Real React ships CommonJS: main is index.js and there is no "type": "module".
  [`${NPM}/react/19.2.0`]: { name: "react", version: "19.2.0", main: "index.js" },
  [`${NPM}/react/18.3.1`]: { name: "react", version: "18.3.1", main: "index.js" },
  [`${NPM}/preact`]: { "dist-tags": { latest: "10.29.8" }, versions: { "10.28.0": {}, "10.29.8": {} } },
  [`${NPM}/preact/10.29.8`]: {
    name: "preact", version: "10.29.8", module: "dist/preact.module.js", main: "dist/preact.js",
    exports: {
      ".": { browser: "./dist/preact.module.js", import: "./dist/preact.mjs", require: "./dist/preact.js" },
      "./hooks": { import: "./hooks/dist/hooks.mjs", require: "./hooks/dist/hooks.js" },
    },
  },
  [`${NPM}/lit`]: { "dist-tags": { latest: "3.3.1" }, versions: { "3.3.1": {} } },
  [`${NPM}/lit/3.3.1`]: { name: "lit", version: "3.3.1", type: "module", exports: { ".": { default: "./index.js" } } },
  "https://jsr.io/@std/path/meta.json": { latest: "1.1.0", versions: { "1.0.0": {}, "1.1.0": {}, "1.2.0": { yanked: true } } },
};

export function offlineFetch(table = {}, { delays = {}, log = [] } = {}) {
  const fetch = async (url, init = {}) => {
    url = String(url);
    log.push({ url, method: init.method ?? "GET" });
    const wait = Object.entries(delays).find(([k]) => url.startsWith(k))?.[1] ?? 0;
    if (wait) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    const hit = table[url] ?? Object.entries(table).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
    if (hit === undefined) return new Response("not found", { status: 404 });
    if (typeof hit === "function") return hit(url, init);
    if (typeof hit === "number") return new Response(hit < 400 ? "ok" : "error", { status: hit });
    return new Response(typeof hit === "string" ? hit : JSON.stringify(hit), { status: 200 });
  };
  fetch.log = log;
  return fetch;
}

/** Every CDN answers with a small module body. */
export const allUp = {
  "https://esm.sh/*": "export default 'esm.sh'",
  "https://cdn.jsdelivr.net/*": "export default 'jsdelivr'",
  "https://unpkg.com/*": "export default 'unpkg'",
  "https://ga.jspm.io/*": "export default 'jspm'",
};

/** One line per trace event: "type:provider (reason)". */
export const show = (trace) =>
  trace.map((e) => `${e.type}${e.phase ? `/${e.phase}` : ""}:${e.provider}${e.reason ? ` (${e.reason})` : ""}`);
