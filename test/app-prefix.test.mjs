// The recipe: an app-owned prefix (your own /components/ directory) routed beside CDN packages,
// with no registry lookup and no network at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, custom, esmSh, jsDelivr } from "../src/core.mjs";
import { fakeFetch, registryFixtures } from "./helpers.mjs";

const app = () => custom("/components/{path}", { name: "app", build: "app" });
const make = (routes, o = {}) => {
  const fetch = fakeFetch(registryFixtures);
  return { fetch, router: createRouter(routes, { probe: "none", fetch, ...o }) };
};

test("custom('/components/{path}') serves an app-owned prefix with no registry lookup", async () => {
  const { router, fetch } = make({ "components/*": app(), "*": esmSh() });
  const { importMap, lock } = await router.build(["components/button.js", "components/forms/input.js", "components/", "react@^19"]);
  assert.deepEqual(importMap.imports, {
    "components/button.js": "/components/button.js",
    "components/forms/input.js": "/components/forms/input.js",
    "components/": "/components/",
    "react": "https://esm.sh/react@19.2.0?target=es2022",
  });
  assert.deepEqual(fetch.log.map((l) => l.url), [`https://registry.npmjs.org/react`], "only react touched the registry");
  assert.equal(lock.packages["components/button.js"].provider, "app");
  assert.equal(lock.packages["components/button.js"].build, "app");
  assert.equal(lock.packages["components/button.js"].version, undefined);
});

test("the `components/` directory specifier is matched by the `components/*` route (it used to fall through to the registry)", async () => {
  const { router, fetch } = make({ "components/*": app(), "*": esmSh() });
  const r = await router.resolve("components/");
  assert.equal(r.url, "/components/");
  assert.equal(r.base, "/components/");
  assert.equal(r.provider, "app");
  assert.equal(fetch.log.length, 0);
  // an exact route still matches the same directory specifier, and `lit/` still reaches `lit*`
  assert.equal((await make({ components: app(), "*": esmSh() }).router.resolve("components/")).provider, "app");
  assert.equal((await make({ "lit*": esmSh() }).router.resolve("lit/")).provider, "esm.sh");
  // a different package's prefix is not captured by it: it goes to the catch-all (and the registry has no such package)
  await assert.rejects(make({ "components/*": app(), "*": esmSh() }).router.resolve("components-extra/"), (e) => e.name === "ResolutionError");
});

test("a lockfile keeps the app build apart: only a provider with build 'app' may serve it", async () => {
  const first = make({ "components/*": app(), "*": [esmSh(), jsDelivr()] });
  const { lock } = await first.router.build(["components/button.js"]);
  const mirror = custom("https://static.example.com/components/{path}", { name: "app-cdn", build: "app" });
  const other = make({ "components/*": [jsDelivr(), mirror] }, { lock });
  const r = await other.router.resolve("components/button.js");
  assert.equal(r.url, "https://static.example.com/components/button.js", "a mirror of the same build stands in; jsDelivr (build npm) is skipped");
  assert.match(r.trace.find((e) => e.type === "skip" && e.provider === "jsdelivr").reason, /locked to "app"/);
});
