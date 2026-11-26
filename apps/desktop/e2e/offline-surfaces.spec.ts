import { test, expect, type Page } from './fixtures/clockedTest';
import { installMenuVault } from './fixtures/menuVault';

/**
 * Every surface of the desktop opens without a network (performance plan L5).
 *
 * The parts that load on demand — the views of the ribbon, a database, the settings and each of their pages, the
 * palette, the quick switcher, the import wizard — are chunks of the app's own bundle, never files of another host.
 * Here everything that is not the app's own origin is refused, and each surface is opened in turn: none may show the
 * area's failure, none may stand empty, and no script or style sheet may be asked of another host or fail to load.
 * `chunk-load.spec.ts` (e2e-prod) loads every chunk on its own; this opens the surfaces that use them.
 *
 * Empty counts as broken (review of L5, 2026-11-25): the AI's tab, restored by the layout with the AI switched off,
 * drew nothing — no failure to find, only a blank pane.
 */

const RIBBON = ['ribbon-graph', 'ribbon-tasks', 'ribbon-calendar', 'ribbon-mail', 'ribbon-comments', 'ribbon-journal'];

async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('area-fallback')).toHaveCount(0);
}

/** The focused pane shows something: text, a control or a drawing — never a blank pane. */
async function notEmpty(page: Page, what: string) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const pane = document.querySelector<HTMLElement>('[data-pane-body]');
          if (!pane) return 'no pane';
          const shown = pane.innerText.trim().length > 0 || pane.querySelector('button, input, canvas, svg, [role="grid"]') !== null;
          return shown ? 'shown' : 'empty';
        }),
      { message: `${what} stands empty`, timeout: 15000 },
    )
    .toBe('shown');
}

test('every surface of the desktop opens from the bundle without a network', async ({ page, context }) => {
  test.setTimeout(240_000);
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:1420').origin;
  const foreign: string[] = [];
  const failed: string[] = [];
  await context.route((url) => url.origin !== origin, (route) => {
    foreign.push(route.request().url());
    return route.abort('internetdisconnected');
  });
  page.on('requestfailed', (request) => {
    // A load the next step cut off (a part loaded ahead while the app idled) is no file that did not load.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (/\.(m?js|css|json|woff2)(\?|$)/.test(request.url()) && new URL(request.url()).origin === origin) failed.push(request.url());
  });
  await page.addInitScript(installMenuVault);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const tree = page.getByTestId('file-tree');
  await expect(tree.getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });

  // The views the ribbon opens, each in its tab.
  const opened: string[] = [];
  for (const id of RIBBON) {
    const button = page.getByTestId(id);
    if ((await button.count()) === 0) continue;
    await button.first().click();
    await settled(page);
    await notEmpty(page, id);
    opened.push(id);
  }
  expect(opened.length, 'the ribbon offers its views').toBeGreaterThanOrEqual(4);

  // A database, and a note beside it.
  await tree.getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 20000 });
  await settled(page);

  // The settings, every page of the app and of the vault.
  await page.keyboard.press('Control+,');
  const settings = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(settings).toBeVisible();
  const pages = settings.getByTestId('settings-nav').locator('.pv-navlink');
  const count = await pages.count();
  expect(count, 'the settings list their pages').toBeGreaterThanOrEqual(10);
  for (let i = 0; i < count; i++) {
    const pageButton = pages.nth(i);
    if (!(await pageButton.isVisible()) || !(await pageButton.isEnabled())) continue;
    await pageButton.click();
    await settled(page);
  }
  // A page may have opened a dialog of its own: the next surfaces start from a fresh window — and with the AI's tab
  // in the layout, as a restart restores it while the AI is switched off.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter((k) => k.startsWith('plainva-layout-'))) {
      localStorage.setItem(key, (localStorage.getItem(key) ?? '').split('plainva://graph').join('plainva://ai'));
    }
  });
  await page.reload();
  await expect(tree.getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });
  const aiTab = page.locator('[data-pv-tab]', { hasText: /\b(AI|KI)\b/ }).first();
  if ((await aiTab.count()) > 0) await aiTab.click();
  await expect(page.getByTestId('ai-tab'), 'the AI tab the layout restored shows its conversations').toBeVisible({ timeout: 20000 });
  await settled(page);

  // The palette, the quick switcher, and the import wizard through the palette.
  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await settled(page);
  await palette.getByRole('textbox').fill('Import');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByText(/Import aus|Import from|importieren/i).first()).toBeVisible();
  await settled(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+o');
  await settled(page);
  await page.keyboard.press('Escape');

  expect(failed, `files of the bundle that did not load: ${failed.join(', ')}`).toEqual([]);
  expect(foreign.filter((url) => /\.(m?js|css)(\?|$)/.test(url)), 'a script or style sheet asked of another host').toEqual([]);
});
