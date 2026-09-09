/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect, type Page } from '@playwright/test';

/**
 * Comments and suggestions in a vault WITHOUT an encrypted workspace
 * (Nachschaerfung, N5) - the first end-to-end run the feature ever had.
 *
 * The mock file system below is the smoke spec's, byte for byte: a plain
 * vault, one note, no keyfile, no sync. Everything the column does here goes
 * through the real store: the bundle lands in `.plainva/sync/` as this
 * device's own file, a rename leaves a move marker, a second device's file
 * dropped into the folder is read on the next "changed" signal, and a broken
 * file is set aside rather than overwritten.
 *
 * Until N0 the desktop never showed the column in a plain vault at all
 * (finding 2026-09-07): the first test is that finding, turned into a guard.
 */

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    /** The version the app reports here; the seen-marker matches it. */
    (window as any).__E2E_APP_VERSION = '9.9.9';
    // Simple in-memory file system mock
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': "# Hello\nWelcome to the mock vault!"
    };

    (window as any).__TAURI_INTERNALS__ = {
      plugins: {
        path: { sep: '/' }
      },
      transformCallback: (callback: any) => {
        // Return a dummy channel id
        return 1;
      },
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;
        
        // --- PATH PLUGIN ---
        if (cmd === 'plugin:path|normalize') {
          // crude normalize mock
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') {
          return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        }
        
        // --- STORE PLUGIN ---
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ["/test-vault", true];
          if (args.key === 'recentVaults') return [["/test-vault"], true];
          // The splash is the default entry since 2026-07-04 — the suite keeps
          // the old auto-open behavior via the (now opt-in) setting.
          if (args.key === 'autoOpenLastVault') return [true, true];
          // The OKF offer must not interfere with the scenarios. It is a toast
          // now rather than the dialog that used to open by itself (P4.1) —
          // `__E2E_OKF_OFFER` lets the one test that WANTS it turn it back on.
          if (String(args.key || '').startsWith('okfPromptDismissed_')) {
            return [(window as any).__E2E_OKF_OFFER ? null : true, true];
          }
          // Neither must the release dialogs: a marker equal to the running
          // version means "already seen". Both are covered on purpose in
          // onboarding.spec.ts — this suite tests the app, not its first
          // five seconds. (Before the StrictMode fix they never appeared at
          // all, which is why no mock needed this.)
          if (args.key === 'whatsNewSeenVersion') return [(window as any).__E2E_APP_VERSION, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          // Everything else comes from a real in-memory store, so a test can
          // seed a setting AND a feature can persist one. Before this the mock
          // answered every unknown key with "unset" and swallowed every write,
          // which made round-trips through the settings surface untestable.
          const store = ((window as any).__E2E_STORE_SEED ??= {});
          if (Object.prototype.hasOwnProperty.call(store, args.key)) return [store[args.key], true];
          return [null, false];
        }
        if (cmd === 'plugin:app|version') return (window as any).__E2E_APP_VERSION;
        if (cmd === 'plugin:store|set') {
          ((window as any).__E2E_STORE_SEED ??= {})[args.key] = args.value;
          return null;
        }
        if (cmd === 'plugin:store|save') return null;

        // --- DIALOG PLUGIN --- plugin-dialog v2 routes ask()/confirm() through
        // the message command and compares the pressed button label ('Yes'/'Ok').
        if (cmd === 'plugin:dialog|ask') return true;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') {
          return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        }
        
        // --- SQL PLUGIN ---
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
           const q = String(args.query);
           // listBases(): inline `LIKE '%.base'` with no bind values — must
           // come before the generic LIKE branch (whose empty needle would
           // return EVERY file as a database).
           if (q.includes("WHERE path LIKE '%.base'")) {
             return Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && p.endsWith('.base'))
               .map(p => ({ path: p.replace('/test-vault/', ''), title: null }));
           }
           // Wiki-link resolution (Editor.openWikiTarget): exact title or path,
           // with `.md` appended as the third candidate. Without this branch the
           // mock answered every link with "no such note", which sent the app
           // down the create-a-note path — so a test could never see what
           // clicking an existing link does.
           if (q.includes('SELECT path FROM files') && q.includes('title = ?')) {
             const [needle, , withMd] = (args.values ?? []).map((v: any) => String(v).toLowerCase());
             const hit = Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
               .map(p => p.replace('/test-vault/', ''))
               .find(rel => {
                 const base = rel.split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
                 return base === needle || rel.toLowerCase() === needle || rel.toLowerCase() === withMd;
               });
             return hit ? [{ path: hit }] : [];
           }
           // Conflict lookup of the sync-error dialog (P3.11): LIKE over paths.
           if (q.includes('WHERE path LIKE')) {
             const pattern = String(args.values?.[0] ?? '');
             const needle = pattern.replace(/%/g, '');
             return Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && p.includes(needle))
               .map(p => ({ path: p.replace('/test-vault/', '') }));
           }
           // The tree listing and the index.md generator queries share one
           // row shape (path/title/mode) derived from the mock fs.
           if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
             const result = Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
               .map(p => {
                 const relativePath = p.replace('/test-vault/', '');
                 const isNote = /\.(md|base)$/i.test(relativePath);
                 // Title mirrors the real indexer: basename without extension.
                 return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
               });
             return result;
           }
           // The vault-wide search (findInVault) and the tag rename read the
           // FTS table: every note with its content, straight from the mock fs.
           if (q.includes('FROM fts_notes')) {
             return Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && /\.md$/i.test(p) && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
               .map(p => {
                 const rel = p.replace('/test-vault/', '');
                 return { path: rel, title: rel.split('/').pop()!.replace(/\.md$/i, ''), content: typeof fs[p] === 'string' ? fs[p] : '' };
               });
           }
           return [];
        }
        
        // --- FS PLUGIN ---
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error("File not found");
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || "");
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error("File not found");
          
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || "");
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
        if (cmd === 'plugin:fs|remove' || cmd === 'move_to_trash') {
          const raw = (args?.path ?? args?.paths?.[0] ?? '') as string;
          const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
          for (const key of Object.keys(fs)) {
            if (key === p || key.startsWith(p + '/')) delete fs[key];
          }
          return null;
        }
        if (cmd === 'plugin:fs|rename') {
          const from = (args.oldPath as string).replace(/\/$/, '');
          const to = (args.newPath as string).replace(/\/$/, '');
          for (const key of Object.keys(fs)) {
            if (key === from || key.startsWith(from + '/')) {
              fs[to + key.slice(from.length)] = fs[key];
              delete fs[key];
            }
          }
          return null;
        }

        return null;
      }
    };
  });
});

/** This device's own bundle in the mock, found by its shape - the id is minted at runtime. */
const ownFile = (page: Page) => page.evaluate(() => Object.keys((window as any).mockFs).find((p) => /^\/test-vault\/\.plainva\/sync\/comments\.[^.]+\.json$/.test(p) && !p.includes('.broken-')) as string);

async function openWelcome(page: Page) {
  // The sideband folder exists in a real vault; the mock only knows files, and
  // a listing of a folder that "does not exist" is empty - which would hide
  // every foreign file from the store.
  await page.addInitScript(() => { (window as any).mockFs['/test-vault/.plainva/sync'] = { isDir: true }; });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();
}

async function openColumn(page: Page) {
  const toggle = page.getByTestId('editor-comments-toggle');
  await expect(toggle, 'the comments toggle exists in a plain vault (N0)').toBeVisible({ timeout: 10000 });
  const column = page.locator('aside.pv-comment-column');
  if (!(await column.isVisible())) await toggle.click();
  await expect(column).toBeVisible();
  return column;
}

async function postComment(page: Page, column: ReturnType<Page['locator']>, text: string) {
  const box = column.locator('.pv-comment-compose--new textarea');
  await box.fill(text);
  await column.locator('.pv-comment-compose--new button', { hasText: /Send|Senden/ }).click();
  await expect(column.locator('.pv-comment-card__body', { hasText: text })).toBeVisible();
}

test('a plain vault has the column: a comment is written, answered and resolved, and lands in this device\'s own file', async ({ page }) => {
  await openWelcome(page);
  const column = await openColumn(page);
  await postComment(page, column, 'so far so good');

  // On disk, in the sideband folder, as ONE file for this device (N2).
  const own = await ownFile(page);
  expect(own, 'the bundle is this device\'s own file').toMatch(/comments\.[^.]+\.json$/);
  const bundle = await page.evaluate((path) => JSON.parse((window as any).mockFs[path]), own);
  expect(Object.values(bundle.comments).map((c: any) => c.body)).toEqual(['so far so good']);
  expect(Object.values(bundle.comments).map((c: any) => c.path)).toEqual(['Welcome.md']);
  // The legacy single file is never written again.
  const legacy = await page.evaluate(() => (window as any).mockFs['/test-vault/.plainva/sync/comments.json']);
  expect(legacy).toBeUndefined();

  // A reply joins the thread, resolving closes it (the card leaves the "open" filter).
  const card = column.locator('.pv-comment-card').first();
  await card.hover();
  await card.getByRole('button', { name: /Reply|Antworten/ }).click();
  const replyBox = column.locator('.pv-comment-compose textarea').last();
  await replyBox.fill('and one more thing');
  await column.locator('.pv-comment-compose button', { hasText: /Send|Senden/ }).last().click();
  await expect(column.locator('.pv-comment-card__body', { hasText: 'and one more thing' })).toBeVisible();
  await card.hover();
  await card.getByRole('button', { name: /^(Resolve|Erledigen)$/ }).first().click();
  await expect(column.locator('.pv-comment-card__body', { hasText: 'so far so good' })).toHaveCount(0);
});

test('a renamed note keeps its remarks (N1)', async ({ page }) => {
  await openWelcome(page);
  const column = await openColumn(page);
  await postComment(page, column, 'follows the rename');

  // Rename through the tree: right-click, "Rename", type, Enter.
  await page.getByTestId('file-tree').getByText('Welcome', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Rename|Umbenennen/ }).click();
  const input = page.locator('form input.pv-field--compact');
  await expect(input).toBeVisible();
  await input.fill('Roadmap');
  await input.press('Enter');
  await expect(page.getByTestId('file-tree').getByText('Roadmap', { exact: true })).toBeVisible({ timeout: 10000 });

  // The marker is in the bundle, and the column of the renamed note lists the remark.
  const own = await ownFile(page);
  const bundle = await page.evaluate((path) => JSON.parse((window as any).mockFs[path]), own);
  const moves = Object.values(bundle.moves ?? {}) as any[];
  expect(moves.map((m) => [m.from, m.to])).toEqual([['Welcome.md', 'Roadmap.md']]);
  await page.getByTestId('file-tree').getByText('Roadmap', { exact: true }).click();
  const after = await openColumn(page);
  await expect(after.locator('.pv-comment-card__body', { hasText: 'follows the rename' })).toBeVisible({ timeout: 10000 });
});

test('another device\'s file dropped into the folder is read on the next signal, and never written (N2)', async ({ page }) => {
  await openWelcome(page);
  const column = await openColumn(page);
  await postComment(page, column, 'mine');

  const phoneFile = JSON.stringify({
    format: 'plainva-comments', version: 1, updatedAt: '2026-09-07T10:00:00Z',
    comments: { ['ab'.repeat(16)]: { commentId: 'ab'.repeat(16), path: 'Welcome.md', parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null, authorDeviceId: 'phone', body: 'from the phone', anchor: null, suggestion: null, createdAt: '2026-09-07T10:00:00Z' } },
    authors: { phone: { name: 'Phone', updatedAt: '2026-09-07T10:00:00Z' } },
  });
  await page.evaluate((text) => {
    (window as any).mockFs['/test-vault/.plainva/sync/comments.phone.json'] = text;
    // What the watcher or the sync cycle would say: every note, re-read.
    window.dispatchEvent(new CustomEvent('plainva-workspace-comments-changed', { detail: { path: '*' } }));
  }, phoneFile);
  await expect(column.locator('.pv-comment-card__body', { hasText: 'from the phone' })).toBeVisible({ timeout: 10000 });
  await expect(column.locator('.pv-comment-card', { hasText: 'from the phone' })).toContainText('Phone');

  // Posting here writes only this device's file; the phone's stays byte for byte.
  await postComment(page, column, 'mine again');
  const untouched = await page.evaluate(() => (window as any).mockFs['/test-vault/.plainva/sync/comments.phone.json']);
  expect(untouched).toBe(phoneFile);
});

test('a broken own file is set aside and reported, never overwritten (N3)', async ({ page }) => {
  await openWelcome(page);
  const column = await openColumn(page);
  await postComment(page, column, 'before the damage');
  const own = await ownFile(page);

  await page.evaluate((path) => {
    (window as any).mockFs[path] = '{ this is not json';
    window.dispatchEvent(new CustomEvent('plainva-workspace-comments-changed', { detail: { path: '*' } }));
  }, own);
  // The column explains what happened, with the reason.
  await expect(page.locator('.pv-toast, [role="status"], [role="alert"]').filter({ hasText: /could not be read|konnte nicht gelesen werden/ }).first()).toBeVisible({ timeout: 10000 });
  const files = await page.evaluate(() => Object.keys((window as any).mockFs).filter((p) => p.includes('/.plainva/sync/comments.')));
  const aside = files.find((p) => p.includes('.broken-'));
  expect(aside, 'the broken file was set aside').toBeTruthy();
  const bytes = await page.evaluate((path) => (window as any).mockFs[path], aside!);
  expect(bytes).toBe('{ this is not json');
  // ...and this device keeps writing, into a fresh file.
  await postComment(page, column, 'after the damage');
  const fresh = await ownFile(page);
  const bundle = await page.evaluate((path) => JSON.parse((window as any).mockFs[path]), fresh);
  expect(Object.values(bundle.comments).map((c: any) => c.body)).toEqual(['after the damage']);
});

test('a suggestion round is sent from the editor, accepted in the column, and the note changes exactly once (N5)', async ({ page }) => {
  await openWelcome(page);
  const column = await openColumn(page);

  // Suggest mode: typing changes a COPY; the band counts the changed blocks.
  await page.getByTestId('editor-suggest-mode').click();
  await expect(page.getByTestId('suggest-band')).toBeVisible();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' plus');
  const send = page.getByTestId('suggest-send');
  await expect(send).toBeEnabled({ timeout: 10000 });
  // The file itself is untouched while the mode is on.
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Welcome.md'])).toBe("# Hello\nWelcome to the mock vault!");
  await send.click();
  await expect(page.getByTestId('suggest-band')).toHaveCount(0);

  // The round lands under "Suggestions"; accepting writes the passage.
  await page.getByTestId('comment-kind-suggestions').click();
  const card = column.locator('.pv-comment-card').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.hover();
  await card.getByRole('button', { name: /^(Accept|Übernehmen)$/ }).first().click();
  await expect.poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/Welcome.md']), { timeout: 10000 }).toContain('Welcome to the mock vault! plus');

  // ...as one ordinary change: exactly one version was kept, and the
  // proposal is closed as applied in this device's own file.
  const backups = await page.evaluate(() => Object.keys((window as any).mockFs).filter((p) => p.startsWith('/test-vault/.plainva/backups/') && p.includes('Welcome')));
  expect(backups, 'one snapshot for the one write').toHaveLength(1);
  const own = await ownFile(page);
  const bundle = await page.evaluate((path) => JSON.parse((window as any).mockFs[path]), own);
  const records = Object.values(bundle.comments) as any[];
  expect(records.filter((r) => r.suggestion).map((r) => r.suggestion.replacement)).toEqual([expect.stringContaining('plus')]);
  expect(records.filter((r) => r.resolvedCommentId).map((r) => r.suggestionOutcome)).toEqual(['applied']);
});
