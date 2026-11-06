/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// D1 of the data-safety plan of 2026-11-06, on the desktop: a vault on a
// share without a trash. A deletion snapshots every file that goes before it
// deletes for good; where that fails too (a full disk), it asks "Delete
// without a backup?" — "Cancel" keeps the item, only "Delete anyway" deletes.
// The mock is the backup suite's (backup.spec.ts), with a trash that refuses
// and snapshots that fail on demand.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/.plainva/backups': { isDir: true },
      '/test-vault/Doc.md': '# Doc\n\nThe text of the doc.',
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
      '/test-vault/Archiv': { isDir: true },
      '/test-vault/Archiv/R-0412.md': '# R-0412',
      '/test-vault/Archiv/Scan.md': '# Scan',
    };
    // Enough other notes that deleting the folder is no "large deletion" with a prompt of its own.
    (window as any).mockFs['/test-vault/Notes'] = { isDir: true };
    for (let i = 0; i < 20; i++) (window as any).mockFs['/test-vault/Notes/N' + i + '.md'] = '# N' + i;
    // The share the vault lies on: no trash (`move_to_trash` below), and
    // while this is set, no snapshot can be written either — a full disk.
    (window as any).__backupsFail = false;
    (window as any).__zipCalls = [];
    (window as any).__zipShouldFail = false;

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
        if (cmd === 'plugin:path|resolve_directory') {
          return '/appdata';
        }

        if (cmd === 'plugin:store|load') return 1;
        // The version the marker above is compared against. Without it the
        // command falls through to `null` and every start looks like an update.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          // Stage D remounts `App` when the shown vault arrives, which is when
          // the release dialog finally gets a vault to render over. A marker
          // equal to the running version means "already seen" - this suite
          // tests the app, not its first five seconds (onboarding.spec covers
          // those on purpose).
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
        if (cmd === 'plugin:store|save') return null;

        // The save dialog of the vault export answers with the path a test set.
        if (cmd === 'plugin:dialog|save') {
          (window as any).__saveArgs = args;
          return (window as any).__savePath ?? null;
        }
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
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && !p.startsWith('/test-vault/.plainva'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
          }
          return [];
        }

        if (cmd === 'create_vault_zip') {
          (window as any).__zipCalls.push(args);
          await new Promise(r => setTimeout(r, 400));
          if ((window as any).__zipShouldFail) throw new Error('Zielordner nicht erreichbar');
          return { zip_path: args.destPath, file_count: 2, total_bytes: 42, skipped: [] };
        }
        if (cmd === 'move_to_trash') {
          throw new Error('the network share has no recycle bin');
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
          // Both spellings: the backup adapter asks the file's kind before a deletion (D1).
          return { isDir: !!file.isDir, isFile: !file.isDir, isDirectory: !!file.isDir, isSymlink: false, mtime: Date.now(), size: typeof file === 'string' ? file.length : 0 };
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
          if ((window as any).__backupsFail && rel.startsWith('.plainva/backups/')) throw new Error('No space left on device (os error 28)');
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
        if (cmd === 'plugin:fs|remove') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          for (const key of Object.keys(fs)) {
            if (key === p || key.startsWith(p + '/')) delete fs[key];
          }
          return null;
        }
        if (cmd === 'plugin:fs|mkdir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          fs[p] = { isDir: true };
          return null;
        }
        if (cmd === 'plugin:fs|rename') {
          const oldP = args.oldPath.endsWith('/') ? args.oldPath.slice(0, -1) : args.oldPath;
          const newP = args.newPath.endsWith('/') ? args.newPath.slice(0, -1) : args.newPath;
          for (const key of Object.keys(fs)) {
            if (key === oldP || key.startsWith(oldP + '/')) {
              const target = newP + key.substring(oldP.length);
              fs[target] = fs[key];
              delete fs[key];
            }
          }
          return null;
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        if (cmd === 'plugin:opener|open_path' || cmd === 'plugin:opener|open_url') return null;

        return null;
      },
    };
  });
});


const mockFile = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).mockFs[p] as string | undefined, path);
const snapshotsOf = (page: Page, prefix: string) =>
  page.evaluate((p) => Object.keys((window as any).mockFs).filter((k) => k.startsWith(p)), prefix);

async function openVault(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('file-tree').getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
}

async function deleteViaTree(page: Page, name: string) {
  await page.getByTestId('file-tree').getByText(name, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(Löschen|Delete)$/ }).click();
  // The ordinary confirmation of a deletion comes first, as always.
  await page.getByRole('button', { name: /^(Löschen|Delete)$/ }).click();
}

test('with the trash refused, the file is snapshotted and deleted for good — nobody is asked', async ({ page }) => {
  await openVault(page);
  await deleteViaTree(page, 'Welcome');
  await expect.poll(() => mockFile(page, '/test-vault/Welcome.md')).toBeUndefined();
  expect(await snapshotsOf(page, '/test-vault/.plainva/backups/Welcome.md.')).toHaveLength(1);
  await expect(page.getByText(/Delete without a backup\?|Ohne Sicherung löschen\?/)).toHaveCount(0);
});

test('where the snapshot fails too, it asks; "Cancel" keeps the file, "Delete anyway" deletes it', async ({ page }, testInfo) => {
  await openVault(page);
  await page.evaluate(() => { (window as any).__backupsFail = true; });
  await deleteViaTree(page, 'Welcome');

  const question = page.getByRole('dialog').filter({ hasText: /Delete without a backup\?|Ohne Sicherung löschen\?/ });
  await expect(question).toBeVisible();
  await expect(question).toContainText('Welcome.md');
  await expect(question).toContainText(/network drive|Netzlaufwerk/);
  // Cancel is the preselected answer.
  await expect(question.getByRole('button', { name: /^(Cancel|Abbrechen)$/ })).toBeFocused();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('delete-without-backup-desktop.png') });
  await question.getByRole('button', { name: /^(Cancel|Abbrechen)$/ }).click();
  await expect(question).toHaveCount(0);
  expect(await mockFile(page, '/test-vault/Welcome.md')).toBeTruthy();

  await deleteViaTree(page, 'Welcome');
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: /^(Delete anyway|Trotzdem löschen)$/ }).click();
  await expect.poll(() => mockFile(page, '/test-vault/Welcome.md')).toBeUndefined();
});

test('a folder names the files it could not keep', async ({ page }, testInfo) => {
  await openVault(page);
  await page.evaluate(() => { (window as any).__backupsFail = true; });
  await deleteViaTree(page, 'Archiv');

  const question = page.getByRole('dialog').filter({ hasText: /Delete without a backup\?|Ohne Sicherung löschen\?/ });
  await expect(question).toBeVisible();
  await expect(question).toContainText('Archiv/R-0412.md');
  await expect(question).toContainText('Archiv/Scan.md');
  await expect(question).toContainText(/2 of the 2 files|2 der 2 Dateien/);
  // The photo after the dialog's fade-in, not during it.
  if (process.env.PLAINVA_EVIDENCE) { await page.waitForTimeout(600); await page.screenshot({ path: testInfo.outputPath('delete-folder-without-backup-desktop.png') }); }
  await question.getByRole('button', { name: /^(Cancel|Abbrechen)$/ }).click();
  expect(await mockFile(page, '/test-vault/Archiv/Scan.md')).toBeTruthy();
});
