// A range becomes one exact version, looked up in the registry; the trace shows the
// lookup. Exact versions skip the lookup; dist-tags and JSR packages work too; an
// impossible range is one ResolutionError, not a CDN failure.
import assert from "node:assert/strict";
import { createRouter, esmSh, jsr } from "@johnhenry/mport";
import { offlineFetch, registry, show } from "./_offline.mjs";

const fetch = offlineFetch(registry);
const router = createRouter({ "*": esmSh(), "@std/*": jsr() }, { fetch, probe: "none" });

const react = await router.resolve("react@^19");
assert.equal(react.version, "19.2.0");
assert.equal(react.url, "https://esm.sh/react@19.2.0?target=es2022");
assert.deepEqual(show(react.trace), ["lookup:npm registry", "resolved:npm registry", "selected:esm.sh"]);

const exact = await router.resolve("react@18.3.1");
assert.deepEqual(show(exact.trace), ["selected:esm.sh"], "an exact version needs no lookup");

assert.equal((await router.resolve("react@next")).version, "20.0.0-rc.1", "dist-tags resolve too");
// ^20 does not match the prerelease, so no version satisfies it: one ResolutionError,
// and no CDN is blamed for it.
await assert.rejects(router.resolve("react@^20"), { name: "ResolutionError" });
assert.deepEqual(router.health.snapshot(), {});

const path = await router.resolve("@std/path@^1");
assert.equal(path.registry, "jsr");
assert.equal(path.version, "1.1.0", "yanked 1.2.0 is ignored");
assert.equal(path.url, "https://esm.sh/jsr/@std/path@1.1.0?target=es2022");

console.log("01 ok:", react.url, "|", path.url);
