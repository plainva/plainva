import { defineConfig, devices } from '@playwright/test';

// Default: dev server on 1420. Set E2E_BASE_URL (e.g. http://localhost:4173 with
// `vite preview`) to run the suite against a production build instead.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:1420';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  // Measured 2026-09-04 (Sammelplan § 2.27, third look): two full runs of
  // 275 tests with the default worker count (12 on 24 cores) against the
  // ONE Vite dev server behind them. Run 1: a single timeout, a test that
  // navigates seven times and spent 30.0 s; run 2: green, the same test at
  // 28.4 s. Nothing in the app was slow — every `page.goto` and every
  // `await import('/src/…')` inside a test queues on that one transform
  // pipeline, and the earlier victims (boot-guard, the sync-error dialog,
  // both lazy-loading) are the same class. So the assertion budget follows
  // the measurement instead of the 5 s default; the production config is
  // untouched, its files are static.
  expect: { timeout: process.env.E2E_BASE_URL ? 5_000 : 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
  ...(process.env.E2E_BASE_URL ? {} : {
    webServer: {
      command: 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  }),
});
