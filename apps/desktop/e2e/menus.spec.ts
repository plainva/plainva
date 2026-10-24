import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMenuVault } from './fixtures/menuVault';
import { openProbePage } from './fixtures/openProbePage';
import type { OutsidePressProbeWindow } from './fixtures/outsidePressProbe';

// A menu or a popover that opens over the page is left the way every such
// surface is left: Escape, or a press beside it — wherever that press lands,
// in a floating window too, and on the head it is dragged by.
//
// Until 2026-10-11 two menus were drawn by hand: the vault menu at the foot of
// the left sidebar and the ⋮ menu in the head of a database. Neither closed on
// Escape, and the vault menu had no way out but its own line. A database's
// menus and its two popovers caught the press beside them with an element laid
// over the page — on a layer below the floating windows, so a press into the
// note preview never reached it, and Escape went to the preview instead. And
// the search field of the shortcuts window was a bare input: the first Escape
// closed the window with the query still in it.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  // Room for the note preview (920 × 680, centred) beside the database's head
  // and the sidebar: nothing these tests press lies under it.
  await page.setViewportSize({ width: 1680, height: 1050 });
});

// The two themes that redraw every surface run the same rules.
type Theme = { name: string; mode: string; variant: string | null } | null;
const THEMES: readonly Theme[] = [
  null,
  { name: 'lcars', mode: 'dark', variant: 'make-it-so' },
  { name: 'win95', mode: 'light', variant: null },
];
const themeName = (theme: Theme) => theme?.name ?? 'default theme';
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

/** Whether a press at the centre of `target` would reach it — nothing else lies over that point. */
const reachable = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });

/**
 * Presses the POINT at the centre of `target`: whatever lies there takes the
 * press. (A locator click waits until the target itself is free — and where a
 * popover means to catch the press beside it, it never is.)
 */
async function pressAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });
}

// --- The vault menu ---------------------------------------------------------

const sidebar = (page: Page) => page.locator('aside[aria-label="Left Sidebar"]');
const vaultLine = (page: Page) => sidebar(page).locator('button[aria-haspopup]').filter({ hasText: 'test-vault' });
const vaultMenu = (page: Page) => sidebar(page).locator('.pv-menu');
const otherVault = (page: Page) => sidebar(page).getByText('zweiter-vault', { exact: true });

for (const theme of THEMES) {
  test(`${themeName(theme)}: the vault menu opens over its line, as wide as the line, and Escape closes it`, async ({ page }) => {
    await openApp(page);
    await wear(page, theme);
    await vaultLine(page).click();
    await expect(otherVault(page)).toBeVisible();
    await expect(vaultLine(page)).toHaveAttribute('aria-expanded', 'true');

    // Over the line, edge to edge with it, and in front of the sidebar — with a
    // vault among its entries whose name is longer than the line: the name is
    // cut short, the menu does not grow past the sidebar. (Asked until it
    // holds: the menu scales in, and a box read mid-way is smaller.)
    await expect
      .poll(async () => {
        const menu = (await vaultMenu(page).boundingBox())!;
        const line = (await vaultLine(page).locator('xpath=..').boundingBox())!;
        return {
          overTheLine: menu.y + menu.height <= line.y,
          leftEdge: Math.abs(menu.x - line.x) <= 1,
          width: Math.abs(menu.width - line.width) <= 1,
        };
      })
      .toEqual({ overTheLine: true, leftEdge: true, width: true });
    expect(await reachable(otherVault(page))).toBe(true);
    await evidence(page, `vault-menu-${theme?.name ?? 'default'}`);

    await page.keyboard.press('Escape');
    await expect(otherVault(page)).toHaveCount(0);
    await expect(vaultLine(page)).toHaveAttribute('aria-expanded', 'false');
  });
}

test('the vault menu closes on a press beside it', async ({ page }) => {
  await openApp(page);
  await vaultLine(page).click();
  await expect(otherVault(page)).toBeVisible();

  await page.locator('main').click({ position: { x: 400, y: 400 } });
  await expect(otherVault(page)).toHaveCount(0);
});

test('the vault menu closes when its own line is pressed again, and opens again after that', async ({ page }) => {
  await openApp(page);
  await vaultLine(page).click();
  await expect(otherVault(page)).toBeVisible();
  // One press, one change: the line is not "beside" its own menu.
  await vaultLine(page).click();
  await expect(otherVault(page)).toHaveCount(0);
  await vaultLine(page).click();
  await expect(otherVault(page)).toBeVisible();
});

test('the command palette opens the vault menu, and it is left the same way', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.locator('.pv-palette-input').fill('vault');
  // The press that picks the command comes before the menu exists: it is not
  // a press beside it, and the menu stays.
  await palette.getByText(/^(Vault in neuem Fenster öffnen|Open vault in a new window)$/).click();
  await expect(palette).toHaveCount(0);
  await expect(otherVault(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(otherVault(page)).toHaveCount(0);
});

// --- A database's menus and popovers ----------------------------------------

const dbHead = (page: Page) => page.locator('.base-header-container');

async function openBoard(page: Page) {
  await openApp(page);
  await page.getByTestId('file-tree').getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 15000 });
}

/** The note preview: a floating window over the database, not modal. */
async function openPreview(page: Page): Promise<Locator> {
  await page.locator('[data-tip="Alpha"]').click();
  const preview = page.locator('.pv-peek-card');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.cm-editor')).toBeVisible({ timeout: 15000 });
  return preview;
}

interface Surface {
  name: string;
  /** For the name of its photo. */
  slug: string;
  open: (page: Page) => Promise<void>;
  /** Something only the open surface shows. */
  shown: (page: Page) => Locator;
  /** What the surface hangs on: it opens directly under it. */
  hangsOn: (page: Page) => Locator;
}
const SURFACES: readonly Surface[] = [
  {
    name: 'the ⋮ menu',
    slug: 'dots-menu',
    open: (page) => dbHead(page).getByRole('button', { name: /^(Menü|Menu)$/ }).click(),
    shown: (page) => dbHead(page).getByRole('menuitem', { name: /^(Tabelle exportieren|Export table)$/ }),
    hangsOn: (page) => dbHead(page).getByRole('button', { name: /^(Menü|Menu)$/ }),
  },
  {
    name: "the view's menu",
    slug: 'view-menu',
    open: (page) => dbHead(page).locator('.base-view-tab-caret').click(),
    shown: (page) => dbHead(page).getByText(/^\s*(Duplizieren|Duplicate)\s*$/),
    hangsOn: (page) => dbHead(page).locator('.base-view-tab.active'),
  },
  {
    name: 'the "add view" menu',
    slug: 'add-view-menu',
    open: (page) => dbHead(page).locator('button.base-view-add').click(),
    shown: (page) => dbHead(page).getByText(/^\s*(Galerie|Gallery)\s*$/),
    hangsOn: (page) => dbHead(page).locator('button.base-view-add'),
  },
  {
    name: 'the "New entry" popover',
    slug: 'new-entry-popover',
    open: (page) => dbHead(page).getByRole('button', { name: /^(Vorlagen und Ablage-Ordner|Templates and storage folder)$/ }).click(),
    shown: (page) => dbHead(page).getByText(/^(Neue Vorlage erstellen|Create new template)$/),
    // The head has a second split button (the one that splits the pane).
    hangsOn: (page) => dbHead(page).locator('.pv-splitbtn').filter({ has: page.getByTestId('base-new-entry') }),
  },
];
const DOTS_MENU = SURFACES[0];
const NEW_ENTRY = SURFACES[3];
/** A window in which the database's pane is narrower than the width its head drops the labels at. */
const NARROW_VIEWPORT = 820;

/** The panel a surface's content sits in: the menu, or the popover. */
const hasClass = (name: string) => `contains(concat(" ", normalize-space(@class), " "), " ${name} ")`;
const panelOf = (content: Locator) =>
  content.locator(`xpath=ancestor::*[${hasClass('pv-menu')} or ${hasClass('pv-popover')}][1]`);

/**
 * Whether a surface opened where it belongs: directly under what it hangs on.
 * These surfaces are placed by the window (`position: fixed`), and something on
 * the way that takes that placing over — a size container does in some engines
 * — would leave them displaced by its own offset, still on top and still
 * usable, which no other assertion here would notice.
 */
async function opensUnder(surface: Surface, page: Page): Promise<boolean> {
  const on = await surface.hangsOn(page).boundingBox();
  const panel = await panelOf(surface.shown(page)).boundingBox();
  if (!on || !panel) return false;
  const gap = panel.y - (on.y + on.height);
  const shared = Math.min(on.x + on.width, panel.x + panel.width) - Math.max(on.x, panel.x);
  return gap >= 0 && gap <= 12 && shared > 0;
}

for (const surface of SURFACES) {
  test(`a press into the note preview closes ${surface.name} of the database behind it`, async ({ page }) => {
    await openBoard(page);
    const preview = await openPreview(page);
    await surface.open(page);
    await expect(surface.shown(page)).toBeVisible();

    await pressAt(page, preview.locator('.cm-content'));
    await expect(surface.shown(page)).toHaveCount(0);
    await expect(preview).toBeVisible();
  });

  test(`Escape closes ${surface.name} of a database`, async ({ page }) => {
    await openBoard(page);
    await surface.open(page);
    await expect(surface.shown(page)).toBeVisible();
    expect(await reachable(surface.shown(page))).toBe(true);
    await evidence(page, surface.slug);

    await page.keyboard.press('Escape');
    await expect(surface.shown(page)).toHaveCount(0);
  });

  test(`${surface.name} opens directly under what it hangs on`, async ({ page }) => {
    await openBoard(page);
    await surface.open(page);
    await expect(surface.shown(page)).toBeVisible();
    // Asked until it holds: a menu scales in, and a box read mid-way is smaller.
    await expect.poll(() => opensUnder(surface, page)).toBe(true);
  });

  test(`beside an open note preview, Escape closes ${surface.name} first and the preview second`, async ({ page }) => {
    await openBoard(page);
    const preview = await openPreview(page);
    await surface.open(page);
    await expect(surface.shown(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(surface.shown(page)).toHaveCount(0);
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pv-peek-card')).toHaveCount(0);
  });
}

// The head of a floating window is what it is dragged by: the press there is
// taken for the drag and never becomes a `mousedown`. A menu that listened for
// that event did not hear it.
for (const theme of THEMES) {
  test(`${themeName(theme)}: a press on the head of the note preview closes the database's ⋮ menu`, async ({ page }) => {
    await openBoard(page);
    await wear(page, theme);
    const preview = await openPreview(page);
    await DOTS_MENU.open(page);
    const row = DOTS_MENU.shown(page);
    await expect(row).toBeVisible();
    expect(await reachable(row)).toBe(true);
    await evidence(page, `database-menu-${theme?.name ?? 'default'}`);

    await pressAt(page, preview.locator('.pv-peek-title'));
    await expect(row).toHaveCount(0);
    await expect(preview).toBeVisible();
  });
}

// In a narrow pane the head's buttons drop their labels. The head measures its
// own width for that and is no size container: its menus and popovers are
// placed by the window, and a container on the way can take that placing over.
test("a narrow database head drops its buttons' labels, and its menus still open under what they hang on", async ({ page }) => {
  await openBoard(page);
  const label = dbHead(page).locator('.base-toolbar-label').first();
  await expect(label).toBeVisible();
  await expect(dbHead(page)).not.toHaveAttribute('data-narrow');

  await page.setViewportSize({ width: NARROW_VIEWPORT, height: 900 });
  await expect(dbHead(page)).toHaveAttribute('data-narrow');
  await expect(label).toBeHidden();
  for (const surface of [DOTS_MENU, NEW_ENTRY]) {
    await surface.open(page);
    await expect(surface.shown(page)).toBeVisible();
    await expect.poll(() => opensUnder(surface, page)).toBe(true);
    await evidence(page, `narrow-head-${surface.slug}`);
    await page.keyboard.press('Escape');
    await expect(surface.shown(page)).toHaveCount(0);
  }

  // And wide again, the labels are back.
  await page.setViewportSize({ width: 1680, height: 1050 });
  await expect(dbHead(page)).not.toHaveAttribute('data-narrow');
  await expect(label).toBeVisible();
});

// The popover's rows come and go while it is open: a template that is assigned
// changes its group, and "show all" is gone once it has been used. The
// keyboard stood on such a row — it must not be left standing nowhere, or
// Escape is nobody's.
test('the "New entry" popover keeps the keyboard when the row it stood on goes, so Escape still closes it', async ({ page }) => {
  await openBoard(page);
  await NEW_ENTRY.open(page);
  await dbHead(page).getByRole('button', { name: /Alle Vorlagen anzeigen|Show all templates/ }).click();
  await expect(dbHead(page).getByRole('button', { name: 'Projektvorlage', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(NEW_ENTRY.shown(page)).toHaveCount(0);
});

test('a view is renamed in a field under its tab: Enter keeps the name, Escape drops it, a press beside keeps it', async ({ page }) => {
  await openBoard(page);
  const tab = dbHead(page).locator('.base-view-tab.active');
  const field = dbHead(page).getByRole('textbox', { name: /^(Name der Ansicht:|View name:)$/ });
  const rename = async () => {
    await dbHead(page).locator('.base-view-tab-caret').click();
    await dbHead(page).getByText(/^\s*(Umbenennen|Rename)\s*$/).click();
    await expect(field).toBeFocused();
  };

  await rename();
  await evidence(page, 'rename-view');
  await field.fill('Karten');
  await page.keyboard.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(tab).toContainText('Karten');

  await rename();
  await field.fill('Verworfen');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(tab).toContainText('Karten');

  await rename();
  await field.fill('Spalten');
  await page.locator('main').click({ position: { x: 700, y: 800 } });
  await expect(field).toHaveCount(0);
  await expect(tab).toContainText('Spalten');
});

test('a press into the note preview closes the "set a value" popover of a selection, and so does Escape', async ({ page }) => {
  await openBoard(page);
  const preview = await openPreview(page);
  // The table lists the same three notes; the preview stays where it is.
  await dbHead(page).locator('.base-view-tab-btn', { hasText: 'Tabelle' }).click();
  await page.getByTestId('base-select-all').click();
  const popover = page.getByTestId('base-bulkset');
  const open = async () => {
    await page.getByTestId('base-sel-setvalue').click();
    await expect(popover).toBeVisible();
  };

  await open();
  await evidence(page, 'set-a-value');
  // This form catches the press beside it: it closes, and the press goes
  // nowhere else. The point is pressed, whatever lies there.
  await pressAt(page, preview.locator('.cm-content'));
  await expect(popover).toHaveCount(0);
  await expect(preview).toBeVisible();

  await open();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(preview).toBeVisible();
});

// --- The shortcuts window ---------------------------------------------------

test("the shortcuts window's search field is the app's search field: Escape clears it first and closes the window second", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('F1');
  const dialog = page.getByTestId('shortcuts-modal');
  await expect(dialog).toBeVisible();
  const field = page.getByTestId('shortcuts-search');

  await field.fill('F1');
  await expect(page.getByTestId('shortcuts-chip-general')).toHaveCount(0);
  await field.press('Escape');
  // The window stays; what goes is the query.
  await expect(dialog).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(page.getByTestId('shortcuts-chip-general')).toBeVisible();

  // The magnifier in front, and an x that does with the pointer what Escape does.
  await expect(dialog.locator('.pv-searchfield > svg')).toBeVisible();
  await field.fill('zzqxnope');
  await evidence(page, 'shortcuts-search');
  await dialog.getByRole('button', { name: /^(Suche löschen|Clear search)$/ }).click();
  await expect(field).toHaveValue('');

  // With nothing to clear, Escape is the window's.
  await field.press('Escape');
  await expect(dialog).toHaveCount(0);
});

// --- The primitives, where the app only gets to them deep inside a note ------

// A form that catches the press beside it lays an element over the page. The
// layer that element names counts only inside its own stacking context — and a
// database embedded in a note sits in one, the editor's scroller. A floating
// window then lies in FRONT of the catcher. The probe is that arrangement: the
// real primitives over the real stylesheets, and nothing else.
async function openOutsidePressProbe(page: Page) {
  await page.route('**/__outside_press_probe', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/outsidePressProbe.tsx');</script></body></html>` }));
  await openProbePage(page, '/__outside_press_probe', () => !!(window as OutsidePressProbeWindow).outsidePressProbe);
  await page.evaluate(() => (window as OutsidePressProbeWindow).outsidePressProbe.mount());
  await expect(page.getByTestId('win')).toBeVisible();
}

test('a form opened from inside a stacking context of its own still closes on a press into the floating window in front of its catcher', async ({ page }) => {
  await openOutsidePressProbe(page);
  const form = page.getByTestId('form');
  const win = page.getByTestId('win');
  const open = async () => {
    await page.getByTestId('open-form').click();
    await expect(form).toBeVisible();
  };

  await open();
  // The arrangement itself: the window's text is reachable — the catcher does
  // not lie over it, whatever layer it names.
  expect(await reachable(page.getByTestId('win-text'))).toBe(true);
  await evidence(page, 'probe-form-and-window');
  await pressAt(page, page.getByTestId('win-text'));
  await expect(form).toHaveCount(0);
  await expect(win).toBeVisible();

  // And on the head the window is dragged by, where a press never becomes a
  // `mousedown`.
  await open();
  await pressAt(page, win.locator('.pv-peek-title'));
  await expect(form).toHaveCount(0);
  await expect(win).toBeVisible();
});

test('a press beside such a form is caught where the catcher lies: the form closes, and the press goes nowhere else', async ({ page }) => {
  await openOutsidePressProbe(page);
  const form = page.getByTestId('form');
  const count = page.getByTestId('beside-count');
  await page.getByTestId('open-form').click();
  await expect(form).toBeVisible();

  await pressAt(page, page.getByTestId('beside'));
  await expect(form).toHaveCount(0);
  await expect(count).toHaveText('0');
  // With the form gone, the same press is the button's.
  await pressAt(page, page.getByTestId('beside'));
  await expect(count).toHaveText('1');
});

test('a menu that hangs on a whole line is exactly as wide as the line, however narrow the line and however long an entry', async ({ page }) => {
  await openOutsidePressProbe(page);
  await page.getByTestId('open-menu').click();
  const menu = page.getByRole('menu', { name: 'Line menu' });
  await expect(menu).toBeVisible();

  // Narrower than a menu's own least width (180), and with an entry far longer
  // than the line: the menu neither keeps its least width nor grows with the
  // entry. (Asked until it holds: the menu scales in.)
  await expect
    .poll(async () => {
      const m = (await menu.boundingBox())!;
      const line = (await page.getByTestId('line').boundingBox())!;
      return {
        overTheLine: m.y + m.height <= line.y,
        leftEdge: Math.abs(m.x - line.x) <= 1,
        width: Math.round(m.width),
      };
    })
    .toEqual({ overTheLine: true, leftEdge: true, width: 133 });
  // The long entry is cut short, not wrapped and not hanging out.
  const text = page.getByTestId('menu-long').locator('.pv-menu-text');
  expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await evidence(page, 'probe-line-menu');

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
