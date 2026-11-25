import { test, expect, type Page } from './fixtures/clockedTest';
import { installMenuVault } from './fixtures/menuVault';

/**
 * Closing a vault waits within a deadline, also in the built surface: a note
 * whose save does not answer holds the switch to another vault for 30 seconds
 * at most, with a notice after 5 seconds and the word that the save goes on in
 * the background. Opening the same vault again waits for that save — never
 * two runtimes at one vault — and says so until it has ended.
 *
 * The save is held at the file system's door (`write_file_atomic`) of the
 * mocked desktop bridge, as a network drive or a cloud placeholder holds it.
 */

/** The page's side of the hold. */
type HoldingWindow = Window & {
  mockFs: Record<string, unknown>;
  __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown, options: unknown) => Promise<unknown> };
  __writesHeld?: Promise<void>;
  __releaseWrites?: () => void;
  __holdWrites?: () => void;
};

/** Holds every write of a note until the test lets it go (runs in the page, after `installMenuVault`). */
function holdNoteWrites(): void {
  const w = window as unknown as HoldingWindow;
  const fs = w.mockFs;
  fs['/zweiter-vault'] = { isDir: true };
  fs['/zweiter-vault/.plainva'] = { isDir: true };
  fs['/zweiter-vault/Zwei.md'] = '# Zwei\n';
  const inner = w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown, options: unknown) => {
    if (cmd === 'write_file_atomic' && w.__writesHeld) await w.__writesHeld;
    return inner(cmd, args, options);
  };
  w.__holdWrites = () => { w.__writesHeld = new Promise<void>((resolve) => { w.__releaseWrites = resolve; }); };
}

const sidebar = (page: Page) => page.locator('aside[aria-label="Left Sidebar"]');

test('switching away from a note whose save hangs goes on after 30 s, and the vault opens again once the save has ended', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(installMenuVault);
  await page.addInitScript(holdNoteWrites);
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Welcome', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('file-tree').getByText('Welcome', { exact: true }).click();
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('Hello.');
  await page.evaluate(() => (window as unknown as HoldingWindow).__holdWrites?.());
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Typed before switching.');

  // To the other vault: the close waits for the save, says so after 5 s, and goes on after 30 s.
  await sidebar(page).locator('button[aria-haspopup]').filter({ hasText: 'test-vault' }).click();
  await sidebar(page).getByText('zweiter-vault', { exact: true }).click();
  await expect(page.getByText('Plainva is still saving “Welcome” – then it goes on.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('“Welcome” is not saved yet. Plainva goes on; the save finishes in the background, and the text is also kept in the draft.')).toBeVisible({ timeout: 40_000 });
  const otherLine = sidebar(page).locator('button[aria-haspopup]').filter({ hasText: 'zweiter-vault' });
  await expect(otherLine, 'the person went on').toBeVisible({ timeout: 20_000 });

  // Back to the first vault while its save still hangs: it waits, and says so (text 7).
  await otherLine.click();
  await sidebar(page).getByText('test-vault', { exact: true }).click();
  const stillClosing = page.getByText('“test-vault” is still closing – then Plainva opens it again.');
  await expect(stillClosing).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  await expect(stillClosing, 'it stands while the save hangs').toBeVisible();

  // The save ends: the vault opens, the notice goes, and the typed text is on disk.
  await page.evaluate(() => (window as unknown as HoldingWindow).__releaseWrites?.());
  await expect(page.getByTestId('file-tree').getByText('Board', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(stillClosing).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as HoldingWindow).mockFs['/test-vault/Welcome.md'])).toContain('Typed before switching.');
});
