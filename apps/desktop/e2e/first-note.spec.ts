/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from './fixtures/clockedTest';
import { installMenuVault } from './fixtures/menuVault';

// An empty vault lands on ONE prompt (plan Oberfläche, O8 / T11): "Write
// your first note", in the empty editor pane, from the same component the
// phone's Home shows. A vault with notes keeps the ordinary empty pane.

/** The menu vault emptied down to what a new vault without a template holds. */
function emptyVault() {
  const fs = (window as any).mockFs;
  for (const path of Object.keys(fs)) {
    if (path !== '/test-vault' && path !== '/test-vault/.plainva' && !path.startsWith('/test-vault/.plainva/')) delete fs[path];
  }
  fs['/test-vault/index.md'] = '# test-vault\n';
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('an empty vault shows one prompt, and the first note ends it', async ({ page }, testInfo) => {
  await page.addInitScript(emptyVault);
  await page.goto('/');

  const pane = page.locator('.pv-emptypane');
  await expect(pane).toBeVisible({ timeout: 20000 });
  const create = pane.getByTestId('first-note-create');
  await expect(create).toBeVisible();
  await expect(pane).toContainText(/Write your first note|Schreib Deine erste Notiz/);
  // ONE action: the ordinary "open a file" button and the shortcut list are gone.
  await expect(pane.getByRole('button')).toHaveCount(1);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('first-note-desktop.png') });

  await create.click();
  // The same flow as "New note" everywhere: the tree's inline name field.
  const name = page.getByTestId('file-tree').locator('form input');
  await expect(name).toBeFocused();
  await page.keyboard.type('Erste');
  await page.keyboard.press('Enter');
  // A note now exists, so the prompt is over — wherever the new note opened.
  await expect.poll(async () => page.evaluate(() =>
    Object.keys((window as any).mockFs).some((p) => p.startsWith('/test-vault/') && p.endsWith('.md') && !p.endsWith('/index.md'))), { timeout: 15000 })
    .toBe(true);
  await expect(page.getByTestId('first-note-create')).toHaveCount(0);
});

test('a vault with notes keeps the ordinary empty pane', async ({ page }) => {
  await page.goto('/');
  const pane = page.locator('.pv-emptypane');
  await expect(pane).toBeVisible({ timeout: 20000 });
  await expect(pane.getByTestId('first-note-create')).toHaveCount(0);
});
