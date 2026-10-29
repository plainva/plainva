/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Queries of the Tasks plugin (plan Tasks-Abfragen, T4/T5): a ```tasks block
 * drawn as a task list in the live preview and in the reading view, in a
 * callout too; a tick writes the task's own line (through the editor when it
 * stands in the same note); "Edit query" shows the text; hints and errors.
 * The mock fs and SQL of the Tasks view's suite (tasks.spec.ts).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Bahnhof Nord.md': '# Bahnhof Nord\n\nStand der Initiative.\n\n> [!todo] Offene Todos\n> ```tasks\n> not done\n> tags include #rettediebahn\n> show tree\n> sort by filename reverse\n> ```\n\n- [ ] Offene Todos sammeln #rettediebahn\n\nNächstes Treffen am Donnerstag.',
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Projekte/Bahn.md': '# Bahn-Projekt\n\n- [ ] Petition einreichen #rettediebahn 📅 2026-10-30 ⏫\n  - [ ] Unterschriften zählen\n  - [x] Text schreiben ✅ 2026-10-20\n- [x] Flyer drucken #rettediebahn ✅ 2026-10-25\n- [ ] Pressemitteilung #presse 📅 2026-11-05\n\n## Termine\n\n- [ ] Treffen mit Verband #rettediebahn ⏳ 2026-10-28',
      '/test-vault/Vorlagen': { isDir: true },
      '/test-vault/Vorlagen/Vorlage.md': '---\nplainva:\n  tasks: false\n---\n- [ ] Vorlage-Aufgabe #rettediebahn',
      '/test-vault/Woche.md': '# Woche\n\n```tasks\nis recurring\nfilter by function task.urgency > 8\n```\n\n```tasks\npath includes Routinen\n(not done) AND "is recurring"\n```\n\n- [ ] Bericht 🔁 every week 📅 2026-11-02',
      '/test-vault/Einbettung.md': '# Einbettung\n\n![[Bahnhof Nord]]\n',
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
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          // Standard task database (PIM 1a): a test opts in by setting
          // fs.__taskDb in its own init script (not a vault path — ignored by
          // noteRows()).
          if (String(args.key || '').startsWith('taskDatabase_')) return fs.__taskDb ? [fs.__taskDb, true] : [null, false];
          // The vault's day boundary (plan Journal-Erweiterungen, X2), minutes
          // after midnight. A test opts in with fs.__dayEndsAt.
          if (String(args.key || '').startsWith('dayEndsAt_')) return [fs.__dayEndsAt ?? 0, true];
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
          // `[[` and `#` in the capture fields (plan Befunde 2026-10-06, W5): the
          // note search of the suggestion list, and the vault's tags — a test
          // opts in to tags with fs.__tags.
          if (q.includes('AS is_attachment FROM files')) {
            const term = String((args.values || [])[0] || '').replace(/%/g, '').toLowerCase();
            return noteRows()
              .filter((r) => !r.path.endsWith('.base') && r.path.toLowerCase().includes(term))
              .map((r) => ({ path: r.path, title: r.mode === 'attachment' ? null : r.title, is_attachment: r.mode === 'attachment' ? 1 : 0 }));
          }
          if (q.includes('FROM tags') && q.includes('GROUP BY tag')) return fs.__tags ?? [];
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
          // getTaskAnchors(): the `plainva` namespace of every note, one JSON
          // row per file. Opt-in per test, and only for files that still exist —
          // so a removed copy drops out of the next query like it does in SQLite.
          if (q.includes('JOIN files f ON f.id = p.file_id')) {
            return ((window as any).__namespaceRows ?? []).filter((r: any) => fs['/test-vault/' + r.path] !== undefined);
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
        // The OS trash: the file is gone from the vault.
        if (cmd === 'move_to_trash') {
          delete fs[String(args.path)];
          return null;
        }
        return null;
      },
    };
  });
});

async function openNote(page: any, name: string) {
  await page.goto('/');
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 10000 });
}

const fileText = (page: any, path: string) => page.evaluate((p: string) => (window as any).mockFs['/test-vault/' + p], path);
const block = (page: any) => page.locator('.pv-tasksquery-live [data-testid="tasks-query"]').first();
const rowTitles = (scope: any) => scope.getByTestId('task-planner-row').allTextContents();

// The tester's case (iPhone, Build 136): a callout "Offene Todos" with a query.
// Obsidian shows the open tasks; Plainva showed four lines of code.
test('the tester\'s callout draws its tasks in the live preview, in the card, as a tree', async ({ page }, testInfo) => {
  await openNote(page, 'Bahnhof Nord');
  const live = page.locator('.pv-tasksquery-live').first();
  await expect(live).toBeVisible();
  // The block replaces the callout's last lines and carries its card.
  await expect(live).toHaveClass(/cm-callout/);
  await expect(page.locator('.cm-content').first()).not.toContainText('sort by filename reverse');
  const q = block(page);
  await expect(q.getByTestId('task-planner-row')).toHaveCount(6);
  const titles = await rowTitles(q);
  // By file name, reversed: Vorlage.md, Bahnhof Nord.md, Bahn.md; the subtasks under their task.
  const starts = ['Vorlage-Aufgabe', 'Offene Todos sammeln', 'Petition einreichen', 'Unterschriften zählen', 'Text schreiben', 'Treffen mit Verband'];
  expect(titles.map((t: string) => starts.find((s) => t.startsWith(s)) ?? t)).toEqual(starts);
  await expect(q.getByTestId('tasks-query-count')).toHaveText(/^(4 tasks|4 Aufgaben)$/);
  if (process.env.PLAINVA_EVIDENCE) {
    await live.screenshot({ path: testInfo.outputPath('tester-callout-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await live.screenshot({ path: testInfo.outputPath('tester-callout-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
  }
});

test('a tick on a task of another note writes that note\'s line', async ({ page }) => {
  await openNote(page, 'Bahnhof Nord');
  const q = block(page);
  const row = q.getByTestId('task-planner-row').filter({ hasText: 'Petition einreichen' });
  await row.getByTestId('task-planner-toggle').click();
  await expect.poll(() => fileText(page, 'Projekte/Bahn.md')).toMatch(/- \[x\] Petition einreichen #rettediebahn 📅 2026-10-30 ⏫ ✅ \d{4}-\d{2}-\d{2}/);
  // The note with the query is not written.
  expect(await fileText(page, 'Bahnhof Nord.md')).toContain('- [ ] Offene Todos sammeln');
});

test('a tick on a task of the same note goes through the editor and is saved', async ({ page }) => {
  await openNote(page, 'Bahnhof Nord');
  const q = block(page);
  await q.getByTestId('task-planner-row').filter({ hasText: 'Offene Todos sammeln' }).getByTestId('task-planner-toggle').click();
  // The ticked task leaves the list (`not done`) once the note is saved and indexed.
  await expect(block(page).getByTestId('task-planner-row').filter({ hasText: 'Offene Todos sammeln' })).toHaveCount(0);
  await expect.poll(() => fileText(page, 'Bahnhof Nord.md'), { timeout: 10000 }).toContain('- [x] Offene Todos sammeln');
  // The query itself is untouched.
  expect(await fileText(page, 'Bahnhof Nord.md')).toContain('> ```tasks\n> not done\n> tags include #rettediebahn');
});

test('"Edit query" shows the query as text with the caret in it; leaving shows the list again', async ({ page }) => {
  await openNote(page, 'Bahnhof Nord');
  await block(page).getByTestId('tasks-query-edit').click();
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('sort by filename reverse');
  await expect(page.locator('.pv-tasksquery-live')).toHaveCount(0);
  const caretLine = await page.evaluate(() => {
    const sel = window.getSelection();
    return sel?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '';
  });
  expect(caretLine).toContain('not done');
  await page.keyboard.press('Control+End');
  await expect(page.locator('.pv-tasksquery-live')).toHaveCount(1);
});

test('a line Plainva does not read is named above the list; one Tasks rejects too is an error', async ({ page }) => {
  await openNote(page, 'Woche');
  const blocks = page.locator('.pv-tasksquery-live [data-testid="tasks-query"]');
  await expect(blocks).toHaveCount(2);
  const hinted = blocks.nth(0);
  await expect(hinted.getByTestId('tasks-query-hint')).toContainText('filter by function');
  await expect(hinted.getByTestId('task-planner-row').first()).toBeVisible();
  const broken = blocks.nth(1);
  await expect(broken).toHaveAttribute('data-status', 'error');
  await expect(broken.getByTestId('tasks-query-error')).toContainText('(not done) AND "is recurring"');
  await expect(broken.getByTestId('task-planner-row')).toHaveCount(0);
  // The explanation is a switch away and changes nothing in the note.
  const before = await fileText(page, 'Woche.md');
  await hinted.getByTestId('tasks-query-explain-switch').click();
  await expect(hinted.getByTestId('tasks-query-explain')).toBeVisible();
  expect(await fileText(page, 'Woche.md')).toBe(before);
});

test('the row menu changes the task\'s due date, priority and state', async ({ page }) => {
  await openNote(page, 'Bahnhof Nord');
  const row = block(page).getByTestId('task-planner-row').filter({ hasText: 'Treffen mit Verband' });
  await row.click({ button: 'right' });
  await page.getByTestId('tasks-query-ctx-priority').click();
  await page.getByTestId('tasks-query-priority-1').click();
  await expect.poll(() => fileText(page, 'Projekte/Bahn.md')).toContain('- [ ] Treffen mit Verband #rettediebahn ⏫ ⏳ 2026-10-28');
  await block(page).getByTestId('task-planner-row').filter({ hasText: 'Treffen mit Verband' }).click({ button: 'right' });
  await page.getByTestId('tasks-query-ctx-state').click();
  await page.getByTestId('tasks-query-state-progress').click();
  await expect.poll(() => fileText(page, 'Projekte/Bahn.md')).toContain('- [/] Treffen mit Verband');
});

test('read mode draws the block too, in the callout card; an embedded note only to look at', async ({ page }, testInfo) => {
  await openNote(page, 'Bahnhof Nord');
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const reader = page.locator('.markdown-reader').first();
  const q = reader.locator('.pv-reader-callout [data-testid="tasks-query"]').first();
  await expect(q.getByTestId('task-planner-row')).toHaveCount(6);
  if (process.env.PLAINVA_EVIDENCE) {
    await reader.locator('.pv-reader-callout').first().screenshot({ path: testInfo.outputPath('tester-read-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await reader.locator('.pv-reader-callout').first().screenshot({ path: testInfo.outputPath('tester-read-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  // A tick in the reading view writes the task's own note.
  await q.getByTestId('task-planner-row').filter({ hasText: 'Treffen mit Verband' }).getByTestId('task-planner-toggle').click();
  await expect.poll(() => fileText(page, 'Projekte/Bahn.md')).toContain('- [x] Treffen mit Verband');
  // "Edit query" goes back to writing with the query as text.
  await q.getByTestId('tasks-query-edit').click();
  await expect(page.locator('.cm-content').first()).toContainText('show tree');

  // The note that embeds it: the list is there, the boxes do nothing.
  await page.getByText('Einbettung', { exact: true }).first().click();
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const embedded = page.locator('.markdown-reader .embedded-note [data-testid="tasks-query"]').first();
  await expect(embedded.getByTestId('task-planner-row').first()).toBeVisible();
  await expect(embedded.getByTestId('task-planner-toggle').first()).toBeDisabled();
  await expect(embedded.getByTestId('tasks-query-edit')).toHaveCount(0);
});
