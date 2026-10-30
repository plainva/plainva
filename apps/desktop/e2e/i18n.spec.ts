/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { APP_LANGUAGES } from '../../../packages/ui/src/services/languages';

// Load locales via fs (Playwright's ESM loader lacks Vite's JSON import support);
// the expected UI strings come straight from the shipped JSONs so the test tracks
// the real translations instead of hard-coded words.
const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'ui', 'src', 'locales');
const loadLocale = (code: string): any => JSON.parse(readFileSync(join(LOCALES, `${code}.json`), 'utf8'));
const en = loadLocale('en');
const fr = loadLocale('fr');

/**
 * App-language switching (Gesamtplan Sprachen 2026-07-04). Same Tauri mock as
 * theming.spec.ts: the store plugin is backed by localStorage so the language
 * choice survives page.reload() like the real plainva-settings.json would.
 * Expected strings come straight from the locale JSONs, so the test tracks
 * translations instead of hard-coding words.
 */
test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': "# Hello\nWelcome to the mock vault!"
    };

    // localStorage-backed store — survives reloads within the test.
    const STORE_LS_KEY = 'pvE2EStore';
    const readStore = (): Record<string, any> => JSON.parse(localStorage.getItem(STORE_LS_KEY) || '{}');
    const writeStore = (s: Record<string, any>) => localStorage.setItem(STORE_LS_KEY, JSON.stringify(s));
    if (!localStorage.getItem(STORE_LS_KEY)) {
      writeStore({
        lastVaultPath: '/test-vault',
        recentVaults: ['/test-vault'],
        autoOpenLastVault: true,
        // Stage D remounts `App` when the shown vault arrives, which is when
        // the release dialog finally gets a vault to render over. A marker
        // equal to the running version means "already seen".
        whatsNewSeenVersion: '9.9.9',
      });
    }

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;

        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') {
          return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        }

        // --- STORE PLUGIN (persistent within the test via localStorage) ---
        if (cmd === 'plugin:store|load') return 1;
        // The version the marker above is compared against.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          const store = readStore();
          if (args.key in store) return [store[args.key], true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') {
          const store = readStore();
          store[args.key] = args.value;
          writeStore(store);
          return null;
        }
        if (cmd === 'plugin:store|save') return null;

        if (cmd === 'plugin:dialog|ask') return true;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') {
          return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        }

        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
          }
          return [];
        }
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
          const entries: Record<string, {name: string, isDirectory: boolean, isFile: boolean, isSymlink: boolean}> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const relative = path.substring(p.length + 1);
              const name = relative.split('/')[0];
              if (!entries[name]) {
                const childPath = `${p}/${name}`;
                const isDir = !!fs[childPath]?.isDir;
                entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
              }
            }
          }
          return Object.values(entries);
        }
        if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'register_write_root') {
          // Atomic-write root handle (hardening P2): the mock id carries the path.
          return 'mock-root:' + String(args.path).replace(/\/$/, '');
        }
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          let str: string;
          if (cmd === 'plugin:fs|write_text_file') {
            str = new TextDecoder().decode(new Uint8Array(args));
          } else {
            str = new TextDecoder().decode(new Uint8Array(args.data || args));
          }
          fs[p] = str;
          return null;
        }
        if (cmd === 'plugin:fs|mkdir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          fs[p] = { isDir: true };
          return null;
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;

        return null;
      }
    };
  });
});

test('Language picker lists every shipped language; switching to French localizes and persists', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Open Settings via the ribbon (Playwright's browser reports en, so the app starts English).
  await page.getByRole('button', { name: en.shortcuts.openSettings, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en.settings.title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: en.settings.sectionAppearance, exact: true }).click();

  // The language picker offers all registered languages under their native names.
  await page.getByLabel(en.settings.language, { exact: true }).click();
  for (const lang of APP_LANGUAGES) {
    await expect(page.getByRole('option', { name: lang.nativeName })).toBeVisible();
  }

  // Pick French: the open dialog relabels immediately (hybrid auto-save, no Save button).
  await page.getByRole('option', { name: 'Français' }).click();
  await expect(page.getByRole('dialog', { name: fr.settings.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: fr.settings.title })).toBeVisible();

  await page.keyboard.press('Escape');

  // The choice survives a reload (appLanguage in the persisted store).
  await page.reload();
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  const frSettingsButton = page.getByRole('button', { name: fr.shortcuts.openSettings, exact: true });
  await expect(frSettingsButton).toBeVisible();

  // Reopen: still French, and the picker shows Français as the current value.
  await frSettingsButton.click();
  await expect(page.getByRole('dialog', { name: fr.settings.title })).toBeVisible();
  await page.getByRole('dialog', { name: fr.settings.title }).getByRole('button', { name: fr.settings.sectionAppearance, exact: true }).click();
  await expect(page.getByLabel(fr.settings.language, { exact: true })).toContainText('Français');
});

/**
 * The info button never stands alone on a line (finding 2026-10-30): under six
 * German labels — "Letzten Vault beim Start automatisch öffnen", "Ort an
 * Journal-Einträge anhängen können", … — the ⓘ dropped onto a line of its own.
 * The label's last word and the button are one span now (`InfoLabel`), and a lone switch
 * no longer takes a 300-px column. Every settings page in every language: the
 * button's middle lies on the last line of its label.
 */
const loneInfoButtons = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const bad: string[] = [];
  // Every info button of the open page and the label it ends: the text
  // before it in the same label element (a row label, a card heading).
  for (const button of Array.from(document.querySelectorAll<HTMLElement>('.pv-setpage[data-active="true"] :is(.pv-setrow-label, .pv-setgroup-label) .pv-infotip'))) {
    if (button.getClientRects().length === 0) continue;
    const label = button.closest<HTMLElement>('.pv-setrow-label, .pv-setgroup-label')!;
    const range = document.createRange();
    range.setStartBefore(label.firstChild!);
    range.setEndBefore(button.closest('.pv-infotip-wrap')!);
    const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (lines.length === 0) continue;
    const lastBottom = Math.max(...lines.map((r) => r.bottom));
    const last = lines.filter((r) => r.bottom > lastBottom - 2);
    const top = Math.min(...last.map((r) => r.top));
    const box = button.getBoundingClientRect();
    const middle = (box.top + box.bottom) / 2;
    if (middle < top - 1 || middle > lastBottom + 1) bad.push(label.textContent ?? '');
  }
  return bad;
});

const visitSettingsPages = async (page: import('@playwright/test').Page, title: string, check: (area: string) => Promise<void>) => {
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  const links = dialog.locator('.pv-navlink:not(:has(kbd))');
  const count = await links.count();
  expect(count).toBeGreaterThan(8);
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    if (!(await link.isVisible())) continue;
    const area = (await link.textContent())?.trim() ?? String(i);
    await link.click();
    await expect(dialog.locator('.pv-setpage[data-active="true"]')).toBeVisible();
    await check(area);
  }
  await page.keyboard.press('Escape');
};

test('Settings: the info button stays on the line of its label, in every language', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  const found: string[] = [];
  // Every language at the usual width, and German — the longest labels — in a narrow window too.
  const runs = [...APP_LANGUAGES.map((lang) => ({ lang, width: 1280 })), { lang: APP_LANGUAGES.find((l) => l.code === 'de')!, width: 980 }];
  for (const { lang, width } of runs) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((code) => {
      const store = JSON.parse(localStorage.getItem('pvE2EStore') || '{}');
      store.appLanguage = code;
      localStorage.setItem('pvE2EStore', JSON.stringify(store));
    }, lang.code);
    await page.reload();
    const loc = loadLocale(lang.code);
    await expect(page.getByRole('button', { name: loc.shortcuts.openSettings, exact: true })).toBeVisible({ timeout: 10000 });
    await visitSettingsPages(page, loc.settings.title, async (area) => {
      for (const label of await loneInfoButtons(page)) found.push(`${lang.code} · ${width} · ${area} · ${label}`);
      if (process.env.PLAINVA_EVIDENCE && lang.code === 'de' && /^(Editor & Notizen|Start & Verhalten|Notizen & Ablage)$/.test(area)) {
        // The annotation rows of the finding sit at the end of Notes & filing.
        await page.getByTestId('settings-annotations').scrollIntoViewIfNeeded().catch(() => undefined);
        for (const mode of ['light', 'dark']) {
          await page.evaluate((m) => document.documentElement.setAttribute('data-theme', m), mode);
          await page.screenshot({ path: testInfo.outputPath(`info-glue-${width}-${area.replace(/\W+/g, '-')}-${mode}.png`) });
        }
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      }
    });
  }
  expect(found).toEqual([]);
});

test('Settings: the info check sees a button that drops alone (positive control)', async ({ page }) => {
  // The rule switched off and the 300-px column back: the reported German row must fail the check.
  await page.addInitScript(() => {
    const store = JSON.parse(localStorage.getItem('pvE2EStore') || '{}');
    store.appLanguage = 'de';
    localStorage.setItem('pvE2EStore', JSON.stringify(store));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const de = loadLocale('de');
  await expect(page.getByRole('button', { name: de.shortcuts.openSettings, exact: true })).toBeVisible({ timeout: 10000 });
  await page.addStyleTag({ content: '.pv-infotip-glue { white-space: normal !important } .pv-setrow-ctrl { flex: 0 0 300px !important; max-width: 46% !important }' });
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: de.settings.title });
  await dialog.getByRole('button', { name: de.settings.sectionBehavior ?? 'Start & Verhalten', exact: true }).click();
  await expect.poll(() => loneInfoButtons(page)).toContain(de.splash.autoOpenLastVault);
});

