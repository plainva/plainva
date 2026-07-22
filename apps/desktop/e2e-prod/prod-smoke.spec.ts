import { test, expect } from '@playwright/test';

/**
 * Production-build smoke check.
 *
 * The rest of the E2E suite (../e2e) runs against the Vite DEV server, so it
 * cannot see failures that only exist in the bundled PRODUCTION build: module
 * init order, minification, code-splitting or CSP. v0.3.0 shipped a white-screen
 * exactly there — searchSnippet.tsx read a class static at module top level and
 * the production bundle evaluated that module before the class initialized,
 * throwing during startup (see commit c5d6a7e). Dev never hit it.
 *
 * This spec loads the real `vite build` output (served by `vite preview`, wired
 * in playwright.prod.config.ts) and asserts the app actually boots. It runs with
 * NO Tauri mock on purpose: that is precisely how the fix was verified by hand,
 * and it keeps the check a pure "does the bundle come up" signal. Because the
 * Tauri backend is absent, the settings store logs a handled
 * "Cannot read properties of undefined (reading 'invoke')" to console.error and
 * the app degrades to the splash — so we must NOT assert on console.error here.
 * The startup crash we guard against instead surfaces as an UNCAUGHT pageerror
 * plus an empty #root, which is what these assertions look for.
 */
test('production bundle boots and renders the splash without an uncaught error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/');

  // The splash is the default entry screen. Its presence proves the bundle
  // evaluated, React mounted and the first real screen rendered (not just an
  // ErrorBoundary fallback). Startup is async — main.tsx renders inside
  // i18nReady.then(...) after the locale chunk loads — so allow a generous wait.
  try {
    await expect(
      page.getByText(/Willkommen bei Plainva|Welcome to Plainva/),
    ).toBeVisible({ timeout: 15000 });
  } catch (error) {
    throw new Error(
      `${String(error)}\nUncaught page errors during startup:\n${pageErrors.join("\n") || "(none)"}`,
      { cause: error },
    );
  }

  // Belt and suspenders: a white-screen leaves #root empty even if some other
  // element happened to match the text.
  await expect(page.locator('#root > *').first()).toBeVisible();

  // A module-init / bundle-evaluation crash throws OUTSIDE any handler, so it
  // arrives as an uncaught pageerror. Report the messages on failure.
  expect(pageErrors, `Uncaught page errors during startup:\n${pageErrors.join('\n')}`).toEqual([]);
});
