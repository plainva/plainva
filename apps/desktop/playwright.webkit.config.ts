import { defineConfig } from "@playwright/test";
import { TEST_TIME_ZONE, pinTestTimeZone } from "../../scripts/test-clock.mjs";

// One zone for the runner and the page (R9, scripts/test-clock.mjs); the shared
// `test` of e2e/fixtures/clockedTest.ts starts each page clock at TEST_NOW.
pinTestTimeZone();

const baseURL = process.env.E2E_BASE_URL || "http://localhost:1440";
export default defineConfig({
  testDir: "./e2e", testMatch: ["listGeometry.spec.ts", "rtlEditor.spec.ts", "tableCell.spec.ts"], workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: "list", timeout: 60_000,
  // Its own folder, like the other two configs (a run empties its output folder first).
  outputDir: "test-results/webkit",
  use: { browserName: "webkit", baseURL, timezoneId: TEST_TIME_ZONE, viewport: { width: 375, height: 812 }, hasTouch: true, trace: "retain-on-failure" },
  ...(process.env.E2E_BASE_URL ? {} : { webServer: { command: "pnpm dev:isolated", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 } }),
});
