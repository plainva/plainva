/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Vault-wide find & replace + tag rename E2E (B6). Drives the modal (Mod+Shift+F)
 * and the tag context-menu rename against the mock fs; the writes land in mockFs.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/A.md': '# A\nOne TODO here and another TODO. Tagged #work and #work/urgent.',
      '/test-vault/B.md': '---\ntags: [work]\n---\n# B\nA third TODO plus #work.',
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
          if (q.includes('content FROM fts_notes')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, content: fs['/test-vault/' + r.path] }));
          }
          if (q.includes('FROM tags') && q.includes('COUNT(DISTINCT file_id)')) {
            return [{ tag: 'work', count: 2 }];
          }
          if (q.includes('FROM tags t') && q.includes('JOIN files f')) {
            return noteRows().map((r) => ({ id: r.path, path: r.path, title: r.title, mtime_local: 1000, size_bytes: 10 }));
          }
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
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const str = cmd === 'plugin:fs|write_text_file' ? new TextDecoder().decode(new Uint8Array(args)) : new TextDecoder().decode(new Uint8Array(args.data || args));
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
      },
    };
  });
});

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('A', { exact: true }).first()).toBeVisible({ timeout: 20000 });
}

test('vault-wide find & replace previews and replaces across notes to disk', async ({ page }) => {
  await openVault(page);
  await page.keyboard.press('Control+Shift+F');

  const dialog = page.getByRole('dialog');
  const find = dialog.getByPlaceholder(/Suchtext|Find/);
  await expect(find).toBeVisible();
  await find.fill('TODO');
  await dialog.getByRole('button', { name: /^(Find|Suchen)$/ }).click();

  // Both notes show up in the preview.
  await expect(dialog.getByRole('button', { name: 'A', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'B', exact: true })).toBeVisible();

  await dialog.getByPlaceholder(/Ersetzen durch|Replace with/).fill('DONE');
  await dialog.getByRole('button', { name: /Replace in|ersetzen/ }).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/A.md']))
    .toContain('One DONE here and another DONE');
});

test('renaming a tag rewrites frontmatter and inline occurrences across the vault', async ({ page }) => {
  await openVault(page);
  // Switch to the Tags sidebar tab.
  await page.getByRole('tab', { name: /Tags/i }).click();
  const tagRow = page.getByText('work', { exact: true }).first();
  await expect(tagRow).toBeVisible();

  await tagRow.click({ button: 'right' });
  const input = page.locator('.pv-modal input.pv-field');
  await expect(input).toBeVisible();
  await input.fill('job');
  await input.press('Enter');

  // Both the inline #work and the frontmatter tag become job.
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/A.md']))
    .toContain('#job');
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/B.md']))
    .toContain('job');
});
