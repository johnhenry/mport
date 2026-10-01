#!/usr/bin/env node
// mport build   [specifier...] [--config mport.config.mjs] [--out importmap.json] [--lock mport.lock.json] [--relock]
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

const USAGE = `usage:
  mport build [specifier...] [--config file] [--out importmap.json] [--lock mport.lock.json] [--relock]
  mport resolve <specifier> [--config file] [--trace]`;

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
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...specs] = positionals;
  if (values.help || !command) return log(USAGE), 0;

  const configPath = values.config ?? (await exists(resolvePath(cwd, "mport.config.mjs")) ? "mport.config.mjs" : null);
  let config = configPath ? (await import(pathToFileURL(resolvePath(cwd, configPath)).href)).default : {};
  const lockName = values.lock ?? "mport.lock.json";
  const lockPath = resolvePath(cwd, lockName);
  const lock = !values.relock && (await exists(lockPath)) ? JSON.parse(await readFile(lockPath, "utf8")) : undefined;
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

  if (command === "resolve") {
    if (!specs[0]) throw new Error(USAGE);
    const { module, trace, ...r } = (await router.resolve(specs[0])) ?? {};
    log(JSON.stringify(values.trace ? { ...r, trace } : r, null, 2));
    return 0;
  }
  if (command === "build") {
    const list = specs.length ? specs : config.specifiers ?? [];
    if (!list.length) throw new Error("mport build: no specifiers (pass them or set `specifiers` in the config)");
    const { importMap, lock: newLock } = await router.build(list, { scopes: config.scopes });
    await writeFile(resolvePath(cwd, values.out), JSON.stringify(importMap, null, 2) + "\n");
    const n = Object.keys(importMap.imports).length;
    if (prebuilt) {
      log(`mport: wrote ${values.out} (${n} imports); ${lockName} was not written because ${configPath} exports a prebuilt router (export a function to use a lockfile)`);
      return 0;
    }
    await writeFile(lockPath, JSON.stringify(newLock, null, 2) + "\n");
    log(`mport: wrote ${values.out} (${n} imports) and ${lockName}`);
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
