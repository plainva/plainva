/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Calendar tab E2E (PIM stage 2c): open the view from the ribbon, see cached
 * events on the month grid, select a day, and turn an event into a meeting
 * note on disk. The pim_* tables are answered by the SQL mock; the worker
 * cycle degrades gracefully (no keychain credentials in the mock -> the pull
 * is skipped, the cache rows still render).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Todo.md': '# Todo\nSome note content.',
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

    // Deterministic pim fixture around "today" (the calendar opens on the
    // current month, so today's cell is always in view).
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayKey = dayKey(now);
    (window as any).__todayKey = todayKey;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const pimEvents = () =>
      (window as any).__pimAccounts?.length === 0
        ? []
        : [
            {
              account_id: 'acc1', cal_id: 'cal1', uid: 'ev-standup', title: 'Standup',
              start_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).getTime(),
              end_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30).getTime(),
              start_date: null, end_date: null, all_day: 0, location: 'Raum 5', description: null,
              attendees: JSON.stringify(['a@example.org']), status: 'confirmed', etag: 'e1',
              series_master: null, recurrence: null, href: null,
            },
            {
              account_id: 'acc1', cal_id: 'cal1', uid: 'ev-holiday', title: 'Feiertag',
              start_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
              end_ts: tomorrow.getTime(),
              start_date: todayKey, end_date: dayKey(tomorrow), all_day: 1, location: null, description: null,
              attendees: null, status: null, etag: 'e2', series_master: null, recurrence: null, href: null,
            },
            // A recurring-series instance on today (stage 4 scope dialog)…
            {
              account_id: 'acc1', cal_id: 'cal1', uid: 'ev-series#inst1', title: 'Wochenmeeting',
              start_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0).getTime(),
              end_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0).getTime(),
              start_date: null, end_date: null, all_day: 0, location: null, description: null,
              attendees: null, status: 'confirmed', etag: 'e3', series_master: 'ev-series', recurrence: null,
              href: 'https://dav.example.org/series.ics',
            },
            // …and its master row (recurrence set -> excluded from the grid).
            {
              account_id: 'acc1', cal_id: 'cal1', uid: 'ev-series', title: 'Wochenmeeting',
              start_ts: new Date(now.getFullYear(), now.getMonth(), 1, 14, 0).getTime(),
              end_ts: new Date(now.getFullYear(), now.getMonth(), 1, 15, 0).getTime(),
              start_date: null, end_date: null, all_day: 0, location: null, description: null,
              attendees: null, status: 'confirmed', etag: 'e-master', series_master: null,
              recurrence: 'RRULE:FREQ=WEEKLY', href: 'https://dav.example.org/series.ics',
            },
          ];

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
          // Standard task database (calendar task overlay): a test opts in via fs.__taskDb.
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
          // PIM cache tables (order matters: listEvents joins pim_calendars).
          if (q.includes('FROM pim_events')) {
            // getEventByUid (queryOne travels as a normal select; first row wins).
            if (q.includes('e.uid = ?')) {
              const uid = String(args.values?.[2] ?? '');
              const hit = pimEvents().find((e: any) => e.uid === uid);
              return hit ? [hit] : [];
            }
            // The grid query excludes series masters (`recurrence IS NULL`).
            return pimEvents().filter((e: any) => !e.recurrence);
          }
          if (q.includes('FROM pim_accounts')) {
            const custom = (window as any).__pimAccounts;
            if (custom) return custom;
            return [{ id: 'acc1', provider: 'caldav', label: 'Testkonto', config: '{}', enabled: 1 }];
          }
          if (q.includes('FROM pim_calendars')) {
            if ((window as any).__pimAccounts?.length === 0) return [];
            return [{ account_id: 'acc1', cal_id: 'cal1', name: 'Privat', color: '#2a9d8f', selected: 1, read_only: 0 }];
          }
          if (q.includes('FROM pim_tasklists') || q.includes('FROM pim_tasks')) return [];
          if (q.includes('SELECT path, title, content FROM fts_notes')) {
            return noteRows()
              .filter((r) => r.mode !== 'attachment')
              .map((r) => ({ path: r.path, title: r.title, content: fs['/test-vault/' + r.path] }));
          }
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes("WHERE path LIKE '%.base'")) {
            return Object.keys(fs)
              .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && p.endsWith('.base'))
              .map((p) => ({ path: p.replace('/test-vault/', ''), title: null }));
          }
          // queryDatabaseFiles(): folder-scoped rows + a bulk properties fetch
          // (the calendar task overlay reads the standard task database here).
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
        if (cmd === 'plugin:sql|select_one') {
          const q = String(args.query);
          // getEventByUid (series "all events" resolves the master row).
          if (q.includes('FROM pim_events')) {
            const uid = String(args.values?.[2] ?? '');
            return pimEvents().find((e: any) => e.uid === uid) ?? null;
          }
          return null;
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
        return null;
      },
    };
  });
});

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
}

test('calendar tab shows cached events, day selection and creates a meeting note on disk', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();

  await expect(page.getByTestId('calendar-view')).toBeVisible();
  await expect(page.getByTestId('calendar-month-title')).not.toBeEmpty();

  // Today's cell carries both fixture events (title snippets are rendered).
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  const todayCell = page.getByTestId(`calendar-day-${todayKey}`);
  await expect(todayCell).toContainText('Standup');
  await expect(todayCell).toContainText('Feiertag');

  // The virtual view lands in the recents strip with its localized name +
  // dedicated icon — never as a raw "calendar" pseudo note.
  const recentRow = page.locator('button[title="plainva://calendar"]');
  await expect(recentRow).toHaveText(/^(Calendar|Kalender)$/);
  await expect(recentRow.locator('svg.lucide-calendar-range')).toBeVisible();

  // Select today -> the day pane lists the all-day event FIRST, then the
  // timed one with its time range and location.
  await todayCell.click();
  const events = page.getByTestId('calendar-event');
  await expect(events).toHaveCount(3);
  await expect(events.first()).toContainText('Feiertag');
  await expect(events.nth(1)).toContainText('Standup');
  await expect(events.nth(1)).toContainText('10:00');
  await expect(events.nth(1)).toContainText('Raum 5');
  await expect(events.nth(2)).toContainText('Wochenmeeting');

  // "Termin -> Meeting-Notiz": creates the anchored note in Meetings/ and
  // opens it in a tab.
  await events.filter({ hasText: 'Standup' }).getByTestId('calendar-meeting-note').click();
  const notePath = `/test-vault/Meetings/${todayKey} Standup.md`;
  await expect.poll(() => page.evaluate((p: string) => (window as any).mockFs[p], notePath)).toBeTruthy();
  const noteContent = await page.evaluate((p: string) => (window as any).mockFs[p], notePath);
  expect(noteContent).toContain('uid: ev-standup');
  expect(noteContent).toContain('type: Meeting');
  expect(noteContent).toContain(`date: ${todayKey}`);
  expect(noteContent).toContain('# Standup');

  // The note opened as a tab (editor shows the H1 as its content).
  await expect(page.locator('.cm-content').getByText('Standup').first()).toBeVisible();

  // Clicking the SAME event again reuses the note (no duplicate sibling).
  await page.getByTestId('ribbon-calendar').click();
  await page.getByTestId(`calendar-day-${todayKey}`).click();
  await page.getByTestId('calendar-event').filter({ hasText: 'Standup' }).getByTestId('calendar-meeting-note').click();
  await expect
    .poll(() => page.evaluate((p: string) => Boolean((window as any).mockFs[p]), `/test-vault/Meetings/${todayKey} Standup 2.md`))
    .toBe(false);
});

test('event dialog: create validation + provider-error surface, edit prefill, delete confirm', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  await page.getByTestId(`calendar-day-${todayKey}`).click();

  // "+" opens the create dialog (the mock calendar is writable + selected).
  await page.getByTestId('calendar-new-event').click();
  await expect(page.getByTestId('event-edit-form')).toBeVisible();

  // Empty title -> inline validation, dialog stays open.
  await page.getByTestId('event-save').click();
  await expect(page.getByTestId('event-error')).toBeVisible();

  // With a title the submit reaches the provider layer; the mock keychain has
  // no credentials, so the write fails INLINE (dialog still open) instead of
  // pretending success.
  await page.getByTestId('event-title').fill('Neuer Test-Termin');
  await page.getByTestId('event-save').click();
  await expect(page.getByTestId('event-error')).toBeVisible();
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();
  await expect(page.getByTestId('event-edit-form')).toHaveCount(0);

  // Edit prefills the event's values (title + local times).
  await page.getByTestId('calendar-event').filter({ hasText: 'Standup' }).getByTestId('calendar-edit-event').click();
  await expect(page.getByTestId('event-title')).toHaveValue('Standup');
  await expect(page.getByTestId('event-start-time')).toHaveValue('10:00');
  await expect(page.getByTestId('event-end-time')).toHaveValue('10:30');
  await expect(page.getByTestId('event-location')).toHaveValue('Raum 5');
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Delete asks first (danger dialog naming the event); cancel keeps it.
  await page.getByTestId('calendar-event').filter({ hasText: 'Standup' }).getByTestId('calendar-delete-event').click();
  const confirm = page.getByRole('dialog').filter({ hasText: /Termin löschen|Delete event/ });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Standup');
  await confirm.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
  await expect(page.getByTestId('calendar-event').filter({ hasText: 'Standup' })).toBeVisible();
});

test('series instance: edit/delete route through the scope dialog; "all" prefills from the master', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  await page.getByTestId(`calendar-day-${todayKey}`).click();

  const seriesRow = page.getByTestId('calendar-event').filter({ hasText: 'Wochenmeeting' });
  // The row carries the recurrence badge.
  await expect(seriesRow.locator('svg.lucide-repeat')).toBeVisible();

  // Edit -> scope dialog; "Alle Termine" opens the editor prefilled from the
  // MASTER row (the series' own start time, not the instance's).
  await seriesRow.getByTestId('calendar-edit-event').click();
  await expect(page.getByTestId('series-scope')).toBeVisible();
  await page.getByTestId('series-scope-all').click();
  await expect(page.getByTestId('event-title')).toHaveValue('Wochenmeeting');
  await expect(page.getByTestId('event-start-time')).toHaveValue('14:00');
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Edit -> "Nur diesen Termin" edits the instance directly.
  await seriesRow.getByTestId('calendar-edit-event').click();
  await page.getByTestId('series-scope-this').click();
  await expect(page.getByTestId('event-title')).toHaveValue('Wochenmeeting');
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Delete -> the scope dialog IS the confirmation; cancel keeps everything.
  await seriesRow.getByTestId('calendar-delete-event').click();
  await expect(page.getByTestId('series-scope')).toBeVisible();
  await expect(page.getByTestId('series-scope')).toContainText('Wochenmeeting');
  await page.getByRole('dialog').filter({ has: page.getByTestId('series-scope') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();
  await expect(seriesRow).toBeVisible();
});

const CAL_TASK_DB_YAML = `properties:
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
filters:
  and:
    - file.folder == "Aufgaben"
`;

test('the calendar optionally overlays due tasks from the standard task database', async ({ page }) => {
  await page.addInitScript((yaml) => {
    const fs = (window as any).mockFs;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    fs['/test-vault/Aufgaben'] = { isDir: true };
    fs['/test-vault/Aufgaben.base'] = yaml;
    fs.__taskDb = 'Aufgaben.base';
    fs['/test-vault/Aufgaben/Steuer.md'] = `---\nstatus: Offen\nfrist: ${today}\n---\n# Steuer\n`;
  }, CAL_TASK_DB_YAML);
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();

  // Off by default: no task section, the task title is not on the grid.
  await expect(page.getByTestId('calendar-day-tasks')).toHaveCount(0);

  // Toggle tasks on -> the due task appears in today's day pane and can be opened.
  await page.getByTestId('calendar-toggle-tasks').click();
  const dayTasks = page.getByTestId('calendar-day-tasks');
  await expect(dayTasks).toBeVisible();
  await expect(dayTasks.getByTestId('calendar-task').filter({ hasText: 'Steuer' })).toBeVisible();

  // The preference persists across a reload (device-local, like the graph pins).
  await page.reload();
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-day-tasks')).toBeVisible();
});

test('week and agenda views: segment switch, week columns without day pane, agenda groups', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);

  // Month is the default: grid + day pane visible.
  await expect(page.getByTestId('calendar-grid')).toBeVisible();
  await expect(page.getByTestId('calendar-day-pane')).toBeVisible();

  // Week: 7 day columns, today's column carries the timed event, NO day pane.
  await page.getByTestId('calendar-mode-week').click();
  await expect(page.getByTestId('calendar-week')).toBeVisible();
  await expect(page.getByTestId('calendar-day-pane')).toHaveCount(0);
  const todayCol = page.getByTestId(`calendar-weekday-${todayKey}`);
  await expect(todayCol.getByTestId('calendar-week-event').filter({ hasText: 'Standup' })).toBeVisible();

  // Clicking a week event opens the edit dialog (single event -> no scope prompt).
  await todayCol.getByTestId('calendar-week-event').filter({ hasText: 'Standup' }).click();
  await expect(page.getByTestId('event-title')).toHaveValue('Standup');
  await page.getByRole('dialog').getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Agenda: grouped upcoming list carries today's events with full action cards.
  await page.getByTestId('calendar-mode-agenda').click();
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await expect(page.getByTestId('calendar-week')).toHaveCount(0);
  await expect(page.getByTestId('calendar-agenda').getByTestId('calendar-event').filter({ hasText: 'Standup' })).toBeVisible();

  // The chosen view persists across a reload.
  await page.reload();
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
});

test('calendar tab without accounts shows the empty state and opens settings', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__pimAccounts = [];
  });
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();

  await expect(page.getByTestId('calendar-view')).toBeVisible();
  await expect(page.getByTestId('calendar-open-settings')).toBeVisible();
  await page.getByTestId('calendar-open-settings').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
