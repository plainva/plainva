/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Spell checking as a device switch (plan Befunde 2026-10-06, E3).
 *
 * What this suite can see is what the app decides: which element carries
 * `spellcheck="true"`, that an open editor follows the switch without being
 * rebuilt, and which menu a right-click opens. The red lines and the
 * suggestions are drawn by the system's checker inside the WebView - no suite
 * sees them, and this one does not pretend to.
 *
 * The right-click is dispatched as an event and its `defaultPrevented` is read
 * back: "not prevented" is exactly the state in which the WebView shows the
 * system's menu, and a real native menu cannot be observed (or closed) from a
 * test.
 */
const NOTE = [
  '# Brief',
  '',
  'Ein Satz mit einem Fehlr und `code` darin.',
  '',
  '| A | B |',
  '| --- | --- |',
  '| eins | zwei |',
  '',
  'Ende.',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript((NOTE) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Brief.md': NOTE,
    };
    const fs = (window as any).mockFs;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.replace(/\.md$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
        });

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        if (cmd === 'plugin:store|load') return 1;
        // The version the marker above is compared against. Without it the
        // command falls through to `null` and every start looks like an update.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          // What the settings wrote in this session wins over the preset.
          if (args.key === 'spellcheck') return [((window as any).__saved?.spellcheck ?? (window as any).__spellcheck) === true, true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          // Stage D remounts `App` when the shown vault arrives, which is when
          // the release dialog finally gets a vault to render over. A marker
          // equal to the running version means "already seen" - this suite
          // tests the app, not its first five seconds (onboarding.spec covers
          // those on purpose).
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') { ((window as any).__saved ??= {})[args.key] = args.value; return null; }
        if (cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          }
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === "register_write_root") return "mock-root:" + String(args.path).replace(/\/$/, "");
        // Checked native reads use the same files as the plugin fixture.
        if (cmd === "checked_path_exists" || cmd === "checked_read_text_file" || cmd === "checked_read_dir") {
          const root = String(args.rootId).replace(/^mock-root:/, "").replace(/\/$/, "");
          const rel = String(args.relPath).replace(/^\/+/, "");
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|exists", { path });
          if (cmd === "checked_path_exists") return present;
          if (!present) return null;
          if (cmd === "checked_read_dir") {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_dir", { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_text_file", { path });
          return typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        }
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error('File not found');
          return { isDir: !!file.isDir, isFile: !file.isDir, mtime: Date.now(), size: typeof file === 'string' ? file.length : 0 };
        }
        if (cmd === 'plugin:fs|read_dir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const entries: Record<string, any> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const name = path.substring(p.length + 1).split('/')[0];
              if (!entries[name]) {
                const isDir = !!fs[`${p}/${name}`]?.isDir;
                entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
              }
            }
          }
          return Object.values(entries);
        }
        if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  }, NOTE);
});



const CONTEXT_MENU = /^(Kontextmenü|Context menu)$/;
const TABLE_MENU = /^(Tabelle bearbeiten|Edit table)$/;
const SWITCH = /^(Rechtschreibprüfung|Spell checking)$/;

async function openNote(page: any) {
  await page.goto('/');
  await expect(page.getByText('Brief', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('Brief', { exact: true }).first().click();
  await expect(page.locator('.cm-content .cm-line', { hasText: 'Ein Satz' })).toBeVisible({ timeout: 20000 });
}

/** Right-clicks the element and says whether anybody prevented the system's menu. */
async function rightClick(locator: any): Promise<boolean> {
  return locator.evaluate((el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left + 6, clientY: box.top + 6 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
}

async function setSwitch(page: any, on: boolean) {
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Editor & Notizen|Editor & notes)$/ }).click();
  const toggle = dialog.getByRole('switch', { name: SWITCH });
  await expect(toggle).toHaveAttribute('aria-checked', on ? 'false' : 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', on ? 'true' : 'false');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('off by default: nothing is checked and a right-click in the note opens Plainva\'s own menu', async ({ page }) => {
  await openNote(page);
  // The document root says "unchecked" for every field nobody classified.
  await expect(page.locator('html')).toHaveAttribute('spellcheck', 'false');
  await expect(page.locator('.cm-content').first()).toHaveAttribute('spellcheck', 'false');

  const prose = page.locator('.cm-content .cm-line', { hasText: 'Ein Satz' });
  expect(await rightClick(prose)).toBe(true);
  const menu = page.getByRole('menu', { name: CONTEXT_MENU });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^(Einfügen|Paste)$/ })).toBeVisible();
});

test('switched on in the settings: the open editor follows, and the right-click belongs to the system', async ({ page }) => {
  await openNote(page);
  const content = page.locator('.cm-content').first();
  const prose = page.locator('.cm-content .cm-line', { hasText: 'Ein Satz' });
  // Type something and remember the element: after the switch it must be the
  // same editor with the same text - followed, not rebuilt.
  await page.locator('.cm-content .cm-line', { hasText: 'Ende.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Nachtrag');
  await content.evaluate((el: any) => { el.__sameEditor = true; });

  await setSwitch(page, true);
  expect(await page.evaluate(() => (window as any).__saved?.spellcheck)).toBe(true);
  await expect(content).toHaveAttribute('spellcheck', 'true');
  expect(await content.evaluate((el: any) => el.__sameEditor === true)).toBe(true);
  await expect(page.locator('.cm-content .cm-line', { hasText: 'Ende. Nachtrag' })).toBeVisible();
  // Undo still knows the typing from before the switch.
  await page.locator('.cm-content .cm-line', { hasText: 'Ende. Nachtrag' }).click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content .cm-line', { hasText: 'Nachtrag' })).toHaveCount(0);

  // Code inside the note stays unchecked.
  await expect(prose.locator('[spellcheck="false"]', { hasText: 'code' })).toHaveCount(1);

  // Prose: nobody prevents the default, and Plainva's menu stays away.
  expect(await rightClick(prose)).toBe(false);
  await expect(page.getByRole('menu', { name: CONTEXT_MENU })).toHaveCount(0);

  // A table cell keeps its own, more specific menu.
  const cell = page.locator('.cm-md-table td', { hasText: 'eins' });
  expect(await rightClick(cell)).toBe(true);
  await expect(page.getByRole('menu', { name: TABLE_MENU })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: TABLE_MENU })).toHaveCount(0);

  // The cell's own field is a writing field like any other.
  await cell.click();
  await expect(page.locator('textarea.cm-md-table-input')).toHaveAttribute('spellcheck', 'true');
  await page.keyboard.press('Escape');

  // And off again: the editor follows back, and so does the menu.
  await setSwitch(page, false);
  await expect(content).toHaveAttribute('spellcheck', 'false');
  expect(await rightClick(prose)).toBe(true);
  await expect(page.getByRole('menu', { name: CONTEXT_MENU })).toBeVisible();
});

test('a stored "on" is applied at start, before anybody opens the settings', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__spellcheck = true; });
  await openNote(page);
  await expect(page.locator('.cm-content').first()).toHaveAttribute('spellcheck', 'true', { timeout: 10000 });
  const prose = page.locator('.cm-content .cm-line', { hasText: 'Ein Satz' });
  expect(await rightClick(prose)).toBe(false);
  await expect(page.getByRole('menu', { name: CONTEXT_MENU })).toHaveCount(0);
});

test('the document says which language the app speaks', async ({ page }) => {
  await openNote(page);
  const appLanguage = await page.evaluate(() => document.documentElement.lang);
  // The harness browser is English or German; either way it is the app's
  // language now, not the "en" the page was shipped with.
  expect(appLanguage).toMatch(/^(en|de)$/);
  const paste = await page.evaluate(() => navigator.language.toLowerCase().startsWith('de'));
  expect(appLanguage).toBe(paste ? 'de' : 'en');
});
