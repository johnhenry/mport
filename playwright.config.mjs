import { defineConfig, devices } from "@playwright/test";

// 8731, not a popular dev port; override with MPORT_TEST_PORT if it is taken
const PORT = Number(process.env.MPORT_TEST_PORT ?? 8731);

// The browser runtime on all three engines. Pages are served from the repository by a
// static server Playwright starts; every CDN and registry request is answered by
// page.route stubs (test/browser/stubs.mjs), so the suite is hermetic.
export default defineConfig({
  testDir: "test/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node test/browser/serve.mjs",
    url: `http://127.0.0.1:${PORT}/package.json`,
    reuseExistingServer: false, // never test against whatever else happens to hold the port
    env: { PORT: String(PORT) },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
