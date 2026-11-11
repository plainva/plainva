import { defineConfig, devices } from '@playwright/test';
import { TEST_TIME_ZONE, pinTestTimeZone } from '../../scripts/test-clock.mjs';
import { PROBE_SPECS } from './scripts/e2e-bundle.mjs';

// One zone for the runner and the page (R9, scripts/test-clock.mjs); the shared
// `test` of e2e/fixtures/clockedTest.ts starts each page clock at TEST_NOW.
pinTestTimeZone();

// Default: dev server on 1420. E2E_BASE_URL points the suite at a server that
// already runs (a dev server on its own port, a preview). E2E_BUNDLE=1 builds
// nothing but serves the e2e bundle (`pnpm build:e2e` first) with `vite preview`
// on 4175 — what CI runs (stability plan R10, scripts/e2e-bundle.mjs).
const bundle = !process.env.E2E_BASE_URL && !!process.env.E2E_BUNDLE;
// The probe pages import a fixture module from the dev server and use nothing
// of the app's bundle: in CI they run on their own against the dev server
// (E2E_PROBES=1), and a run against the bundle leaves them out.
const probes = !!process.env.E2E_PROBES;
const againstBundle = bundle || !!process.env.E2E_AGAINST_BUNDLE;
const baseURL = process.env.E2E_BASE_URL || (bundle ? 'http://localhost:4175' : 'http://localhost:1420');

export default defineConfig({
  testDir: './e2e',
  ...(probes ? { testMatch: PROBE_SPECS } : againstBundle ? { testIgnore: PROBE_SPECS } : {}),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI: four shards of two workers each against static files (R10); one worker
  // against the dev server was 67 minutes.
  workers: process.env.CI ? 2 : undefined,
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
  expect: { timeout: process.env.E2E_BASE_URL || bundle ? 5_000 : 10_000 },
  // Each config writes into its own folder: Playwright empties its output
  // folder when a run starts, and in CI the production smoke runs right after
  // this suite — sharing `test-results/` erased the traces of every test that
  // had needed a retry before CI could upload them (E27, Befunde 2026-09-24).
  outputDir: 'test-results/e2e',
  use: {
    baseURL,
    timezoneId: TEST_TIME_ZONE,
    // Every first run is traced in CI and the trace is kept when that run
    // fails (`retain-on-first-failure`). `on-first-retry` kept the trace of the
    // RETRY, which is the attempt that passed: of three flaky tests examined on
    // 2026-10-06 none had a trace of the attempt that failed. The CI workflow
    // uploads whatever trace exists as the `playwright-*` artifact.
    trace: process.env.CI ? 'retain-on-first-failure' : 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
  ...(process.env.E2E_BASE_URL ? {} : bundle ? {
    webServer: {
      command: 'pnpm preview:e2e',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  } : {
    webServer: {
      command: 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  }),
});
