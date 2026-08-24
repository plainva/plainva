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

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
}

test('tasks view aggregates checkboxes across notes, filters by status, and toggles one back to disk', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();
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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
  await page.getByTestId('ribbon-tasks').click();

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
