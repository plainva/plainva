/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// The OKF conversion, converted → continued → undone, through the real wizard
// (Maintenance › OKF format) over a mock file system (findings § 3.129 Nr. 1,
// § 3.87 Nr. 15 and 17):
// - a continued run takes its folder and options from the journal and converts
//   no note twice — "rename" moved the type the first pass had set and wrote
//   that pass's text over the original's backup, so the undo brought back the
//   damaged text;
// - the undo puts back only a note that still is what the run made of it — a
//   note edited after the run keeps the edit, and the undo says so;
// - the working copy of an open conflict is no note of its own and is not
//   counted.

const PERSON = '---\ntype: Person\n---\n# B\n';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript((person: string) => {
    // Kept across a reload, as a disk is across a restart.
    const saved = sessionStorage.getItem('okf-e2e-fs');
    (window as any).mockFs = saved ? JSON.parse(saved) : {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/A.md': '# A\n',
      '/test-vault/B.md': person,
      '/test-vault/C.md': '# C\n',
      '/test-vault/D.md': '# D\n',
      // A conflict copy the index lists; not a note of its own.
      '/test-vault/D.CONFLICT-2026-10-30T10-00-00-000Z-0f3c.md': '# D, the other side\n',
    };
    /** Every journal write, so a test can put an interrupted run's marker back. */
    (window as any).__okfJournal = null;

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
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;

        return null;
      },
    };
  }, PERSON);
});

const file = (page: Page, path: string) => page.evaluate((p) => (window as any).mockFs[p] as string | undefined, path);
const set = (page: Page, path: string, text: string | null) =>
  page.evaluate(([p, t]) => {
    if (t === null) delete (window as any).mockFs[p as string];
    else (window as any).mockFs[p as string] = t;
  }, [path, text] as const);

/** Opens Settings › Vault › Maintenance and the conversion wizard from its OKF card. */
async function openWizard(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-open-sync-settings', { detail: { area: 'maintenance' } })));
  const card = page.getByTestId('settings-okf');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole('button', { name: 'Start conversion…' }).click();
}

test('convert with "rename", continue the interrupted run, undo: no note converted twice, no edit lost', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('A', { exact: true }).first()).toBeVisible({ timeout: 10000 });

  // First pass: type Memo, existing types renamed.
  await openWizard(page);
  const dialog = page.getByRole('dialog', { name: 'Convert to OKF format' });
  // Four notes are checked; the conflict copy beside D is not (§ 3.87 Nr. 17 a).
  await expect(dialog).toContainText('4 markdown files checked', { timeout: 10000 });
  await expect(dialog).toContainText('3 file(s) without a valid type field');
  const typeField = dialog.getByRole('textbox').first();
  await typeField.fill('Memo');
  await dialog.getByRole('radio').nth(1).check();
  await dialog.getByRole('button', { name: 'Preview (no changes)' }).click();
  await dialog.getByRole('button', { name: /^Convert \d+ file\(s\)$/ }).click();
  await expect(dialog).toContainText('Conversion finished.', { timeout: 15000 });

  const converted = { A: await file(page, '/test-vault/A.md'), B: await file(page, '/test-vault/B.md') };
  expect(converted.A).toContain('type: Memo');
  expect(converted.B).toContain('type_original: Person');
  const backupDir = await page.evaluate(() =>
    Object.keys((window as any).mockFs).find((p) => /\/\.plainva\/backups\/okf-conversion-[^/]+\/A\.md$/.test(p))!.replace(/\/A\.md$/, ''),
  );
  expect(await file(page, `${backupDir}/A.md`)).toBe('# A\n');

  // The run as a kill would have left it: C never reached, the journal still
  // on disk — and the app started again.
  await set(page, '/test-vault/C.md', '# C\n');
  await set(page, `${backupDir}/C.md`, null);
  await page.evaluate(() => {
    const j = (window as any).__okfJournal;
    (window as any).mockFs[j.path] = j.contents;
    sessionStorage.setItem('okf-e2e-fs', JSON.stringify((window as any).mockFs));
  });
  await page.reload();

  // The start-up notice leads to the open run, never to a fresh start.
  await page.getByRole('button', { name: 'Take a look' }).click({ timeout: 15000 });
  await expect(page.getByTestId('okf-pending-run')).toBeVisible({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toContainText('Conversion finished.', { timeout: 15000 });
  await expect(dialog).toContainText('1 file(s) changed');

  // Converted once: the first pass's notes are untouched, C with the run's options, the originals still in the one backup folder.
  expect(await file(page, '/test-vault/A.md')).toBe(converted.A);
  expect(await file(page, '/test-vault/B.md')).toBe(converted.B);
  expect(await file(page, '/test-vault/C.md')).toContain('type: Memo');
  expect(await file(page, `${backupDir}/A.md`)).toBe('# A\n');
  expect(await file(page, `${backupDir}/B.md`)).toBe(PERSON);
  const folders = await page.evaluate(() =>
    new Set(Object.keys((window as any).mockFs).filter((p) => p.includes('/.plainva/backups/okf-conversion-')).map((p) => p.split('/').slice(0, 5).join('/'))).size,
  );
  expect(folders).toBe(1);

  // D is edited after the run; the undo leaves it and says so.
  const edited = `${await file(page, '/test-vault/D.md')}A line written after the run.\n`;
  await set(page, '/test-vault/D.md', edited);
  await dialog.getByRole('button', { name: 'Undo the conversion' }).click();
  await expect(page.getByText('3 file(s) restored.')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/1 file\(s\) changed after the conversion and were left as they are/)).toBeVisible();

  expect(await file(page, '/test-vault/A.md')).toBe('# A\n');
  expect(await file(page, '/test-vault/B.md')).toBe(PERSON);
  expect(await file(page, '/test-vault/C.md')).toBe('# C\n');
  expect(await file(page, '/test-vault/D.md')).toBe(edited);

  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: 'test-results/okf-conversion-undo.png' });
});
