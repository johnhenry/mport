// Compiled (never run) by `npm run typecheck`: exercises the public types through the
// package's own exports map, so a declaration that disagrees with docs/api.md or the
// code's real shapes fails to compile.
import mport, {
  MPort, MPortURL, DEFAULT_ORIGINS, DEFAULT_CACHE_KEY,
  createRouter, route, esmSh, jsDelivr, unpkg, jspm, jsr, github, local, custom, origin, provider,
  fallback, race, adaptive, weighted, prefer, verified, cache, sri,
  HealthRegistry, RoutingError, SkipError, IntegrityError, ResolutionError,
  parseSpecifier, keyOf, isRoutable, createRegistry, entryInfo, entryOf, resolveExports,
  compileImportMap, mergeImportMaps, createLock, lockKey, injectImportMap, startup, createImporter, semver,
  type Resolution, type TraceEvent, type Lockfile, type ImportMap, type HealthState, type Router, type ConflictReport, type GraphReport, parseImports, outdated, pickVersion, type OutdatedRow,
} from "@johnhenry/mport";
import * as core from "@johnhenry/mport/core";
import mportRollup, { mportRollup as namedRollup, type RollupPluginOptions } from "@johnhenry/mport/rollup";
import mportVite, { mportVite as namedVite } from "@johnhenry/mport/vite";
import firefoxDefault from "@johnhenry/mport/firefox";

export async function check(): Promise<void> {
  const router: Router = createRouter(
    {
      "*": [esmSh(), jsDelivr(), unpkg()],
      "@std/*": jsr(),
      "@internal/*": "https://modules.example.com/",
      "github:*": github({ via: "esm.sh" }),
      "vendored*": local({ base: "/vendor/" }),
      "jspm*": fallback({ providers: [jspm(), unpkg()], circuitBreaker: { failures: 2, reset: "30s" } }),
      "tuned*": adaptive([esmSh(), 5], weighted(jsDelivr({ esm: true }), 3), unpkg()),
      "by-target*": prefer({ browser: esmSh(), raw: jsDelivr(), default: unpkg() }),
      "checked*": race(verified(esmSh()), verified(unpkg(), { algorithm: "sha512" })),
      "cached*": fallback(cache({ store: new Map() }), esmSh()),
      "tpl*": custom("https://x.test/{scope}/{bare}@{version}/{entry}", { build: "x" }),
      "mine*": provider({ name: "mine", build: "npm", needsEntry: true, url: (a) => `https://m.test/${a.name}@${a.version}/${a.entry ?? a.path}` }),
      "v1*": origin({ path: "cdn.jsdelivr.net/npm/" }),
    },
    { probe: "none", circuitBreaker: { failures: 3, reset: 30_000 }, allowCommonJS: false, onEvent: (e: TraceEvent) => void e.type },
  );
  const arrayRouter = createRouter([route(/^react/, esmSh()), route((s) => s.startsWith("@std/"), jsr())], { health: router.health });

  const r: Resolution | null = await router.resolve("react@^19", { exclude: new Set(["unpkg"]), relock: true });
  if (r) {
    const url: string = r.url;
    const build: string = r.build;
    const events: TraceEvent[] = r.trace;
    void [url, build, events];
  }
  await arrayRouter.resolve({ name: "@std/path", version: "^1", registry: "jsr" }, { target: "raw", capabilities: ["raw"] });
  const mod = await router.import<{ default: unknown }>("dayjs@1", { build: "esm.sh", signal: AbortSignal.timeout(1000) });
  void mod.default;

  const importLock: Lockfile = { lockfileVersion: 1, packages: {} };
  const { importMap, lock }: { importMap: ImportMap; lock: Lockfile } = await router.build(["react@^19", "lit/"], {
    scopes: { "https://legacy.example.com/": { react: "react@18" } },
  });
  const scoped = await router.build(["react@19", "react@18", "lib-a@1"], { conflicts: "scope" });
  const reports: ConflictReport[] = scoped.conflicts;
  void [reports[0]?.kept.url, reports[0]?.scoped[0]?.scope, reports[0]?.unscoped.length];
  // @ts-expect-error conflicts is "error" or "scope"
  await router.build(["react"], { conflicts: "merge" });
  const walked = await router.build(["react@19"], { graph: { maxFiles: 100, maxDepth: 5, dynamic: true, origins: ["https://esm.sh"], algorithm: "sha512" } });
  const gr: GraphReport | undefined = walked.graph;
  void [gr?.files, gr?.truncated[0]?.reason, gr?.bare, walked.lock.files?.["https://x.test/a.js"]];
  void parseImports("import 'a'", { dynamic: true });
  void compileImportMap([{ key: "a", url: "u" }], {}, { integrity: { u: "sha384-x" } });
  const behind = await outdated(importLock, { registry: router.registry, names: ["react"] });
  const row: OutdatedRow | undefined = behind.outdated[0];
  void [row?.current, row?.wanted, row?.latest, row?.updatable, behind.skipped[0]?.reason];
  void pickVersion("react", "^19", { versions: ["19.0.0"], tags: { latest: "19.0.0" } });
  const pinned = createRouter({ "*": esmSh() }, { lock });
  void pinned.lock.get("react@^19")?.version;
  void mergeImportMaps(importMap, compileImportMap([{ key: "a", url: "https://a.test/a.js" }]));

  const snapshot: Record<string, HealthState> = router.health.snapshot();
  void snapshot;
  const health = new HealthRegistry({ failures: 1, reset: "1m", now: () => 0 });
  health.failure("x");
  void [health.isOpen("x"), health.successRate("x"), health.latency("x")];

  try {
    await router.build(["./local.js"]);
  } catch (e) {
    if (e instanceof RoutingError) void e.errors.length;
    if (e instanceof ResolutionError || e instanceof SkipError || e instanceof IntegrityError) void e.trace;
  }

  const parsed = parseSpecifier("npm:react@^19/jsx-runtime");
  if (parsed) void [keyOf(parsed), lockKey(parsed), parsed.explicit, parsed.prefix];
  void isRoutable("./x.js");
  const registry = createRegistry({ npm: "https://registry.npmjs.org" });
  void registry.entryInfo("preact", "10.29.8", "hooks");
  const info: { file: string; esm: boolean } = entryInfo({ main: "index.js" });
  void [info, entryOf({ module: "x.mjs" }), resolveExports({ ".": "./x.js" })];
  void createLock({ packages: {} }).toJSON().lockfileVersion;
  void [sri(new Uint8Array([1])), semver.maxSatisfying(["1.0.0"], "^1"), semver.compare("1.0.0", "2.0.0")];

  if (typeof document !== "undefined") {
    injectImportMap(importMap);
    await startup(router, ["react@^19"]);
  }
  const load = createImporter(router);
  await load("react@^19");

  // v1
  const lodash = await mport<{ default: unknown }>("lodash-es@4.17.21/lodash.js");
  void lodash;
  const [, winner, v1info] = await MPortURL({ cdns: ["unpkg.com/", { path: "cdn.jsdelivr.net/npm/", versionMarker: "@" }], useCache: "localhost" })({ name: "x", version: "1", path: "y.js" });
  void [winner, v1info.cached, v1info.trace];
  void MPort("a.cdn/", "b.cdn/");
  void [DEFAULT_ORIGINS.length, DEFAULT_CACHE_KEY, firefoxDefault];

  // bundler plugins
  const rollupOptions: RollupPluginOptions = { mode: "importmap", versions: { react: "^19" }, packageJson: true, exclude: /^@local\//, specifiers: ["lit@3"], fileName: "map.json", build: { conflicts: "scope", graph: true } };
  const rollupPlugin = mportRollup(router, rollupOptions);
  void [namedRollup === mportRollup, rollupPlugin.name, rollupPlugin.api.specifiers(), (await rollupPlugin.api.importMap()).importMap.imports];
  const vitePlugin = mportVite(router, { mode: "external", dev: true, exclude: ["react"], packageJson: "package.json" });
  void [namedVite === mportVite, vitePlugin.enforce, vitePlugin.apply({}, { command: "build" })];
  // the real bundlers' plugin types accept ours (vite and rollup are devDependencies)
  const asVite: import("vite").Plugin = mportVite(router);
  const asRollup: import("rollup").Plugin = mportRollup(router);
  void [asVite, asRollup];
  // @ts-expect-error mode is "external" or "importmap"
  mportVite(router, { mode: "inline" });

  // core has no v1 functions
  void core.createRouter;
  // @ts-expect-error MPort is not exported from ./core
  void core.MPort;
}
