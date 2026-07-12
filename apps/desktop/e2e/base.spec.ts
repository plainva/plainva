/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// E2E of the `.base` database viewer (plan Base-Erweiterungen W7): table with
// property filter + sort rules, pointer-driven board card drag, and the
// creation wizard. The Tauri mock extends the smoke-test mock with enough SQL
// answers (files list incl. folder LIKE filters, bulk properties) for
// queryDatabaseFiles to return real rows.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  await page.addInitScript(() => {
    const boardYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.status:',
      '    plainva:',
      '      input: select',
      '      options:',
      '        - value: active',
      '        - value: paused',
      'views:',
      '  - type: table',
      '    name: Board',
      '    order:',
      '      - file.name',
      '      - note.status',
      '    plainva:',
      '      render: board',
      '      groupBy: status',
      '',
    ].join('\n');

    const multiViewYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '  - type: list',
      '    name: Liste',
      '    order:',
      '      - file.name',
      '      - note.status',
      '',
    ].join('\n');
    // The calendar entry must fall into the CURRENT month (the view opens on
    // today) — the fixture date is computed, not hardcoded.
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const calDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-15`;
    const calYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.status:',
      '    plainva:',
      '      input: select',
      '      options:',
      '        - value: active',
      '        - value: paused',
      'views:',
      '  - type: table',
      '    name: Kalender',
      '    order:',
      '      - file.name',
      '      - note.status',
      '      - note.date',
      '    plainva:',
      '      render: calendar',
      '      dateField: date',
      '',
    ].join('\n');

    // Relations fixtures (Gesamtplan Base-Relationen P12): a Kunden target base,
    // a `kunde` relation (limit 1) on the Cockpit, a reverse column on Kunden,
    // and a self-relation Tasks base with sub-items.
    const cockpitYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.kunde:',
      '    plainva:',
      '      input: relation',
      '      relationBase: Kundenkartei.base',
      '      relationLimit: one',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '      - note.prio',
      '      - note.kunde',
      '',
    ].join('\n');
    const kundenYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Kunden"',
      'properties:',
      '  note.projekte:',
      '    plainva:',
      '      reverseOf:',
      '        base: Cockpit.base',
      '        property: kunde',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.projekte',
      '',
    ].join('\n');
    const relBoardYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.kunde:',
      '    plainva:',
      '      input: relation',
      '      relationBase: Kundenkartei.base',
      '      relationLimit: one',
      'views:',
      '  - type: table',
      '    name: KundenBoard',
      '    order:',
      '      - file.name',
      '    plainva:',
      '      render: board',
      '      groupBy: kunde',
      '',
    ].join('\n');
    const tasksYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.parent:',
      '    plainva:',
      '      input: relation',
      '      relationBase: Tasks.base',
      '      relationLimit: one',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '    plainva:',
      '      subItemsProperty: parent',
      '',
    ].join('\n');

    // New-item flow fixtures (plan Base-Neu P6): a base with several folder
    // sources (choice dialog), one without any source (setup dialog) and a
    // template folder for the "Neu" dropdown.
    const multiSrcYaml = [
      'filters:',
      '  or:',
      '    - file.folder == "Projekte"',
      '    - file.folder == "Kunden"',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '',
    ].join('\n');
    const noSrcYaml = [
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '',
    ].join('\n');

    // Template-database fixture (Gesamtplan DB-Vorlagen 2026-07-04): only a
    // plain folder source (Obsidian-evaluable). The folder's managed index.md
    // must still not appear as a row — the query layer drops OKF reserved names.
    const excludeYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Vorgaenge"',
      'properties:',
      '  note.status:',
      '    plainva:',
      '      input: status',
      '      options:',
      '        - value: Offen',
      '        - value: Erledigt',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '',
    ].join('\n');

    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Kunden': { isDir: true },
      '/test-vault/Templates': { isDir: true },
      '/test-vault/Templates/Projektvorlage.md': '---\ntype: Projekt\nstatus: entwurf\n---\n\n# {{title}}\n\nStart: {{date}}\n',
      '/test-vault/MultiSrc.base': multiSrcYaml,
      '/test-vault/NoSrc.base': noSrcYaml,
      '/test-vault/Projekte/Alpha.md': '---\nstatus: active\nprio: 2\nkunde: "[[ACME]]"\n---\n# Alpha\n\nSee [[Beta]] and [[Tasks.base]]\n',
      '/test-vault/Projekte/Beta.md': '---\nstatus: paused\nprio: 1\nparent: "[[Alpha]]"\n---\n# Beta',
      '/test-vault/Projekte/Gamma.md': '---\nstatus: active\nprio: 3\nkunde: "[[Nirgendwo]]"\n---\n# Gamma',
      '/test-vault/Kunden/ACME.md': '---\nbranche: tech\n---\n# ACME',
      '/test-vault/Kunden/Globex.md': '---\nbranche: energie\n---\n# Globex',
      '/test-vault/Cockpit.base': cockpitYaml,
      '/test-vault/Board.base': boardYaml,
      '/test-vault/MultiView.base': multiViewYaml,
      '/test-vault/Cal.base': calYaml,
      '/test-vault/Kundenkartei.base': kundenYaml,
      '/test-vault/RelBoard.base': relBoardYaml,
      '/test-vault/Tasks.base': tasksYaml,
      '/test-vault/Vorgaenge': { isDir: true },
      '/test-vault/Vorgaenge/index.md': '<!-- plainva:index generated -->\n# Vorgaenge\n',
      '/test-vault/Vorgaenge/Vorgang A.md': '---\nstatus: Offen\n---\n# Vorgang A',
      '/test-vault/Vorgaenge/Vorgang B.md': '---\nstatus: Erledigt\n---\n# Vorgang B',
      '/test-vault/Ablauf.base': excludeYaml,
    };

    const dbFiles = [
      { id: '1', path: 'Projekte/Alpha.md', title: 'Alpha', mtime_local: 1750000000000, size_bytes: 10 },
      { id: '2', path: 'Projekte/Beta.md', title: 'Beta', mtime_local: 1750000001000, size_bytes: 10 },
      { id: '3', path: 'Projekte/Gamma.md', title: 'Gamma', mtime_local: 1750000002000, size_bytes: 10 },
      { id: '4', path: 'Kunden/ACME.md', title: 'ACME', mtime_local: 1750000003000, size_bytes: 10 },
      { id: '5', path: 'Kunden/Globex.md', title: 'Globex', mtime_local: 1750000004000, size_bytes: 10 },
      { id: '6', path: 'Vorgaenge/index.md', title: 'index', mtime_local: 1750000005000, size_bytes: 10 },
      { id: '7', path: 'Vorgaenge/Vorgang A.md', title: 'Vorgang A', mtime_local: 1750000006000, size_bytes: 10 },
      { id: '8', path: 'Vorgaenge/Vorgang B.md', title: 'Vorgang B', mtime_local: 1750000007000, size_bytes: 10 },
    ];
    const dbProps: Record<string, { key: string; value: string; type: string }[]> = {
      '1': [{ key: 'status', value: 'active', type: 'text' }, { key: 'prio', value: '2', type: 'number' }, { key: 'tags', value: '["typ/tagebuch","thema/psyche"]', type: 'list' }, { key: 'date', value: calDate, type: 'text' }, { key: 'kunde', value: '[[ACME]]', type: 'text' }],
      '2': [{ key: 'status', value: 'paused', type: 'text' }, { key: 'prio', value: '1', type: 'number' }, { key: 'tags', value: '["typ/tagebuch"]', type: 'list' }, { key: 'parent', value: '[[Alpha]]', type: 'text' }],
      '3': [{ key: 'status', value: 'active', type: 'text' }, { key: 'prio', value: '3', type: 'number' }, { key: 'tags', value: '["thema/psyche"]', type: 'list' }, { key: 'kunde', value: '[[Nirgendwo]]', type: 'text' }],
      '4': [{ key: 'branche', value: 'tech', type: 'text' }],
      '5': [{ key: 'branche', value: 'energie', type: 'text' }],
      '7': [{ key: 'status', value: 'Offen', type: 'text' }],
      '8': [{ key: 'status', value: 'Erledigt', type: 'text' }],
    };
    // Property-scoped link rows (links.property_key) backing reverse columns.
    const dbLinks = [
      { source_path: 'Projekte/Alpha.md', source_title: 'Alpha', target_path: 'ACME', property_key: 'kunde' },
      { source_path: 'Projekte/Beta.md', source_title: 'Beta', target_path: 'Alpha', property_key: 'parent' },
    ];

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
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          // The splash is the default entry since 2026-07-04 — the suite keeps
          // the old auto-open behavior via the (now opt-in) setting.
          if (args.key === 'autoOpenLastVault') return [true, true];
          // The one-time OKF explainer (P12) must not block the scenarios.
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const query: string = args.query || '';
          const values: any[] = args.values || [];
          if (query.includes('SELECT path, title, mode FROM files')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
              .map(p => ({ path: p.replace('/test-vault/', ''), title: p.replace('/test-vault/', ''), mode: 'note' }));
          }
          if (query.includes('SELECT DISTINCT path FROM files')) {
            // getAllFolders derives the folder list from these paths (wizard dropdowns).
            return dbFiles.map(f => ({ path: f.path }));
          }
          // listNotes (note pickers, broken-link detection) and the resolver corpus
          // (reverse enrichment, relation writes) — P12.
          if (query.includes('SELECT path, title FROM files')) {
            return dbFiles.map(f => ({ path: f.path, title: f.title }));
          }
          if (query.includes(`SELECT path FROM files WHERE mode != 'attachment'`)) {
            return dbFiles.map(f => ({ path: f.path }));
          }
          // resolveNotePath (title/path, case-insensitive).
          if (query.includes('COLLATE NOCASE')) {
            const target = String(values[0] ?? '').toLowerCase();
            const hit = dbFiles.find(f =>
              f.title.toLowerCase() === target || f.path.toLowerCase() === target || f.path.toLowerCase() === `${target}.md`
            );
            if (hit) return [{ path: hit.path }];
            // Also resolve a `.base` file by its path/name (peek base navigation).
            const baseHit = Object.keys(fs).find(p => !fs[p].isDir && p.replace('/test-vault/', '').toLowerCase() === target);
            return baseHit ? [{ path: baseHit.replace('/test-vault/', '') }] : [];
          }
          // Property-scoped reverse lookup (links.property_key), P3.
          if (query.includes('l.property_key = ?')) {
            return dbLinks.filter(l => l.property_key === values[0]).map(l => ({ ...l }));
          }
          if (query.includes('FROM tags')) {
            return [{ tag: 'projekt', count: 2 }];
          }
          if (query.includes('FROM files f')) {
            const prefixes = values
              .filter((v: any) => typeof v === 'string' && v.endsWith('%'))
              .map((v: string) => v.slice(0, -1));
            let rows = dbFiles;
            if (prefixes.length > 0) {
              // OR-combined folder sources produce "LIKE ? OR LIKE ?" (P7).
              rows = query.includes(' OR ')
                ? dbFiles.filter(f => prefixes.some(p => f.path.startsWith(p)))
                : dbFiles.filter(f => prefixes.every(p => f.path.startsWith(p)));
            }
            return rows.map(r => ({ ...r }));
          }
          if (query.includes('FROM properties')) {
            const out: any[] = [];
            for (const id of values) for (const p of dbProps[String(id)] || []) out.push({ file_id: id, ...p });
            return out;
          }
          return [];
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
          const str = cmd === 'plugin:fs|write_text_file'
            ? new TextDecoder().decode(new Uint8Array(args))
            : new TextDecoder().decode(new Uint8Array(args.data || args));
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

// The file tree hides the .base extension (Base-UX2 P7) — bases are addressed
// by their bare display name, scoped to the file tree to avoid collisions with
// the editor title and the "recently opened" strip above the tree.
async function openBase(page: Page, name: string) {
  const entry = page.getByTestId('file-tree').getByText(name, { exact: true });
  await expect(entry).toBeVisible({ timeout: 10000 });
  await entry.click();
}

test('Base table: rows render, filter row narrows, sort rule flips order', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Beta')).toBeVisible();
  await expect(table.getByText('Gamma')).toBeVisible();

  // Open the config panel.
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();

  // Add a sort rule (defaults to the first free column = file.name, ASC) and
  // flip its direction — the first data row becomes Gamma.
  await page.getByRole('button', { name: /Sortierung hinzufügen|Add sort/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Alpha');
  await page.getByRole('button', { name: /Aufsteigend|Ascending/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Gamma');

  // Add a property filter status == active via the draft row.
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'active', exact: true }).click();

  await expect(table.getByText('Beta')).not.toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Gamma')).toBeVisible();
});

// Maintainer report 2026-07-03: filtering tags "is typ/tagebuch" emptied the view
// although every row carried the tag (the predicate stringified the list), and the
// value dropdown then degraded to a text input because its options were derived
// from the (now empty) filtered rows instead of the source.
test('Base filter on a list property: "is" matches membership and the value dropdown survives', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  // Add the filter tags == typ/tagebuch via the config panel's draft row.
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'typ/tagebuch', exact: true }).click();

  // Rows carrying the tag stay; only the untagged row disappears.
  await expect(table.getByText('Gamma')).not.toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Beta')).toBeVisible();

  // The value editor is still a dropdown and still offers the full source
  // vocabulary (not just the values surviving the active filter).
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await expect(page.getByRole('option', { name: 'thema/psyche', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Base board: pointer drag moves a card and writes the frontmatter', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');

  // Wait for the two group columns and the card.
  const card = page.getByTitle('Alpha');
  await expect(card).toBeVisible({ timeout: 10000 });
  const pausedHeader = page.getByText('paused', { exact: true }).first();
  await expect(pausedHeader).toBeVisible();

  const cardBox = (await card.boundingBox())!;
  const targetBox = (await pausedHeader.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();

  // The drop wrote the new group value into the note's frontmatter.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']))
    .toContain('status: paused');
});

test('Base board: dragging a column header reorders the group options (report 2026-07-07)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');

  const activeHeader = page.getByText('active', { exact: true }).first();
  const pausedHeader = page.getByText('paused', { exact: true }).first();
  await expect(activeHeader).toBeVisible({ timeout: 10000 });
  await expect(pausedHeader).toBeVisible();

  // Options start [active, paused]; drag the "paused" header left onto "active".
  const from = (await pausedHeader.boundingBox())!;
  const to = (await activeHeader.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 3 }); // arm the drag
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();

  // The select options were reordered in the .base (dropdowns everywhere follow).
  await expect
    .poll(async () => {
      const y = (await page.evaluate(() => (window as any).mockFs['/test-vault/Board.base'])) as string;
      return y.indexOf('value: paused') < y.indexOf('value: active');
    })
    .toBe(true);
});

test('Base board: color mode "column" tints the whole column and persists (WP3)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible({ timeout: 10000 });

  // The "active" column div is the header's parent; read its inline style.
  const colStyle = () =>
    page.evaluate(() => {
      const header = document.querySelector('[data-testid="board-col-header-active"]');
      return (header?.parentElement as HTMLElement | null)?.getAttribute('style') ?? '';
    });
  // Starts neutral (chip mode is the default).
  expect(await colStyle()).toContain('var(--bg-secondary)');

  // Open the config panel and switch the column color to "whole list".
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('button', { name: /^(Spaltenfarbe|Column color)$/ }).click();
  await page.getByRole('option', { name: /^(Ganze Liste|Whole list)$/ }).click();

  // The .base persists boardColorMode: column under the view's plainva namespace.
  await expect
    .poll(async () => {
      const y = (await page.evaluate(() => (window as any).mockFs['/test-vault/Board.base'])) as string;
      return typeof y === 'string' && y.includes('boardColorMode: column');
    })
    .toBe(true);

  // The whole column is now tinted with a chip palette token.
  await expect.poll(colStyle).toContain('var(--chip-');
});

test('Base wizard: new database via source step, live match count, created file opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').getByText('Cockpit', { exact: true })).toBeVisible({ timeout: 10000 });

  // Trigger "new database" via the same window event the sidebar menu uses,
  // then name it in the inline (autofocused) input.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'base' } })));
  await page.keyboard.type('Neu');
  await page.keyboard.press('Enter');

  // The wizard opens; no file exists yet.
  await expect(page.getByText(/Neue Datenbank|New database/).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Neu.base'])).toBeUndefined();

  // Pick the existing folder via "create new folder" (idempotent for an
  // existing path) — the probe query reports the matching notes.
  await page.getByRole('button', { name: /Neuen Ordner anlegen|Create new folder/ }).click();
  await page.keyboard.type('Projekte');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/3 (Notizen|notes)/)).toBeVisible();

  // The found properties are preselected; create the database.
  await expect(page.getByText('status', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Datenbank erstellen|Create database/ }).click();

  await expect.poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Neu.base'])).toContain('file.folder == "Projekte"');
  // The new base opened in the viewer and shows the matching rows (link chips
  // may repeat a file name, hence .first()).
  await expect(page.locator('table').getByText('Alpha').first()).toBeVisible();
});

test('File tree shows bases without the .base extension (P7)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').getByText('Cockpit', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('aside').getByText('Cockpit.base', { exact: true })).toHaveCount(0);
});

test('Base table: a single click starts inline editing and saves (P3)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  const row = page.locator('tr', { hasText: 'Alpha' });
  await row.getByText('active', { exact: true }).click();
  const input = row.locator('input');
  await expect(input).toBeVisible();
  await input.fill('review');
  await input.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']))
    .toContain('status: review');
});

test('Board: clicking a card opens the peek window; maximize opens a tab (P5)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  const card = page.getByTitle('Alpha');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  const peek = page.locator('.pv-peek-card');
  await expect(peek).toBeVisible();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Alpha');
  // The full editor loads lazily inside the peek.
  await expect(peek.locator('.cm-editor')).toBeVisible({ timeout: 15000 });

  // Close via X, reopen, then maximize into a regular tab (the base tab stays).
  await peek.locator('.pv-peek-actions').getByRole('button', { name: /Schließen|Close/ }).click();
  await expect(page.locator('.pv-peek-card')).toHaveCount(0);
  await card.click();
  await page.locator('.pv-peek-actions').getByRole('button', { name: /Als Tab öffnen|Open as tab/ }).click();
  await expect(page.locator('.pv-peek-card')).toHaveCount(0);
  await expect(page.locator('main .cm-editor').first()).toBeVisible({ timeout: 15000 });
});

test('Peek: the properties toggle reveals a scoped Properties column (plan P3)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  const card = page.getByTitle('Alpha');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  const peek = page.locator('.pv-peek-card');
  await expect(peek).toBeVisible();
  await expect(peek.locator('.cm-editor')).toBeVisible({ timeout: 15000 });

  // The Properties column is hidden by default; the toggle reveals it, bound to
  // the peek note via its own scoped document channel.
  await expect(peek.locator('.pv-peek-side')).toHaveCount(0);
  const toggle = peek.locator('.pv-peek-actions').getByRole('button', { name: /Eigenschaften|Properties/ });
  await toggle.click();
  await expect(peek.locator('.pv-peek-side')).toBeVisible();
  await toggle.click();
  await expect(peek.locator('.pv-peek-side')).toHaveCount(0);
});

test('Peek: back/forward navigates the peek history and greys out at the ends (plan P2)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  const card = page.getByTitle('Alpha');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  const peek = page.locator('.pv-peek-card');
  await expect(peek).toBeVisible();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Alpha');
  await expect(peek.locator('.cm-editor')).toBeVisible({ timeout: 15000 });

  const back = peek.locator('.pv-peek-nav button').first();
  const fwd = peek.locator('.pv-peek-nav button').last();
  // A fresh peek has nothing behind it — both buttons are disabled AND visibly
  // greyed (the reported bug: they must not look active when inactive).
  await expect(back).toBeDisabled();
  await expect(back).toHaveCSS('opacity', '0.4');
  await expect(fwd).toBeDisabled();
  await expect(fwd).toHaveCSS('opacity', '0.4');

  // Click the [[Beta]] wiki-link inside the peek editor: the peek navigates to Beta.
  await peek.locator('.cm-editor').getByText('Beta', { exact: true }).click();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Beta');
  await expect(back).toBeEnabled();
  await expect(back).toHaveCSS('opacity', '1');
  await expect(fwd).toBeDisabled();

  // Back returns to Alpha and forward becomes available.
  await back.click();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Alpha');
  await expect(back).toBeDisabled();
  await expect(fwd).toBeEnabled();

  // Forward returns to Beta.
  await fwd.click();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Beta');
});

test('Peek: a .base opened from inside the peek renders in-window and joins the history', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  await page.getByTitle('Alpha').click();

  const peek = page.locator('.pv-peek-card');
  await expect(peek).toBeVisible();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Alpha');
  await expect(peek.locator('.cm-editor')).toBeVisible({ timeout: 15000 });
  const back = peek.locator('.pv-peek-nav button').first();
  await expect(back).toBeDisabled();

  // Click the [[Tasks.base]] link inside the peek: the base renders IN the peek
  // (not kicked out to a tab) and becomes part of the back history.
  await peek.locator('.cm-editor').getByText('Tasks.base', { exact: true }).click();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Tasks');
  await expect(peek.locator('.base-header-container')).toBeVisible({ timeout: 15000 });
  await expect(back).toBeEnabled();

  // Back returns to the note (the base was a real history entry).
  await back.click();
  await expect(peek.locator('.pv-peek-title')).toHaveText('Alpha');
  await expect(peek.locator('.cm-editor')).toBeVisible();
});

test('Board: Ctrl+click on a card opens it in the split pane (P5)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');
  const card = page.getByTitle('Alpha');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click({ modifiers: ['Control'] });

  await expect(page.locator('main section')).toHaveCount(2);
  await expect(page.locator('main section').nth(1).locator('.cm-editor')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pv-peek-card')).toHaveCount(0);
});

test('Calendar: entries show the enabled properties (P4)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cal');
  // The entry renders in the current month; the typed status chip sits below the name.
  await expect(page.locator('main').getByText('Alpha', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('main').getByText('active', { exact: true })).toBeVisible();
});

test('Base view persistence: the last active view is restored (P6)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiView');
  await expect(page.locator('.base-view-tab.active')).toContainText('Tabelle');
  await page.getByText('Liste', { exact: true }).click();
  await expect(page.locator('.base-view-tab.active')).toContainText('Liste');

  // Leave the base (open a note), then come back — the list view is restored.
  // (The mock indexes titles as full paths, hence the "Projekte/Alpha" label.)
  await page.locator('aside').getByText('Projekte', { exact: true }).click();
  await page.locator('aside').getByText('Projekte/Alpha', { exact: true }).click();
  await expect(page.locator('main .cm-editor').first()).toBeVisible({ timeout: 15000 });
  await openBase(page, 'MultiView');
  await expect(page.locator('.base-view-tab.active')).toContainText('Liste', { timeout: 10000 });
});

// Plan Per-View-Filter 2026-07-07: property filter rules are stored per view
// (views[i].filters), folder/tag sources stay global. A filter added in one view
// must not affect the other, and it must persist into the ACTIVE view only.
test('Base per-view filters: a filter applies only to the view it was added in', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiView');
  await expect(page.locator('.base-view-tab.active')).toContainText('Tabelle');

  const table = page.locator('table');
  await expect(table.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(table.getByText('Beta', { exact: true })).toBeVisible();
  await expect(table.getByText('Gamma', { exact: true })).toBeVisible();

  // Add a status == active filter in the Tabelle view (hides the paused Beta).
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'active', exact: true }).click();

  await expect(table.getByText('Beta', { exact: true })).not.toBeVisible();
  await expect(table.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(table.getByText('Gamma', { exact: true })).toBeVisible();

  // The rule persists as a native per-view filter (Tabelle = views[0]); the file
  // level keeps only the folder source.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/MultiView.base']))
    .toContain('status == "active"');

  // Switch to the Liste view — the Tabelle filter does not apply there.
  await page.getByText('Liste', { exact: true }).click();
  await expect(page.locator('.base-view-tab.active')).toContainText('Liste');
  await expect(page.locator('main').getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();

  // Back to Tabelle — the filter is still active there.
  await page.getByText('Tabelle', { exact: true }).click();
  await expect(page.locator('.base-view-tab.active')).toContainText('Tabelle');
  await expect(table.getByText('Beta', { exact: true })).not.toBeVisible();
  await expect(table.getByText('Alpha', { exact: true })).toBeVisible();
});

// Maintainer report 2026-07-07: filtering a column whose values are wiki-links
// but that has no `input: relation` schema showed the raw "[[ACME]]" as the
// dropdown label. Such a column is now recognized as a relation-by-data: the
// value editor uses the note dropdown (display-text labels + "Diese Notiz")
// and the operator defaults to membership. The stored value stays the full link.
test('Base filter value: a wiki-link column without a relation schema is treated as a relation', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiView');

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  // `kunde` (Alpha -> [[ACME]]) has no schema entry in MultiView.
  await page.getByRole('option', { name: 'Kunde', exact: true }).click();

  // Picking a relation-by-data column switches the operator to membership
  // (the operator Select's accessible name is its aria-label, so assert its text).
  await expect(page.getByRole('button', { name: /Filteroperator|Filter operator/i })).toContainText(/enthält|contains/i);

  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  // Note dropdown: display-text label (never the raw wiki-link) + the "Diese Notiz" option.
  await expect(page.getByRole('option', { name: 'ACME', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '[[ACME]]', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Diese Notiz|This note/ })).toBeVisible();
});

test('Base: renaming a property updates the config and the note frontmatter', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.locator('.base-config-panel').getByRole('button', { name: /Eigenschaft: status|Property: status/ }).click();
  const dialog = page.getByRole('dialog', { name: /Eigenschaft: status|Property: status/ });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('zustand');
  await dialog.getByRole('button', { name: /Speichern|Save/ }).click();
  // The bulk rename asks via the in-app confirm (plan Designsprache P3;
  // window.confirm is gone — the old page.on('dialog') accept with it).
  await page.locator('.pv-modal-footer button.pv-btn--primary').click();

  // The frontmatter key moved in the notes and the .base references the new id.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']))
    .toContain('zustand: active');
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md'])).not.toContain('status:');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']))
    .toContain('note.zustand');
  // The table shows the renamed column with its values intact.
  await expect(page.locator('table').getByText('zustand')).toBeVisible();
  await expect(page.locator('table').getByText('active').first()).toBeVisible();
});

test('Wizard: adding further sources keeps offering dropdowns (P8)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').getByText('Cockpit', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'base' } })));
  await page.keyboard.type('Zwei');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Neue Datenbank|New database/).first()).toBeVisible();

  const wizard = page.locator('.pv-modal-card');
  // First source via the two dropdowns (type + value).
  await wizard.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('option', { name: 'Projekte', exact: true }).click();

  // The add row STILL offers both dropdowns — switch the type to tag, add one.
  await wizard.getByRole('button', { name: /Quelle|Source/ }).click();
  await page.getByRole('option', { name: 'Tag', exact: true }).click();
  await wizard.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('option', { name: '#projekt', exact: true }).click();

  // Both conditions landed as rows — never a free-text fallback.
  await expect(wizard.getByText('Projekte', { exact: true })).toBeVisible();
  await expect(wizard.getByText('#projekt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
});

// --- Relations (Gesamtplan Base-Relationen, P12) ---------------------------

test('Relation cell: picker scoped to the target base, limit 1 writes a scalar link', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Beta')).toBeVisible();

  // Beta has no kunde yet — click its empty kunde cell (last column) to edit.
  const betaRow = table.locator('tbody tr', { hasText: 'Beta' });
  await betaRow.locator('td').last().click();

  const editor = page.locator('.base-inline-editor');
  await expect(editor).toBeVisible();
  await editor.locator('input').fill('AC');
  await editor.getByRole('button', { name: 'ACME', exact: true }).click();

  // Limit 1: the pick replaced the value, closed the editor and wrote a SCALAR.
  await expect(editor).not.toBeVisible();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Beta.md']))
    .toContain('kunde: "[[ACME]]"');
});

test('Relation picker: creating a missing note lands in the target base source folder', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  const betaRow = table.locator('tbody tr', { hasText: 'Beta' });
  await betaRow.locator('td').last().click();

  const editor = page.locator('.base-inline-editor');
  await expect(editor).toBeVisible();
  await editor.locator('input').fill('Delta');
  await editor.getByRole('button', { name: /Neue Notiz|Create new note/ }).click();

  // The note was created in the Kunden folder (the target base's source) and linked.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Kunden/Delta.md']))
    .toContain('type:');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Beta.md']))
    .toContain('[[Delta]]');
});

test('Broken relation chip renders muted and does not open a peek', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  // Gamma links to a note that does not exist.
  const broken = page.locator('.pv-chip-broken', { hasText: 'Nirgendwo' });
  await expect(broken).toBeVisible();
  await broken.click();
  await expect(page.locator('.pv-peek-card')).not.toBeVisible();
});

test('Show on target: the column editor writes the reverse column into the other base', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  // Open the kunde column editor from the config panel.
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  // Both the table header and the panel expose the editor button — scope to the panel.
  await page.locator('.base-config-panel').getByRole('button', { name: /Eigenschaft: kunde|Property: kunde/ }).click();

  const modal = page.locator('.pv-modal');
  await expect(modal).toBeVisible();
  // The fixture target already carries a reverse column for this relation —
  // the checkbox is PRE-FILLED from the target config. Unchecking removes it.
  await expect(modal.getByRole('checkbox')).toBeChecked();
  await modal.getByRole('checkbox').uncheck();
  await modal.getByRole('button', { name: /Speichern|Save/ }).click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Kundenkartei.base']))
    .not.toContain('reverseOf');

  // Re-open and check it again: a fresh reverse column is created in the
  // target, named after this base ("Cockpit").
  await page.locator('.base-config-panel').getByRole('button', { name: /Eigenschaft: kunde|Property: kunde/ }).click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('checkbox')).not.toBeChecked();
  await modal.getByRole('checkbox').check();
  await modal.getByRole('button', { name: /Speichern|Save/ }).click();

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Kundenkartei.base']))
    .toContain('note.Cockpit');
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Kundenkartei.base'])).toContain('reverseOf');
});

test('Reverse column: shows linking notes and editing writes the counterpart frontmatter', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Kundenkartei');

  const table = page.locator('table');
  // The enrichment lists Alpha (kunde -> ACME) in ACME reverse cell.
  const acmeRow = table.locator('tbody tr', { hasText: 'ACME' });
  await expect(acmeRow.getByText('Alpha')).toBeVisible();

  // Add Beta to the Globex reverse cell — the OWNING property of Beta changes.
  const globexRow = table.locator('tbody tr', { hasText: 'Globex' });
  await globexRow.locator('td').last().click();
  const editor = page.locator('.base-inline-editor');
  await expect(editor).toBeVisible();
  await editor.locator('input').fill('Bet');
  await editor.getByRole('button', { name: 'Beta', exact: true }).click();

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Beta.md']))
    .toContain('kunde: "[[Globex]]"');
});

test('Sub-items: rows nest under their parent, expand state persists across reopen', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Tasks');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Gamma')).toBeVisible();
  // Beta (parent: Alpha) starts collapsed under Alpha; the badge shows 1 child.
  await expect(table.getByText('Beta')).not.toBeVisible();
  await expect(table.locator('.base-subitem-badge')).toHaveText('1');

  await table.getByRole('button', { name: /Aufklappen|Expand/ }).click();
  await expect(table.getByText('Beta')).toBeVisible();

  // The expand state survives switching away and back (app-side persistence).
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();
  await openBase(page, 'Tasks');
  await expect(page.locator('table').getByText('Beta')).toBeVisible();
  await page.locator('table').getByRole('button', { name: /Zuklappen|Collapse/ }).click();
  await expect(page.locator('table').getByText('Beta')).not.toBeVisible();
});

test('Board grouped by relation: columns per linked note, drag moves the link', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'RelBoard');

  // Columns mirror the linked notes (populated groups only); Alpha sits under
  // ACME, Gamma's dangling link provides the second column as the drop target.
  const alphaCard = page.getByTitle('Alpha');
  await expect(alphaCard).toBeVisible({ timeout: 10000 });
  const targetHeader = page.getByText('Nirgendwo', { exact: true }).first();
  await expect(targetHeader).toBeVisible();

  const cardBox = (await alphaCard.boundingBox())!;
  const targetBox = (await targetHeader.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();

  // Limit 1: the drag replaced the relation with the target column's link.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']))
    .toContain('kunde: "[[Nirgendwo]]"');
});

test('New property of type Relation opens the column editor for the target setup', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  const panel = page.locator('.base-config-panel');
  await panel.getByRole('button', { name: /Neue Eigenschaft|New property/ }).click();
  await page.getByPlaceholder(/Name der Eigenschaft|Property name/).fill('verknuepft');
  await panel.getByRole('button', { name: /^(Typ|Type)$/ }).click();
  await page.getByRole('option', { name: 'Relation', exact: true }).click();
  await panel.getByRole('button', { name: /^(Hinzufügen|Add)$/ }).click();

  // The column editor opens right away so target base / cardinality / show-on
  // can be picked (maintainer feedback: Relation was unreachable from here).
  const modal = page.locator('.pv-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/Ziel-Datenbank|Target database/)).toBeVisible();
  await expect(modal.getByText(/Kardinalität|Cardinality/)).toBeVisible();
});

test('Relation filter: note dropdown narrows by linked note', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Kunde', exact: true }).click();
  // Relation columns default to "enthält" with a note dropdown.
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'ACME', exact: true }).click();

  await expect(table.getByText('Beta')).not.toBeVisible();
  await expect(table.getByText('Gamma')).not.toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();
});

// --- New-item flow (plan Base-Neu P6) ---------------------------------------

test('Base "Neu": a single folder source stores the item there and opens the peek', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByTitle(/Neues Element anlegen|Create a new item/).click();

  // Name = "{base stem} {count+1}", straight into the peek window.
  await expect(page.locator('.pv-peek-title')).toContainText('Cockpit_4');
  const file = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Cockpit_4.md']);
  expect(file).toContain('type:');
  expect(file).toContain('okf_version:');
  expect(file).toContain('# Cockpit_4'); // template-less items start with an H1 (UI-UX P6)
});

test('Base "Neu": several folder sources ask once and persist the choice in the .base', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiSrc');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByTitle(/Neues Element anlegen|Create a new item/).click();
  const dialog = page.getByRole('dialog', { name: /Ablage-Ordner|Storage folder/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio').nth(1).check(); // Kunden
  await dialog.getByRole('button', { name: /Festlegen|Set folder/ }).click();

  await expect(page.locator('.pv-peek-title')).toContainText('MultiSrc_6');
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/MultiSrc.base']);
  expect(base).toContain('newItemFolder: Kunden');
  const file = await page.evaluate(() => (window as any).mockFs['/test-vault/Kunden/MultiSrc_6.md']);
  expect(file).toContain('type:');

  // Second click: the persisted folder is used without asking again, and the
  // name counts past the existing file.
  await page.locator('.pv-peek-actions').getByRole('button', { name: /Schließen|Close/ }).click();
  await page.getByTitle(/Neues Element anlegen|Create a new item/).click();
  await expect(page.getByRole('dialog', { name: /Ablage-Ordner|Storage folder/ })).not.toBeVisible();
  await expect(page.locator('.pv-peek-title')).toContainText('MultiSrc_7');
  const second = await page.evaluate(() => (window as any).mockFs['/test-vault/Kunden/MultiSrc_7.md']);
  expect(second).toContain('type:');
});

test('Base "Neu": without any source the setup dialog creates the folder and adds it as source', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'NoSrc');

  await page.getByTitle(/Neues Element anlegen|Create a new item/).click();
  const dialog = page.getByRole('dialog', { name: /Ablage-Ordner|Storage folder/ });
  await expect(dialog).toBeVisible();
  // The folder input carries a datalist -> its ARIA role is combobox.
  await dialog.getByRole('combobox').fill('Ablage');
  await dialog.getByRole('button', { name: /Festlegen|Set folder/ }).click();

  await expect(page.locator('.pv-peek-title')).toContainText('NoSrc');
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/NoSrc.base']);
  expect(base).toContain('file.folder == "Ablage"');
  expect(base).toContain('newItemFolder: Ablage');
  const folder = await page.evaluate(() => (window as any).mockFs['/test-vault/Ablage']);
  expect(folder && folder.isDir).toBeTruthy();
});

test('Base "Neu" templates: create with a template once and set it as default', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  const chevron = page.getByRole('button', { name: /Vorlagen und Ablage-Ordner|Templates and storage folder/ });
  await chevron.click();
  // Open dropdown adds backdrop+popover into .pv-splitbtn: the chevron must
  // KEEP its half-pill shape (regression: :last-child lost to the popover div).
  await expect(chevron).toHaveCSS('border-top-left-radius', '0px');
  await expect(chevron).toHaveCSS('border-bottom-left-radius', '0px');
  await page.getByRole('button', { name: 'Projektvorlage', exact: true }).click();

  await expect(page.locator('.pv-peek-title')).toContainText('Cockpit_4');
  const file = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Cockpit_4.md']);
  expect(file).toContain('type: Projekt'); // template frontmatter wins over the OKF default
  expect(file).toContain('# Cockpit_4'); // {{title}} interpolated
  expect(file).toContain('okf_version:'); // OKF still completes what is missing

  // Star = base default template, persisted under views[0].plainva.
  await page.locator('.pv-peek-actions').getByRole('button', { name: /Schließen|Close/ }).click();
  await page.getByRole('button', { name: /Vorlagen und Ablage-Ordner|Templates and storage folder/ }).click();
  await page.getByRole('button', { name: /Als Standard setzen|Set as default/ }).last().click();
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(base).toContain('newItemTemplate');
  expect(base).toContain('Projektvorlage.md');
});

// --- Filter groups (plan Base-Neu P10) --------------------------------------

test('Base filter groups: OR group narrows, switches logic and persists single-rooted', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();

  // Draft group with status == active -> Beta (paused) disappears.
  await page.getByRole('button', { name: /Gruppe hinzufügen|Add group/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).last().click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).last().click();
  await page.getByRole('option', { name: 'active', exact: true }).click();
  await expect(table.getByText('Beta')).not.toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();

  // Switch the committed group to "Beliebige" and add prio == 1 as a second rule.
  const group = page.locator('.base-cfg-filtergroup');
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: /Beliebige|Any/ }).click();
  await group.getByRole('button', { name: /Regel hinzufügen|Add rule/ }).click();
  await group.getByRole('button', { name: /Filterspalte|Filter column/ }).last().click();
  await page.getByRole('option', { name: 'Prio', exact: true }).click();
  // prio derives value options from the source rows -> a picker, not free text.
  await group.getByRole('button', { name: /^(Wert|Value)/ }).last().click();
  await page.getByRole('option', { name: '1', exact: true }).click();

  // (status == active) OR (prio == 1): Beta (prio 1) returns, all three visible.
  await expect(table.getByText('Beta')).toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Gamma')).toBeVisible();

  // Persisted single-rooted: the or-group lives INSIDE the and-list.
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(base).toContain('or:');
  expect(base).toContain('status == "active"');
  expect(base).toContain('prio == "1"');
  expect(base.indexOf('file.folder == "Projekte"')).toBeLessThan(base.indexOf('or:'));
});

// --- Delete property (plan Base-Neu P11/P12) --------------------------------

test('Delete property: column vanishes everywhere and the frontmatter is cleaned (checkbox default ON)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  // Scoped to the config panel — the table column header offers the same button.
  await page.getByRole('complementary', { name: /Konfigurieren|Configure/ })
    .getByRole('button', { name: /^(Eigenschaft|Property): status$/ }).click();
  await page.getByRole('button', { name: /Eigenschaft löschen|Delete property/ }).click();

  const dialog = page.getByRole('dialog', { name: /Eigenschaft löschen|Delete property/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toBeChecked(); // maintainer default: ON
  await dialog.getByRole('button', { name: /^(Löschen|Delete)$/ }).click();

  // Column gone from the table, schema/order gone from the file, frontmatter cleaned.
  await expect(table.locator('th', { hasText: 'status' })).not.toBeVisible();
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(base).not.toContain('note.status');
  const alpha = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']);
  expect(alpha).not.toContain('status: active');
  expect(alpha).toContain('prio: 2'); // untouched siblings survive
});

test('Delete relation property: the reverse column in the target base goes along', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await page.getByRole('complementary', { name: /Konfigurieren|Configure/ })
    .getByRole('button', { name: /^(Eigenschaft|Property): kunde$/ }).click();
  await page.getByRole('button', { name: /Eigenschaft löschen|Delete property/ }).click();

  const dialog = page.getByRole('dialog', { name: /Eigenschaft löschen|Delete property/ });
  // The dialog announces the reverse column that will be removed along.
  await expect(dialog.getByText(/projekte/)).toBeVisible();
  await dialog.getByRole('button', { name: /^(Löschen|Delete)$/ }).click();

  await expect(table.locator('th', { hasText: 'kunde' })).not.toBeVisible();
  const cockpit = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(cockpit).not.toContain('note.kunde');
  const target = await page.evaluate(() => (window as any).mockFs['/test-vault/Kundenkartei.base']);
  expect(target).not.toContain('note.projekte');
  const alpha = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Alpha.md']);
  expect(alpha).not.toContain('kunde:');
});

// --- Properties list: drag-reorder rewrites the view's column order (UI-UX P3) ---
test('Konfigurieren: dragging a property row reorders the table columns and persists', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  const grips = page.locator('[aria-label="Eigenschaft verschieben (ziehen)"], [aria-label="Reorder property (drag)"]');
  await expect(grips.first()).toBeVisible();
  expect(await grips.count()).toBeGreaterThan(1);

  const before = await page.locator('table th').allInnerTexts();
  const srcBox = await grips.nth(1).boundingBox();
  const dstBox = await grips.nth(0).boundingBox();
  expect(srcBox && dstBox).toBeTruthy();
  await page.mouse.move(srcBox!.x + srcBox!.width / 2, srcBox!.y + srcBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstBox!.x + dstBox!.width / 2, dstBox!.y + dstBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => await page.locator('table th').allInnerTexts())
    .not.toEqual(before);
  // The new order is persisted into the .base (views[i].order).
  const cockpit = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(String(cockpit)).toContain('order:');
});

test('Column editor: grouped type picker with the panel vocabulary; OKF system fields locked (P7)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Typed.base'] = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '      - note.type',
      '',
    ].join('\n');
  });
  await page.goto('/');
  await openBase(page, 'Typed');
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();

  // Normal property: the grouped picker (same menu as the markdown panel)
  // offers the extended vocabulary — tags/contact types and relation, no link.
  await page.locator('.base-config-panel').getByRole('button', { name: /Eigenschaft: status|Property: status/ }).click();
  const dialog = page.getByRole('dialog', { name: /Eigenschaft: status|Property: status/ });
  await dialog.getByRole('button', { name: /Feldtyp|Field type/ }).click();
  const menu = page.locator('.pv-type-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Tags', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Telefon|Phone/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Relation', exact: true })).toBeVisible();
  // Picking the current type closes the popover (it would otherwise cover the
  // dialog's action row), then leave without saving.
  await menu.getByRole('button', { name: 'Text', exact: true }).click();
  await dialog.getByRole('button', { name: /Abbrechen|Cancel/ }).click();

  // OKF system field `type`: name and field type locked, delete not offered.
  await page.locator('.base-config-panel').getByRole('button', { name: /Eigenschaft: type|Property: type/ }).click();
  const sys = page.getByRole('dialog', { name: /Eigenschaft: type|Property: type/ });
  await expect(sys.getByRole('textbox', { name: 'Name' })).toBeDisabled();
  await expect(sys.getByRole('button', { name: /Feldtyp|Field type/ })).toBeDisabled();
  await expect(sys.getByRole('button', { name: /Eigenschaft löschen|Delete property/ })).toHaveCount(0);
});

// --- Template databases (Gesamtplan DB-Vorlagen 2026-07-04) ------------------

test('Template DB excludes the source folder index.md from the view', async ({ page }) => {
  await page.goto('/');
  // The base file is named distinctly from its source folder to avoid a
  // sidebar name collision (folder "Vorgaenge" vs. base "Ablauf").
  await openBase(page, 'Ablauf');

  const table = page.locator('table');
  await expect(table.getByText('Vorgang A')).toBeVisible({ timeout: 10000 });
  await expect(table.getByText('Vorgang B')).toBeVisible();

  // The folder's managed index.md is dropped by the query layer (OKF reserved
  // name), NOT by a filter — so it must not be a row even though the base has
  // only a plain folder source.
  await expect(table.getByText('index', { exact: true })).toHaveCount(0);
  await expect(table.locator('tbody tr')).toHaveCount(2);
});
