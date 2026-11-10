/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from './fixtures/clockedTest';

/**
 * A file embed is a card (plan Rückmeldungen 05.11., P4; decision E2).
 * `![[Mietvertrag.pdf#height=600]]` went down the note path, was read as text
 * and said "could not be read" about a PDF that was there. Now the editor and
 * the reading view draw a card with the file's name, size and folder, and its
 * "Open" hands the file to the system. A file that is not there says so.
 */
const PDF = [...'%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'].map((char) => char.charCodeAt(0) & 0xff);
const NOTE = '# Wohnung\n\nUnterlagen zum Mietvertrag:\n\n![[Mietvertrag.pdf#height=600]]\n\nNicht da:\n\n![[Fehlt.pdf]]\n';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(({ PDF, NOTE }) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Wohnung.md': NOTE,
      '/test-vault/Anhänge': { isDir: true },
      '/test-vault/Anhänge/Mietvertrag.pdf': { bytes: PDF },
    };
    (window as any).opened = [] as string[];
    const fs = (window as any).mockFs;
    const isFile = (p: string) => fs[p] !== undefined && !fs[p].isDir;
    const bytesOf = (entry: any): number[] => (typeof entry === 'string' ? Array.from(new TextEncoder().encode(entry)) : entry.bytes);
    const fileRows = () =>
      Object.keys(fs)
        .filter((p) => isFile(p) && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.split('/').pop()!.replace(/\.md$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
        });

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
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
        if (cmd === 'plugin:opener|open_path') { (window as any).opened.push(String(args.path)); return null; }
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('FROM files WHERE is_deleted = 0')) return fileRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) return fileRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          if (q.includes('SELECT path, title FROM files')) return fileRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return fileRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          fs[`${root}/${rel}`] = args.encoding === 'base64'
            ? { bytes: Array.from(atob(String(args.contents)), (char) => char.charCodeAt(0)) }
            : String(args.contents);
          return null;
        }
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
  }, { PDF, NOTE });
});

async function openWohnung(page: any) {
  await page.goto('/');
  await expect(page.getByText('Wohnung', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('Wohnung', { exact: true }).first().click();
}

async function expectCard(page: any, scope: any) {
  const card = scope.getByTestId('file-embed');
  await expect(card).toHaveCount(1, { timeout: 20000 });
  await expect(card).toHaveAttribute('data-path', 'Anhänge/Mietvertrag.pdf');
  await expect(card.locator('.pv-filecard-name')).toHaveText('Mietvertrag.pdf');
  await expect(card.locator('.pv-filecard-meta')).toHaveText(`${PDF.length} B · Anhänge/`);
  await expect(card.locator('.pv-filecard-badge')).toHaveText('PDF');
  // The PDF is there: nothing says it could not be read. The one that is not says so.
  await expect(page.getByText(/could not be read/)).toHaveCount(0);
  await expect(page.getByText('“Fehlt.pdf” was not found.')).toBeVisible();
  await card.getByTestId('file-embed-open').click();
  await expect.poll(() => page.evaluate(() => (window as any).opened)).toEqual(['/test-vault/Anhänge/Mietvertrag.pdf']);
}

test('a PDF embedded in a note is a card with name, size and Open in the live preview', async ({ page }) => {
  await openWohnung(page);
  await expect(page.locator('.cm-content').first()).toContainText('Unterlagen zum Mietvertrag', { timeout: 20000 });
  await expectCard(page, page.locator('.cm-content').first());
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('file-embed-desktop-live.png') });
});

test('the reading view draws the same card', async ({ page }) => {
  await page.addInitScript(() => { (window as any).storeOverrides = { defaultViewMode: 'read' }; });
  await openWohnung(page);
  await expect(page.locator('.markdown-reader').first()).toContainText('Unterlagen zum Mietvertrag', { timeout: 20000 });
  await expectCard(page, page.locator('.markdown-reader').first());
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('file-embed-desktop-read.png') });
});
