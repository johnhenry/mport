import { test, expect } from "@playwright/test";
import { installStubs } from "./stubs.mjs";

// examples/playground.html runs every scenario in the page and checks its own claims
// ("Did it happen?"). Here each scenario must come out with every check passing, in
// every engine, against the stub CDN.
const SCENARIOS = [
  "normal", "namespace", "outage", "runtime", "race", "breaker", "pinning", "prefer", "integrity", "v1",
];

test.describe("playground scenarios", () => {
  test.beforeEach(async ({ context }) => {
    await installStubs(context);
  });

  for (const [i, id] of SCENARIOS.entries()) {
    test(`${i + 1}. ${id}`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/examples/playground.html");
      await expect(page.locator("#scenario-buttons button")).toHaveCount(10);
      // (the first scenario also plays on load; clicking it replays it)
      await page.locator("#scenario-buttons button").nth(i).click();
      const marks = page.locator("#scenario .checks .mark");
      await expect(marks.first()).toBeVisible();
      await expect(page.locator("#scenario .checks .mark.wait")).toHaveCount(0, { timeout: 60_000 });
      const texts = await page.locator("#scenario .checks li").allTextContents();
      expect(await page.locator("#scenario .checks .mark.fail").count(), `failed checks:\n${texts.join("\n")}`).toBe(0);
      expect(await marks.count()).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }

  test("build your own: Resolve produces an import map and a lockfile", async ({ page }) => {
    await page.goto("/examples/playground.html");
    await page.locator("#specs").fill("preact@^10\nnanoid@^5");
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(page.locator("#cards .card").first()).toBeVisible();
    await expect(page.locator("#output")).toContainText('"nanoid"', { timeout: 20_000 }); // the scenario that auto-plays on load wrote its own map first
    const map = JSON.parse(await page.locator("#output").textContent());
    expect(Object.keys(map.imports).sort()).toEqual(["nanoid", "preact"]);
    await page.locator('[data-tab="lock"]').click();
    await expect(page.locator("#output")).toContainText('"lockfileVersion": 1');
  });
});
