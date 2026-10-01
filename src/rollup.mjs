// Rollup plugin: bare imports go through a mport router.
//
//   import mport from "@johnhenry/mport/rollup";
//   export default { input: "src/main.js", plugins: [mport(router)], output: { dir: "dist" } };
//
// mode "external" (default): `import "react"` becomes `import "https://esm.sh/react@19.2.0?target=es2022"`.
// mode "importmap": the import stays `import "react"` and the bundle gets an `importmap.json`
// asset (the build's import map) for you to inline into the page.
import { createBundlerCore } from "./bundler.mjs";

/**
 * @param {object} router a router from createRouter()
 * @param {object} [options] see docs/api.md ("Bundler plugins")
 */
export function mportRollup(router, options = {}) {
  const core = createBundlerCore(router, options);
  const { fileName = "importmap.json" } = options;
  return {
    name: "mport",
    api: core,
    async buildStart() {
      await core.loadPackageJson();
    },
    resolveId(source) {
      return core.resolveId(source);
    },
    async generateBundle() {
      if (core.mode !== "importmap") return;
      const { importMap } = await core.importMap();
      this.emitFile({ type: "asset", fileName, source: JSON.stringify(importMap, null, 2) + "\n" });
    },
  };
}

export default mportRollup;
