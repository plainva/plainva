import { test, expect } from '@playwright/test';

/**
 * The boot guard (public/boot-guard.js) is the only thing that stands between
 * an unsupported engine and a blank white window — the failure reported in
 * issue #46 and, before that, in v0.3.0.
 *
 * These tests need no Tauri mock: the guard is a classic script that runs while
 * the document is still parsing, long before the app would reach for an API.
 * Whether the app itself mounts afterwards is a different question and not this
 * file's.
 */

const OVERLAY = '#plainva-boot-failure';

test('shows a readable message when the engine cannot parse lookbehind', async ({ page }) => {
  // The actual issue #46 failure, reproduced: an engine below Safari 16.4
  // rejects a lookbehind pattern. Patching the constructor is the closest a
  // modern browser gets to being an old one.
  await page.addInitScript(() => {
    const Original = RegExp;
    const Patched = function (pattern: unknown, flags?: string) {
      if (typeof pattern === 'string' && pattern.indexOf('(?<') !== -1) {
        throw new SyntaxError('Invalid regular expression: invalid group specifier name');
      }
      return new Original(pattern as string, flags);
    } as unknown as RegExpConstructor;
    Patched.prototype = Original.prototype;
    (window as unknown as { RegExp: RegExpConstructor }).RegExp = Patched;
  });

  await page.goto('/');

  const overlay = page.locator(OVERLAY);
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Plainva can't start on this system");
  // The version floor has to be ON the screen — "it doesn't work" alone would
  // send the next reporter down the same road. Asserted on the ENGINE bar, not
  // the macOS version: the OS number is owned by floorConsistency.test.ts, and
  // a second copy here is exactly how it drifted the first time.
  await expect(overlay).toContainText('Safari 16.4');
  await expect(overlay).toContainText('WebKitGTK 2.40');
  // WHICH probe failed, and on what. Issue #46 stalled precisely here: the
  // screen said "Safari 16.4 required" to someone running Safari 17.6, and
  // neither of us could tell whether that was a false alarm or a real gap.
  await expect(overlay).toContainText('Missing: RegExp lookbehind');
  await expect(overlay).toContainText('User agent:');
  await expect(overlay).toContainText('Mozilla/');
  // And the reassurance that matters most to someone whose notes are at stake.
  await expect(overlay).toContainText('Your notes are untouched');
});

test('names structuredClone when that is the one that is missing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true });
  });

  await page.goto('/');

  const overlay = page.locator(OVERLAY);
  await expect(overlay).toBeVisible();
  // The other probe passed on this engine, so it must not appear — otherwise the
  // report would send us after the wrong feature.
  await expect(overlay).toContainText('Missing: structuredClone');
  await expect(overlay).not.toContainText('RegExp lookbehind (');
});

test('does nothing at all on a supported engine', async ({ page }) => {
  await page.goto('/');

  // Not "eventually absent" — never present. A guard that flashes a failure
  // screen on a healthy start would be worse than no guard.
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator('#root')).toBeAttached();
});

/** The entry module, in dev and in a production build — so these tests say the
 *  same thing whether the suite runs against `pnpm dev` or `vite preview`. */
const ENTRY_PATTERNS = ['**/src/main.tsx', '**/assets/index-*.js'];

test('reports the error when the entry module dies while evaluating', async ({ page }) => {
  // The v0.3.0 failure class: the bundle loads and then throws on its way up.
  // Nothing renders, and before this guard nothing said why.
  for (const pattern of ENTRY_PATTERNS) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'throw new Error("boot exploded");',
      }),
    );
  }

  await page.goto('/');

  const overlay = page.locator(OVERLAY);
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Plainva didn't start");
  // The technical detail is the whole point — without it a report says
  // "it's broken" and we are back to guessing.
  await expect(overlay).toContainText('boot exploded');
  await expect(overlay).toContainText('User agent:');
  await expect(overlay).toContainText('github.com/plainva/plainva/issues');
});

test('reports the quiet failure too: no error, nothing rendered', async ({ page }) => {
  // Harder than a thrown error, because there is nothing to catch. An empty
  // module loads fine and simply never mounts — the white window again.
  for (const pattern of ENTRY_PATTERNS) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
  }

  await page.goto('/');

  const overlay = page.locator(OVERLAY);
  await expect(overlay).toBeVisible({ timeout: 15000 });
  await expect(overlay).toContainText('No error was reported');
});

test('stays out of the way once the app has mounted', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root > *').first()).toBeAttached();

  // A background rejection after startup — a failed sync, a token refresh —
  // must never cover a working app. Mobile learned this the hard way.
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('late and harmless') }));
  });

  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test('a late mount retires the timeout overlay instead of burying the app', async ({ page }) => {
  // The watchdog's only claim is "nothing rendered after eight seconds", and a
  // slow boot disproves it a moment later — a loaded machine, a cold disk, six
  // browsers on one box. Before this, the overlay stayed for good and sat on
  // top of a perfectly running app, swallowing every click: 47 E2E tests failed
  // that way in one run (2026-08-24). An ERROR still keeps the screen; the test
  // above pins that half.
  for (const pattern of ENTRY_PATTERNS) {
    await page.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 9000));
      await route.continue();
    });
  }

  await page.goto('/');

  const overlay = page.locator(OVERLAY);
  await expect(overlay).toBeVisible({ timeout: 15000 });
  await expect(overlay).toContainText('No error was reported');

  await expect(page.locator('#root > *').first()).toBeAttached({ timeout: 20000 });
  await expect(overlay).toHaveCount(0, { timeout: 5000 });
});
