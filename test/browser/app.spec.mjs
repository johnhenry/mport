import { test, expect } from "@playwright/test";
import { installStubs } from "./stubs.mjs";

// examples/app.html loads a real Preact + htm app, either through an injected import map
// (startup) or through router.import() (runtime), with esm.sh up, down, or up-but-broken.
const CASES = [
  // [mode, esm, works]
  ["startup", "up", true],
  ["startup", "down", true],
  ["startup", "breaks", false], // an import map has no fallback
  ["runtime", "up", true],
  ["runtime", "down", true],
  ["runtime", "breaks", true], // router.import() excludes esm.sh and retries
];

test.describe("app.html", () => {
  test.beforeEach(async ({ context }) => {
    await installStubs(context);
  });

  for (const [mode, esm, works] of CASES) {
    test(`${mode} mode, esm.sh ${esm}: ${works ? "the app runs" : "the app cannot load (no fallback)"}`, async ({ page }) => {
      await page.goto(`/examples/app.html?mode=${mode}&esm=${esm}`);
      const outcome = page.locator("#outcome");
      await expect(outcome).toBeVisible();
      await expect(outcome).toHaveClass(works ? /good/ : /bad/);
      if (works) {
        await expect(page.locator("#app .todo")).toHaveCount(2);
        await page.getByLabel("New todo").fill("write a browser test");
        await page.getByRole("button", { name: "Add" }).click();
        await expect(page.locator("#app .todo")).toHaveCount(3);
        await expect(page.locator("#app .status")).toContainText(esm === "up" ? "esm.sh" : "jsdelivr");
        await page.locator("#app .todo input[type=checkbox]").first().click();
      } else {
        await expect(page.locator("#app .todo")).toHaveCount(0);
      }
      if (mode === "startup" && esm !== "breaks") {
        // the import map the page installed is a standard one the engine understands
        const map = await page.evaluate(() => JSON.parse(document.querySelector('script[type="importmap"]').textContent));
        expect(Object.keys(map.imports).sort()).toEqual(["htm", "preact", "preact/hooks"]);
      }
    });
  }
});
