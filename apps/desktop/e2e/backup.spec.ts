/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// E2E for the backups & versioning plan (Gesamtplan Backups & Versionierung
// 2026-07-05): version-history modal roundtrip (list -> diff -> restore, incl.
// the editor flush/adopt handshake), deleted-files recovery, and the settings
// "Back up now" flow driving the status-bar states against a mocked
// create_vault_zip command.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/.plainva/backups': { isDir: true },
      '/test-vault/.plainva/backups/Doc.md.1751700000000.bak': '# Doc\n\nalte Fassung eins',
      '/test-vault/.plainva/backups/Doc.md.1751700500000.bak': '# Doc\n\nalte Fassung zwei',
      '/test-vault/.plainva/backups/sub': { isDir: true },
      '/test-vault/.plainva/backups/sub/Gone.md.1751700000000.bak': '# Gone\n\ngeloeschter Inhalt',
      '/test-vault/Doc.md': '# Doc\n\naktuelle Fassung',
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
    };
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
          throw new Error('no trash in mock'); // adapter falls back to plugin:fs|remove
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

async function openVault(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Doc', { exact: true })).toBeVisible({ timeout: 10000 });
}

const mockFile = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).mockFs[p] as string | undefined, path);

test('version history lists snapshots, shows a diff and restores an older version', async ({ page }) => {
  await openVault(page);

  // Open the file first so the editor participates in the flush/adopt handshake.
  const treeItem = page.getByTestId('file-tree').getByText('Doc', { exact: true });
  await treeItem.click();
  await expect(page.locator('.cm-content').first()).toContainText('aktuelle Fassung', { timeout: 10000 });

  await treeItem.click({ button: 'right' });
  await page.getByTestId('tree-version-history').click();

  const modal = page.getByTestId('version-history-modal');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('version-item')).toHaveCount(2);
  // Newest first: the diff view (default for text files) is mounted.
  await expect(page.getByTestId('version-diff-host')).toBeVisible();
  await expect(page.getByTestId('version-diff-host')).toContainText('alte Fassung zwei');
  // The rule (P2): LEFT is what the note holds now, RIGHT is the saved version.
  await expect(page.locator('.pv-merge-host .cm-merge-a')).toContainText('aktuelle Fassung');
  await expect(page.locator('.pv-merge-host .cm-merge-b')).toContainText('alte Fassung zwei');
  // D5: the comparison scrolls inside the merge view, not nowhere.
  expect(await page.locator('.pv-merge-host .cm-mergeView').evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);

  // Pick the OLDER snapshot and restore it (confirmed via the in-app dialog,
  // plan Designsprache P3). The fixture timestamps are deliberately over-age
  // (>90 days): the forced pre-restore backup must not prune the snapshot
  // before it is read (regression).
  await page.getByTestId('version-item').nth(1).click();
  await expect(page.getByTestId('version-diff-host')).toContainText('alte Fassung eins');
  await page.getByTestId('version-restore').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').click();

  await expect(modal).not.toBeVisible({ timeout: 10000 });
  // The editor adopted the restored content (dirty guard bypassed via plainva-file-restored)...
  await expect(page.locator('.cm-content').first()).toContainText('alte Fassung eins', { timeout: 10000 });
  // ...and the write went through the full chain to "disk".
  expect(await mockFile(page, '/test-vault/Doc.md')).toContain('alte Fassung eins');
  // The pre-restore state was itself snapshotted (forceBackup before restore).
  const snapshotOfCurrent = await page.evaluate(() => {
    const fs = (window as any).mockFs as Record<string, unknown>;
    return Object.keys(fs).some(
      (k) => /^\/test-vault\/\.plainva\/backups\/Doc\.md\.\d+\.bak$/.test(k) && String(fs[k]).includes('aktuelle Fassung')
    );
  });
  expect(snapshotOfCurrent).toBe(true);
});

test('deleted files can be restored from their snapshots', async ({ page }) => {
  await openVault(page);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-show-deleted-files')));
  const modal = page.getByTestId('deleted-files-modal');
  await expect(modal).toBeVisible();

  const row = page.getByTestId('deleted-file-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('sub/Gone.md');

  await page.getByTestId('deleted-file-restore').click();
  await expect(page.getByTestId('deleted-file-row')).toHaveCount(0);
  expect(await mockFile(page, '/test-vault/sub/Gone.md')).toContain('geloeschter Inhalt');
});

test('settings "Back up now" drives the status bar through running and done', async ({ page }) => {
  await openVault(page);

  // Pages redesign: the deep link carries the target area (backup page).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-open-sync-settings', { detail: { area: 'backup' } })));
  await expect(page.getByTestId('backup-zip-enabled')).toBeVisible({ timeout: 10000 });

  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('statusbar-backup-running')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('statusbar-backup-done')).toBeVisible({ timeout: 10000 });

  const zipCalls = await page.evaluate(() => (window as any).__zipCalls as any[]);
  expect(zipCalls.length).toBe(1);
  expect(String(zipCalls[0].vaultPath)).toBe('/test-vault');
  expect(String(zipCalls[0].destPath)).toMatch(/^\/appdata\/backups\/test-vault-[0-9a-f]{8}\/test-vault_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
  expect(zipCalls[0].excludeDirNames).toContain('.plainva');
});

test('a failing backup shows the warning state that opens the settings', async ({ page }) => {
  await openVault(page);
  await page.evaluate(() => { (window as any).__zipShouldFail = true; });

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-backup-now', { detail: { vaultPath: '/test-vault' } })));
  const errorChip = page.getByTestId('statusbar-backup-error');
  await expect(errorChip).toBeVisible({ timeout: 10000 });

  await errorChip.click();
  await expect(page.getByTestId('backup-zip-enabled')).toBeVisible({ timeout: 10000 });
});

// ---- the comparison surface for a sync conflict (feedback round 2026-09-01, P2)

const CONFLICT_PATH = '/test-vault/Doc.CONFLICT-2026-07-05T12-30-00-000Z.md';

async function openConflictCompare(page: Page) {
  await page.addInitScript((p) => {
    // No H1: the tree then shows the file name, which is what a user sees too.
    (window as any).mockFs[p] = 'Kopie von diesem Geraet\n\naktuelle Fassung';
  }, CONFLICT_PATH);
  await openVault(page);
  const copy = page.getByTestId('file-tree').getByText(/Doc\.CONFLICT-/);
  await expect(copy).toBeVisible();
  await copy.click({ button: 'right' });
  await page.getByTestId('tree-resolve-conflict').click();
  await expect(page.getByTestId('compare-modal')).toBeVisible();
  // The rule, pinned: LEFT is what the note holds, RIGHT is the copy.
  await expect(page.locator('.pv-merge-host .cm-merge-a')).toContainText('# Doc');
  await expect(page.locator('.pv-merge-host .cm-merge-b')).toContainText('Kopie von diesem Geraet');
  // The footer prices the decision before it is taken.
  await expect(page.getByTestId('compare-stats')).toContainText('+1');
}

test('conflict: the tree leads to the comparison, and taking the copy writes it into the note', async ({ page }) => {
  await openConflictCompare(page);
  await page.getByTestId('compare-adopt').click();
  // The confirmation names the decision; primary = take the copy.
  await page.locator('.pv-modal-footer button.pv-btn--primary').last().click();
  await expect(page.getByTestId('compare-modal')).not.toBeVisible({ timeout: 10000 });
  expect(await mockFile(page, '/test-vault/Doc.md')).toContain('Kopie von diesem Geraet');
  expect(await mockFile(page, CONFLICT_PATH)).toBeUndefined();
});

test('conflict: keeping both turns the copy into a sibling named by its time', async ({ page }) => {
  await openConflictCompare(page);
  await page.getByTestId('compare-keep-both').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').last().click();
  await expect(page.getByTestId('compare-modal')).not.toBeVisible({ timeout: 10000 });
  const files = await page.evaluate(() => Object.keys((window as any).mockFs));
  expect(files.find((f) => /\/test-vault\/Doc \(Version 2026-07-05 \d\d-30\)\.md$/.test(f)), files.join('\n')).toBeDefined();
  expect(await mockFile(page, CONFLICT_PATH)).toBeUndefined();
  expect(await mockFile(page, '/test-vault/Doc.md')).toContain('aktuelle Fassung');
});

test('conflict: the blind exits are gone from the context menu', async ({ page }) => {
  await page.addInitScript((p) => {
    (window as any).mockFs[p] = 'Kopie von diesem Geraet';
  }, CONFLICT_PATH);
  await openVault(page);
  await page.getByTestId('file-tree').getByText(/Doc\.CONFLICT-/).click({ button: 'right' });
  await expect(page.getByTestId('tree-resolve-conflict')).toBeVisible();
  await expect(page.getByText('Keep this Version')).toHaveCount(0);
  await expect(page.getByText('Discard Conflict')).toHaveCount(0);
});
