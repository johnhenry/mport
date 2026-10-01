// The CSP hash of the inline import map (issue #2), verified by real engines under a strict policy:
// the hash mport computes must equal the one the browser computes for the text it parsed, byte for
// byte, or the import map is blocked and the page's bare imports fail. A wrong hash is the control.
import { test, expect } from "@playwright/test";
import { renderImportMapCsp, importMapHash } from "../../src/core.mjs";

const DEP = "/test/browser/fixtures/csp-dep.mjs";
const POLICY = (hash) => `default-src 'none'; script-src 'self' ${hash}; require-trusted-types-for 'script'`;

// serve `html` at a made-up path with a Content-Security-Policy header; every other request (the fixtures) goes to the static server
const serve = async (page, path, html, policy) => {
  await page.route(`**${path}`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": policy }, body: html }));
};
const WRONG = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='";

// a map with characters that get escaped and ones that are not ASCII, so a hash of anything but the emitted text fails
const MAP = { imports: { dep: DEP, "a<b": DEP, "é€😀": DEP, "u v": DEP } };

for (const { name, hash, allowed } of [
  { name: "the hash from renderImportMapCsp()", hash: async (r) => r.hash, allowed: true },
  { name: "a wrong hash (control)", hash: async () => WRONG, allowed: false },
]) {
  test(`static page, inline import map allowed by ${name}: ${allowed ? "bare imports resolve" : "the map is blocked"}`, async ({ page }) => {
    const r = await renderImportMapCsp(MAP);
    const html = `<!doctype html><meta charset="utf-8"><script src="/test/browser/fixtures/csp-probe.js"></script>\n${r.html}\n<script type="module" src="/test/browser/fixtures/csp-main.mjs"></script>`;
    await serve(page, "/csp-static.html", html, POLICY(await hash(r)));
    await page.goto("/csp-static.html");
    if (allowed) {
      await page.waitForFunction(() => window.result === "dep-loaded");
      expect(await page.evaluate(() => window.violations)).toEqual([]);
    } else {
      await page.waitForFunction(() => window.violations.some((v) => v.directive.startsWith("script-src")));
      expect(await page.evaluate(() => window.result)).toBeUndefined();
    }
  });
}

test("the browser's own hash of the parsed script text equals mport's (read back from the DOM)", async ({ page }) => {
  const r = await renderImportMapCsp(MAP);
  await serve(page, "/csp-static.html", `<!doctype html><meta charset="utf-8">${r.html}`, POLICY(r.hash));
  await page.goto("/csp-static.html");
  const text = await page.evaluate(() => document.querySelector('script[type="importmap"]').textContent);
  expect(text).toBe(r.text);
  const browserHash = await page.evaluate(async (text) => {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    return `'sha256-${btoa(String.fromCharCode(...d))}'`;
  }, text);
  expect(browserHash).toBe(r.hash);
});

test("a DOM-injected import map is allowed by the same hash (injectImportMap sets the same text)", async ({ page, browserName }) => {
  test.skip(browserName === "firefox", "Firefox ignores an import map added after a module has loaded (the injector is itself a module)");
  const hash = await importMapHash({ imports: { dep: DEP } });
  // Trusted Types would reject a string assigned to a script's text: this policy leaves it out
  await serve(page, "/csp-inject.html", `<!doctype html><meta charset="utf-8"><script src="/test/browser/fixtures/csp-probe.js"></script><script src="/test/browser/fixtures/csp-inject.js"></script>`,
    `default-src 'none'; script-src 'self' ${hash}`);
  await page.goto("/csp-inject.html");
  await page.waitForFunction(() => window.result !== undefined || window.failure !== undefined);
  expect(await page.evaluate(() => window.failure)).toBeUndefined();
  expect(await page.evaluate(() => window.result)).toBe("dep-loaded");
});
