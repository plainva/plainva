import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMenuVault } from './fixtures/menuVault';

// A tab is as wide as what it holds — its icon, its name, its ✕ — up to a
// most. Only when the strip is full do the tabs give way: a long name is cut
// short first, and what still does not fit goes behind the overflow button.
//
// Until 2026-10-23 every tab took an equal share of the strip and was never
// narrower than 104 px: a tab named "index" stood with an empty stretch after
// its ✕, and a long name was cut short beside it while the strip still had
// room (finding of the maintainer, 2026-10-23).

const LONG = 'Essensplaene_Uebersicht_und_Wochenplanung_fuer_den_ganzen_Herbst';
const MANY = Array.from({ length: 18 }, (_, i) => `Note ${String(i + 1).padStart(2, '0')}`);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  await page.addInitScript(({ long, many }) => {
    const fs = (window as unknown as { mockFs: Record<string, unknown> }).mockFs;
    for (const name of ['AGENTS', 'index', long, ...many]) fs[`/test-vault/${name}.md`] = `# ${name}\n\nText.\n`;
    // A write can be held back on request, so a note stays unsaved as long as
    // a test needs to look at it.
    const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = tauri.invoke;
    tauri.invoke = (...a: unknown[]) =>
      (window as unknown as { holdWrites?: boolean }).holdWrites && /write/.test(String(a[0])) ? new Promise(() => {}) : invoke(...a);
  }, { long: LONG, many: MANY });
  await page.setViewportSize({ width: 1680, height: 1050 });
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });
}

const tree = (page: Page) => page.getByTestId('file-tree');
const tabs = (page: Page, strip = '[data-pv-tabstrip]') => page.locator(`${strip} [role="tab"]`);
const tab = (page: Page, name: string) => tabs(page).filter({ hasText: name });

/** Opens each note in a tab of its own (the first one in the tab that is there). */
async function openTabs(page: Page, names: readonly string[]) {
  for (const [i, name] of names.entries()) {
    const entry = tree(page).getByText(name, { exact: true });
    await entry.scrollIntoViewIfNeeded();
    // A middle click opens a new tab. Playwright's middle click sends no
    // auxclick to the tree row here, so the event the row listens for is sent.
    if (i === 0) await entry.click();
    else await entry.dispatchEvent('auxclick', { button: 1, bubbles: true });
    await expect(tab(page, name).first()).toBeVisible();
  }
}

/**
 * How a tab sits around what it holds: `slack` is the room inside it that
 * nothing fills (padding and border aside), `cut` whether its name is cut short.
 */
const fit = (t: Locator) =>
  t.evaluate((el) => {
    const cs = getComputedStyle(el);
    const kids = Array.from(el.children) as HTMLElement[];
    const first = kids[0].getBoundingClientRect();
    const last = kids[kids.length - 1].getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const frame = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((sum, k) => sum + parseFloat(cs[k as 'paddingLeft']), 0);
    const label = el.querySelector<HTMLElement>(':scope > span:not([aria-hidden])')!;
    return {
      width: box.width,
      slack: Math.round(box.width - (last.right - first.left) - frame),
      cut: label.scrollWidth > label.clientWidth,
    };
  });

// The two themes that redraw every surface: LCARS draws tabs as pills with
// margins of their own, Win95 on its navy bar.
type Theme = { name: string; mode: string; variant: string | null } | null;
const THEMES: readonly Theme[] = [
  null,
  { name: 'lcars', mode: 'dark', variant: 'make-it-so' },
  { name: 'win95', mode: 'light', variant: null },
];
async function wear(page: Page, theme: Theme) {
  if (!theme) return;
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.setAttribute('data-theme-name', t.name);
    root.setAttribute('data-theme', t.mode);
    if (t.variant) root.setAttribute('data-theme-variant', t.variant);
    else root.removeAttribute('data-theme-variant');
  }, theme);
}

async function evidence(page: Page, name: string) {
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`${name}.png`) });
}

for (const theme of THEMES) test(`${theme?.name ?? 'default theme'}: a tab with a short name is as wide as its name, a database tab and a pinned tab too, and choosing another tab moves no width`, async ({ page }) => {
  await openApp(page);
  await wear(page, theme);
  await openTabs(page, ['AGENTS', 'index', 'Board']);
  await expect(tabs(page)).toHaveCount(3);

  // Pin "index" — the pin glyph is part of what the tab holds.
  await tab(page, 'index').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(tab(page, 'index').locator('svg.lucide-pin')).toBeVisible();

  for (const name of ['AGENTS', 'index', 'Board']) {
    const seen = await fit(tab(page, name));
    expect(seen.cut, `"${name}" is cut short`).toBe(false);
    expect(seen.slack, `"${name}" has room inside it that nothing fills`).toBeLessThanOrEqual(1);
  }

  // The same tab is as wide chosen as not chosen.
  const before = await Promise.all(['AGENTS', 'index', 'Board'].map((n) => fit(tab(page, n))));
  await tab(page, 'AGENTS').click();
  await expect(tab(page, 'AGENTS')).toHaveAttribute('aria-selected', 'true');
  const after = await Promise.all(['AGENTS', 'index', 'Board'].map((n) => fit(tab(page, n))));
  for (const [i, b] of before.entries()) expect(Math.abs(after[i].width - b.width)).toBeLessThanOrEqual(0.5);
  await evidence(page, `tabs-short-names-${theme?.name ?? 'default'}`);
});

test('a long name is cut short only at the most a tab may be wide, and the tab names it in full', async ({ page }) => {
  await openApp(page);
  await openTabs(page, ['AGENTS', 'index', LONG]);
  const long = tab(page, 'Essensplaene');
  const seen = await fit(long);
  expect(seen.cut).toBe(true);
  // The strip has room: the long tab takes the most a tab may take, no less.
  expect(seen.width).toBeGreaterThanOrEqual(219);
  expect(seen.width).toBeLessThanOrEqual(221);
  await expect(long).toHaveAttribute('data-tip', `${LONG}.md`);
  // The short ones beside it keep their whole names.
  for (const name of ['AGENTS', 'index']) expect((await fit(tab(page, name))).cut).toBe(false);
});

for (const theme of THEMES) test(`${theme?.name ?? 'default theme'}: many tabs fill the strip before any goes behind the overflow button, and nothing scrolls`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);
  await openTabs(page, MANY);
  // The theme comes after the tabs: what the strip measured under the old one
  // must not stay behind (LCARS pills are wider and carry margins).
  await wear(page, theme);

  const strip = page.locator('[data-pv-tabstrip]');
  const more = page.getByTestId('tabstrip-more');
  await expect(more).toBeVisible();
  // The active (last opened) tab is in the window.
  await expect(tab(page, MANY[MANY.length - 1])).toHaveAttribute('aria-selected', 'true');

  const shown = await tabs(page).count();
  expect(shown).toBeLessThan(MANY.length);
  // No scrollbar, no tab half out of sight.
  await expect.poll(() => strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // Every tab in the window keeps its whole short name.
  await expect.poll(async () => {
    const cut: string[] = [];
    for (let i = 0; i < (await tabs(page).count()); i++) if ((await fit(tabs(page).nth(i))).cut) cut.push(String(i));
    return cut;
  }).toEqual([]);
  // And the strip is full: the room left beside the tabs would not hold
  // another one — a tab with its margins and the strip's gap.
  await expect.poll(() => page.evaluate(() => {
    const filler = document.querySelector<HTMLElement>('header button[aria-label="New tab"]')!.nextElementSibling as HTMLElement;
    const first = document.querySelector<HTMLElement>('header [data-pv-tabstrip] [role="tab"]')!;
    const cs = getComputedStyle(first);
    const gap = parseFloat(getComputedStyle(first.parentElement!).columnGap) || 0;
    return {
      // The filler after "+" keeps a few pixels of its own to drag the window by.
      room: filler.getBoundingClientRect().width - (parseFloat(getComputedStyle(filler).minWidth) || 0),
      another: first.getBoundingClientRect().width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight) + gap,
    };
  }).then(({ room, another }) => room < another)).toBe(true);
  await evidence(page, `tabs-overflow-${theme?.name ?? 'default'}`);
});

test('the strips of a split editor follow the same rule, and overflow the same way', async ({ page }) => {
  await openApp(page);
  await openTabs(page, ['AGENTS', 'index', LONG]);
  await tab(page, 'index').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right' }).click();
  const left = page.locator('section [data-pv-tabstrip="0"]');
  const right = page.locator('section [data-pv-tabstrip="1"]');
  const inStrip = (strip: Locator, name: string) => strip.locator('[role="tab"]').filter({ hasText: name });
  await expect(inStrip(right, 'index')).toBeVisible();

  for (const t of [inStrip(left, 'AGENTS'), inStrip(right, 'index')]) {
    const seen = await fit(t);
    expect(seen.cut).toBe(false);
    expect(seen.slack, 'a short tab has room inside it that nothing fills').toBeLessThanOrEqual(1);
  }
  const long = await fit(inStrip(left, 'Essensplaene'));
  expect(long.cut).toBe(true);
  expect(long.width).toBeGreaterThanOrEqual(219);
  expect(long.width).toBeLessThanOrEqual(221);
  await evidence(page, 'tabs-split');

  // Many tabs in the right pane: it fills, then overflows — no scrollbar.
  await inStrip(right, 'index').click();
  for (const name of MANY.slice(0, 10)) {
    await tree(page).getByText(name, { exact: true }).dispatchEvent('auxclick', { button: 1, bubbles: true });
  }
  await expect(right.getByTestId('tabstrip-more')).toBeVisible();
  await expect.poll(() => right.evaluate((el) => {
    const strip = el as HTMLElement;
    const kids = Array.from(strip.children) as HTMLElement[];
    const first = kids[0];
    const cs = getComputedStyle(first);
    const another = first.getBoundingClientRect().width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    const left = strip.getBoundingClientRect().right - parseFloat(getComputedStyle(strip).paddingRight) - kids[kids.length - 1].getBoundingClientRect().right;
    return { scrolls: strip.scrollWidth > strip.clientWidth + 1, roomForAnother: left >= another };
  })).toEqual({ scrolls: false, roomForAnother: false });
  await evidence(page, 'tabs-split-overflow');
});

test('typing into a note moves no tab: the unsaved dot sits where the ✕ is, and the ✕ comes back under the pointer', async ({ page }) => {
  await openApp(page);
  await openTabs(page, ['index', 'Board', 'AGENTS']);
  await expect(tab(page, 'AGENTS')).toHaveAttribute('aria-selected', 'true');
  const widths = () => Promise.all(['index', 'AGENTS', 'Board'].map(async (n) => (await fit(tab(page, n))).width));
  const before = await widths();

  await page.evaluate(() => { (window as unknown as { holdWrites: boolean }).holdWrites = true; });
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' more');
  const close = tab(page, 'AGENTS').locator('.pv-tab-close');
  await expect(close).toHaveAttribute('data-dirty', 'true');
  await page.mouse.move(700, 600);
  await expect(close.locator('.pv-tab-dirty')).toBeVisible();
  await expect(close.locator('svg')).toBeHidden();
  const during = await widths();
  for (const [i, b] of before.entries()) expect(Math.abs(during[i] - b), 'a tab moved while a note was unsaved').toBeLessThanOrEqual(0.5);
  await evidence(page, 'tabs-unsaved');

  await tab(page, 'AGENTS').hover();
  await expect(close.locator('svg')).toBeVisible();
  await expect(close.locator('.pv-tab-dirty')).toBeHidden();
});

test('a note open twice, pinned and not, leaves the strip settled at every width', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);
  await openTabs(page, ['index']);
  await tab(page, 'index').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(tab(page, 'index').locator('svg.lucide-pin')).toBeVisible();
  // Enough tabs to overflow, then the same note once more, unpinned and active.
  for (const name of [...MANY.slice(0, 12), 'index']) {
    await tree(page).getByText(name, { exact: true }).dispatchEvent('auxclick', { button: 1, bubbles: true });
  }
  await expect(tab(page, 'index').last()).toHaveAttribute('aria-selected', 'true');

  // The two copies differ by the pin. Measured by path alone, whichever copy
  // was in the window set the width the window was chosen by, and in a band
  // of widths the window flipped between them until React gave up.
  for (let width = 1000; width <= 1400; width += 6) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  expect(errors.filter((e) => /Maximum update depth|Too many re-renders/i.test(e))).toEqual([]);
  await expect(page.getByTestId('tabstrip-more')).toBeVisible();
});
