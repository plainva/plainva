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
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
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
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('SELECT path, title, content FROM fts_notes')) {
            return noteRows()
              .filter((r) => r.mode !== 'attachment')
              .map((r) => ({ path: r.path, title: r.title, content: fs['/test-vault/' + r.path] }));
          }
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          // listBases(): inline `LIKE '%.base'` — must precede the generic
          // "SELECT path, title FROM files" (listNotes) branch below.
          if (q.includes("WHERE path LIKE '%.base'")) {
            return Object.keys(fs)
              .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && p.endsWith('.base'))
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
              for (const line of fm[1].split('\n')) {
                const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
                if (kv) out.push({ file_id: rel, key: kv[1], value: kv[2].replace(/^"|"$/g, ''), type: 'text' });
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
  const recentRow = page.locator('button[title="plainva://tasks"]');
  await expect(recentRow).toHaveText(/^(Tasks|Aufgaben)$/);
  await expect(recentRow.locator('svg.lucide-list-checks')).toBeVisible();

  // Toggle "buy milk" via its checkbox (the button just before the text button).
  await page.getByRole('button', { name: /buy milk/ }).locator('xpath=preceding-sibling::button[1]').click();

  // It is written back to disk as [x].
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']))
    .toContain('- [x] buy milk');

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
  await page.getByRole('button', { name: /call bob/ }).locator('xpath=following-sibling::button[1]').click();

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
  await expect(dbSection.getByText('2026-08-01')).toBeVisible();
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
  await page.getByRole('button', { name: /buy milk/ }).locator('xpath=following-sibling::button[1]').click();
  const menu = page.getByRole('menu', { name: /Move to database|In Datenbank verschieben/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Aufgaben' }).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/buy milk.md']))
    .toBeTruthy();
  const todo = await page.evaluate(() => (window as any).mockFs['/test-vault/Todo.md']);
  expect(todo).toContain('- [[buy milk]]');
});
