import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMenuVault } from './fixtures/menuVault';

// A menu takes the keyboard when it opens: its first entry has the focus, the
// arrow keys, Home and End walk the entries, Enter picks one, and Escape hands
// the focus back to what had it before the menu opened.
//
// Until 2026-10-22 none of that held in a browser. The menu primitive put the
// focus on its first entry while the menu was still hidden — it is measured
// before it is shown — and a hidden element takes no focus. The focus stayed
// where it was, the arrow keys went past the menu, and only a Tab into it woke
// it (Sammelplan § 3.99). Its unit test was green: jsdom focuses hidden
// elements. So these run in a real browser.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  await page.setViewportSize({ width: 1680, height: 1050 });
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });
}

async function evidence(page: Page, name: string) {
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`${name}.png`) });
}

/** The one menu that is open. */
const openMenu = (page: Page) => page.locator('.pv-menu[role="menu"]');
/** The entries the keyboard walks: the enabled ones, in order. */
const entries = (menu: Locator) => menu.locator('.pv-menu-item:not(:disabled)');
const focusVisible = (target: Locator) => target.evaluate((el) => el.matches(':focus-visible'));

test("the sidebar's New menu: the first entry has the focus, the arrow keys, Home and End walk the entries, Escape hands the focus back", async ({ page }) => {
  await openApp(page);
  const trigger = page.getByTestId('sidebar-new');
  await trigger.click();
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  const items = entries(menu);
  const n = await items.count();
  expect(n).toBeGreaterThan(2);

  await expect(items.first()).toBeFocused();
  // Opened with the mouse: the entry holds the focus without the ring a
  // keyboard would see — nothing in the menu looks picked before a key is pressed.
  expect(await focusVisible(items.first())).toBe(false);
  await evidence(page, 'new-menu-opened-by-mouse');

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  expect(await focusVisible(items.nth(1))).toBe(true);
  await page.keyboard.press('ArrowUp');
  await expect(items.first()).toBeFocused();
  // Past the first entry the walk goes round to the last.
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(n - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(n - 1)).toBeFocused();
  await evidence(page, 'new-menu-walked-to-the-end');

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the vault menu: the first entry has the focus, End reaches "Switch vault", and Escape hands the focus back to the line', async ({ page }) => {
  await openApp(page);
  const line = page.locator('aside[aria-label="Left Sidebar"]').locator('button[aria-haspopup]').filter({ hasText: 'test-vault' });
  await line.click();
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  const items = entries(menu);

  await expect(items.first()).toHaveText(/zweiter-vault/);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText(/^(Vault wechseln|Switch vault)/i);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(line).toBeFocused();
});

test('Enter held down on the button that opens a menu does not pick its first entry', async ({ page }) => {
  await openApp(page);
  const trigger = page.getByTestId('sidebar-new');
  await trigger.focus();
  await page.keyboard.down('Enter');
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  const items = entries(menu);
  await expect(items.first()).toBeFocused();
  // The key is still down and repeats — into the entry that has the focus now.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(menu).toBeVisible();
  await expect(items.first()).toBeFocused();
});

test('a menu that opens over a file being renamed leaves the name field its keyboard: the half-typed name is not taken', async ({ page }) => {
  await openApp(page);
  const tree = page.getByTestId('file-tree');
  await tree.getByText('Welcome', { exact: true }).click({ button: 'right' });
  await openMenu(page).getByRole('menuitem', { name: /^(Umbenennen|Rename)/ }).click();
  const name = tree.getByRole('textbox');
  await expect(name).toBeFocused();
  await name.fill('Halb getippt');

  // A right-click into the field opens a menu over it. Leaving the field would
  // end the rename — it takes the name when it loses the focus.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await name.click({ button: 'right' });
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Halb getippt');

  // An entry picked with the mouse: its press takes no focus, so the rename
  // goes on with what was typed.
  await menu.getByRole('menuitem', { name: /^(Pfad kopieren|Copy path)$/i }).click();
  await expect(menu).toHaveCount(0);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Halb getippt');

  // One Escape closes one thing: first the menu in front of the field — the
  // rename goes on —, then the rename, which Escape gives up as it always did.
  await name.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Halb getippt');
  await page.keyboard.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(tree.getByText('Welcome', { exact: true })).toBeVisible();
  await expect(tree.getByText('Halb getippt', { exact: true })).toHaveCount(0);
});

test('a press beside a menu leaves the focus where the press lands, not on the button that opened it', async ({ page }) => {
  await openApp(page);
  const trigger = page.getByTestId('sidebar-new');
  await trigger.click();
  const menu = openMenu(page);
  await expect(entries(menu).first()).toBeFocused();
  // An empty spot of the main area takes no focus: after the press it is nowhere.
  await page.locator('main').click({ position: { x: 400, y: 400 } });
  await expect(menu).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(trigger).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("a menu picked with the mouse hands the focus back without bringing up the button's tip", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 15000 });
  const dots = page.locator('.base-header-container').getByRole('button', { name: /^(Menü|Menu)$/ });
  await dots.click();
  const menu = openMenu(page);
  await expect(entries(menu).first()).toBeFocused();
  await entries(menu).first().click();
  await expect(menu).toHaveCount(0);
  await expect(dots).toBeFocused();
  // A tip on focus is the keyboard's; this focus came back after a press.
  await page.waitForTimeout(900);
  await expect(page.locator('.pv-tooltip', { hasText: /^(Menü|Menu)$/ })).toHaveCount(0);

  // The same button reached by the keyboard does show its tip: the menu walked
  // with the arrow keys and closed with Escape hands the focus back as the
  // keyboard's.
  await page.keyboard.press('Enter');
  await expect(entries(menu).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(dots).toBeFocused();
  await expect(page.locator('.pv-tooltip', { hasText: /^(Menü|Menu)$/ })).toBeVisible();
});

test("a database's ⋮ menu opened from the keyboard: Enter on the button opens it on its first entry, the arrow keys reach Export, Enter picks it", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 15000 });
  const dots = page.locator('.base-header-container').getByRole('button', { name: /^(Menü|Menu)$/ });

  await dots.focus();
  await page.keyboard.press('Enter');
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  const items = entries(menu);
  await expect(items.first()).toBeFocused();
  // Opened from the keyboard: the ring shows where the keyboard is.
  expect(await focusVisible(items.first())).toBe(true);
  await evidence(page, 'dots-menu-opened-by-keyboard');

  await page.keyboard.press('ArrowDown');
  const exportEntry = menu.getByRole('menuitem', { name: /^(Tabelle exportieren|Export table)$/ });
  await expect(exportEntry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog').filter({ hasText: /Tabelle exportieren|Export table/ })).toBeVisible();
});

test('a right-click on a selection in the editor: the menu takes the keyboard, Escape gives the editor back its focus and its selection, and Paste picked from the keyboard lands on that selection', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Welcome', { exact: true }).click();
  const content = page.locator('.cm-content').first();
  await expect(content).toBeVisible({ timeout: 15000 });
  const line = page.locator('.cm-line').filter({ hasText: 'Hello.' }).first();
  await expect(line).toBeVisible();
  const selection = () => page.evaluate(() => window.getSelection()?.toString() ?? '');

  // The word, selected the way a hand selects it.
  await line.getByText('Hello.').dblclick({ position: { x: 8, y: 6 } });
  await expect.poll(selection).toBe('Hello');
  await expect(content).toBeFocused();

  await line.getByText('Hello.').click({ button: 'right', position: { x: 8, y: 6 } });
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  const cut = menu.getByRole('menuitem', { name: /^(Ausschneiden|Cut)$/ });
  await expect(cut).toBeFocused();
  await evidence(page, 'editor-context-menu');

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(content).toBeFocused();
  await expect.poll(selection).toBe('Hello');

  // The note is as it was.
  await expect(line).toHaveText('Hello.');

  // An entry picked from the keyboard acts on the editor the menu was opened
  // over, at the selection it was opened on: Paste replaces the word.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('Bonjour'));
  await line.getByText('Hello.').click({ button: 'right', position: { x: 8, y: 6 } });
  await expect(cut).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^(Einfügen|Paste)$/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(content).toContainText('Bonjour.');
  await expect(content).not.toContainText('Hello');
  await expect(content).toBeFocused();
});

test('Enter held down on an entry of the menu over the editor does not go on into the editor: the selection the menu handed back stays', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Welcome', { exact: true }).click();
  const content = page.locator('.cm-content').first();
  await expect(content).toBeVisible({ timeout: 15000 });
  const line = page.locator('.cm-line').filter({ hasText: 'Hello.' }).first();
  await line.getByText('Hello.').dblclick({ position: { x: 8, y: 6 } });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Hello');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await line.getByText('Hello.').click({ button: 'right', position: { x: 8, y: 6 } });
  const menu = openMenu(page);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^(Kopieren|Copy)$/ })).toBeFocused();
  // Copy picked with Enter, and the key held: the menu closes, the editor gets
  // the focus and its selection back, and the key repeats — into the editor,
  // where an Enter replaces a selection with a line break.
  await page.keyboard.down('Enter');
  await expect(menu).toHaveCount(0);
  await expect(content).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(content).toContainText('Hello.');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Hello');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hello');
});

test('a menu over the editor of a floating window: dragging the window by its head gives the editor its keyboard back when the drag ends', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-tip="Alpha"]').click();
  const preview = page.locator('.pv-peek-card');
  const content = preview.locator('.cm-content');
  await expect(content).toBeVisible({ timeout: 15000 });
  const line = preview.locator('.cm-line').filter({ hasText: 'First.' }).first();
  await line.click();
  await expect(content).toBeFocused();
  await line.click({ button: 'right' });
  const menu = openMenu(page);
  await expect(menu).toBeVisible();
  await expect(entries(menu).first()).toBeFocused();

  // The head takes the press for the drag: no mousedown follows, nothing takes
  // the focus — it comes back to the editor when the press ends.
  const title = preview.locator('.pv-peek-title');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await expect(menu).toHaveCount(0);
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect(content).toBeFocused();
});
