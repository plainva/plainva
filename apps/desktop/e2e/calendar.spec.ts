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
              end_ts: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).getTime(),
              start_date: null, end_date: null, all_day: 0, location: 'Raum 5', description: 'Kurzes Standup',
              attendees: JSON.stringify(['a@example.org']), status: 'confirmed', etag: 'e1',
              series_master: null, recurrence: null, href: null, color: '#039be5',
              rsvps: JSON.stringify([
                { name: 'Chef', email: 'chef@example.org', status: 'accepted', organizer: true },
                { name: 'Ich', email: 'me@example.org', status: 'needsAction', self: true },
              ]),
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

test('month day-pane time grid; event -> meeting note on disk', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();

  await expect(page.getByTestId('calendar-view')).toBeVisible();
  await expect(page.getByTestId('calendar-month-title')).not.toBeEmpty();

  // Today's month cell carries both fixture events (title snippets rendered).
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  const todayCell = page.getByTestId(`calendar-day-${todayKey}`);
  await expect(todayCell).toContainText('Standup');
  await expect(todayCell).toContainText('Feiertag');

  // The virtual view lands in the recents strip with its localized name + icon.
  const recentRow = page.locator('button[title="plainva://calendar"]');
  await expect(recentRow).toHaveText(/^(Calendar|Kalender)$/);
  await expect(recentRow.locator('svg.lucide-calendar-range')).toBeVisible();

  // Select today -> the day pane is a time grid: all-day strip + a timed block.
  await todayCell.click();
  const dayPane = page.getByTestId('calendar-day-pane');
  await expect(dayPane.getByTestId('calendar-timegrid')).toBeVisible();
  await expect(page.getByTestId('calendar-allday-event').filter({ hasText: 'Feiertag' })).toBeVisible();
  const standup = page.getByTestId('calendar-timed-event').filter({ hasText: 'Standup' });
  await expect(standup).toBeVisible();

  // Click the event -> edit dialog carries a "Meeting-Notiz" action -> note on disk.
  await standup.click();
  await expect(page.getByTestId('event-edit-form')).toBeVisible();
  await page.getByTestId('event-meeting-note').click();
  const notePath = `/test-vault/Meetings/${todayKey} Standup.md`;
  await expect.poll(() => page.evaluate((p: string) => (window as any).mockFs[p], notePath)).toBeTruthy();
  const noteContent = await page.evaluate((p: string) => (window as any).mockFs[p], notePath);
  expect(noteContent).toContain('uid: ev-standup');
  expect(noteContent).toContain('type: Meeting');
  expect(noteContent).toContain(`date: ${todayKey}`);
  expect(noteContent).toContain('# Standup');
  await expect(page.locator('.cm-content').getByText('Standup').first()).toBeVisible();

  // The SAME event again reuses the note (no duplicate sibling).
  await page.getByTestId('ribbon-calendar').click();
  await page.getByTestId(`calendar-day-${todayKey}`).click();
  await page.getByTestId('calendar-timed-event').filter({ hasText: 'Standup' }).click();
  await page.getByTestId('event-meeting-note').click();
  await expect
    .poll(() => page.evaluate((p: string) => Boolean((window as any).mockFs[p]), `/test-vault/Meetings/${todayKey} Standup 2.md`))
    .toBe(false);
});

test('event dialog: create validation + provider-error surface, edit prefill, delete confirm', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  await page.getByTestId(`calendar-day-${todayKey}`).click();

  // The day-pane "+" opens the create dialog (mock calendar is writable).
  await page.getByTestId('calendar-new-event').click();
  await expect(page.getByTestId('event-edit-form')).toBeVisible();

  // Empty title -> inline validation, dialog stays open.
  await page.getByTestId('event-save').click();
  await expect(page.getByTestId('event-error')).toBeVisible();

  // With a title the submit reaches the provider layer; no mock credentials ->
  // the write fails INLINE instead of pretending success.
  await page.getByTestId('event-title').fill('Neuer Test-Termin');
  await page.getByTestId('event-save').click();
  await expect(page.getByTestId('event-error')).toBeVisible();
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();
  await expect(page.getByTestId('event-edit-form')).toHaveCount(0);

  // Clicking the timed block opens the edit dialog prefilled with its values.
  await page.getByTestId('calendar-timed-event').filter({ hasText: 'Standup' }).click();
  await expect(page.getByTestId('event-title')).toHaveValue('Standup');
  await expect(page.getByTestId('event-start-time')).toHaveValue('10:00');
  await expect(page.getByTestId('event-end-time')).toHaveValue('11:00');
  await expect(page.getByTestId('event-location')).toHaveValue('Raum 5');
  await expect(page.getByTestId('event-description')).toHaveValue('Kurzes Standup');
  // The event's own colour preselects its swatch, and the dialog offers the palette.
  await expect(page.getByTestId('event-color-#039be5')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('event-color-#d50000').click();
  await expect(page.getByTestId('event-color-#d50000')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('event-color-#039be5')).toHaveAttribute('aria-pressed', 'false');

  // RSVP back-channel: attendees with their status, plus the own accept/decline
  // buttons (the user is an invited attendee). No provider in the mock, so a
  // response surfaces the "unsupported" error inline instead of pretending.
  await expect(page.getByTestId('event-attendees')).toContainText('Chef');
  await expect(page.getByTestId('event-attendees')).toContainText('Ich');
  await expect(page.getByTestId('rsvp-accept')).toBeVisible();
  await page.getByTestId('rsvp-decline').click();
  await expect(page.getByTestId('event-error')).toBeVisible();

  // Delete from the dialog -> danger confirm naming the event; cancel keeps it.
  await page.getByTestId('event-delete').click();
  const confirm = page.getByRole('dialog').filter({ hasText: /Termin löschen|Delete event/ });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Standup');
  await confirm.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
  await expect(page.getByTestId('calendar-timed-event').filter({ hasText: 'Standup' })).toBeVisible();
});

test('series instance: clicking routes through the scope dialog; "all" prefills from the master', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  await page.getByTestId(`calendar-day-${todayKey}`).click();

  const seriesBlock = page.getByTestId('calendar-timed-event').filter({ hasText: 'Wochenmeeting' });
  // The block carries the recurrence badge.
  await expect(seriesBlock.locator('svg.lucide-repeat')).toBeVisible();

  // Click -> scope dialog; "Alle Termine" opens the editor prefilled from the
  // MASTER row (the series' own start time, not the instance's).
  await seriesBlock.click();
  await expect(page.getByTestId('series-scope')).toBeVisible();
  await page.getByTestId('series-scope-all').click();
  await expect(page.getByTestId('event-title')).toHaveValue('Wochenmeeting');
  await expect(page.getByTestId('event-start-time')).toHaveValue('14:00');
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Click -> "Nur diesen Termin" edits the instance directly.
  await seriesBlock.click();
  await page.getByTestId('series-scope-this').click();
  await expect(page.getByTestId('event-title')).toHaveValue('Wochenmeeting');
  await page.getByRole('dialog').filter({ has: page.getByTestId('event-edit-form') }).getByRole('button', { name: /Abbrechen|Cancel/ }).click();
});

test('quick-create: clicking an empty slot opens the popover; "more options" -> full dialog', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  await page.getByTestId('calendar-mode-day').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  const col = page.getByTestId(`calendar-timecol-${todayKey}`);
  await expect(col).toBeVisible();

  // Click an empty area near the top (early hours have no fixture events) ->
  // the quick-create popover appears.
  await col.click({ position: { x: 40, y: 90 } });
  await expect(page.getByTestId('calendar-quick-create')).toBeVisible();
  await page.getByTestId('calendar-quick-title').fill('Kaffeepause');

  // "More options" carries the draft into the full editor.
  await page.getByTestId('calendar-quick-more').click();
  await expect(page.getByTestId('event-edit-form')).toBeVisible();
  await expect(page.getByTestId('event-title')).toHaveValue('Kaffeepause');
});

test('an existing event can be dragged to reschedule and resized; a tiny drag stays a click', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  await page.getByTestId('calendar-mode-day').click();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);
  const col = page.getByTestId(`calendar-timecol-${todayKey}`);
  await expect(col).toBeVisible();
  const block = col.getByTestId('calendar-timed-event').filter({ hasText: 'Standup' });
  await block.scrollIntoViewIfNeeded();
  // The block is tinted with the event's own colour (#039be5), not the calendar colour.
  await expect(block).toHaveCSS('background-color', 'rgb(3, 155, 229)');
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  // Drag the body down ~2 hours -> reschedule. The mock has no provider, so the
  // write attempt surfaces an error toast; the block is treated as a drag, NOT a
  // click, so the edit dialog stays closed.
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 44, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 92, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.pv-toast--error').first()).toBeVisible();
  await expect(page.getByTestId('event-edit-form')).toHaveCount(0);

  // Drag the bottom-edge resize handle down -> another reschedule write attempt.
  const handle = block.getByTestId('calendar-event-resize');
  const hbox = await handle.boundingBox();
  expect(hbox).not.toBeNull();
  if (hbox) {
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + 60, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.pv-toast--error').first()).toBeVisible();
    await expect(page.getByTestId('event-edit-form')).toHaveCount(0);
  }

  // A tiny drag (below the snap threshold) is still a click -> the dialog opens.
  const box2 = await block.boundingBox();
  if (box2) {
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 8);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 10, { steps: 2 });
    await page.mouse.up();
  }
  await expect(page.getByTestId('event-title')).toHaveValue('Standup');
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

  // Off by default: the due task is not shown on the grid.
  await expect(page.getByTestId('calendar-task').filter({ hasText: 'Steuer' })).toHaveCount(0);

  // Toggle tasks on -> the due task appears in today's day-pane strip.
  await page.getByTestId('calendar-toggle-tasks').click();
  await expect(page.getByTestId('calendar-task').filter({ hasText: 'Steuer' })).toBeVisible();

  // The preference persists across a reload (device-local, like the graph pins).
  await page.reload();
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-task').filter({ hasText: 'Steuer' })).toBeVisible();
});

test('view modes: month / day / 3-day / week are time grids, agenda is a list', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-calendar').click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();
  const todayKey = await page.evaluate(() => (window as any).__todayKey);

  // Month is the default: grid + day-pane time grid.
  await expect(page.getByTestId('calendar-grid')).toBeVisible();
  await expect(page.getByTestId('calendar-day-pane')).toBeVisible();

  // Day: a single-column time grid, no day pane, no month grid.
  await page.getByTestId('calendar-mode-day').click();
  await expect(page.getByTestId('calendar-timegrid')).toBeVisible();
  await expect(page.getByTestId('calendar-grid')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-pane')).toHaveCount(0);
  await expect(page.getByTestId(`calendar-timecol-${todayKey}`).getByTestId('calendar-timed-event').filter({ hasText: 'Standup' })).toBeVisible();

  // 3-day: still a time grid.
  await page.getByTestId('calendar-mode-3day').click();
  await expect(page.getByTestId('calendar-timegrid')).toBeVisible();

  // Week: 7 columns, no day pane, today's column carries the timed event ->
  // clicking it opens the edit dialog (single event -> no scope prompt).
  await page.getByTestId('calendar-mode-week').click();
  await expect(page.getByTestId('calendar-timegrid')).toBeVisible();
  await expect(page.getByTestId('calendar-day-pane')).toHaveCount(0);
  await page.getByTestId(`calendar-timecol-${todayKey}`).getByTestId('calendar-timed-event').filter({ hasText: 'Standup' }).click();
  await expect(page.getByTestId('event-title')).toHaveValue('Standup');
  await page.getByRole('dialog').getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // Agenda: no time grid; grouped list with the event's full action card.
  await page.getByTestId('calendar-mode-agenda').click();
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await expect(page.getByTestId('calendar-timegrid')).toHaveCount(0);
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
