import { defineConfig, devices } from "@playwright/test";
import { TEST_TIME_ZONE, pinTestTimeZone } from "../../scripts/test-clock.mjs";

// One zone for the runner and the page (R9, scripts/test-clock.mjs); the shared
// `test` of e2e-prod/clockedTest.ts starts each page clock at TEST_NOW.
pinTestTimeZone();

/**
 * Playwright config for the mobile PRODUCTION-build smoke check (./e2e-prod).
 *
 * `vite preview` serves an existing `dist/`, so a `vite build` must have run
 * first — the `smoke:prod` script does both. Port 4174 on purpose: 4173 is the
 * desktop's, and the two must be able to run side by side.
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:4174";

export default defineConfig({
  testDir: "./e2e-prod",
  // Says at once when dist/ is not the e2e build (`--mode e2e`) the sign-in tests need.
  globalSetup: "./e2e-prod/bundleCheck.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI: two shards of two workers each (stability plan R10); one worker locally.
  // The Enter that two workers once lost was the test typing within one frame
  // of it (note-line-ends.spec.ts), not the app.
  workers: process.env.CI ? 2 : 1,
  reporter: "list",
  // In CI the first run of every test is traced and the trace kept when it
  // fails: `on-first-retry` kept the retry, which is the attempt that passed.
  use: { baseURL, timezoneId: TEST_TIME_ZONE, trace: process.env.CI ? "retain-on-first-failure" : "on-first-retry", ...devices["Pixel 7"] },
  projects: [{ name: "mobile-chromium" }],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: "npx vite preview --port 4174 --strictPort",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
      }),
});
