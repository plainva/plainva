import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from '@playwright/test';
// The suite's fixed clock: two walks of the same commit photograph the same day.
import { test } from '../e2e/fixtures/clockedTest';
import { installMenuVault } from '../e2e/fixtures/menuVault';
import { installReviewVault } from './reviewVault';
import { specMock } from './specMocks';

/**
 * The desktop screenshot walk (decision E8 of the interface review, 2026-11-10).
 *
 * Photographs the desktop shell scene by scene, in the browser against the
 * Tauri double of the E2E suite, so a later round can put "before" and "after"
 * side by side. It is a TOOL, not a test: it asserts nothing beyond reaching
 * its scenes, a step that cannot be reached is logged and skipped, and it runs
 * only through its own config (`playwright.screenshots.config.ts`), never in
 * the E2E suite. How to run it and what its pictures cannot prove:
 * docs/engineering/Screenshot_Captures.md.
 *
 * Scenes: main, ai, firstrun, whatsnew, mail, cal, base — pick with
 * `PLAINVA_SCENES=main,mail` (default: all).
 */

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(process.env.PLAINVA_SHOTS_DIR ?? join(DESKTOP, 'screenshots', 'walk'));
const SCENES = (process.env.PLAINVA_SCENES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const wanted = (scene: string) => SCENES.length === 0 || SCENES.includes(scene);

const MOCK = {
  main: () => specMock('smoke.spec.ts'),
  mail: () => specMock('mail.spec.ts'),
  cal: () => specMock('calendar.spec.ts'),
  firstrun: () => specMock('onboarding.spec.ts', 'firstRunShell'),
};

function scheme(): string {
  return String(test.info().project.use.colorScheme ?? 'light');
}

async function shot(page: Page, name: string) {
  const dir = join(OUT, scheme());
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(-10, -10).catch(() => {});
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled' });
}

/** A step that cannot be reached is reported and skipped: one missing control never costs the walk. */
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.log(`SKIPPED ${scheme()}/${name}: ${String((error as Error).message).split('\n')[0]}`);
  }
}

const wait = (page: Page, ms = 600) => page.waitForTimeout(ms);
const esc = async (page: Page) => { await page.keyboard.press('Escape'); await wait(page, 300); };
const toggleMode = (page: Page, axis: 'source' | 'read') =>
  page.evaluate((a) => window.dispatchEvent(new CustomEvent('plainva-toggle-view-mode', { detail: { axis: a } })), axis);

async function mainApp(page: Page, extra?: string) {
  await page.addInitScript({ content: MOCK.main() });
  await page.addInitScript(installReviewVault);
  if (extra) await page.addInitScript({ content: extra });
  await page.goto('/');
  await page.getByTestId('file-tree').waitFor({ timeout: 30_000 });
  await wait(page, 1500);
}

async function openRelaunch(page: Page) {
  await page.getByTestId('file-tree').getByText('Projects', { exact: true }).click();
  await wait(page);
  await page.getByTestId('file-tree').getByText('Website relaunch', { exact: true }).click();
  await wait(page, 1500);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

test('main', async ({ page }) => {
  test.skip(!wanted('main'));
  await mainApp(page);
  await shot(page, '01-main-no-tab');
  await step('open note', () => openRelaunch(page));
  await shot(page, '02-note-live');
  await step('source', async () => { await toggleMode(page, 'source'); await wait(page, 800); await shot(page, '03-note-source'); await toggleMode(page, 'source'); await wait(page, 400); });
  await step('read', async () => { await toggleMode(page, 'read'); await wait(page, 1000); await shot(page, '04-note-read'); await toggleMode(page, 'read'); await wait(page, 400); });
  await step('left tabs', async () => {
    const tabs = page.locator('[aria-label="View"] [role=tab], [aria-label="View"] button');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const label = (await tabs.nth(i).getAttribute('aria-label')) || String(i);
      await tabs.nth(i).click();
      await wait(page, 700);
      await shot(page, `05-left-tab-${i}-${label.replace(/\W+/g, '_')}`);
    }
    if (n) await tabs.nth(0).click();
  });
  await step('sidebar search', async () => {
    await page.getByPlaceholder('Search notes').first().click();
    await page.keyboard.type('website');
    await wait(page, 1500);
    await shot(page, '06a-sidebar-search');
    await esc(page);
    await page.getByPlaceholder('Search notes').first().fill('');
  });
  await step('search & replace', async () => { await page.keyboard.press('Control+Shift+F'); await wait(page, 500); await page.keyboard.type('website'); await wait(page, 1500); await shot(page, '06-search-replace'); await esc(page); });
  await step('right sidebar', async () => {
    const side = page.locator('aside[aria-label="Right Sidebar"]');
    for (const section of ['Outline', 'Graph', 'Properties', 'Journal']) {
      await side.getByText(section, { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
      await wait(page, 500);
    }
    await shot(page, '07-right-sidebar');
  });
  await step('palette', async () => { await page.keyboard.press('Control+p'); await wait(page, 700); await shot(page, '08-command-palette'); await esc(page); });
  await step('switcher', async () => { await page.keyboard.press('Control+o'); await wait(page, 700); await shot(page, '09-quick-switcher'); await esc(page); });
  await step('file menu', async () => { await page.getByTestId('file-tree').getByText('Roadmap', { exact: true }).click({ button: 'right' }); await wait(page, 500); await shot(page, '10-file-context-menu'); await esc(page); });
  await step('editor menu', async () => { await page.locator('.cm-content').first().click({ button: 'right', position: { x: 200, y: 60 } }); await wait(page, 500); await shot(page, '10b-editor-context-menu'); await esc(page); });
  await step('slash', async () => {
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await wait(page, 700);
    await shot(page, '11-slash-menu');
    await esc(page);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
  });
  await step('selection toolbar', async () => { await page.locator('.cm-line').filter({ hasText: 'Clear hero' }).first().click({ clickCount: 3 }); await wait(page, 700); await shot(page, '12-selection-toolbar'); await page.keyboard.press('ArrowDown'); });
  for (const id of ['ribbon-graph', 'ribbon-tasks', 'ribbon-journal', 'ribbon-comments']) {
    await step(id, async () => { await page.getByTestId(id).first().click({ timeout: 3000 }); await wait(page, 1500); await shot(page, `13-${id}`); });
  }
  await step('shortcuts', async () => { await page.keyboard.press('F1'); await wait(page, 700); await shot(page, '14-shortcuts'); await esc(page); });
  await step('settings', async () => {
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await wait(page, 1200);
    const dialog = page.getByRole('dialog').last();
    await shot(page, '20-settings-first');
    const pages = ['Appearance', 'Editor & notes', 'Startup & behavior', 'AI', 'About & diagnostics', 'Cloud accounts', 'Security & Sharing', 'AI in this vault', 'Notes & filing', 'Daily notes & journal', 'Bars & areas', 'Backup & version history', 'Maintenance'];
    let i = 0;
    for (const name of pages) {
      i++;
      await step(`settings ${name}`, async () => {
        await dialog.getByRole('button', { name, exact: true }).first().click({ timeout: 2000 });
        await wait(page, 900);
        await shot(page, `21-settings-${String(i).padStart(2, '0')}-${name.replace(/\W+/g, '_')}`);
      });
    }
    await esc(page);
    await esc(page);
  });
  await step('narrow', async () => { await page.setViewportSize({ width: 900, height: 600 }); await wait(page, 1000); await shot(page, '30-narrow-900x600'); await page.setViewportSize({ width: 1440, height: 900 }); });
});

test('ai', async ({ page }) => {
  test.skip(!wanted('ai'));
  // One canned answer of a provider, so the conversation shows its full shape.
  const sse = (text: string) => [
    ['message_start', { type: 'message_start', message: { usage: { input_tokens: 40 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const script = [sse('Here is a short summary of **Website relaunch**:\n\n- Three feature pages instead of six\n- Screenshots are still missing\n\nThe next step is collecting screenshots.')];
  await mainApp(page, `(() => { const script = ${JSON.stringify(script)};
    window.__E2E_STORE_SEED = { ai: { enabled: true, providers: ['anthropic'], profiles: { balanced: { providerId: 'anthropic', model: 'm-1' } } } };
    const orig = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args, options) => {
      if (cmd === 'ai_key_present') return true;
      if (cmd === 'ai_http') { const text = script.shift(); const send = (c) => args.onEvent.onmessage(c); if (text === undefined) send({ type: 'failed', code: 'network', message: 'offline' }); else { send({ type: 'open', status: 200 }); send({ type: 'data', text }); send({ type: 'done' }); } return null; }
      return orig(cmd, args, options);
    }; })();`);
  await step('open note', () => openRelaunch(page));
  await shot(page, '40-ai-main');
  await step('companion', async () => {
    await page.keyboard.press('Control+j');
    await wait(page, 1000);
    await shot(page, '41-ai-companion-empty');
    const companion = page.getByTestId('ai-companion');
    await companion.getByTestId('ai-input').fill('Summarize this note');
    await companion.getByTestId('ai-send').click();
    await wait(page, 1000);
    await shot(page, '42-ai-consent');
    await companion.getByTestId('ai-consent-send').click({ timeout: 4000 }).catch(() => {});
    await wait(page, 2000);
    await shot(page, '43-ai-answer');
  });
});

test('firstrun', async ({ page }) => {
  test.skip(!wanted('firstrun'));
  await page.addInitScript({ content: MOCK.firstrun() });
  await page.goto('/');
  await wait(page, 5000);
  await shot(page, '50-firstrun-welcome');
  await step('later', async () => { await page.getByRole('button', { name: /Later/ }).click(); await wait(page, 1000); await shot(page, '51-splash'); });
  await step('new vault', async () => { await page.getByRole('button', { name: /New Vault/ }).first().click(); await wait(page, 1000); await shot(page, '52-new-vault-where'); });
});

test('whatsnew', async ({ page }) => {
  test.skip(!wanted('whatsnew'));
  await page.addInitScript({ content: MOCK.main() });
  await page.addInitScript(installReviewVault);
  // An older "seen" version, so the highlights of this one are owed.
  await page.addInitScript(() => {
    const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { key?: string }, o?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = tauri.invoke;
    tauri.invoke = async (cmd, args, options) => (cmd === 'plugin:store|get' && args.key === 'whatsNewSeenVersion' ? ['0.0.1', true] : original(cmd, args, options));
  });
  await page.goto('/');
  await wait(page, 6000);
  await shot(page, '55-whats-new');
});

test('mail', async ({ page }) => {
  test.skip(!wanted('mail'));
  await page.addInitScript({ content: MOCK.mail() });
  await page.goto('/');
  await page.getByTestId('file-tree').waitFor({ timeout: 30_000 });
  await wait(page, 1000);
  await page.getByTestId('ribbon-mail').click();
  await wait(page, 2500);
  await shot(page, '60-mail-list');
  await step('reader', async () => { await page.getByTestId('mail-envelope').first().click(); await wait(page, 1500); await shot(page, '61-mail-reader'); });
  await step('compose', async () => { await page.getByTestId('mail-compose').click(); await wait(page, 1200); await shot(page, '62-mail-composer'); });
});

test('cal', async ({ page }) => {
  test.skip(!wanted('cal'));
  await page.addInitScript({ content: MOCK.cal() });
  await page.goto('/');
  await page.getByTestId('file-tree').waitFor({ timeout: 30_000 });
  await wait(page, 1000);
  await page.getByTestId('ribbon-calendar').click();
  await wait(page, 2500);
  await shot(page, '65-calendar-month');
  for (const mode of ['week', 'day', 'agenda']) {
    await step(mode, async () => { await page.getByTestId(`calendar-mode-${mode}`).click({ timeout: 3000 }); await wait(page, 1200); await shot(page, `66-calendar-${mode}`); });
  }
});

test('base', async ({ page }) => {
  test.skip(!wanted('base'));
  const views = ['table', 'board', 'list', 'cards', 'calendar', 'timeline', 'pinboard'];
  const lines = ['filters:', '  and:', '    - file.folder == "Projekte"', 'properties:', '  note.status:', '    plainva:', '      input: select', '      options:', '        - value: active', '        - value: paused', 'views:'];
  for (const view of views) {
    lines.push(`  - type: ${['table', 'list', 'cards'].includes(view) ? view : 'table'}`, `    name: V-${view}`, '    order:', '      - file.name', '      - note.status');
    if (['board', 'calendar', 'timeline', 'pinboard'].includes(view)) {
      lines.push('    plainva:', `      render: ${view}`);
      if (view === 'board') lines.push('      groupBy: status');
      if (view === 'calendar' || view === 'timeline') lines.push('      dateField: date');
    }
  }
  const yaml = [...lines, ''].join('\n');
  await page.addInitScript(installMenuVault);
  await page.addInitScript((text) => { (window as unknown as { mockFs: Record<string, string> }).mockFs['/test-vault/Board.base'] = text; }, yaml);
  await page.goto('/');
  const board = page.getByTestId('file-tree').getByText('Board', { exact: true });
  await board.waitFor({ timeout: 30_000 });
  await board.click();
  await wait(page, 2000);
  await shot(page, '70-base-first');
  for (const view of views) {
    await step(view, async () => { await page.getByText(`V-${view}`, { exact: true }).first().click({ timeout: 3000 }); await wait(page, 1500); await shot(page, `71-base-${view}`); });
  }
});
