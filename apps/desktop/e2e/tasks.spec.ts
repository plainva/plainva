/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Vault-wide Tasks view E2E (B4): open the view from the ribbon, see checkboxes
 * aggregated across notes, filter by status, and toggle one back to disk. Drives
 * DOM affordances against the mock fs (no canvas / no real SQLite).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Todo.md': '# Todo\n- [ ] buy milk #shopping\n- [x] done thing\n- [ ] call bob 📅 2026-08-01',
      '/test-vault/Notes': { isDir: true },
      '/test-vault/Notes/other.md': '# Other\n- [ ] review PR #dev',
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

/**
 * Opens the tasks view on "All" — the view as it has always been (database
 * section, then notes grouped by note), which is what most of this file is
 * about. Since the planner (B1) the view opens on "Today"; the planner's own
 * lists have their test further down.
 */
async function openTasks(page: any) {
  await page.getByTestId('ribbon-tasks').click();
  await page.getByTestId('tasks-list-all').click();
}

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
}

test('Tasks metadata stays visible and a repeated completion keeps one successor', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Todo.md'] = '# Todo\n- [ ] Weekly audit ➕ 2026-08-01 🆔 audit-1 🔁 every week 📅 2026-09-01\n- [ ] Unusual rule 🆔 unusual-1 🔁 every month on the last';
  });
  await openVault(page); await openTasks(page);
  const original = page.getByRole('button', { name: /Weekly audit/ });
  await expect(original.getByTestId('task-metadata')).toContainText('audit-1');
  await expect(original.getByTestId('task-metadata')).toContainText('2026-08-01');
  await expect(page.getByRole('button', { name: /Unusual rule/ }).locator('.pv-taskmeta-unsupported')).toBeVisible();
  await original.locator('xpath=preceding-sibling::button[1]').click();
  await expect.poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md'])).toContain('✅');
  await expect(page.getByRole('button', { name: /Weekly audit/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Weekly audit/ }).getByTestId('task-metadata')).toContainText('pv-');
  await page.getByTestId('tasks-filter-all').click();
  const done = page.getByRole('button', { name: /Weekly audit/ }).filter({ hasText: 'audit-1' });
  await done.locator('xpath=preceding-sibling::button[1]').click();
  await expect(done.getByTestId('task-metadata')).not.toContainText('Completed:');
  await done.locator('xpath=preceding-sibling::button[1]').click();
  await expect(page.getByRole('button', { name: /Weekly audit/ })).toHaveCount(2);
  const text = await page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']);
  expect(text.match(/Weekly audit/g)).toHaveLength(2); expect(text).toContain('every month on the last');
  await page.screenshot({ path: testInfo.outputPath('tasks-metadata.png') });
});

test('tasks view aggregates checkboxes across notes, filters by status, and toggles one back to disk', async ({ page }) => {
  await openVault(page);
  await openTasks(page);

  // Default "open" filter: the two open tasks show, the done one is hidden.
  await expect(page.getByRole('button', { name: /buy milk/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /call bob/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /review PR/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /done thing/ })).toHaveCount(0);

  // The virtual view lands in the sidebar "recently opened" strip with its
  // localized name + dedicated icon — never as a raw "tasks" pseudo note.
  const recentRow = page
    .getByTestId('recents-section')
    .getByRole('button', { name: /^(Tasks|Aufgaben)$/ });
  await expect(recentRow).toBeVisible();
  await expect(recentRow.locator('svg.lucide-list-checks')).toBeVisible();

  // Toggle "buy milk" via its checkbox (the button just before the text button).
  const indexWritesBefore = await page.evaluate(() => (window as any).mockFs.__taskIndexWrites);
  await page.getByRole('button', { name: /buy milk/ }).locator('xpath=preceding-sibling::button[1]').click();

  // It is written back to disk as [x].
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']))
    .toContain('- [x] buy milk');

  // The file-backed write is followed by a targeted FTS refresh before the
  // overview re-queries. The completed row must not flash back into "Open".
  await expect.poll(() => page.evaluate(() => (window as any).mockFs.__taskIndexWrites)).toBeGreaterThan(indexWritesBefore);
  await expect(page.getByRole('button', { name: /buy milk/ })).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: /buy milk/ })).toHaveCount(0);

  // It leaves the "open" filter; switching to "All" shows it again.
  await page.getByTestId('tasks-filter-all').click();
  await expect(page.getByRole('button', { name: /buy milk/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /done thing/ })).toBeVisible();
});

test('hiding a note writes plainva.tasks: false and drops it until "show hidden"', async ({ page }) => {
  await openVault(page);
  await openTasks(page);
  await expect(page.getByRole('button', { name: /buy milk/ })).toBeVisible();

  // Hide the Todo group via its eye button (writes the opt-out marker to disk).
  await page.getByRole('button', { name: /Hide from tasks|Aus Aufgaben ausblenden/ }).first().click();

  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']))
    .toContain('tasks: false');

  // Its tasks leave the default view...
  await expect(page.getByRole('button', { name: /buy milk/ })).toHaveCount(0);

  // ...and "show hidden" brings the note back (dimmed, with a re-show affordance).
  await page.getByRole('checkbox', { name: /Show hidden|Ausgeblendete anzeigen/ }).check();
  await expect(page.getByRole('button', { name: /buy milk/ })).toBeVisible();
});

const TASK_DB_YAML = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: In Arbeit
        - value: Erledigt
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
    order:
      - file.name
      - note.status
      - note.frist
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
filters:
  and:
    - file.folder == "Aufgaben"
`;

test('promoting a checkbox creates a task note in the standard database and links the source line', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  // The database section renders above the note groups — still empty.
  const dbSection = page.getByTestId('task-db-section');
  await expect(dbSection).toBeVisible();
  await expect(dbSection.getByText(/No entries yet|Noch keine Einträge/)).toBeVisible();
  await expect(page.getByText(/From notes|Aus Notizen/)).toBeVisible();

  // Promote "call bob" (the database button right after the task text).
  await page.getByRole('button', { name: /call bob/ }).locator('xpath=..').getByTestId('task-promote').click();

  // A task note appears in the database folder: due date in the date column,
  // first status option, tags carried, source backlink; the checkbox line in
  // the source note became a wiki link.
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/call bob.md']))
    .toBeTruthy();
  const note = await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/call bob.md']);
  expect(note).toContain('frist: 2026-08-01');
  expect(note).toContain('status: Offen');
  expect(note).toContain('source: "[[Todo]]"');
  const todo = await page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']);
  expect(todo).toContain('- [[call bob]]');
  expect(todo).not.toContain('- [ ] call bob');

  // Both sections refresh: the entry shows in the database section (status
  // chip + due pill), the checkbox left the notes section.
  await expect(dbSection.getByRole('button', { name: /call bob/ })).toBeVisible();
  await expect(dbSection.getByText('Offen')).toBeVisible();
  // The pill shows the date SHORT (E3): the stored day key is what the note
  // carries, not what a reader is asked to parse. Day and month in the app's
  // own order, no year while it is this one — asserted as a pattern rather
  // than one country's spelling, because Intl decides the order per language.
  await expect(dbSection.getByText(/\b01[./]08\.?|\b08[./]01\b/)).toBeVisible();
  await expect(dbSection.getByText('2026-08-01')).toHaveCount(0);
});

test('the database section marks completed entries done and the status filter applies to it', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    // Two database entries: one open, one already done (last status option).
    fs['/test-vault/Aufgaben/Open task.md'] = '---\nstatus: Offen\nfrist: 2026-08-05\n---\n# Open task\n';
    fs['/test-vault/Aufgaben/Finished task.md'] = '---\nstatus: Erledigt\n---\n# Finished task\n';
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  const dbSection = page.getByTestId('task-db-section');
  await expect(dbSection).toBeVisible();

  // Default "open" filter: the done entry is hidden, the open one shows.
  await expect(dbSection.getByRole('button', { name: /Open task/ })).toBeVisible();
  await expect(dbSection.getByRole('button', { name: /Finished task/ })).toHaveCount(0);

  // Switch to "done": the completed entry shows and is marked done (glyph state),
  // the open one is now hidden — the filter genuinely reaches the DB section.
  await page.getByTestId('tasks-filter-done').click();
  const doneRow = dbSection.locator('[data-testid="task-db-row"]').filter({ hasText: 'Finished task' });
  await expect(doneRow).toBeVisible();
  await expect(doneRow).toHaveAttribute('data-done', '1');
  await expect(dbSection.getByRole('button', { name: /Open task/ })).toHaveCount(0);

  // "All" shows both, the open one classified as not-done.
  await page.getByTestId('tasks-filter-all').click();
  await expect(dbSection.getByRole('button', { name: /Open task/ })).toBeVisible();
  await expect(dbSection.locator('[data-testid="task-db-row"]').filter({ hasText: 'Open task' })).toHaveAttribute('data-done', '0');
});

test('the database-section status is editable inline (toggle + option menu) and written to the note', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] = '---\nstatus: Offen\n---\n# Steuer\n';
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  const dbSection = page.getByTestId('task-db-section');
  const row = dbSection.locator('[data-testid="task-db-row"]').filter({ hasText: 'Steuer' });
  await expect(row).toBeVisible();

  // Checkbox toggle: open -> done writes the LAST status option to the note.
  await row.getByTestId('task-db-toggle').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Steuer.md']))
    .toContain('status: Erledigt');

  // The row left the default "open" filter; switch to done to reach the chip.
  await page.getByTestId('tasks-filter-done').click();
  await expect(row).toHaveAttribute('data-done', '1');

  // Status chip opens the option menu; picking the intermediate option writes it.
  await row.getByTestId('task-db-status-chip').click();
  const menu = page.getByRole('menu', { name: /Change status|Status ändern/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'In Arbeit' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Steuer.md']))
    .toContain('status: In Arbeit');
});

const CHECKBOX_TASK_DB_YAML = `properties:
  note.erledigt:
    plainva:
      input: checkbox
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: In Arbeit
        - value: Erledigt
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
    order:
      - file.name
      - note.erledigt
      - note.status
      - note.frist
filters:
  and:
    - file.folder == "Aufgaben"
`;

test('with a done-checkbox column the overview checkbox writes the CHECKBOX property (status coupled)', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] = '---\nerledigt: false\nstatus: Offen\n---\n# Steuer\n';
  }, CHECKBOX_TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  const dbSection = page.getByTestId('task-db-section');
  const row = dbSection.locator('[data-testid="task-db-row"]').filter({ hasText: 'Steuer' });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-done', '0');

  // The overview checkbox IS the note's checkbox property: toggling writes
  // `erledigt: true` AND couples the status to the done option.
  await row.getByTestId('task-db-toggle').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Steuer.md']))
    .toContain('erledigt: true');
  const note = await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Steuer.md']);
  expect(note).toContain('status: Erledigt');
});

test('without a standard database the promote button offers the database picker', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    // NO fs.__taskDb — no standard database configured.
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  // No database section without a configured standard DB.
  await expect(page.getByTestId('task-db-section')).toHaveCount(0);

  // The promote click opens the picker menu listing the vault's databases;
  // choosing one promotes into it ad hoc.
  await page.getByRole('button', { name: /buy milk/ }).locator('xpath=..').getByTestId('task-promote').click();
  const menu = page.getByRole('menu', { name: /Move to database|In Datenbank verschieben/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Aufgaben' }).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/buy milk.md']))
    .toBeTruthy();
  const todo = await page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']);
  expect(todo).toContain('- [[buy milk]]');
});

test('block time on a task offers date/start/duration and reaches the provider (issue #34, wave 3)', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] =
      '---\ntype: task\nstatus: Offen\nfrist: 2026-08-03\nplainva:\n  pim:\n    uid: remote-1\n---\n\n# Steuer\n';
    // A writable calendar exists -> the action is offered.
    (window as any).__pimAccounts = [{ id: 'acc1', provider: 'caldav', label: 'Testkonto', config: '{}', enabled: 1 }];
    (window as any).__pimCalendars = [
      { account_id: 'acc1', cal_id: 'cal1', name: 'Privat', color: '#2a9d8f', selected: 1, read_only: 0 },
    ];
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  // The database row carries the action; a checkbox row carries it too.
  await expect(page.getByTestId('task-db-block')).toBeVisible();
  await expect(page.getByTestId('task-block').first()).toBeVisible();

  await page.getByTestId('task-db-block').click();
  const dialog = page.getByTestId('task-block-modal');
  await expect(dialog).toBeVisible();

  // The due date prefills the day, the duration defaults to one hour, and the
  // end read-out follows the chosen preset.
  await expect(page.getByTestId('task-block-day')).toHaveValue('2026-08-03');
  await page.getByTestId('task-block-start').fill('13:00');
  await expect(page.getByTestId('task-block-until')).toContainText('14:00');
  await page.getByTestId('task-block-120').click();
  await expect(page.getByTestId('task-block-until')).toContainText('15:00');

  // A custom length reveals the minutes field.
  await page.getByTestId('task-block-custom').click();
  await expect(page.getByTestId('task-block-minutes')).toBeVisible();
  await page.getByTestId('task-block-minutes').fill('45');
  await expect(page.getByTestId('task-block-until')).toContainText('13:45');

  // Submitting reaches the provider layer; with no mock credentials the write
  // fails INLINE and the dialog stays open instead of pretending success.
  await page.getByTestId('task-block-submit').click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('a repeating task spawns its next occurrence when checked off (issue #34, wave 3)', async ({ page }) => {
  // The dates are relative to today on purpose. `from: "due"` never returns a
  // date in the past, so a hard-coded due date turns this test into one that
  // rots with the calendar: it asserted "one week later" and started failing
  // the day the fixture went overdue. The overdue catch-up itself has its own
  // unit test; what THIS test is about is the note appearing a week on.
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const due = day(0);
  const nextDue = day(7);
  await page.addInitScript(([yaml, dueDate]) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Blumen.md'] =
      '---\ntype: task\nstatus: Offen\nfrist: ' + dueDate + '\nplainva:\n  repeat:\n    freq: weekly\n    interval: 1\n    from: due\n---\n\n# Blumen giessen\n';
    // A task mirrored from a provider list: it keeps ITS recurrence.
    fs['/test-vault/Aufgaben/Remote.md'] =
      '---\ntype: task\nstatus: Offen\nplainva:\n  pim:\n    uid: remote-1\n---\n\n# Remote\n';
  }, [TASK_DB_YAML, due] as const);
  await openVault(page);
  await openTasks(page);

  const rows = page.getByTestId('task-db-row');
  await expect(rows).toHaveCount(2);
  // The rule shows as a badge, read from the INDEXED namespace (no file read).
  await expect(page.getByTestId('task-db-repeat-badge')).toHaveCount(1);
  // The mirrored task offers no local repetition — one button, not two.
  await expect(page.getByTestId('task-db-repeat')).toHaveCount(1);

  // Check the repeating task off: the completed note stays, and the next
  // occurrence appears as an ordinary sibling note, open again, one week later.
  await rows.filter({ hasText: 'Blumen' }).getByTestId('task-db-toggle').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Blumen 2.md']))
    .toBeTruthy();

  const next = await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Blumen 2.md']);
  expect(next).toContain(`frist: ${nextDue}`);
  expect(next).toContain('status: Offen');
  expect(next).toContain('freq: weekly');
  const done = await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Blumen.md']);
  expect(done).toContain('status: Erledigt');
});

test('the repeat dialog writes and clears the rule (issue #34, wave 3)', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] = '---\ntype: task\nstatus: Offen\nfrist: 2026-08-03\n---\n\n# Steuer\n';
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  await page.getByTestId('task-db-repeat').click();
  await expect(page.getByTestId('task-repeat-modal')).toBeVisible();
  await page.getByTestId('task-repeat-monthly').click();
  await page.getByTestId('task-repeat-interval').fill('3');
  await page.getByTestId('task-repeat-from-completion').click();
  await page.getByTestId('task-repeat-submit').click();

  await expect
    .poll(() => page.evaluate(() => String((window as any).mockFs['/test-vault/Aufgaben/Steuer.md'] ?? '')))
    .toContain('freq: monthly');
  const note = await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/Steuer.md']);
  expect(note).toContain('interval: 3');
  expect(note).toContain('from: completion');

  // Turning it off removes the rule again.
  await page.getByTestId('task-db-repeat').click();
  await page.getByTestId('task-repeat-off').click();
  await expect
    .poll(() => page.evaluate(() => String((window as any).mockFs['/test-vault/Aufgaben/Steuer.md'] ?? '')))
    .not.toContain('freq:');
});

// The trailing controls of a task row are optional and of varying width, and
// as plain siblings they packed to the right — so a row WITHOUT a repeat
// button put its remaining icons somewhere else than the row above, and status
// words of different length ended on different edges. Fixed slots now.
test('Task rows: the trailing controls line up whether or not a row fills them', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    const note = (lines: string[]) => lines.join('\n');
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    // One local task (repeat badge AND repeat button, short status) and one
    // mirrored from a provider (no repeat button, longer status) — exactly the
    // pair that made the column zigzag.
    fs['/test-vault/Aufgaben/Blumen.md'] = note([
      '---', 'type: task', 'status: Offen', 'frist: 2026-08-03',
      'plainva:', '  repeat:', '    freq: weekly', '    interval: 1', '    from: due',
      '---', '', '# Blumen giessen', '',
    ]);
    fs['/test-vault/Aufgaben/Remote.md'] = note([
      '---', 'type: task', 'status: In Arbeit',
      'plainva:', '  pim:', '    uid: remote-1',
      '---', '', '# Remote', '',
    ]);
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  const rows = page.getByTestId('task-db-row');
  await expect(rows).toHaveCount(2);

  const geometry = await page.evaluate(() => {
    const out: Array<{ slots: number[]; trailRight: number; centres: number[] }> = [];
    for (const row of Array.from(document.querySelectorAll('[data-testid="task-db-row"]'))) {
      const rail = row.querySelector('.pv-taskacts')!;
      const slots = Array.from(rail.querySelectorAll('.pv-taskacts-slot'))
        .map((el) => Math.round(el.getBoundingClientRect().x));
      const trail = rail.querySelector('.pv-taskacts-trail')!.getBoundingClientRect();
      const centres = Array.from(rail.querySelectorAll('svg, button')).map((el) => {
        const r = el.getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      });
      out.push({ slots, trailRight: Math.round(trail.right), centres });
    }
    return out;
  });

  expect(geometry).toHaveLength(2);
  // Horizontally: the same columns in both rows, even though only one of them
  // has a repeat button to put in the first slot.
  expect(geometry[0].slots).toEqual(geometry[1].slots);
  expect(geometry[0].trailRight).toBe(geometry[1].trailRight);
  // Vertically: everything in one rail shares a centre line (chips used to sit
  // 2px lower than the buttons beside them).
  for (const row of geometry) {
    const spread = Math.max(...row.centres) - Math.min(...row.centres);
    expect(spread, 'the rail is not on one line').toBeLessThanOrEqual(1);
  }
});


test('task filters survive note navigation and restart; missing selections can be cleared', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('plainva-task-view-/test-vault')) localStorage.setItem('plainva-task-view-/test-vault', JSON.stringify({ version: 1, status: 'all', text: 'old search', folder: 'Removed', tag: 'missing', dueOnly: true, showHidden: true, list: 'all' }));
  });
  await openVault(page); await page.getByTestId('ribbon-tasks').click();
  const search = page.getByPlaceholder(/Filter tasks|Aufgaben filtern/);
  await expect(search).toHaveValue('old search');
  await expect(page.getByRole('button', { name: /All folders|Alle Ordner/ })).toContainText(/Removed.*Unavailable|Removed.*Nicht verfügbar/);
  await page.getByTestId('tasks-reset-filters').click();
  await expect(search).toHaveValue('');
  await page.getByTestId('tasks-filter-all').click(); await search.fill('milk');
  await page.getByRole('button', { name: /buy milk/ }).click();
  await page.getByTestId('ribbon-tasks').click(); await expect(search).toHaveValue('milk');
  await page.reload(); await page.getByTestId('ribbon-tasks').click(); await expect(search).toHaveValue('milk');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('plainva-task-view-/test-vault')!));
  // Resetting the filters leaves the chosen list alone (planner B1).
  expect(state).toEqual({ version: 1, status: 'all', text: 'milk', folder: '', tag: '', dueOnly: false, showHidden: false, list: 'all' });
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md'])).toContain('- [ ] buy milk');
});

test('tasks that exist more than once: the notice, the review, and only the empty copies go (finding 2026-09-20)', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    const note = (uid: string, title: string, status: string, body = '') =>
      ['---', 'plainva:', '  pim:', '    kind: task', '    provider: google', '    list: L1', `    uid: ${uid}`, `status: ${status}`, '---', `# ${title}`, ...(body ? ['', body] : []), ''].join('\n');
    // One task, three notes: the original, a frozen copy, and a copy somebody wrote into.
    fs['/test-vault/Aufgaben/Blumen gießen.md'] = note('u1', 'Blumen gießen', 'Offen');
    fs['/test-vault/Aufgaben/Blumen gießen 2.md'] = note('u1', 'Blumen gießen', 'Erledigt');
    fs['/test-vault/Aufgaben/Blumen gießen 3.md'] = note('u1', 'Blumen gießen', 'Offen', 'Der Farn steht jetzt im Flur.');
    fs['/test-vault/Aufgaben/Einmalig.md'] = note('u2', 'Einmalig', 'Offen');
    const ns = (uid: string) => JSON.stringify({ pim: { kind: 'task', provider: 'google', list: 'L1', uid } });
    (window as any).__namespaceRows = [
      { path: 'Aufgaben/Blumen gießen.md', ctime: 1, value: ns('u1') },
      { path: 'Aufgaben/Blumen gießen 2.md', ctime: 2, value: ns('u1') },
      { path: 'Aufgaben/Blumen gießen 3.md', ctime: 3, value: ns('u1') },
      { path: 'Aufgaben/Einmalig.md', ctime: 4, value: ns('u2') },
    ];
  }, TASK_DB_YAML);
  await openVault(page);
  await openTasks(page);

  // One task is claimed by more than one note — the single one does not count.
  await expect(page.getByTestId('task-duplicates-banner')).toContainText('1');
  await page.getByTestId('task-duplicates-review').click();

  const dialog = page.getByTestId('task-duplicates-dialog');
  await expect(dialog).toBeVisible();
  const rows = dialog.locator('[data-verdict]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-verdict', 'kept');
  await expect(dialog.locator('[data-verdict="removable"]')).toHaveCount(1);
  await expect(dialog.locator('[data-verdict="ownText"]')).toHaveCount(1);

  await page.getByTestId('task-duplicates-remove').click();
  await expect(dialog).toHaveCount(0);

  const left = await page.evaluate(() => Object.keys((window as any).mockFs).filter((p) => p.startsWith('/test-vault/Aufgaben/')).sort());
  expect(left).toEqual(['/test-vault/Aufgaben/Blumen gießen 3.md', '/test-vault/Aufgaben/Blumen gießen.md', '/test-vault/Aufgaben/Einmalig.md']);

  // What is left carries something of its own: nothing more to remove, and the
  // notice can be put away.
  await expect(page.getByTestId('task-duplicates-banner')).toBeVisible();
  await page.getByTestId('task-duplicates-review').click();
  await expect(page.getByTestId('task-duplicates-remove')).toHaveCount(0);
  await page.getByTestId('task-duplicates-putaway').click();
  await expect(page.getByTestId('task-duplicates-banner')).toHaveCount(0);
});

test('the planner: Today with Overdue on top, Upcoming by day, Inbox — and quick capture writes every field (B1/B2)', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] = `---\nstatus: Offen\nfrist: ${key(-2)}\n---\n# Steuer\n`;
    fs['/test-vault/Aufgaben/Angebot.md'] = `---\nstatus: Offen\nfrist: ${key(0)}T14:00\n---\n# Angebot\n`;
    fs['/test-vault/Aufgaben/Bericht.md'] = `---\nstatus: Offen\nfrist: ${key(3)}\n---\n# Bericht\n`;
    fs['/test-vault/Aufgaben/Irgendwann.md'] = '---\nstatus: Offen\n---\n# Irgendwann\n';
    // A checkbox in a note, due today: the planner reads both sources.
    fs['/test-vault/Todo.md'] = `# Todo\n- [ ] Drucker einrichten 📅 ${key(0)}\n- [ ] ohne Datum\n`;
  }, TASK_DB_YAML);
  await openVault(page);
  await page.getByTestId('ribbon-tasks').click();

  // Opens on Today: what is late leads, then today — database and note side by side.
  const list = page.getByTestId('task-planner-list');
  await expect(page.getByTestId('task-planner-section-overdue')).toContainText('Steuer');
  const today = page.getByTestId('task-planner-section-today');
  await expect(today).toContainText('Angebot');
  // The clock follows the language: 14:00, or 02:00 PM in English.
  await expect(today).toContainText(/14:00|02:00\sPM/);
  await expect(today).toContainText('Drucker einrichten');
  await expect(list).not.toContainText('Bericht');
  await expect(page.getByTestId('tasks-list-overdue')).toHaveText(/1 \+ 2/);

  await page.getByTestId('tasks-list-upcoming').click();
  await expect(page.getByTestId('task-planner-section-day')).toContainText('Bericht');
  await page.getByTestId('tasks-list-inbox').click();
  await expect(page.getByTestId('task-planner-section-inbox')).toContainText('Irgendwann');
  await expect(page.getByTestId('task-planner-section-inbox')).toContainText('ohne Datum');

  // Ticking a checkbox row in the planner writes the note, like the row in "All".
  await page.getByTestId('tasks-list-today').click();
  await today.locator('[data-testid="task-planner-row"]', { hasText: 'Drucker einrichten' }).getByTestId('task-planner-toggle').click();
  await expect.poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md'])).toContain('- [x] Drucker einrichten');

  // Quick capture: what is recognised shows as bricks BEFORE anything is saved.
  const input = page.getByTestId('task-capture-input');
  await input.fill('Rechnung schreiben tomorrow 9:30 #kunde weekly');
  const bricks = page.getByTestId('task-capture-bricks');
  await expect(bricks.getByTestId('task-capture-brick-date')).toBeVisible();
  await expect(bricks.getByTestId('task-capture-brick-time')).toContainText('09:30');
  await expect(bricks.getByTestId('task-capture-brick-tag')).toContainText('kunde');
  await expect(bricks.getByTestId('task-capture-brick-repeat')).toBeVisible();
  await input.press('Enter');

  await expect.poll(async () => page.evaluate(() => Object.keys((window as any).mockFs).some((p) => p.includes('Rechnung schreiben')))).toBe(true);
  const note = await page.evaluate(() => {
    const fs = (window as any).mockFs;
    return String(fs[Object.keys(fs).find((p) => p.includes('Rechnung schreiben'))!]);
  });
  expect(note).toMatch(/frist: "?\d{4}-\d{2}-\d{2}T09:30/);
  expect(note).toContain('kunde');
  expect(note).toMatch(/repeat:/);
  expect(note).toContain('# Rechnung schreiben');
  await expect(input).toHaveValue('');
});

test('the journal: capture lands on top, an entry becomes a task the task view knows, delete has an undo (plan Journal J4/J5)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    const fs = (window as any).mockFs;
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    (window as any).__dayKey = key;
    // Yesterday's daily note has a journal; today's note does not exist yet.
    fs[`/test-vault/${key(-1)}.md`] = '# Yesterday\n\n## Journal\n\n- 09:12 Called the workshop #client\n- [ ] 10:30 Order the spare part\n\n## Notes\n\nkeep me\n';
  });
  await openVault(page);
  await page.getByTestId('ribbon-journal').click();
  const view = page.getByTestId('journal-view');
  await expect(view.getByTestId('journal-day')).toHaveCount(1);
  await expect(view).toContainText('Called the workshop');

  // Capture with the keyboard shortcut: one field, one Enter — today's note is created on the way.
  await page.keyboard.press('Control+Shift+J');
  const dialog = page.getByTestId('journal-capture-dialog');
  await expect(dialog.getByTestId('journal-capture-target')).toContainText(/will be created|wird angelegt/);
  await dialog.getByTestId('journal-capture-input').fill('Router is in the basement #client');
  await dialog.getByTestId('journal-capture-input').press('Enter');
  await expect(dialog).toBeHidden();
  const todayPath = await page.evaluate(() => `/test-vault/${(window as any).__dayKey(0)}.md`);
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p] ?? ''), todayPath)).toMatch(/## Journal\n\n- \d{2}:\d{2} Router is in the basement #client\n$/);
  // The new day stands on top of the stream, its entry in it.
  await expect(view.getByTestId('journal-day')).toHaveCount(2);
  await expect(view.getByTestId('journal-day').first()).toContainText('Router is in the basement');

  // The tag chip filters the stream; "All" takes the filter back.
  await view.getByTestId('journal-filter-tag').first().click();
  await expect(view.getByTestId('journal-entry')).toHaveCount(2);
  await view.getByTestId('journal-filter-all').click();
  await expect(view.getByTestId('journal-entry')).toHaveCount(3);

  // Turn the new entry into a task: a checkbox the task view already knows (E8).
  await view.getByTestId('journal-day').first().getByTestId('journal-entry-menu').click();
  await page.getByTestId('journal-ctx-toTask').click();
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p]), todayPath)).toMatch(/- \[ \] \d{2}:\d{2} Router is in the basement #client/);
  await expect(view.getByTestId('journal-day').first().getByTestId('journal-entry-toggle')).toBeVisible();

  // Delete yesterday's plain entry, then take it back: the note is byte for byte what it was.
  const yesterdayPath = await page.evaluate(() => `/test-vault/${(window as any).__dayKey(-1)}.md`);
  const before = await page.evaluate((p) => String((window as any).mockFs[p]), yesterdayPath);
  await view.getByTestId('journal-entry').filter({ hasText: 'Called the workshop' }).getByTestId('journal-entry-menu').click();
  await page.getByTestId('journal-ctx-delete').click();
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p]), yesterdayPath)).not.toContain('Called the workshop');
  // The capture's own "Entry saved · Undo" may still be up; this is the delete's.
  await page.locator('.pv-toast').filter({ hasText: /Entry deleted|Eintrag gelöscht/ }).locator('.pv-toast-action').click();
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p]), yesterdayPath)).toBe(before);
  await expect(view).toContainText('Called the workshop');

  // Both task entries stand in the task view under "From notes".
  await openTasks(page);
  await expect(page.getByRole('button', { name: /Router is in the basement/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Order the spare part/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the journal in two shapes: the same entries as a stream and as cards (plan Journal-Erweiterungen, X5)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    const fs = (window as any).mockFs;
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    fs[`/test-vault/${key}.md`] = '# Yesterday\n\n## Journal\n\n- 09:12 Called the workshop\n- [ ] 10:30 Order the spare part\n';
  });
  await openVault(page);
  await page.getByTestId('ribbon-journal').click();
  const view = page.getByTestId('journal-view');
  // The stream is what a device sees until it says otherwise.
  await expect(view.getByTestId('journal-days')).toBeVisible();

  await view.getByTestId('journal-shape-cards').click();
  const wall = view.getByTestId('journal-cards');
  await expect(wall).toBeVisible();
  await expect(view.getByTestId('journal-days')).toHaveCount(0);
  // The same two entries, now as cards - and the task still carries its box.
  await expect(wall.getByTestId('journal-card')).toHaveCount(2);
  await expect(wall.getByTestId('journal-card').first()).toContainText('Order the spare part');
  await expect(wall.locator('[data-task="open"]').getByTestId('journal-entry-toggle')).toBeVisible();

  // The choice survives a reload: it belongs to the device.
  await page.reload();
  await page.getByTestId('ribbon-journal').click();
  await expect(view.getByTestId('journal-cards')).toBeVisible();

  await view.getByTestId('journal-shape-stream').click();
  await expect(view.getByTestId('journal-days')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the day boundary: an entry at 01:30 joins yesterday and keeps its time (plan Journal-Erweiterungen, X2)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Half past one in the morning, with the vault's day ending at 04:00.
  await page.clock.setFixedTime(new Date('2026-09-22T01:30:00'));
  await page.addInitScript(() => {
    const fs = (window as any).mockFs;
    fs.__dayEndsAt = 4 * 60;
    fs['/test-vault/2026-09-21.md'] = '# Monday\n\n## Journal\n\n- 22:10 Last train home\n';
  });
  await openVault(page);
  await page.getByTestId('ribbon-journal').click();
  const view = page.getByTestId('journal-view');

  // The head of the day that is still collecting says where a line goes now.
  await expect(view.getByTestId('journal-day').first()).toContainText(/until 04:00|bis 04:00/);

  await page.keyboard.press('Control+Shift+J');
  const dialog = page.getByTestId('journal-capture-dialog');
  // The target is YESTERDAY's note, and it exists - so no "will be created".
  await expect(dialog.getByTestId('journal-capture-target')).toContainText('2026-09-21');
  await dialog.getByTestId('journal-capture-input').fill('Could not sleep');
  await dialog.getByTestId('journal-capture-input').press('Enter');
  await expect(dialog).toBeHidden();

  // Yesterday's note took it, stamped with the real clock - not shifted back.
  await expect
    .poll(async () => page.evaluate(() => String((window as any).mockFs['/test-vault/2026-09-21.md'] ?? '')))
    .toBe('# Monday\n\n## Journal\n\n- 22:10 Last train home\n- 01:30 Could not sleep\n');
  // And no note was made for the calendar day the clock shows.
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/2026-09-22.md'] ?? null)).toBeNull();
  // One day in the stream, not two.
  await expect(view.getByTestId('journal-day')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the journal and an OPEN daily note: unsaved typing stays, the entry arrives in the editor, nothing becomes a conflict (plan Journal J2)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // The editor saves one second after the last keystroke. This run needs the
  // capture to meet typing that is still UNSAVED, and it used to prove that
  // with a wall clock (typing to capture under 900 ms) — which a busy machine
  // broke in every attempt (finding 2026-09-24). Instead, one-second timers are
  // HELD while the capture runs: the pending save cannot fire on its own, the
  // capture's flush is the only way it reaches the disk, and afterwards the
  // held timers are released and time runs as usual.
  await page.addInitScript(() => {
    const realSet = window.setTimeout.bind(window);
    const realClear = window.clearTimeout.bind(window);
    const held = new Map<number, () => void>();
    let nextId = 1_000_000_000;
    const hold = { on: false };
    (window as any).__saveWindow = {
      hold: () => { hold.on = true; },
      pending: () => held.size,
      release: () => {
        hold.on = false;
        for (const [id, run] of [...held]) {
          held.delete(id);
          realSet(run, 1000);
        }
      },
    };
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (hold.on && ms === 1000 && typeof fn === 'function') {
        const id = nextId++;
        held.set(id, () => (fn as (...a: unknown[]) => void)(...args));
        return id;
      }
      return realSet(fn, ms, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined && held.delete(id)) return;
      realClear(id);
    }) as typeof window.clearTimeout;
  });
  await page.addInitScript(() => {
    const fs = (window as any).mockFs;
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    (window as any).__today = today;
    fs[`/test-vault/${today}.md`] = '# Today\n\nplan\n\n## Journal\n\n- 08:00 first\n';
  });
  await openVault(page);
  const today = await page.evaluate(() => (window as any).__today as string);
  const path = `/test-vault/${today}.md`;
  await page.getByText(today, { exact: true }).first().click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('first');

  // The sidebar shows the journal of the open daily note's day. Since
  // 2026-09-22 it is a section of its own that starts CLOSED, and the pen in
  // its heading opens the ordinary capture dialog for that day — the column
  // carries no field, so there is one way to write an entry.
  await page.locator('.pv-side-section-header', { hasText: /Journal/ }).first().click();
  await expect(page.getByTestId('journal-days')).toContainText('first');

  // The dialog is modal, so it cannot stand open while the note is typed in.
  // Its first opening loads a chunk, though, and what this run measures is the
  // gap between typing and capturing — not that load. So it is opened once and
  // dismissed, which warms the chunk before the window that is being timed.
  const pen = page.getByTestId('right-journal-new');
  const field = page.getByTestId('journal-capture-input');
  await pen.click();
  await expect(field).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);

  // Type into the note and capture while the save is held — so the typing is
  // still unsaved when the entry is written, however long the machine takes.
  await page.evaluate(() => (window as any).__saveWindow.hold());
  await page.locator('.cm-line', { hasText: /^plan$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed and unsaved');
  // The capture really meets an UNSAVED note: the save is pending, and the
  // file on disk does not hold the typing yet.
  expect(await page.evaluate(() => (window as any).__saveWindow.pending() as number)).toBeGreaterThan(0);
  expect(await page.evaluate((p) => String((window as any).mockFs[p]), path)).not.toContain('typed and unsaved');
  await pen.click();
  await field.fill('second, from the dialog');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  // What this run pins is the OUTCOME; that the pending save is flushed BEFORE
  // the note is read is pinned in journalWrite.test.ts - the mock adapter here
  // has no conflict copies, so a missing flush would not show in this run the
  // way it does in the app.

  // Both are on disk: what was typed, and the entry under it.
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p]), path)).toMatch(/^# Today\n\nplan typed and unsaved\n\n## Journal\n\n- 08:00 first\n- \d{2}:\d{2} second, from the dialog\n$/);
  // The open editor adopted the line without a reload and without losing the typing.
  await expect(editor).toContainText('second, from the dialog');
  await expect(editor).toContainText('plan typed and unsaved');
  // No conflict copy, no conflict banner: the pending save went first.
  const conflicts = await page.evaluate(() => Object.keys((window as any).mockFs).filter((key) => /conflict/i.test(key)));
  expect(conflicts).toEqual([]);
  await expect(page.locator('[data-testid="conflict-banner"]')).toHaveCount(0);

  // From here on time runs as usual again.
  await page.evaluate(() => (window as any).__saveWindow.release());

  // Typing on afterwards saves on top of the entry instead of over it.
  await page.locator('.cm-line', { hasText: /^plan typed and unsaved$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(async () => page.evaluate((p) => String((window as any).mockFs[p]), path), { timeout: 15000 }).toMatch(/plan typed and unsaved!\n\n## Journal\n\n- 08:00 first\n- \d{2}:\d{2} second, from the dialog\n$/);
  expect(errors).toEqual([]);
});
