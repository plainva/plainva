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
  //
  // Scoped to the splash's own H1 on purpose. A bare text match ALSO hit the
  // first-run welcome modal, which carries the same wording in an <h2> and
  // mounts a beat later: whether the assertion resolved before or after that
  // decided between "passed" and "strict mode violation", so the check failed
  // under load and passed in isolation (four pushes, 2026-07-29). The modal is
  // the app working, not a defect — the smoke asks whether the bundle boots.
  try {
    await expect(
      page.getByRole('heading', { level: 1, name: /Willkommen bei Plainva|Welcome to Plainva/ }),
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

/**
 * The auxiliary-window entry point, in the production bundle (multi-window P0).
 *
 * A second window is a second entry into the SAME bundle (`index.html?win=aux`),
 * and that changes what the production build evaluates first — exactly the class
 * of failure that shipped a white window twice (v0.3.0 and the mobile bundle in
 * S20). The dev-server suite cannot see it, so the aux shell is checked here
 * from the day it exists rather than the day it breaks.
 *
 * Without a Tauri backend there is no window bus and no vault: the shell reports
 * that and renders its title bar. That is the point — what is being asserted is
 * that the bundle evaluates and the aux tree mounts, not that a vault opens.
 */
test('production bundle boots the auxiliary window shell', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/?win=aux&vault=%2Ftmp%2Fvault&content=Test.md&label=aux-1');

  // The aux title bar is the shell's own chrome — no ribbon, no tabs, no
  // sidebars. Its presence proves the client-mode provider mounted.
  await expect(page.getByTestId('aux-titlebar')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('aux-titlebar')).toContainText('Test.md');
  await expect(page.getByTestId('aux-content')).toBeVisible();

  expect(pageErrors, `Uncaught page errors in the aux window:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * A singleton view in an auxiliary window, in the production bundle (P2).
 *
 * A view window loads chunks the note window never touches (graph engine,
 * calendar, mail) through a SECOND entry point — the exact combination that
 * shipped a white window twice. It also proves the title: "plainva://calendar"
 * has no file name, so splitting it on "/" would name the window "calendar"
 * lowercase, and the taskbar entry is all the user has to tell two windows
 * apart.
 */
test('production bundle boots an auxiliary window showing a view', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/?win=aux&vault=%2Ftmp%2Fvault&content=plainva%3A%2F%2Fcalendar&label=aux-2');

  await expect(page.getByTestId('aux-titlebar')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('aux-titlebar')).toContainText(/Kalender|Calendar/);

  expect(pageErrors, `Uncaught page errors in the view window:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * A preset window, in the production bundle (P4/E4).
 *
 * What this can see is the aux entry evaluating with a preset in the URL — the
 * module-order surface that has shipped a white window twice. What it can NOT
 * see is the split filling up: the panes render only once a vault adapter
 * exists, and this smoke deliberately runs without a Tauri backend. The seeded
 * split is asserted in ../e2e/multi-window.spec.ts, where the backend is mocked.
 */
test('production bundle boots a preset window', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/?win=aux&vault=%2Ftmp%2Fvault&content=plainva%3A%2F%2Fmail&preset=mail-calendar&label=aux-3');

  await expect(page.getByTestId('aux-titlebar')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('aux-content')).toBeVisible();

  expect(pageErrors, `Uncaught page errors in the preset window:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * The FULL second window, in the production bundle (multi-window stage C).
 *
 * A third entry point into the same bundle — and the heaviest one: it pulls the
 * whole shell (ribbon, sidebars, tabs, status bar) in client mode. That is the
 * same combination that shipped a white window twice, one shell larger, so it
 * is smoke-checked from the day it exists.
 *
 * Without a Tauri backend no vault opens, so what must appear is the honest
 * empty state rather than a tree: a full window carries no "open vault" of its
 * own (plan E7), and an empty shell would be a dead end.
 */
test('production bundle boots the full second window', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/?win=full&vault=%2Ftmp%2Fvault&label=full-1');

  await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 15000 });
  // Scoped by text rather than by order: the shell mounts other live regions.
  const empty = page.getByRole('status').filter({ hasText: /No vault open|Kein Vault/ });
  await expect(empty).toBeVisible({ timeout: 15000 });

  expect(pageErrors, `Uncaught page errors in the full window:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * A full window on a DIFFERENT vault than the central one (stage D).
 *
 * With two vaults open at once the vault is no longer a constant of the app but
 * a parameter of the window, and it travels through the query string. This is
 * the boot with a foreign one - deliberately a Windows path, because the vault
 * string now passes through path handling (the nesting check, the per-vault
 * storage keys) before anything renders, and a mistake there fails the way the
 * white window did: not with a message, with nothing.
 */
test('production bundle boots a full window on a foreign vault', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

  await page.goto('/?win=full&vault=C%3A%5CVaults%5CProject%20B&label=full-2');

  await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 15000 });
  const empty = page.getByRole('status').filter({ hasText: /No vault open|Kein Vault/ });
  await expect(empty).toBeVisible({ timeout: 15000 });

  expect(pageErrors, `Uncaught page errors in the foreign-vault window:\n${pageErrors.join('\n')}`).toEqual([]);
});
