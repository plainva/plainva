import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:1440";
export default defineConfig({
  testDir: "./e2e", testMatch: ["listGeometry.spec.ts", "rtlEditor.spec.ts"], workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: "list", timeout: 60_000,
  // Its own folder, like the other two configs (a run empties its output folder first).
  outputDir: "test-results/webkit",
  use: { browserName: "webkit", baseURL, viewport: { width: 375, height: 812 }, hasTouch: true, trace: "retain-on-failure" },
  ...(process.env.E2E_BASE_URL ? {} : { webServer: { command: "pnpm dev:isolated", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 } }),
});
