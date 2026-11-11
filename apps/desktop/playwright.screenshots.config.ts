import { defineConfig, devices } from '@playwright/test';

/**
 * The desktop screenshot walk (docs/engineering/Screenshot_Captures.md). Not a
 * test suite: it photographs scenes into PLAINVA_SHOTS_DIR, in light and dark.
 * Needs a dev server it does not start itself — never on 1420 (the E2E suite)
 * or 1440 (the maintainer's isolated dev server):
 *
 *   pnpm --filter desktop exec vite --port 1464 --strictPort
 *   E2E_BASE_URL=http://localhost:1464 npx playwright test --config playwright.screenshots.config.ts
 */
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('Set E2E_BASE_URL to a running desktop dev server (not 1420/1440).');

export default defineConfig({
  testDir: './e2e-screenshots',
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/screenshots',
  use: { baseURL, viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
});
