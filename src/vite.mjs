// @ts-self-types="./vite.d.ts"
// Vite plugin: bare imports go through a mport router (production builds).
//
//   import mport from "@johnhenry/mport/vite";
//   export default { plugins: [mport(router)] };
//
// mode "external" (default): the built bundle imports the CDN URL directly.
// mode "importmap": the bundle keeps bare imports and the plugin injects the
// `<script type="importmap">` for them at the top of index.html's <head>.
// Dev server: untouched by default (Vite pre-bundles dependencies itself); `dev: true`
// applies the same resolution there ("external" mode only).
import { createBundlerCore } from "./bundler.mjs";
import { importMapText } from "./importmap.mjs";

export function mportVite(router, options = {}) {
  const core = createBundlerCore(router, options);
  const { dev = false } = options;
  if (dev && core.mode === "importmap") throw new TypeError('mport: the Vite plugin\'s dev option works with mode "external" only (the import map is known only once the bundle has been built)');
  return {
    name: "mport",
    enforce: "pre",
    api: core,
    apply: (_config, { command }) => command === "build" || dev,
    async configResolved(config) {
      await core.loadPackageJson(config.root);
    },
    resolveId(source, _importer, opts) {
      if (opts?.ssr) return null; // Node can't import an https: URL; leave server builds alone
      if (/^(vite(\/|$)|\/?@vite\/)/.test(source)) return null; // Vite's own virtual modules (vite/modulepreload-polyfill, …)
      return core.resolveId(source);
    },
    transformIndexHtml: {
      order: "post",
      async handler() {
        if (core.mode !== "importmap") return;
        const { importMap } = await core.importMap();
        return [{ tag: "script", attrs: { type: "importmap" }, children: importMapText(importMap), injectTo: "head-prepend" }];
      },
    },
  };
}

export default mportVite;
