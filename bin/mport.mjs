#!/usr/bin/env node
// mport build   [specifier...] [--config mport.config.mjs] [--out importmap.json] [--lock mport.lock.json] [--relock]
//               [--conflicts error|scope] [--graph [--max-files N] [--max-depth N]]
// mport outdated [name...] [--config file] [--lock mport.lock.json] [--json]
// mport update   [name...] [--config file] [--lock mport.lock.json] [--json]
// mport resolve <specifier> [--config mport.config.mjs] [--trace]
//
// The config module's default export is one of
//   { routes, specifiers?, scopes?, options? }   a config object (mport builds the router)
//   ({ lock, relock }) => router | config object  a function, called with the parsed lockfile
//   a router (from createRouter)                 prebuilt: it can't take --lock/--relock, so the
//                                                lock file is neither read nor written
import { readFile, writeFile, access } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createRouter } from "../src/router.mjs";
import { esmSh, jsDelivr, unpkg } from "../src/providers.mjs";
import { outdated, selectEntries } from "../src/outdated.mjs";

const USAGE = `usage:
  mport build [specifier...] [--config file] [--out importmap.json] [--lock mport.lock.json] [--relock] [--conflicts error|scope]
              [--graph [--max-files N] [--max-depth N]]
  mport resolve <specifier> [--config file] [--trace]
  mport outdated [name...] [--config file] [--lock mport.lock.json] [--json]
  mport update   [name...] [--config file] [--lock mport.lock.json] [--json]`;

const exists = (p) => access(p).then(() => true, () => false);

export async function main(argv = process.argv.slice(2), { log = console.log, cwd = process.cwd() } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      out: { type: "string", short: "o", default: "importmap.json" },
      lock: { type: "string", short: "l" },
      relock: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      conflicts: { type: "string" },
      graph: { type: "boolean", default: false },
      "max-files": { type: "string" },
      "max-depth": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...specs] = positionals;
  if (values.help || !command) return log(USAGE), 0;

  const configPath = values.config ?? (await exists(resolvePath(cwd, "mport.config.mjs")) ? "mport.config.mjs" : null);
  let config = configPath ? (await import(pathToFileURL(resolvePath(cwd, configPath)).href)).default : {};
  const lockName = values.lock ?? "mport.lock.json";
  const lockPath = resolvePath(cwd, lockName);
  const lockFile = (await exists(lockPath)) ? JSON.parse(await readFile(lockPath, "utf8")) : undefined;
  if ((command === "outdated" || command === "update") && !lockFile) throw new Error(`mport ${command}: no lockfile at ${lockName} (run \`mport build\` first)`);
  if (command === "update" && values.relock) throw new Error("mport update: --relock is what update does; it takes names instead (mport update [name...])");
  // update re-resolves what it selects, so those entries must not pin themselves; graph hashes are re-recorded
  const toUpdate = command === "update" ? selectEntries(lockFile, specs) : [];
  if (command === "update" && specs.length && !toUpdate.length) {
    throw new Error(`mport update: no locked entry matches ${specs.map((n) => `"${n}"`).join(", ")} (names are lock keys, specifiers or package names)`);
  }
  const lock = command === "update"
    ? { ...lockFile, files: undefined, packages: Object.fromEntries(Object.entries(lockFile.packages ?? {}).filter(([k]) => !toUpdate.some(([u]) => u === k))) }
    : !values.relock ? lockFile : undefined;
  const fromFunction = typeof config === "function";
  if (fromFunction) config = await config({ lock, relock: values.relock, lockPath });
  // A router built ahead of time can't take --lock/--relock: reading or rewriting the lock
  // file around it would be a lie, so refuse rather than ignore the flags.
  const prebuilt = typeof config.resolve === "function" && !fromFunction;
  if (prebuilt && (values.lock !== undefined || values.relock)) {
    throw new Error(
      `mport: ${values.relock ? "--relock" : "--lock"} has no effect because ${configPath} exports a prebuilt router. ` +
      "Export a function, `export default ({ lock }) => createRouter(routes, { lock })`, or a { routes, options } object.",
    );
  }
  const router = typeof config.resolve === "function"
    ? config
    : createRouter(config.routes ?? { "*": [esmSh(), jsDelivr(), unpkg()] }, { ...config.options, lock });

  if (command === "outdated") {
    if (typeof router.registry?.info !== "function") throw new Error("mport outdated: the router has no registry client to ask (does the config export a createRouter() router?)");
    const { outdated: rows, skipped } = await outdated(lockFile, { registry: router.registry, names: specs });
    if (values.json) log(JSON.stringify({ outdated: rows, skipped }, null, 2));
    else {
      if (!rows.length) log("mport: everything in the lockfile is up to date");
      else {
        const table = [["package", "current", "wanted", "latest"], ...rows.map((r) => [r.specifier, r.current, r.wanted, r.latest])];
        const w = [0, 1, 2, 3].map((c) => Math.max(...table.map((row) => String(row[c]).length)));
        for (const row of table) log(row.map((cell, c) => String(cell).padEnd(w[c])).join("  ").trimEnd());
      }
      for (const k of skipped) log(`mport: skipped ${k.key}: ${k.reason}`);
    }
    return 0;
  }
  if (command === "update") {
    if (prebuilt) throw new Error(`mport update: ${configPath} exports a prebuilt router, which can't take the lockfile. Export a function, \`export default ({ lock }) => createRouter(routes, { lock })\`, or a { routes, options } object.`);
    const keep = Object.entries(lockFile.packages ?? {});
    const specifiers = [...new Set(keep.map(([k, e]) => e.specifier ?? k))];
    const graph = lockFile.files ? config.graph || true : config.graph; // a lockfile that has file hashes keeps having them
    const { lock: next } = await router.build(specifiers, { conflicts: "scope", graph });
    const updated = [];
    for (const [key] of toUpdate) {
      const from = lockFile.packages[key]?.version;
      const to = next.packages[key]?.version;
      if (from !== to) updated.push({ key, specifier: lockFile.packages[key].specifier ?? key, name: lockFile.packages[key].name, from, to });
    }
    const changed = JSON.stringify(next) !== JSON.stringify(lockFile);
    if (changed) await writeFile(lockPath, JSON.stringify(next, null, 2) + "\n");
    if (values.json) log(JSON.stringify({ updated, checked: toUpdate.length, lockfile: lockName, written: changed }, null, 2));
    else if (!updated.length) log(`mport: ${toUpdate.length} locked entr${toUpdate.length === 1 ? "y" : "ies"} already at the newest version their range allows${changed ? `; ${lockName} rewritten` : ""}`);
    else {
      for (const u of updated) log(`mport: ${u.specifier}: ${u.from} -> ${u.to}`);
      log(`mport: wrote ${lockName}; run \`mport build\` to regenerate the import map`);
    }
    return 0;
  }
  if (command === "resolve") {
    if (!specs[0]) throw new Error(USAGE);
    const { module, trace, ...r } = (await router.resolve(specs[0])) ?? {};
    log(JSON.stringify(values.trace ? { ...r, trace } : r, null, 2));
    return 0;
  }
  if (command === "build") {
    const list = specs.length ? specs : config.specifiers ?? [];
    if (!list.length) throw new Error("mport build: no specifiers (pass them or set `specifiers` in the config)");
    const graph = values.graph || values["max-files"] || values["max-depth"]
      ? { ...(config.graph === true ? {} : config.graph), ...(values["max-files"] && { maxFiles: +values["max-files"] }), ...(values["max-depth"] && { maxDepth: +values["max-depth"] }) }
      : config.graph;
    const { importMap, lock: newLock, graph: walked } = await router.build(list, { scopes: config.scopes, conflicts: values.conflicts ?? config.conflicts, graph });
    for (const t of walked?.truncated ?? []) {
      log(`mport: warning: the import graph of ${t.root} was cut short at ${t.reason} ${t.limit} (${t.skipped} file(s) not hashed)`);
    }
    await writeFile(resolvePath(cwd, values.out), JSON.stringify(importMap, null, 2) + "\n");
    const n = Object.keys(importMap.imports).length;
    if (prebuilt) {
      log(`mport: wrote ${values.out} (${n} imports); ${lockName} was not written because ${configPath} exports a prebuilt router (export a function to use a lockfile)`);
      return 0;
    }
    await writeFile(lockPath, JSON.stringify(newLock, null, 2) + "\n");
    log(`mport: wrote ${values.out} (${n} imports) and ${lockName}${walked ? ` (${walked.files} files hashed)` : ""}`);
    return 0;
  }
  throw new Error(`unknown command "${command}"\n${USAGE}`);
}

const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return ""; } })();
if (import.meta.url === invoked) {
  main().then((code) => process.exit(code ?? 0), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
