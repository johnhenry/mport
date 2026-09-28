#!/usr/bin/env node
// mport build   [specifier...] [--config mport.config.mjs] [--out importmap.json] [--lock mport.lock.json] [--relock]
// mport resolve <specifier> [--config mport.config.mjs] [--trace]
//
// The config module's default export is either a router (from createRouter)
// or { routes, specifiers?, scopes?, options? }.
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
      lock: { type: "string", short: "l", default: "mport.lock.json" },
      relock: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...specs] = positionals;
  if (values.help || !command) return log(USAGE), 0;

  const configPath = values.config ?? (await exists(resolvePath(cwd, "mport.config.mjs")) ? "mport.config.mjs" : null);
  const config = configPath ? (await import(pathToFileURL(resolvePath(cwd, configPath)).href)).default : {};
  const lockPath = resolvePath(cwd, values.lock);
  const lock = !values.relock && (await exists(lockPath)) ? JSON.parse(await readFile(lockPath, "utf8")) : undefined;
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
    await writeFile(lockPath, JSON.stringify(newLock, null, 2) + "\n");
    log(`mport: wrote ${values.out} (${Object.keys(importMap.imports).length} imports) and ${values.lock}`);
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
