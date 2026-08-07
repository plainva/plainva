import { defineConfig, devices } from "@playwright/test";

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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry", ...devices["Pixel 7"] },
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
