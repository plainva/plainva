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
  // Both languages, because there is no i18n bundle at this point.
  await expect(overlay).toContainText("Plainva can't start on this system");
  await expect(overlay).toContainText('Plainva kann auf diesem System nicht starten');
  // The version floor has to be ON the screen — "it doesn't work" alone would
  // send the next reporter down the same road.
  await expect(overlay).toContainText('macOS 13');
  await expect(overlay).toContainText('WebKitGTK 2.40');
  // And the reassurance that matters most to someone whose notes are at stake.
  await expect(overlay).toContainText('Your notes are untouched');
});

test('shows the same message when a required runtime API is missing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true });
  });

  await page.goto('/');

  await expect(page.locator(OVERLAY)).toBeVisible();
});

test('does nothing at all on a supported engine', async ({ page }) => {
  await page.goto('/');

  // Not "eventually absent" — never present. A guard that flashes a failure
  // screen on a healthy start would be worse than no guard.
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator('#root')).toBeAttached();
});
