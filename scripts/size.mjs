// Size budgets: `npm run size` (gating in CI).
//
// Measures (1) the packed tarball (`npm pack --dry-run --json`: the compressed size and the unpacked size) and
// (2) the gzip size of every entry point of `exports`, counting the entry file plus every file it reaches through
// relative static imports (that is what a no-bundler page downloads for it), and compares them with the limits in
// package.json's "sizeBudget". It exits 1 when any measure is over its limit. `--json <file>` also writes the report
// (CI uploads it as an artifact).
//
//   "sizeBudget": { "tarball": <bytes>, "unpacked": <bytes>, "entries": { ".": <gzip bytes>, "./core": <gzip bytes>, … } }
//
// Limits are today's measurements plus headroom (see AGENTS.md "Size budgets"): raise one on purpose, in the commit
// that grows the package, never to make a red build green.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const budget = pkg.sizeBudget;
if (!budget) throw new Error('size: package.json has no "sizeBudget"');

const IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?(["'])(\.{1,2}\/[^"']+)\1/g;

/** The file plus every file it reaches through relative static imports and re-exports. */
async function reach(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const source = await readFile(file, "utf8");
    seen.set(file, source);
    // comment lines (`// import x from "./y"`, ` * import …`) are not imports; only JavaScript files are followed
    const code = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const [, , spec] of code.matchAll(IMPORT)) if (/\.[cm]?js$/.test(spec)) queue.push(resolve(dirname(file), spec));
  }
  return seen;
}

const entryFile = (target) => (typeof target === "string" ? target : target?.default ?? target?.import);
const entries = Object.entries(pkg.exports ?? {}).filter(([k, v]) => k !== "./package.json" && entryFile(v));

const pack = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
const measured = { tarball: pack.size, unpacked: pack.unpackedSize, files: pack.entryCount, entries: {} };
for (const [key, target] of entries) {
  const files = await reach(resolve(root, entryFile(target)));
  const text = [...files.values()].join("\n");
  measured.entries[key] = { gzip: gzipSync(text, { level: 9 }).length, files: files.size, raw: Buffer.byteLength(text) };
}

const rows = [
  ["tarball (npm pack)", measured.tarball, budget.tarball],
  ["unpacked (npm pack)", measured.unpacked, budget.unpacked],
  ...Object.entries(measured.entries).map(([key, m]) => [`gzip ${key} (${m.files} file${m.files === 1 ? "" : "s"})`, m.gzip, budget.entries?.[key]]),
];
const missing = Object.keys(measured.entries).filter((k) => budget.entries?.[k] === undefined);
const stale = Object.keys(budget.entries ?? {}).filter((k) => !(k in measured.entries));
let failed = false;
const w = Math.max(...rows.map(([n]) => n.length));
for (const [name, bytes, limit] of rows) {
  const over = limit === undefined || bytes > limit;
  failed ||= over;
  const note = limit === undefined ? "NO BUDGET" : `${((bytes / limit) * 100).toFixed(0)}% of ${limit}${over ? "  OVER BUDGET" : ""}`;
  console.log(`${name.padEnd(w)}  ${String(bytes).padStart(8)} B  ${note}`);
  if (over && process.env.GITHUB_ACTIONS) console.log(`::error title=size budget::${name}: ${bytes} B${limit === undefined ? " has no budget in package.json sizeBudget" : ` is over its ${limit} B budget`}`);
}
for (const k of stale) {
  failed = true;
  console.log(`sizeBudget.entries has "${k}", which is not an export of package.json: remove it`);
}
if (missing.length) console.log(`add sizeBudget.entries for: ${missing.join(", ")}`);

const out = process.argv.indexOf("--json");
if (out !== -1) {
  const file = resolve(root, process.argv[out + 1] ?? "size-report.json");
  await writeFile(file, JSON.stringify({ node: process.version, measured, budget, over: failed }, null, 2) + "\n");
  console.log(`wrote ${relative(root, file)}`);
}
process.exit(failed ? 1 : 0);
