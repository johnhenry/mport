// Compare a bench run with the committed baseline, without gating: `node bench/compare.mjs <current.json> [baseline.json] [--factor N]`.
//
// A measure regresses when it is more than FACTOR times worse than the baseline (default 3: runners differ a lot, so
// this only catches a real regression such as an accidental quadratic loop). Lower is better for ms/µs, higher for
// anything per second. It prints a table and, under GitHub Actions, one `::warning::` per regression; the exit code is
// always 0. Refresh the baseline on purpose: `npm run bench -- --out bench/baseline.json` (ideally from a CI run's artifact).
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const at = args.indexOf("--factor");
const factor = at === -1 ? 3 : Number(args.splice(at, 2)[1]);
const [currentFile, baselineFile = new URL("./baseline.json", import.meta.url).pathname] = args;
if (!currentFile || !(factor > 1)) { console.error("usage: node bench/compare.mjs <current.json> [baseline.json] [--factor N>1]"); process.exit(0); }

const read = async (f) => JSON.parse(await readFile(f, "utf8")).results ?? {};
const [current, baseline] = await Promise.all([read(currentFile), read(baselineFile)]);
const lowerIsBetter = (unit) => unit === "ms" || unit === "µs" || unit === "us";
const higherIsBetter = (unit) => /\/s$/.test(unit);
let regressions = 0;
for (const [name, now] of Object.entries(current)) {
  const was = baseline[name];
  if (!was) { console.log(`new      ${name}: ${now.value} ${now.unit} (no baseline)`); continue; }
  const ratio = lowerIsBetter(now.unit) ? now.value / was.value : higherIsBetter(now.unit) ? was.value / now.value : 1;
  const bad = ratio > factor;
  regressions += bad;
  console.log(`${bad ? "REGRESS " : "ok      "} ${name}: ${now.value} ${now.unit} vs ${was.value} (${ratio.toFixed(2)}x ${ratio > 1 ? "worse" : "of the baseline"})`);
  if (bad && process.env.GITHUB_ACTIONS) console.log(`::warning title=bench regression::${name} is ${ratio.toFixed(1)}x worse than the baseline (${now.value} ${now.unit} vs ${was.value}); threshold ${factor}x, non-gating`);
}
for (const name of Object.keys(baseline)) if (!(name in current)) console.log(`missing  ${name}: in the baseline, not in this run`);
console.log(regressions ? `${regressions} measure(s) over ${factor}x the baseline (warning only)` : `no measure is over ${factor}x the baseline`);
