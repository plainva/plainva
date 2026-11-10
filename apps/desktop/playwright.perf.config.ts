import { defineConfig, devices } from '@playwright/test';

/**
 * The browser measurement at the built bundle (Gesamtplan Leistung L0,
 * decision E4): a REPORT, not a gate — browser timings on a shared CI runner
 * move too much for a verdict. `e2e-perf/browser-perf.spec.ts` writes its
 * numbers to `test-results/perf/browser-perf.json` and fails only when the app
 * cannot do what is measured.
 *
 * Runs against `vite preview` of an existing `dist/` (the `perf:browser`
 * script builds first). Port 1462 by default — never 1420 or 1440, which other
 * tools of this repository own; `PERF_PORT` or `E2E_BASE_URL` choose another.
 */
const port = Number(process.env.PERF_PORT || 1462);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e-perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/perf',
  timeout: 600_000,
  use: { baseURL, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `pnpm preview --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
