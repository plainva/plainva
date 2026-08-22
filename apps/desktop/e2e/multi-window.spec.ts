/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Popping a note out into its own window (multi-window P1).
 *
 * The dev server has one browser window, so what can be proven here is the part
 * that decides everything else: that the app asks for a window with the right
 * URL, and that the tab the note came from is GONE afterwards. The second half
 * is the whole dedup rule (plan E2) - a note left behind in a tab while a window
 * shows it is exactly the duplicate the design forbids, and it is the failure a
 * unit test of the routing alone would never see.
 *
 * The real second OS window is a maintainer check; the aux SHELL is covered by
 * the production smoke, which loads ?win=aux against the real bundle.
 *
 * The mock backend is the one from tasks.spec.ts (the leanest harness that
 * actually boots a vault), plus a recorder for the webview-create command.
 */
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
      '/test-vault/Second.md': '# Second\nAnother note.',
    };
    const fs = (window as any).mockFs;
    fs.__fts = {};
    fs.__taskIndexWrites = 0;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          const isMd = /\.md$/i.test(rel);
          return { path: rel, title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''), mode: isMd ? 'obsidian' : 'attachment', mtime_local: 1000, ctime: 500 };
        });

    /** Every webview the app asked the backend to create. */
    (window as any).createdWindows = [] as Array<{ label: string; url: string }>;
    /** Every window the app asked the backend to bring forward. */
    (window as any).focusedWindows = [] as string[];

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        // The command behind `new WebviewWindow(...)`. Recording it is the
        // point of this spec: the URL carries the whole handover.
        if (cmd === 'plugin:webview|create_webview_window') {
          const opts = args?.options ?? {};
          (window as any).createdWindows.push({ label: opts.label, url: opts.url });
          return null;
        }
        // Focus routing has to be answerable, not just survivable: without a
        // window list `getByLabel` throws, the owner falls back to a tab, and
        // the dedup assertion would pass for the wrong reason.
        if (cmd === 'plugin:window|get_all_windows') {
          return (window as any).createdWindows.map((w: { label: string }) => w.label);
        }
        if (cmd === 'plugin:window|set_focus') {
          const label = (options?.headers?.['Tauri-Window-Label'] as string) ?? args?.label ?? 'unknown';
          (window as any).focusedWindows.push(label);
          return null;
        }
        if (String(cmd).startsWith('plugin:webview|') || String(cmd).startsWith('plugin:window|')) return null;
        if (String(cmd).startsWith('plugin:event|')) return 1;
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
          // Standard task database (PIM 1a): a test opts in by setting
          // fs.__taskDb in its own init script (not a vault path — ignored by
          // noteRows()).
          if (String(args.key || '').startsWith('taskDatabase_')) return fs.__taskDb ? [fs.__taskDb, true] : [null, false];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') {
          const q = String(args.query || '');
          if (q.includes('INSERT INTO fts_notes')) {
            const [content, _title, path] = args.values || [];
            fs.__fts[String(path)] = String(content);
            fs.__taskIndexWrites++;
          }
          return [0, 0];
        }
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          // PIM cache: opt-in per test via __pimAccounts, so the "block time"
          // action (which needs a writable calendar) stays out of every other
          // test's rows.
          if (q.includes('FROM pim_accounts')) return (window as any).__pimAccounts ?? [];
          if (q.includes('FROM pim_calendars')) return (window as any).__pimCalendars ?? [];
          if (q.includes('FROM pim_events') || q.includes('FROM pim_tasklists') || q.includes('FROM pim_tasks')) return [];
          if (q.includes('SELECT path, title, content FROM fts_notes')) {
            return noteRows()
              .filter((r) => r.mode !== 'attachment')
              .map((r) => ({ path: r.path, title: r.title, content: fs.__fts[r.path] ?? fs['/test-vault/' + r.path] }));
          }
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          // listBases(): inline `LIKE '%.base'` — must precede the generic
          // "SELECT path, title FROM files" (listNotes) branch below.
          if (q.includes("WHERE path LIKE '%.base'")) {
            return Object.keys(fs)
              .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && p.endsWith('.base'))
              .map((p) => ({ path: p.replace('/test-vault/', ''), title: null }));
          }
          // queryDatabaseFiles(): main row query (aliased `FROM files f`) with
          // the pushed-down folder source, then a bulk properties fetch keyed
          // by file id (the mock uses the relative path AS the id).
          if (q.includes('FROM files f')) {
            const pattern = String(args.values?.[0] ?? '');
            const prefix = pattern.replace(/%$/, '');
            return noteRows()
              .filter((r) => r.mode !== 'attachment' && (!prefix || r.path.startsWith(prefix)))
              .map((r) => ({ id: r.path, path: r.path, title: r.title, mtime_local: r.mtime_local, size_bytes: 1 }));
          }
          if (q.includes('FROM properties')) {
            const out: any[] = [];
            for (const rel of (args.values ?? []) as string[]) {
              const content = String(fs['/test-vault/' + rel] ?? '');
              const fm = content.match(/^---\n([\s\S]*?)\n---/);
              if (!fm) continue;
              const lines = fm[1].split('\n');
              for (let i = 0; i < lines.length; i++) {
                const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
                if (kv) {
                  out.push({ file_id: rel, key: kv[1], value: kv[2].replace(/^"|"$/g, ''), type: 'text' });
                  continue;
                }
                // A nested block (e.g. the `plainva` namespace) is stored by the
                // real indexer as ONE property holding JSON. Mirror that here so
                // readers of the namespace behave as they do against SQLite.
                const parent = lines[i].match(/^([A-Za-z_][\w-]*):\s*$/);
                if (!parent) continue;
                const nested: any = {};
                const stack: any[] = [{ indent: -1, obj: nested }];
                let j = i + 1;
                for (; j < lines.length; j++) {
                  const m = lines[j].match(/^(\s+)([A-Za-z_][\w-]*):\s*(.*)$/);
                  if (!m) break;
                  const indent = m[1].length;
                  while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
                  const target = stack[stack.length - 1].obj;
                  const raw = m[3].trim();
                  if (raw === '') {
                    const child = {};
                    target[m[2]] = child;
                    stack.push({ indent, obj: child });
                  } else {
                    const num = Number(raw);
                    target[m[2]] = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(num) && raw !== '' ? num : raw.replace(/^"|"$/g, '');
                  }
                }
                i = j - 1;
                out.push({ file_id: rel, key: parent[1], value: JSON.stringify(nested), type: 'text' });
              }
            }
            return out;
          }
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, mode: r.mode === 'obsidian' ? 'note' : r.mode }));
          }
          if (q.includes('SELECT path, title FROM files')) {
            return noteRows().filter((r) => r.mode !== 'attachment' && !r.path.endsWith('.base')).map((r) => ({ path: r.path, title: r.title }));
          }
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

async function openWelcome(page: any) {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByRole('tab').filter({ hasText: 'Welcome' })).toBeVisible();
}

/** What the owner asked the backend to open, once it has asked. */
async function createdWindow(page: any) {
  await expect
    .poll(async () => await page.evaluate(() => (window as any).createdWindows.length), { timeout: 10000 })
    .toBe(1);
  return await page.evaluate(() => (window as any).createdWindows[0]);
}

test('a tab pops out into its own window and leaves no copy behind', async ({ page }) => {
  await openWelcome(page);
  const tab = page.getByRole('tab').filter({ hasText: 'Welcome' });

  await tab.click({ button: 'right' });
  const entry = page.getByRole('menuitem', { name: /In neuem Fenster|Open in new window/ });
  await expect(entry).toBeVisible();
  await entry.click();

  // The window is asked for with everything the aux shell needs: which vault to
  // open, which note to show, and a label the owner can address it by.
  const created = await createdWindow(page);
  expect(created.label).toMatch(/^aux-/);
  expect(created.url).toContain('win=aux');
  expect(created.url).toContain(encodeURIComponent('Welcome.md'));
  expect(created.url).toContain(encodeURIComponent('/test-vault'));
  expect(created.url).toContain(encodeURIComponent(created.label));

  // ...and the tab is gone. This is the dedup rule, not tidiness: the same note
  // in a tab AND a window means two editors on one file.
  await expect(tab).toHaveCount(0);
});

test('the editor menu offers the same popout', async ({ page }) => {
  await openWelcome(page);
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();

  await page.getByTestId('editor-menu-btn').click();
  await page.getByTestId('editor-menu-new-window').click();

  const created = await createdWindow(page);
  expect(created.url).toContain(encodeURIComponent('Welcome.md'));
  await expect(page.getByRole('tab').filter({ hasText: 'Welcome' })).toHaveCount(0);
});

/**
 * A singleton view in its own window (multi-window P2).
 *
 * The ribbon is where a view is opened, so it is also where it gets popped out.
 * What matters beyond the window itself: the ribbon must stop opening a TAB for
 * a view that already has a window — `focusOrOpenVirtual` only ever knew this
 * window's panes, and a second calendar next to the one on screen is the same
 * duplicate the design forbids for notes.
 */
test('a view pops out of the ribbon and the ribbon then focuses it instead of opening a tab', async ({ page }) => {
  await openWelcome(page);

  await page.getByTestId('ribbon-graph').click({ button: 'right' });
  await page.getByTestId('ribbon-menu-new-window').click();

  const created = await createdWindow(page);
  expect(created.url).toContain('win=aux');
  expect(created.url).toContain(encodeURIComponent('plainva://graph'));

  // The graph is now in a window. Clicking the ribbon again must bring THAT
  // window forward, not build a second graph here. Waiting for the focus first
  // matters: asserting "no tab" right after the click would pass before the
  // routing has even answered.
  await page.getByTestId('ribbon-graph').click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).focusedWindows.length), { timeout: 10000 })
    .toBeGreaterThan(0);
  await expect(page.getByRole('tab').filter({ hasText: /Graph/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).createdWindows.length)).toBe(1);
});

/**
 * The communications preset (P4/E4).
 *
 * "Mail beside the calendar" is the arrangement people asked for, and it is an
 * ORDINARY auxiliary window whose two panes start filled — not a window type of
 * its own. What matters here is that one request produces exactly one window and
 * that the preset travels in the URL, because the new window seeds its split
 * from that alone.
 */
test('the palette opens one window that starts with mail beside the calendar', async ({ page }) => {
  await openWelcome(page);

  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: /Kommunikations-Fenster|communications window/ }).click();

  const created = await createdWindow(page);
  expect(created.url).toContain('win=aux');
  expect(created.url).toContain('preset=mail-calendar');
  // The first pane doubles as the window's dedup identity.
  expect(created.url).toContain(encodeURIComponent('plainva://mail'));

  // One request, one window: a second communications window would be two mail
  // clients on one account.
  expect(await page.evaluate(() => (window as any).createdWindows.length)).toBe(1);
});
