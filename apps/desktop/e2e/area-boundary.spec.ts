/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';
import { installMenuVault } from './fixtures/menuVault';

// Areas that fail on their own (stability plan 2026-11-10, R3). Before it, a
// render error in one view took the whole window: the only error boundary sat
// around the app. A real crash cannot be ordered from outside, so the areas
// are made to fail through the boundary's test seam (`__plainvaAreaCrash`,
// present in the dev server and the e2e bundle, dead code in every shipped
// build); everything around them is the real app.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  await page.setViewportSize({ width: 1400, height: 900 });
});

const crash = (page: Page, area: string) => page.evaluate((a) => (window as any).__plainvaAreaCrash.crash(a), area);
const heal = (page: Page, area?: string) => page.evaluate((a) => (window as any).__plainvaAreaCrash.clear(a ?? undefined), area ?? null);
const file = (page: Page, path: string) => page.evaluate((p) => (window as any).mockFs[p], path);

async function openWelcome(page: Page) {
  await page.goto('/');
  const entry = page.getByTestId('file-tree').getByText('Welcome', { exact: true });
  await expect(entry).toBeVisible({ timeout: 20000 });
  await entry.click();
  await expect(page.locator('.cm-content').getByText('Hello.')).toBeVisible();
}

async function typeAtEnd(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}

test('a tab that fails keeps the window, reloads, does not loop, and closes', async ({ page }, testInfo) => {
  await openWelcome(page);
  await crash(page, 'tab:note');

  const fallback = page.getByTestId('area-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('data-area', 'tab:note');
  await expect(fallback).toContainText('This area could not be shown');
  await expect(fallback).toContainText('About & diagnostics');
  // The rest of the window is alive: the tree still opens things.
  await expect(page.getByTestId('file-tree').getByText('Welcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Right Sidebar' })).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('tab-fallback-light.png') });

  // Still failing: one reload, then it stays and says so — no loop, no reload button.
  await fallback.getByTestId('area-fallback-reload').click();
  await expect(fallback).toHaveAttribute('data-failed-again', 'true');
  await expect(fallback).toContainText('It failed again after reloading');
  await expect(fallback.getByTestId('area-fallback-reload')).toHaveCount(0);

  // The way out is the tab's own close.
  await fallback.getByTestId('area-fallback-exit').click();
  await expect(fallback).toHaveCount(0);
  await expect(page.locator('.pv-emptypane')).toBeVisible();
});

test('the fallback in the dark theme', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openWelcome(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await crash(page, 'tab:note');
  await expect(page.getByTestId('area-fallback')).toBeVisible();
  await crash(page, 'section:outline');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('tab-fallback-dark.png') });
});

test("the editor's own area fails: the typed text is on disk and comes back with the reload", async ({ page }) => {
  await openWelcome(page);
  await typeAtEnd(page, ' Typed before the crash.');
  // At once, before the save timer: the text is only in the editor and its journal.
  await crash(page, 'tab:note');
  await expect(page.getByTestId('area-fallback')).toBeVisible();
  // Leaving the editor flushed its last text, as closing the tab does.
  await expect.poll(() => file(page, '/test-vault/Welcome.md'), { timeout: 10000 }).toContain('Typed before the crash.');

  await heal(page, 'tab:note');
  await page.getByTestId('area-fallback-reload').click();
  await expect(page.locator('.cm-content')).toContainText('Typed before the crash.');
  await expect(page.getByTestId('area-fallback')).toHaveCount(0);
});

test("a neighbour of the editor fails: the editor stays the same, with its unsaved text", async ({ page }, testInfo) => {
  await openWelcome(page);
  await page.locator('.cm-content').evaluate((el) => el.setAttribute('data-probe', 'same-editor'));
  await typeAtEnd(page, ' Still typing.');

  // The tree beside it, the database line in it, the right column's sections.
  for (const area of ['sidebar:files', 'editor:databaseBar', 'section:outline', 'section:backlinks', 'section:properties', 'shell:statusbar']) {
    await crash(page, area);
  }
  await expect(page.locator('[data-area="sidebar:files"]')).toBeVisible();
  await expect(page.locator('[data-area="editor:databaseBar"]')).toBeVisible();
  await expect(page.locator('.cm-content[data-probe="same-editor"]')).toContainText('Still typing.');
  await page.keyboard.insertText(' And on.');
  await expect(page.locator('.cm-content')).toContainText('Still typing. And on.');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('neighbours-fallback-light.png') });

  await heal(page);
  await page.locator('[data-area="sidebar:files"]').getByTestId('area-fallback-reload').click();
  await expect(page.getByTestId('file-tree').getByText('Welcome', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content[data-probe="same-editor"]')).toBeVisible();
});

test('a database view fails: the head with its views stays, the tab stays', async ({ page }) => {
  await page.goto('/');
  const entry = page.getByTestId('file-tree').getByText('Board', { exact: true });
  await expect(entry).toBeVisible({ timeout: 20000 });
  await entry.click();
  await expect(page.getByText('Alpha').first()).toBeVisible();
  for (const area of ['base:table', 'base:board']) await crash(page, area);
  const fallback = page.locator('[data-area^="base:"]');
  await expect(fallback).toBeVisible();
  await expect(page.locator('[data-area="tab:base"]')).toHaveCount(0);
  await heal(page);
  await fallback.getByTestId('area-fallback-reload').click();
  await expect(page.getByText('Alpha').first()).toBeVisible();
});

test('a settings page fails: the settings and their other pages stay', async ({ page }) => {
  await openWelcome(page);
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Whichever page the settings opened on: every page fails, the frame stays.
  const pages = ['appearance', 'customTheme', 'editor', 'behavior', 'ai', 'about', 'cloudAccounts', 'sync', 'security', 'aiVault', 'pim', 'mail', 'content', 'journal', 'bars', 'backup', 'vaultDetails', 'maintenance'];
  for (const name of pages) await crash(page, `settings:${name}`);
  const shown = dialog.locator('.pv-setpage[data-active="true"] [data-testid="area-fallback"]');
  await expect(shown).toBeVisible();
  await expect(dialog.locator('.pv-modal-heading').first()).toBeVisible();
  await heal(page);
  await shown.getByTestId('area-fallback-reload').click();
  await expect(dialog.locator('.pv-setpage[data-active="true"] [data-testid="area-fallback"]')).toHaveCount(0);
});
