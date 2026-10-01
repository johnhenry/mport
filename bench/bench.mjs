// Benchmarks (non-gating): `npm run bench` [-- --json].
//
// All against a fake fetch, so these measure mport's own work (routing, registry
// parsing, hashing, import-map compilation), not network speed. A real build is
// dominated by round trips; see "latency" below for the effect of concurrency.
//
//   cold build        50 specifiers, nothing cached or locked: registry lookup, (entry
//                     lookup,) CDN probe, import map, lockfile
//   cold build, graph the same plus fetching, hashing and parsing 4 files per module
//   resolve (pinned)  resolve() with a lockfile and probe "none": the per-specifier
//                     routing cost once versions are known
//   resolve (warm)    resolve() on a router whose registry lookups are memoized
//   parseImports      MB/s over minified-looking module source
//   latency           the cold build with 20 ms per request: shows the concurrency win
import { createRouter, esmSh, jsDelivr, parseImports } from "../src/core.mjs";
import { fakeFetch } from "../test/helpers.mjs";

const COUNT = 50;
const NPM = "https://registry.npmjs.org";
const names = Array.from({ length: COUNT }, (_, i) => `pkg-${String(i).padStart(2, "0")}`);

const table = {};
for (const n of names) {
  table[`${NPM}/${n}`] = { "dist-tags": { latest: "2.1.0" }, versions: { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} } };
  table[`${NPM}/${n}/2.1.0`] = { name: n, version: "2.1.0", type: "module", main: "index.js" };
  const base = `https://esm.sh/${n}@2.1.0`;
  table[`${base}?target=es2022`] = `export * from "/${n}@2.1.0/es2022/${n}.mjs";`;
  table[`${base}/es2022/${n}.mjs`] = `import"/${n}@2.1.0/es2022/a.mjs";import b from"./b.mjs";export default b;`;
  table[`${base}/es2022/a.mjs`] = `import{c}from"./c.mjs";export const a=c+1;`;
  table[`${base}/es2022/b.mjs`] = `export default 1;`;
  table[`${base}/es2022/c.mjs`] = `export const c=${"1+".repeat(50)}1;`;
}
table["https://cdn.jsdelivr.net/*"] = "export {}";
const specifiers = names.map((n) => `${n}@^2`);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
const time = async (fn) => {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
};
const fmt = (ms) => `${ms.toFixed(1)} ms`;
const results = {};
const record = (name, value, unit, extra = {}) => { results[name] = { value: +value.toFixed(2), unit, ...extra }; };

const make = (o = {}, delay = 0) => {
  const base = fakeFetch(table);
  const fetch = delay ? async (...a) => (await new Promise((r) => setTimeout(r, delay)), base(...a)) : base;
  return createRouter({ "*": esmSh() }, { fetch, ...o });
};

async function series(name, runs, fn) {
  await fn(); // warm-up: JIT, module loading
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await time(fn));
  record(name, median(samples), "ms", { p95: +p95(samples).toFixed(2), runs, specifiers: COUNT });
}

await series("cold build, probe head", 30, () => make().build(specifiers));
await series("cold build, jsDelivr raw (entry lookup + probe)", 30, () =>
  createRouter({ "*": jsDelivr() }, { fetch: fakeFetch(table) }).build(specifiers));
await series("cold build, probe none", 30, () => make({ probe: "none" }).build(specifiers));
await series("cold build, graph (4 files per module)", 15, () => make({ probe: "none" }).build(specifiers, { graph: true }));
await series("cold build, 20 ms latency per request", 3, () => make({}, 20).build(specifiers));

// per-specifier resolve cost with pins (no registry), and with a warm registry memo
{
  const { lock } = await make({ probe: "none" }).build(specifiers);
  const router = make({ probe: "none", lock });
  const N = 5000;
  const t = await time(async () => { for (let i = 0; i < N; i++) await router.resolve(specifiers[i % COUNT]); });
  record("resolve, pinned by lockfile", (N / t) * 1000, "resolutions/s", { n: N });
}
{
  const router = make({ probe: "none" });
  await Promise.all(specifiers.map((s) => router.resolve(s)));
  const N = 5000;
  const t = await time(async () => { for (let i = 0; i < N; i++) await router.resolve(specifiers[i % COUNT]); });
  record("resolve, warm registry memo", (N / t) * 1000, "resolutions/s", { n: N });
}

// import parsing
{
  const chunk = `import{a as b}from"/x/y.mjs";const f=(e,t)=>{return e/t/2+"import z from 'no'"};export{f as default};/* import q from "no" */\n`.repeat(2000);
  const mb = chunk.length / 1e6;
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(await time(() => parseImports(chunk)));
  record("parseImports", mb / (median(runs) / 1000), "MB/s", { sizeMB: +mb.toFixed(2) });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, results }, null, 2));
} else {
  console.log(`mport bench: Node ${process.version} on ${process.platform}-${process.arch}; fake fetch, no network\n`);
  const w = Math.max(...Object.keys(results).map((k) => k.length));
  for (const [name, r] of Object.entries(results)) {
    const value = r.unit === "ms" ? `${fmt(r.value)} (p95 ${fmt(r.p95)}, ${r.runs} runs)` : `${Math.round(r.value).toLocaleString("en-US")} ${r.unit}`.replace(/(\.\d+)? MB\/s/, " MB/s");
    console.log(`${name.padEnd(w)}  ${value}`);
  }
}
