import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMenuVault } from './fixtures/menuVault';
import { openProbePage } from './fixtures/openProbePage';
import type { PressBesideProbeWindow, StationName } from './fixtures/pressBesideProbe';

// A surface that is left by a press beside it hears that press at the window
// (`useOutsidePress`), whatever lands where it was made. Until 2026-10-22
// twelve surfaces listened for it themselves, as a `mousedown` at the
// document (Sammelplan § 3.100): the select lists, the font field, the
// property popovers, a database's cell editors, the date field, the table size
// and the database picker. A press on a handle that drags — a floating
// window's head, a column's grip — cancels its `pointerdown`, the browser then
// sends no `mousedown` at all, and they stayed open beside it; ten of them also
// missed every press whose `mousedown` a handler stopped on its way (a table
// cell of the editor, a link in a rendered cell, a comment bubble).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  // Room for the station on the left, the floating window in the middle and
  // the stopper and the grip on the right: nothing these tests press lies
  // under anything else.
  await page.setViewportSize({ width: 1680, height: 1050 });
});

async function openProbe(page: Page, station: StationName) {
  await page.route('**/__press_beside_probe', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/pressBesideProbe.tsx');</script></body></html>` }));
  await openProbePage(page, '/__press_beside_probe', () => !!(window as PressBesideProbeWindow).pressBesideProbe);
  await page.evaluate((s) => (window as PressBesideProbeWindow).pressBesideProbe.mount(s), station);
  await expect(page.getByTestId('win')).toBeVisible();
}

/**
 * Presses the POINT at the centre of `target`: whatever lies there takes the
 * press. (A locator click waits until the target itself is free.)
 */
async function pressAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Whether a press at the centre of `target` would reach it — nothing else lies over that point. */
const reachable = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });

const station = (page: Page) => page.getByTestId('station');
const value = (page: Page) => page.getByTestId('value');
const closes = (page: Page) => page.getByTestId('closes');
const head = (page: Page) => page.getByTestId('win').locator('.pv-peek-title');
/** A point of the page no surface, button or window covers. */
const pressOnThePage = (page: Page) => page.mouse.click(1200, 900);

interface Station {
  name: StationName;
  label: string;
  open: (page: Page) => Promise<void>;
  /** Something only the open surface shows. */
  shown: (page: Page) => Locator;
  /** Takes an entry; the value it should leave behind. */
  pick: (page: Page) => Promise<void>;
  picked: RegExp | string;
  /** Listened at the document in the bubble phase until § 3.100: a stopped `mousedown` was lost. */
  bubble: boolean;
  /** Its own overlay covers the window's head (the palette): the grip above the overlay is pressed instead. */
  coversTheWindow?: boolean;
  /** It says it was left (`closes`): a cell then leaves its edit. */
  saysItWasLeft?: boolean;
}

const popover = (page: Page) => station(page).locator('.pv-popover');
const row = (page: Page, text: string | RegExp) => station(page).locator('.pv-popover-row').filter({ hasText: text });

const STATIONS: readonly Station[] = [
  {
    name: 'select',
    label: 'a select list',
    open: (page) => page.getByTestId('select-trigger').click(),
    shown: (page) => page.getByRole('listbox', { name: 'Probe list' }),
    pick: (page) => page.getByRole('option', { name: 'Beta' }).click(),
    picked: 'b',
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'font',
    label: 'the font field',
    open: (page) => page.getByRole('button', { name: 'Probe font' }).click(),
    shown: (page) => page.getByRole('listbox', { name: 'Probe font' }),
    // The second row: the first names the default. Fonts this machine lacks are disabled.
    pick: (page) => page.getByRole('listbox', { name: 'Probe font' }).locator('[role="option"]:not([disabled])').nth(1).click(),
    picked: /\S/,
    bubble: true,
  },
  {
    name: 'relation',
    label: "a link property's list",
    open: (page) => station(page).locator('.pv-chip-input').click(),
    shown: popover,
    pick: (page) => row(page, 'Alpha').click(),
    picked: /Alpha/,
    bubble: true,
  },
  {
    name: 'tags',
    label: "a tags property's list",
    open: (page) => station(page).locator('.pv-chip-input').click(),
    shown: popover,
    pick: (page) => row(page, 'alpha').click(),
    picked: /alpha/,
    bubble: true,
  },
  {
    name: 'select-chip',
    label: "a select property's list",
    open: (page) => station(page).locator('.pv-select-btn').click(),
    shown: popover,
    pick: (page) => row(page, 'paused').click(),
    picked: 'paused',
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'multi',
    label: "a multi-select property's list",
    open: (page) => station(page).locator('.pv-chip-input').click(),
    shown: popover,
    pick: (page) => row(page, 'green').click(),
    picked: /green/,
    bubble: true,
  },
  {
    name: 'type-menu',
    label: "a property's type menu",
    open: (page) => station(page).locator('.pv-type-btn').click(),
    shown: (page) => station(page).locator('.pv-type-menu'),
    pick: (page) => station(page).locator('.pv-type-menu .pv-popover-row').filter({ hasText: /^\s*(Zahl|Number)\s*$/ }).click(),
    picked: 'number',
    bubble: true,
  },
  {
    name: 'add-property',
    label: 'the "add property" popover',
    open: (page) => page.getByTestId('open').click(),
    shown: (page) => station(page).locator('.pv-add-popover'),
    pick: (page) => station(page).locator('.pv-add-types .pv-popover-row').filter({ hasText: /^\s*(Zahl|Number)\s*$/ }).click(),
    picked: /:number$/,
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'cell-multi',
    label: "a database cell's multi-select editor",
    open: (page) => page.getByTestId('open').click(),
    shown: (page) => station(page).locator('.base-inline-editor'),
    pick: async (page) => {
      await station(page).locator('.base-inline-editor .pv-selecttrigger').click();
      await page.getByRole('option', { name: 'green' }).click();
    },
    picked: /green/,
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'cell-relation',
    label: "a database cell's relation editor",
    open: (page) => page.getByTestId('open').click(),
    shown: (page) => station(page).locator('.base-inline-editor'),
    pick: (page) => station(page).locator('.base-inline-result').filter({ hasText: 'Alpha' }).click(),
    picked: /Alpha/,
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'date',
    label: "a date property's picker",
    open: (page) => station(page).locator('.pv-field').click(),
    shown: (page) => page.getByTestId('date-field-picker'),
    pick: (page) => page.getByTestId('date-field-day-2026-10-23').click(),
    picked: '2026-10-23',
    bubble: true,
    saysItWasLeft: true,
  },
  {
    name: 'table-size',
    label: 'the table size grid',
    open: (page) => page.getByTestId('open').click(),
    shown: (page) => page.getByRole('dialog', { name: /^(Tabellengröße wählen|Choose table size)$/ }),
    pick: (page) => page.getByRole('dialog', { name: /^(Tabellengröße wählen|Choose table size)$/ }).locator('div[style*="cursor: pointer"]').first().click(),
    picked: '1x1',
    bubble: false,
    saysItWasLeft: true,
  },
  {
    name: 'base-picker',
    label: 'the database picker',
    open: (page) => page.getByTestId('open').click(),
    shown: (page) => page.getByRole('dialog', { name: /^(Datenbank einbetten|Embed database)$/ }),
    pick: (page) => page.getByRole('dialog', { name: /^(Datenbank einbetten|Embed database)$/ }).getByRole('button', { name: /Board/ }).click(),
    picked: 'Board.base',
    bubble: false,
    coversTheWindow: true,
    saysItWasLeft: true,
  },
];

for (const s of STATIONS) {
  test(`${s.label} closes on a press on a handle that takes it for a drag`, async ({ page }) => {
    await openProbe(page, s.name);
    await s.open(page);
    await expect(s.shown(page)).toBeVisible();
    const handle = s.coversTheWindow ? page.getByTestId('grip') : head(page);
    expect(await reachable(handle)).toBe(true);
    const before = await value(page).textContent();

    await pressAt(page, handle);
    await expect(s.shown(page)).toHaveCount(0);
    // Leaving takes nothing; a surface that says it was left says it once.
    await expect(value(page)).toHaveText(before ?? '');
    if (s.saysItWasLeft) await expect(closes(page)).toHaveText('1');
    await expect(page.getByTestId('win')).toBeVisible();
  });

  if (s.bubble) {
    test(`${s.label} closes on a press whose mousedown a handler stops on its way`, async ({ page }) => {
      await openProbe(page, s.name);
      await s.open(page);
      await expect(s.shown(page)).toBeVisible();
      expect(await reachable(page.getByTestId('stopper'))).toBe(true);

      await pressAt(page, page.getByTestId('stopper'));
      await expect(s.shown(page)).toHaveCount(0);
    });
  }

  test(`${s.label}: an entry is taken with a press, and a press on the page beside it leaves it as before`, async ({ page }) => {
    await openProbe(page, s.name);
    await s.open(page);
    await expect(s.shown(page)).toBeVisible();
    await s.pick(page);
    await expect(value(page)).toHaveText(s.picked);

    // A press on the page — heard before § 3.100 as well — closes it.
    const after = await value(page).textContent();
    const closesBefore = Number(await closes(page).textContent());
    if (await s.shown(page).count() === 0) await s.open(page);
    await expect(s.shown(page)).toBeVisible();
    await pressOnThePage(page);
    await expect(s.shown(page)).toHaveCount(0);
    await expect(value(page)).toHaveText(after ?? '');
    if (s.saysItWasLeft) await expect(closes(page)).toHaveText(String(closesBefore + 1));
  });
}

// What a press beside these surfaces does besides closing them stays what it
// was: an editor commits with every change, so leaving it saves nothing — and
// drops what was typed and not confirmed.
test("leaving a cell's multi-select editor drops a value that was typed and not confirmed", async ({ page }) => {
  await openProbe(page, 'cell-multi');
  await page.getByTestId('open').click();
  await station(page).locator('.base-inline-input').fill('purple');
  await pressAt(page, head(page));
  await expect(station(page).locator('.base-inline-editor')).toHaveCount(0);
  await expect(value(page)).toHaveText('["red"]');
  await expect(closes(page)).toHaveText('1');
});

test('leaving a date with a time drops a day that was picked and not confirmed', async ({ page }) => {
  await openProbe(page, 'date-cell');
  await page.getByTestId('open').click();
  await expect(page.getByTestId('date-field-picker')).toBeVisible();
  await page.getByTestId('date-field-day-2026-10-23').click();
  await expect(page.getByTestId('date-field-picker')).toBeVisible();
  await pressAt(page, head(page));
  await expect(page.getByTestId('date-field-picker')).toHaveCount(0);
  await expect(value(page)).toHaveText('2026-10-22');
  await expect(closes(page)).toHaveText('1');
});

// What opens a surface is not beside it: its own press answers. Counted as
// beside, the press closed the surface and the click that followed opened it
// again — a toggle that never closed.
for (const s of STATIONS.filter((x) => x.name === 'type-menu' || x.name === 'add-property' || x.name === 'date')) {
  test(`${s.label} closes when what opened it is pressed again, and opens on the next press`, async ({ page }) => {
    await openProbe(page, s.name);
    await s.open(page);
    await expect(s.shown(page)).toBeVisible();
    await s.open(page);
    await expect(s.shown(page)).toHaveCount(0);
    await s.open(page);
    await expect(s.shown(page)).toBeVisible();
  });
}

// A finger is heard by the `mousedown` the browser sends once its tap is made
// out. A handle that takes the press cancels the `pointerdown`, and then no
// `mousedown` comes for the finger either: such a press is heard as soon as it
// has passed every handler on its way.
test.describe('with a finger', () => {
  test.use({ hasTouch: true });

  async function tapAt(page: Page, target: Locator) {
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  test('a tap on the head of a floating window closes a menu', async ({ page }) => {
    await openProbe(page, 'menu');
    await page.getByTestId('open').tap();
    const menu = page.getByRole('menu', { name: 'Probe menu' });
    await expect(menu).toBeVisible();
    await tapAt(page, head(page));
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('win')).toBeVisible();
  });

  test('a tap on a grip closes a select list', async ({ page }) => {
    await openProbe(page, 'select');
    await page.getByTestId('select-trigger').tap();
    const list = page.getByRole('listbox', { name: 'Probe list' });
    await expect(list).toBeVisible();
    await tapAt(page, page.getByTestId('grip'));
    await expect(list).toHaveCount(0);
    await expect(closes(page)).toHaveText('1');
  });

  test('a tap beside a select list closes it, and a tap on an entry takes the entry', async ({ page }) => {
    await openProbe(page, 'select');
    const list = page.getByRole('listbox', { name: 'Probe list' });
    await page.getByTestId('select-trigger').tap();
    await expect(list).toBeVisible();
    await tapAt(page, page.getByTestId('win-text'));
    await expect(list).toHaveCount(0);
    await page.getByTestId('select-trigger').tap();
    await expect(list).toBeVisible();
    await page.getByRole('option', { name: 'Gamma' }).tap();
    await expect(value(page)).toHaveText('c');
    await expect(list).toHaveCount(0);
  });
});

// The same surfaces in the app, where the press is made: a database's table
// and the note preview, a floating window over it.

async function openBoard(page: Page) {
  await page.addInitScript(installMenuVault);
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Board', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByTestId('file-tree').getByText('Board', { exact: true }).click();
  await expect(page.locator('[data-tip="Alpha"]')).toBeVisible({ timeout: 15000 });
}

test("in a database's table, a cell's select list closes when a column is made wider beside it", async ({ page }) => {
  await openBoard(page);
  await page.locator('.base-header-container .base-view-tab').filter({ hasText: /^\s*Tabelle\s*$/ }).click();
  const cell = page.getByTestId('base-row').filter({ hasText: 'Alpha' }).locator('td:not(.pv-selcol)').nth(1);
  await cell.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();

  await pressAt(page, page.locator('.base-col-resize').first());
  await expect(list).toHaveCount(0);
  // The cell left its edit and shows what the note holds.
  await expect(cell).toContainText('active');
});

test("in the note preview, a property's type menu closes on a press on the head of the window it is in", async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-tip="Alpha"]').click();
  const preview = page.locator('.pv-peek-card');
  await expect(preview).toBeVisible();
  // The properties of the previewed note stand in the window's own side
  // column; the type menu of a row is one of the surfaces of § 3.100.
  await preview.getByRole('button', { name: /^(Eigenschaften|Properties)$/ }).click();
  const typeButton = preview.locator('.pv-prow[data-prop="status"] .pv-type-btn');
  await expect(typeButton).toBeVisible({ timeout: 15000 });
  await typeButton.click();
  const menu = page.locator('.pv-type-menu');
  await expect(menu).toBeVisible();

  await pressAt(page, preview.locator('.pv-peek-title'));
  await expect(menu).toHaveCount(0);
  await expect(preview).toBeVisible();
});
