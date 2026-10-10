// Bundling the package itself, the way a consumer's build does (#5). Rollup is
// what Vite 7 and older build with; every import() in what a consumer bundles
// must be statically analysable, or each build prints a warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";

const ENTRY = "\0consumer";

for (const spec of ["@johnhenry/mport", "@johnhenry/mport/core", "@johnhenry/mport/firefox"]) {
  test(`rollup bundles a page that imports ${spec} without warnings`, async () => {
    const consumer = {
      name: "consumer",
      resolveId(id) {
        if (id === ENTRY) return ENTRY;
        // the package's own exports map (self-reference), as a consumer resolves it
        if (id === spec) return fileURLToPath(import.meta.resolve(spec));
      },
      load(id) {
        if (id === ENTRY) return `import * as m from ${JSON.stringify(spec)};\nconsole.log(m);\n`;
      },
    };
    const warnings = [];
    const bundle = await rollup({ input: ENTRY, plugins: [consumer], onwarn: (w) => warnings.push(w) });
    await bundle.generate({ format: "es" });
    await bundle.close();
    assert.deepEqual(
      warnings.map((w) => `${w.code}: ${w.message}`),
      [],
      "no warnings (INVALID_IMPORT_ATTRIBUTE: 'could not statically analyze an import attribute' was #5)",
    );
  });
}
