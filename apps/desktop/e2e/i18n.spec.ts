/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { APP_LANGUAGES } from '../src/services/languages';

// Load locales via fs (Playwright's ESM loader lacks Vite's JSON import support);
// the expected UI strings come straight from the shipped JSONs so the test tracks
// the real translations instead of hard-coded words.
const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales');
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
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
          }
          return [];
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
  await dialog.getByRole('button', { name: en.settings.general, exact: true }).click();

  // The language picker offers all registered languages under their native names.
  await page.getByLabel(en.settings.language).click();
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
  await page.getByRole('dialog', { name: fr.settings.title }).getByRole('button', { name: fr.settings.general, exact: true }).click();
  await expect(page.getByLabel(fr.settings.language)).toContainText('Français');
});
