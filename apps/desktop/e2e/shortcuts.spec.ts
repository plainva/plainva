/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Redesigned shortcuts window (F1): chip navigation across areas, a search that
 * spans every area, keyboard + mouse rows, auto platform detection. Assertions
 * stay language-agnostic (test ids + key tokens + the echoed query).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/A.md': '# A\nHello.',
    };
    const fs = (window as any).mockFs;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
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
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
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
  });
});

test('F1 opens the shortcuts window; chips switch areas and search filters', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('A', { exact: true }).first()).toBeVisible({ timeout: 20000 });

  // F1 opens the window (the global handler preventDefaults it).
  await page.keyboard.press('F1');
  const modal = page.getByTestId('shortcuts-modal');
  await expect(modal).toBeVisible();

  // Several areas are offered as chips.
  await expect(page.getByTestId('shortcuts-chip-general')).toBeVisible();
  await expect(page.getByTestId('shortcuts-chip-graph')).toBeVisible();
  await expect(page.getByTestId('shortcuts-chip-base')).toBeVisible();

  // Chip navigation selects the Graph area.
  await page.getByTestId('shortcuts-chip-graph').click();
  await expect(page.getByTestId('shortcuts-chip-graph')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('shortcuts-chip-general')).toHaveAttribute('aria-selected', 'false');

  // Searching spans all areas and hides the chips; the F1 row (a key token,
  // language-independent) surfaces.
  await page.getByTestId('shortcuts-search').fill('F1');
  await expect(page.getByTestId('shortcuts-chip-general')).toHaveCount(0);
  await expect(modal.locator('kbd', { hasText: 'F1' }).first()).toBeVisible();

  // A query with no hits echoes the query in the empty state.
  await page.getByTestId('shortcuts-search').fill('zzqxnope');
  await expect(modal.getByText('zzqxnope')).toBeVisible();

  // Clearing search brings the chips back; Escape closes.
  await page.getByTestId('shortcuts-search').fill('');
  await expect(page.getByTestId('shortcuts-chip-general')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});
