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
