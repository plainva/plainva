import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the PRODUCTION-build smoke check (../e2e-prod).
 *
 * Unlike the default config (playwright.config.ts), which runs the full suite
 * against the Vite dev server, this one runs a single tiny spec against the
 * bundled output served by `vite preview`. It exists to catch production-only
 * startup failures (module init order, minification, code-splitting, CSP) that
 * the dev-server suite is structurally blind to.
 *
 * `vite preview` serves an existing `dist/`, so a `vite build` must have run
 * first: the `smoke:prod` script does that; in CI the dedicated build step does.
 * Set E2E_BASE_URL to point at an already-running preview instead.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          // Serves apps/desktop/dist (must be built first). --strictPort makes a
          // busy 4173 fail loudly instead of drifting to another port the tests
          // would never reach.
          command: 'pnpm preview --port 4173 --strictPort',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
      }),
});
