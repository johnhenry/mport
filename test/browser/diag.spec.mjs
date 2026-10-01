import { test } from "@playwright/test";
import { installStubs } from "./stubs.mjs";
test("diag: late import map", async ({ page, context, browserName }) => {
  await installStubs(context);
  page.on("console", (m) => console.log(`DIAG[${browserName}] console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => console.log(`DIAG[${browserName}] pageerror: ${e.message}`));
  await page.goto("/test/browser/fixtures/blank.html");
  await page.waitForFunction(() => window.ready === true);
  const r = await page.evaluate(async () => {
    const el = window.mport.injectImportMap({ imports: { demo: "https://esm.sh/lit@3.3.1?target=es2022" } });
    const out = { ua: navigator.userAgent, supports: HTMLScriptElement.supports?.("importmap") };
    out.late = await new Promise((resolve) => {
      const s = document.createElement("script");
      s.type = "module";
      s.textContent = `try { const m = await import("demo"); window.__r = "loaded:" + m.default; } catch (e) { window.__r = "error:" + e.message; }`;
      s.onload = () => setTimeout(() => resolve(window.__r), 300);
      document.body.append(s);
      setTimeout(() => resolve(window.__r ?? "timeout"), 3000);
    });
    return out;
  });
  console.log(`DIAG[${browserName}] ${JSON.stringify(r)}`);
});
