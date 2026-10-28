/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * A file the cloud provider refuses for good (third review 2026-10-27): the
 * sync moves this device's content of it to a copy that goes up, and tells
 * the editor. The editor open on the old name switches to the copy at once -
 * unsaved text included - instead of saving the old name again or looking
 * for a file "moved outside Plainva". The sync's move is played here the way
 * the engine makes it: the file is renamed on disk, and the event follows.
 *
 * The fixture is the note-body suite's plain vault (see not-text.spec.ts).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Start.md': '# Start\n\nA note in UTF-8.\n',
      '/test-vault/Flagged.md': '# Flagged\n\nThe provider does not hand out this file.\n',
    };
    (window as any).writes = [] as string[];
    const fs = (window as any).mockFs;
    const isFile = (p: string) => fs[p] !== undefined && !fs[p].isDir;
    const bytesOf = (entry: any): number[] => (typeof entry === 'string' ? Array.from(new TextEncoder().encode(entry)) : entry.bytes);
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => isFile(p) && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
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
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          const overrides = (window as any).storeOverrides ?? {};
          if (args.key in overrides) return [overrides[args.key], true];
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
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
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        // Every write is noted — none may reach the two files unasked — and
        // lands as what it is: bytes as bytes, a text as its UTF-8.
        if (cmd === 'write_file_atomic') {
          (window as any).writes.push(String(args.relPath));
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          fs[`${root}/${rel}`] = args.encoding === 'base64'
            ? { bytes: Array.from(atob(String(args.contents)), (char) => char.charCodeAt(0)) }
            : String(args.contents);
          return null;
        }
        if (cmd === 'move_to_trash' || cmd === 'plugin:fs|remove') {
          const p = String(args.path).replace(/\/$/, '');
          for (const key of Object.keys(fs)) if (key === p || key.startsWith(p + '/')) delete fs[key];
          return null;
        }
        // Checked native reads use the same files as the plugin fixture. The
        // text read decodes strictly, as Rust's `read_to_string` does: bytes
        // that are not UTF-8 are refused, not replaced.
        if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|exists', { path });
          if (cmd === 'checked_path_exists') return present;
          if (!present) return null;
          if (cmd === 'checked_read_dir') {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path });
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
          } catch {
            throw 'cannot read text file: stream did not contain valid UTF-8';
          }
        }
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error('File not found');
          return { isDir: !!file.isDir, isFile: !file.isDir, mtime: 1000, size: file.isDir ? 0 : bytesOf(file).length };
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
          return bytesOf(content);
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  });
});

async function open(page: any, name: string) {
  await page.goto('/');
  await expect(page.getByText('Start', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText(name, { exact: true }).first().click();
}


const COPY = 'Flagged (conflict 2026-10-27 15-00-00).md';

/** What the engine does: the file goes to its copy on disk, and the shell hears of it. */
async function syncMovesToCopy(page: any) {
  await page.evaluate((copy: string) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/' + copy] = fs['/test-vault/Flagged.md'];
    delete fs['/test-vault/Flagged.md'];
    window.dispatchEvent(new CustomEvent('plainva-file-moved', { detail: { from: 'Flagged.md', to: copy, vaultPath: '/test-vault' } }));
  }, COPY);
}

test('the editor open on a refused file switches to its copy, and its next save goes there', async ({ page }) => {
  await open(page, 'Flagged');
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('The provider does not hand out this file.', { timeout: 20000 });

  await syncMovesToCopy(page);

  await expect(page.getByRole('tab', { name: /Flagged \(conflict 2026-10-27 15-00-00\)/ }).first()).toBeVisible({ timeout: 10000 });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' Typed after the move.');
  await expect.poll(() => page.evaluate((copy: string) => (window as any).mockFs['/test-vault/' + copy], COPY), { timeout: 15000 }).toContain('Typed after the move.');
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({ writes: (window as any).writes as string[], old: (window as any).mockFs['/test-vault/Flagged.md'] }));
  expect(state.writes).not.toContain('Flagged.md');
  expect(state.old).toBeUndefined();
  // Not the lookup for a file moved elsewhere: no such notice.
  await expect(page.locator('.pv-toast').filter({ hasText: 'Moved outside Plainva' })).toHaveCount(0);
});

test('what was typed but not saved yet goes along to the copy, never back to the old name', async ({ page }) => {
  await open(page, 'Flagged');
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('The provider does not hand out this file.', { timeout: 20000 });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' Typed just before.');

  await syncMovesToCopy(page);

  await expect.poll(() => page.evaluate((copy: string) => (window as any).mockFs['/test-vault/' + copy], COPY), { timeout: 15000 }).toContain('Typed just before.');
  await expect(page.getByRole('tab', { name: /Flagged \(conflict 2026-10-27 15-00-00\)/ }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Flagged.md'])).toBeUndefined();
});
