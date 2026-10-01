import { test, expect } from "@playwright/test";
import { installStubs } from "./stubs.mjs";

// examples/compat.html runs the 1.x API through both entry points (including a scan that
// the Firefox entry never contains a two-argument import()).
test("compat.html: every 1.x check passes on both entry points", async ({ context, page }) => {
  await installStubs(context);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/examples/compat.html");
  const summary = page.locator("#summary");
  await expect(summary).toContainText("checks passed on both entry points", { timeout: 40_000 });
  await expect(summary).toHaveClass(/ok/);
  expect(await page.locator("td.res.fail").count()).toBe(0);
  expect(await page.locator("td.res.pass").count()).toBeGreaterThanOrEqual(17);
  expect(errors).toEqual([]);
});

test("index.html redirects to the playground", async ({ context, page }) => {
  await installStubs(context);
  await page.goto("/examples/index.html");
  await expect(page).toHaveURL(/playground\.html$/);
});
