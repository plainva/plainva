/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from './fixtures/clockedTest';

// P21 (maintainer, 03.11.): a link that names an overview only as `index`
// leads to whichever `index.md` the link rule finds first. Generating an
// overview puts a new `index.md` into a folder and took such links over without
// a word, as an adoption did before decision E10 (index-adopt-pins.spec.ts):
// here a link in Projekte/ to the overview of Other/ led to the new listing.
// "Create overview" asks first where that would happen, counted and preset;
// the index.md manager's run - every folder without one at once - counts all
// new overviews together, and the run's links are written before any overview
// exists. The phone asks the same (overview-generate-pins.spec.ts).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Other': { isDir: true },
      '/test-vault/Other/index.md': '# Other\n',
      '/test-vault/Other/Note.md': 'Up: [[index]]\n',
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Projekte/Plan.md': 'See [[index]].\n',
      '/test-vault/Bereich': { isDir: true },
      '/test-vault/Bereich/Note.md': 'Back: [x](index.md)\n',
    };
    (window as any).__okfJournal = null;
    (window as any).__indexLinks = [
      { source_path: 'Projekte/Plan.md', target_path: 'index', link_type: 'wikilink', anchor: null, line_number: 1, property_key: null },
      { source_path: 'Other/Note.md', target_path: 'index', link_type: 'wikilink', anchor: null, line_number: 1, property_key: null },
      { source_path: 'Bereich/Note.md', target_path: 'index.md', link_type: 'markdown-link', anchor: null, line_number: 1, property_key: null },
    ];

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
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
        if (cmd === 'plugin:path|resolve_directory') return '/appdata';

        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
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
          // The links that name an overview by its name (`linksNamingFile`) - the
          // index of this mock holds no links, so the test hands them in.
          if (q.includes('FROM links l') && !q.includes('source_title')) return (window as any).__indexLinks ?? [];
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash)/.test(p))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
          }
          return [];
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
          return typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
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
          const entries: Record<string, { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const relative = path.substring(p.length + 1);
              const name = relative.split('/')[0];
              if (!entries[name]) {
                const childPath = `${p}/${name}`;
                const isDir = !!fs[childPath]?.isDir || relative.includes('/');
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
          return 'mock-root:' + String(args.path).replace(/\/$/, '');
        }
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          if (p.includes('/okf-journal/')) (window as any).__okfJournal = { path: p, contents: fs[p] };
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const str = new TextDecoder().decode(new Uint8Array(cmd === 'plugin:fs|write_text_file' ? args : (args.data || args)));
          fs[p] = str;
          return null;
        }
        if (cmd === 'plugin:fs|mkdir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          fs[p] = { isDir: true };
          return null;
        }
        if (cmd === 'plugin:fs|remove') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          for (const key of Object.keys(fs)) {
            if (key === p || key.startsWith(p + '/')) delete fs[key];
          }
          return null;
        }
        if (cmd === 'plugin:fs|rename') {
          const oldP = args.oldPath.endsWith('/') ? args.oldPath.slice(0, -1) : args.oldPath;
          const newP = args.newPath.endsWith('/') ? args.newPath.slice(0, -1) : args.newPath;
          for (const key of Object.keys(fs)) {
            if (key === oldP || key.startsWith(oldP + '/')) {
              fs[newP + key.substring(oldP.length)] = fs[key];
              delete fs[key];
            }
          }
          return null;
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;

        return null;
      },
    };
  });
});

const file = (page: Page, path: string) => page.evaluate((p) => (window as any).mockFs[p] as string | undefined, path);

test('Create overview offers to write the links to other overviews with their folder, and does', async ({ page }) => {
  await page.goto('/');
  const folder = page.getByTestId('file-tree').getByText('Projekte', { exact: true });
  await expect(folder).toBeVisible({ timeout: 10000 });
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create overview' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create overview' });
  const offer = dialog.getByTestId('confirm-checkbox');
  await expect(offer).toBeChecked({ timeout: 10000 });
  // One link tips over: the one in Projekte/. Other/ keeps its own overview, and
  // from Bereich/ the shorter path still answers.
  await expect(dialog).toContainText('Write links to other overviews with their folder, so they keep leading there (1)');
  await expect(dialog).toContainText('A link that names an overview only as “index” would lead to the new one.');
  // The dialog fades in; the picture is of the settled dialog.
  if (process.env.PLAINVA_EVIDENCE) { await page.waitForTimeout(500); await page.screenshot({ path: test.info().outputPath('generate-pin-offer.png') }); }
  await dialog.getByRole('button', { name: 'Create overview' }).click();

  await expect(page.locator('.pv-toast', { hasText: 'Links to other overviews written with their folder: 1' })).toBeVisible({ timeout: 15000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('generate-pin-result.png') });
  expect(await file(page, '/test-vault/Projekte/Plan.md')).toBe('See [[Other/index]].\n');
  expect(await file(page, '/test-vault/Projekte/index.md')).toContain('# Projekte');
  expect(await file(page, '/test-vault/Other/Note.md')).toBe('Up: [[index]]\n');
  expect(await file(page, '/test-vault/Bereich/Note.md')).toBe('Back: [x](index.md)\n');
});

test('Create overview: a cancel writes nothing, an unticked box writes the overview alone', async ({ page }) => {
  await page.goto('/');
  const folder = page.getByTestId('file-tree').getByText('Projekte', { exact: true });
  await expect(folder).toBeVisible({ timeout: 10000 });
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create overview' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create overview' });
  await expect(dialog.getByTestId('confirm-checkbox')).toBeChecked({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await file(page, '/test-vault/Projekte/index.md')).toBeUndefined();
  expect(await file(page, '/test-vault/Projekte/Plan.md')).toBe('See [[index]].\n');

  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create overview' }).click();
  dialog = page.getByRole('dialog', { name: 'Create overview' });
  await dialog.getByTestId('confirm-checkbox').uncheck({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Create overview' }).click();
  await expect.poll(() => file(page, '/test-vault/Projekte/index.md'), { timeout: 15000 }).toContain('# Projekte');
  expect(await file(page, '/test-vault/Projekte/Plan.md')).toBe('See [[index]].\n');
});

test('generating in every folder without an overview counts the whole run once and writes the links first', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Projekte', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-open-sync-settings', { detail: { area: 'maintenance' } })));
  await expect(page.getByTestId('settings-okf')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('settings-okf').getByRole('button', { name: 'Open…' }).click();
  const dialog = page.getByRole('dialog', { name: 'index.md manager' });
  await expect(dialog.getByRole('combobox', { name: 'Action for Projekte' })).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByTestId('indexmd-pin-links')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Generate index.md in all 3 folders without one' }).click();

  // The vault's root, Projekte and Bereich get one. The root's takes every bare
  // link - Other/'s own included - so all three are offered, in one count.
  const offer = dialog.getByTestId('indexmd-pin-links');
  await expect(offer).toBeChecked({ timeout: 10000 });
  await expect(dialog).toContainText('Write links to other overviews with their folder, so they keep leading there (3)');
  await expect(dialog).toContainText('A link that names an overview only as “index” would lead to one of the new ones.');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('generate-all-pin-offer.png') });
  await dialog.getByRole('button', { name: /^Run 3 action/ }).click();
  await expect(dialog).toContainText('Links to other overviews written with their folder: 3', { timeout: 15000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('generate-all-pin-result.png') });

  expect(await file(page, '/test-vault/Projekte/Plan.md')).toBe('See [[Other/index]].\n');
  expect(await file(page, '/test-vault/Other/Note.md')).toBe('Up: [[Other/index]]\n');
  expect(await file(page, '/test-vault/Bereich/Note.md')).toBe('Back: [x](../Other/index.md)\n');
  for (const path of ['/test-vault/index.md', '/test-vault/Projekte/index.md', '/test-vault/Bereich/index.md']) {
    expect(await file(page, path)).toBeDefined();
  }
});
