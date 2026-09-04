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
    // S20: an entry that SPANS (15th to 17th) and one that carries a TIME —
    // without both, week and day would render but prove nothing.
    const calSpanStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-15`;
    const calEnd = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-17`;
    const calTimed = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-16T14:30`;
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
      '      endField: end',
      '',
    ].join('\n');

    // S21: a timeline with start, end AND a colour column — a bar one can take
    // hold of only exists when the view has both ends.
    const tlYaml = [
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
      '    name: Zeitleiste',
      '    order:',
      '      - file.name',
      '      - note.status',
      '    plainva:',
      '      render: timeline',
      '      dateField: date',
      '      endField: end',
      '      colorBy: status',
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
      // A rollup over that reverse column: how many of the customer's projects
      // are not done yet (plan Projektwerkzeug S1-S3).
      '  note.offen:',
      '    plainva:',
      '      rollup:',
      '        through: projekte',
      '        of: status',
      '        fn: countWhere',
      '        where:',
      '          op: "!="',
      '          value: done',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.projekte',
      '      - note.offen',
      // Obsidian's own column footer over the rollup column (S5).
      '    summaries:',
      '      note.offen: Sum',
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

    // Pinboard fixture (plan Pinboard P3): a Keep-style view over a Zettel
    // folder; card bodies come from the fts_notes mock below.
    const pinboardYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Zettel"',
      'properties:',
      '  note.frist:',
      '    input: date',
      'views:',
      '  - type: table',
      '    name: Pinnwand',
      '    order:',
      '      - file.name',
      '      - note.frist',
      '    plainva:',
      '      render: pinboard',
      '',
    ].join('\n');

    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Zettel': { isDir: true },
      '/test-vault/Zettel/Einkauf.md': '---\nplainva:\n  header_color: "#c94f4f"\n---\n- [ ] Milch\n- [x] Brot\n',
      '/test-vault/Zettel/Idee.md': '# Solaranlage\n\nDach **pruefen** lassen\n',
      '/test-vault/Zettel/Notiz.md': 'Nur Text\n',
      '/test-vault/Pinnwand.base': pinboardYaml,
      '/test-vault/Kunden': { isDir: true },
      '/test-vault/Templates': { isDir: true },
      '/test-vault/Templates/Projektvorlage.md': '---\ntype: Projekt\nstatus: entwurf\n---\n\n# {{title}}\n\nStart: {{date}}\n',
      '/test-vault/MultiSrc.base': multiSrcYaml,
      '/test-vault/NoSrc.base': noSrcYaml,
      '/test-vault/Projekte/Alpha.md': '---\nstatus: active\nprio: 2\nkunde: "[[ACME]]"\n---\n# Alpha\n\nSee [[Beta]] and [[Tasks.base]]\n',
      '/test-vault/Projekte/Beta.md': '---\nstatus: paused\nprio: 1\nparent: "[[Alpha]]"\nblockedBy:\n  - uid: "[[Gamma]]"\n    reltype: FINISHTOSTART\n---\n# Beta',
      '/test-vault/Projekte/Gamma.md': '---\nstatus: active\nprio: 3\nkunde: "[[Nirgendwo]]"\n---\n# Gamma',
      '/test-vault/Kunden/ACME.md': '---\nbranche: tech\n---\n# ACME',
      '/test-vault/Kunden/Globex.md': '---\nbranche: energie\n---\n# Globex',
      '/test-vault/Cockpit.base': cockpitYaml,
      '/test-vault/Board.base': boardYaml,
      '/test-vault/MultiView.base': multiViewYaml,
      '/test-vault/Cal.base': calYaml,
      '/test-vault/Zeit.base': tlYaml,
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
      { id: '9', path: 'Zettel/Einkauf.md', title: 'Einkauf', mtime_local: 1750000008000, size_bytes: 10 },
      { id: '10', path: 'Zettel/Idee.md', title: 'Idee', mtime_local: 1750000009000, size_bytes: 10 },
      { id: '11', path: 'Zettel/Notiz.md', title: 'Notiz', mtime_local: 1750000010000, size_bytes: 10 },
    ];
    const dbProps: Record<string, { key: string; value: string; type: string }[]> = {
      '1': [{ key: 'status', value: 'active', type: 'text' }, { key: 'prio', value: '2', type: 'number' }, { key: 'tags', value: '["typ/tagebuch","thema/psyche"]', type: 'list' }, { key: 'date', value: calDate, type: 'text' }, { key: 'kunde', value: '[[ACME]]', type: 'text' }],
      '2': [{ key: 'status', value: 'paused', type: 'text' }, { key: 'prio', value: '1', type: 'number' }, { key: 'tags', value: '["typ/tagebuch"]', type: 'list' }, { key: 'parent', value: '[[Alpha]]', type: 'text' }, { key: 'date', value: calTimed, type: 'text' }, { key: 'blockedBy', value: '[{"uid":"[[Gamma]]","reltype":"FINISHTOSTART"}]', type: 'list' }],
      '3': [{ key: 'status', value: 'active', type: 'text' }, { key: 'prio', value: '3', type: 'number' }, { key: 'tags', value: '["thema/psyche"]', type: 'list' }, { key: 'kunde', value: '[[Nirgendwo]]', type: 'text' }, { key: 'date', value: calSpanStart, type: 'text' }, { key: 'end', value: calEnd, type: 'text' }],
      '4': [{ key: 'branche', value: 'tech', type: 'text' }],
      '5': [{ key: 'branche', value: 'energie', type: 'text' }],
      '7': [{ key: 'status', value: 'Offen', type: 'text' }],
      '8': [{ key: 'status', value: 'Erledigt', type: 'text' }],
      '9': [{ key: 'frist', value: '2026-08-01', type: 'text' }],
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
        // The version the marker above is compared against. Without it the
        // command falls through to `null` and every start looks like an update.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          // The splash is the default entry since 2026-07-04 — the suite keeps
          // the old auto-open behavior via the (now opt-in) setting.
          if (args.key === 'autoOpenLastVault') return [true, true];
          // Stage D remounts `App` when the shown vault arrives, which is when
          // the release dialog finally gets a vault to render over. A marker
          // equal to the running version means "already seen" - this suite
          // tests the app, not its first five seconds (onboarding.spec covers
          // those on purpose).
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
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
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
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
          // Pinboard path sweep (P5): the base list for sweepPinboardRefs.
          if (query.includes(`WHERE path LIKE '%.base'`)) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.endsWith('.base'))
              .map(p => ({ path: p.replace('/test-vault/', '') }));
          }
          // Pinboard card data (plan Pinboard P2/P3): body from the FTS mirror
          // (read LIVE from mockFs so checkbox writes show up on re-query),
          // ctime from the files table, tags via the file join.
          if (query.includes('FROM fts_notes WHERE path IN')) {
            return values
              .map((v: any) => {
                const c = fs['/test-vault/' + v];
                return typeof c === 'string' ? { path: v, content: c } : null;
              })
              .filter(Boolean);
          }
          if (query.includes('SELECT path, ctime FROM files WHERE path IN')) {
            return values
              .map((v: any) => {
                const hit = dbFiles.find(f => f.path === v);
                return hit ? { path: v, ctime: hit.mtime_local } : null;
              })
              .filter(Boolean);
          }
          if (query.includes('JOIN files f ON f.id = t.file_id')) {
            const zettelTags: Record<string, string[]> = {
              'Zettel/Einkauf.md': ['einkauf'],
              'Zettel/Notiz.md': ['einkauf', 'ideen'],
            };
            const out: any[] = [];
            for (const v of values) for (const tg of zettelTags[String(v)] ?? []) out.push({ path: v, tag: tg });
            return out;
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
          // Rollup enrichment (plan Projektwerkzeug S2): one joined load of the
          // LINKED notes' properties, keyed by path.
          if (query.includes('LEFT JOIN properties')) {
            const out: any[] = [];
            for (const v of values) {
              const f = dbFiles.find(x => x.path === String(v));
              if (!f) continue;
              const props = dbProps[f.id] || [];
              if (props.length === 0) {
                out.push({ path: f.path, title: f.title, mtime_local: f.mtime_local, size_bytes: f.size_bytes, key: null, value: null, type: null });
                continue;
              }
              for (const pr of props) {
                out.push({ path: f.path, title: f.title, mtime_local: f.mtime_local, size_bytes: f.size_bytes, ...pr });
              }
            }
            return out;
          }
          if (query.includes('FROM properties')) {
            // Two callers, two key shapes: the base viewer passes file IDs,
            // getFileProperties joins on files.path. Accept both so a query by
            // path does not silently come back empty.
            const out: any[] = [];
            for (const v of values) {
              const key = String(v);
              const id = dbFiles.some(f => f.id === key) ? key : (dbFiles.find(f => f.path === key)?.id ?? key);
              for (const p of dbProps[id] || []) out.push({ file_id: id, ...p });
            }
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
          // Lets a test read back what really landed on disk.
          (window as any).__writtenFiles = { ...((window as any).__writtenFiles ?? {}), [p.replace('/test-vault/', '')]: fs[p] };
          // Quick-captured Zettel join the query rows (pinboard P4): the files
          // list is otherwise static, so a fresh note would never render.
          const relVault = p.replace('/test-vault/', '');
          if (relVault.startsWith('Zettel/') && relVault.endsWith('.md') && !dbFiles.some(f => f.path === relVault)) {
            dbFiles.push({ id: 'z' + dbFiles.length, path: relVault, title: relVault.split('/').pop()!.replace(/\.md$/i, ''), mtime_local: 1750000020000, size_bytes: 10 });
          }
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
        if (cmd === 'plugin:fs|rename') {
          const from = String(args.oldPath).replace(/\/$/, '');
          const to = String(args.newPath).replace(/\/$/, '');
          if (fs[from] !== undefined) {
            fs[to] = fs[from];
            delete fs[from];
          }
          const relFrom = from.replace('/test-vault/', '');
          const relTo = to.replace('/test-vault/', '');
          const row = dbFiles.find(f => f.path === relFrom);
          if (row) {
            row.path = relTo;
            row.title = relTo.split('/').pop()!.replace(/\.md$/i, '');
          }
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

// Config redesign 2026-07-18: the panel shows one AREA per tab. Reach a
// non-default area (view is the default) by clicking its icon tab.
const CFG_TAB = {
  view: /^(Ansicht|View)$/,
  columns: /^(Eigenschaften|Properties)$/,
  filter: /^Filter$/,
  sort: /^(Sortierung|Sort)$/,
  source: /^(Datenquelle|Data source)$/,
} as const;
async function configTab(page: Page, area: keyof typeof CFG_TAB) {
  await page.locator('.base-config-panel').getByRole('tab', { name: CFG_TAB[area] }).click();
}

// The database context line is the first child of the document pane, so with a
// zero top margin its chips sat exactly on the toolbar's bottom rule and read
// as colliding with it.
test('The database context line keeps clear of the toolbar rule above it', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Projekte"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Projekte"]').click();
  await aside.locator('[data-tree-path="Projekte/Beta.md"]').click();

  const bar = page.getByTestId('note-db-bar');
  await expect(bar).toBeVisible({ timeout: 10000 });
  const toolbar = (await page.getByTestId('editor-toolbar').first().boundingBox())!;
  const chip = (await bar.locator('.pv-dbbar-chip').first().boundingBox())!;
  expect(chip.y, 'the chip overlaps the toolbar rule')
    .toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 4);
});

// --- The sidebar's "Databases" section is an entry inspector (plan P2) ------
// Opening a note that is a row of a database used to say only WHICH database
// it belonged to. It now shows the note's values for that database's columns,
// in the database's own order, and steps to the neighbouring entry.
test('Entry inspector: the sidebar shows the database columns and steps to the neighbour', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Projekte"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Projekte"]').click();
  await aside.locator('[data-tree-path="Projekte/Beta.md"]').click();

  const right = page.locator('aside[aria-label="Right Sidebar"]');
  // Sidebar sections remember their open state per device; a fresh profile
  // starts them collapsed, so the section has to be opened first.
  await right.getByRole('button', { name: /Datenbanken|Databases/ }).click();
  const grid = right.locator('.pv-dbinsp-grid').first();
  await expect(grid).toBeVisible({ timeout: 10000 });

  // Beta's own values for the Cockpit's columns \u2014 the properties panel would
  // list raw frontmatter; this is the row as its database sees it.
  await expect(grid).toContainText('paused');

  // Position in the view, and a step to the neighbour.
  const pos = right.locator('.pv-dbinsp-pos').first();
  await expect(pos).toHaveText(/[0-9]+ . [0-9]+/);
  const before = await pos.innerText();
  await right.getByRole('button', { name: /Nächster Eintrag|Next entry/i }).first().click();
  await expect(right.locator('.pv-dbinsp-pos').first()).not.toHaveText(before);
});

// A 232px sidebar is a real width — the plan calls it out by name. The grid has
// to give up its second column before the editors get squeezed.
test('Entry inspector: the key/value grid stacks in a narrow sidebar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plainva-right-sidebar-width', '210'));
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Projekte"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Projekte"]').click();
  await aside.locator('[data-tree-path="Projekte/Beta.md"]').click();

  const right = page.locator('aside[aria-label="Right Sidebar"]');
  await expect(right.locator('.pv-side-right')).toHaveAttribute('data-side-step', /compact|minimal/);
  await right.getByRole('button', { name: /Datenbanken|Databases/ }).click();
  const grid = right.locator('.pv-dbinsp-grid').first();
  await expect(grid).toBeVisible({ timeout: 10000 });

  // One column, not two: the label sits above its value.
  const cols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  expect(cols.trim().split(/\s+/).length).toBe(1);
});

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
  await configTab(page, 'sort');
  await page.getByRole('button', { name: /Sortierung hinzufügen|Add sort/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Alpha');
  await page.getByRole('button', { name: /Aufsteigend|Ascending/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Gamma');

  // Add a property filter status == active via the draft row.
  await configTab(page, 'filter');
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
// Issue #34: "Creating a new entry … doesn't allow you to choose a name or
// rename it or delete it, other than by renaming or deleting the linked file."
// No base view had a row menu, and the peek hides the editor's ⋮.
test('Base table: right-clicking a row renames the entry and carries its heading', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();
  await table.locator('tbody tr').filter({ hasText: 'Alpha' }).click({ button: 'right' });

  await page.getByRole('menuitem', { name: /Umbenennen|Rename/ }).click();
  const dlg = page.getByRole('dialog', { name: /Umbenennen|Rename/ });
  await expect(dlg).toBeVisible();
  const input = dlg.getByRole('textbox');
  await expect(input).toHaveValue('Alpha');
  await input.fill('Fencing quote');
  await dlg.getByRole('button', { name: /Confirm|Bestätigen/ }).click();

  // The rename runs write → move → reindex, so poll the disk rather than
  // reading it once (a single read raced the move under full-suite load).
  await expect
    .poll(() =>
      page.evaluate(() => '/test-vault/Projekte/Alpha.md' in (window as any).mockFs),
    )
    .toBe(false);
  // The heading mirrored the file name, so it travels with it — otherwise the
  // note would still call itself "Alpha" in its own text.
  const renamed = await page.evaluate(
    () => (window as any).mockFs['/test-vault/Projekte/Fencing quote.md'] as string,
  );
  expect(renamed).toContain('# Fencing quote');
});

test('Base filter on a list property: "is" matches membership and the value dropdown survives', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  // Add the filter tags == typ/tagebuch via the config panel's draft row.
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await configTab(page, 'filter');
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'typ/tagebuch', exact: true }).click();

  // Rows carrying the tag stay; only the untagged row disappears.
  await expect(table.getByText('Gamma')).not.toBeVisible();
  await expect(table.getByText('Alpha')).toBeVisible();
  await expect(table.getByText('Beta')).toBeVisible();

  // Committed rules render as chip sentences (config redesign P4); click the
  // chip to re-open its editor. The value editor is still a dropdown and still
  // offers the full source vocabulary (not just the surviving values).
  await page.locator('.base-cfg-chipsentence').first().click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await expect(page.getByRole('option', { name: 'thema/psyche', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Base board: pointer drag moves a card and writes the frontmatter', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Board');

  // Wait for the two group columns and the card.
  const card = page.locator('[data-tip="Alpha"]');
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

  // Pick the folder via the BROWSABLE picker (2026-07-17): it walks the live
  // file system, so the click descends into "Projekte" and the footer button
  // confirms it — the probe query then reports the matching notes.
  await page.getByRole('button', { name: /Ordner auswählen…|Choose folder…/ }).click();
  await page.locator('.pv-modal').getByText('Projekte', { exact: true }).click();
  await page.getByRole('button', { name: /Diesen Ordner verwenden|Use this folder/ }).click();
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
  // The row now also carries the selection checkbox — say which input is meant.
  const input = row.locator('td:not(.pv-selcol) input');
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
  const card = page.locator('[data-tip="Alpha"]');
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
  const card = page.locator('[data-tip="Alpha"]');
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
  const card = page.locator('[data-tip="Alpha"]');
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
  await page.locator('[data-tip="Alpha"]').click();

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
  const card = page.locator('[data-tip="Alpha"]');
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
  await configTab(page, 'filter');
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
  await configTab(page, 'filter');
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
  await configTab(page, 'columns');
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

test('Wizard: a brand-new EMPTY folder is pickable via the browsable picker; tag sources keep their dropdown (P8/F4)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').getByText('Cockpit', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'base' } })));
  await page.keyboard.type('Zwei');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Neue Datenbank|New database/).first()).toBeVisible();

  const wizard = page.getByTestId('base-create-wizard');
  // First source: the picker's "new folder" row creates an EMPTY folder and
  // descends into it — the maintainer's F4 case (the old index-backed dropdown
  // could never offer a folder without indexed files).
  await wizard.getByRole('button', { name: /Ordner auswählen…|Choose folder…/ }).click();
  const picker = page.locator('.pv-modal');
  await picker.getByPlaceholder(/Neuer Ordner|New folder/).fill('Leerbereich');
  await picker.getByRole('button', { name: /^(Anlegen|Create)$/ }).click();
  await picker.getByRole('button', { name: /Diesen Ordner verwenden|Use this folder/ }).click();
  expect(await page.evaluate(() => !!(window as any).mockFs['/test-vault/Leerbereich']?.isDir)).toBe(true);

  // The add row still offers the type select — switch to tag, add via dropdown.
  await wizard.getByRole('button', { name: /Quelle|Source/ }).click();
  await page.getByRole('option', { name: 'Tag', exact: true }).click();
  await wizard.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('option', { name: '#projekt', exact: true }).click();

  // Both conditions landed as rows — never a free-text fallback.
  await expect(wizard.getByText('Leerbereich', { exact: true })).toBeVisible();
  await expect(wizard.getByText('#projekt', { exact: true })).toBeVisible();

  // The wizard opens WITHOUT a BaseViewer (file tree / settings), and the
  // base-cfg-* rules used to be an inline <style> that only the viewer rendered
  // — so this dialog came up completely unstyled (maintainer report
  // 2026-07-27). Pin that its stylesheet is actually in effect here.
  const card = wizard.locator('.base-cfg-card').first();
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe('0px');

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
  await betaRow.locator('td:not(.pv-selcol)').last().click();

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
  await betaRow.locator('td:not(.pv-selcol)').last().click();

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
  await configTab(page, 'columns');
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
  // Address the reverse column by POSITION IN THE ORDER, not as "the last cell":
  // the base now also carries a rollup, and the last cell is that one.
  await globexRow.locator('td:not(.pv-selcol)').nth(1).click();
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
  const alphaCard = page.locator('[data-tip="Alpha"]');
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
  await configTab(page, 'columns');
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
  await configTab(page, 'filter');
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

  await page.locator('[data-tip="Neues Element anlegen"], [data-tip="Create a new item"]').click();

  // Name = "{base stem} {count+1}", straight into the peek window.
  await expect(page.locator('.pv-peek-title')).toContainText('Cockpit_4');
  const file = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Cockpit_4.md']);
  expect(file).toContain('type:');
  expect(file).not.toContain('okf_version:'); // OKF v0.2: the bundle version lives in the root index.md only
  expect(file).toContain('# Cockpit_4'); // template-less items start with an H1 (UI-UX P6)
});

test('Base "Neu": several folder sources ask once and persist the choice in the .base', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiSrc');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.locator('[data-tip="Neues Element anlegen"], [data-tip="Create a new item"]').click();
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
  await page.locator('[data-tip="Neues Element anlegen"], [data-tip="Create a new item"]').click();
  await expect(page.getByRole('dialog', { name: /Ablage-Ordner|Storage folder/ })).not.toBeVisible();
  await expect(page.locator('.pv-peek-title')).toContainText('MultiSrc_7');
  const second = await page.evaluate(() => (window as any).mockFs['/test-vault/Kunden/MultiSrc_7.md']);
  expect(second).toContain('type:');
});

test('Base "Neu": without any source the setup dialog creates the folder and adds it as source', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'NoSrc');

  await page.locator('[data-tip="Neues Element anlegen"], [data-tip="Create a new item"]').click();
  const dialog = page.getByRole('dialog', { name: /Ablage-Ordner|Storage folder/ });
  await expect(dialog).toBeVisible();
  // Plain text input since the browsable picker replaced the index-backed
  // datalist (2026-07-17) — locate it by its aria-label.
  await dialog.getByRole('textbox', { name: /Ablage-Ordner|Storage folder/ }).fill('Ablage');
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
  // The template is not assigned to this base, so it sits behind the expander
  // (plan Vorlagen-Datenbank-Zuordnung, decision E2).
  await page.getByRole('button', { name: /Alle Vorlagen anzeigen|Show all templates/ }).click();
  await page.getByRole('button', { name: 'Projektvorlage', exact: true }).click();

  await expect(page.locator('.pv-peek-title')).toContainText('Cockpit_4');
  const file = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Cockpit_4.md']);
  expect(file).toContain('type: Projekt'); // template frontmatter wins over the OKF default
  expect(file).toContain('# Cockpit_4'); // {{title}} interpolated
  expect(file).not.toContain('okf_version:'); // OKF v0.2: notes never carry the bundle version

  // Star = base default template, persisted under views[0].plainva.
  await page.locator('.pv-peek-actions').getByRole('button', { name: /Schließen|Close/ }).click();
  await page.getByRole('button', { name: /Vorlagen und Ablage-Ordner|Templates and storage folder/ }).click();
  await page.getByRole('button', { name: /Alle Vorlagen anzeigen|Show all templates/ }).click();
  await page.getByRole('button', { name: /Als Standard setzen|Set as default/ }).last().click();
  const base = await page.evaluate(() => (window as any).mockFs['/test-vault/Cockpit.base']);
  expect(base).toContain('newItemTemplate');
  expect(base).toContain('Projektvorlage.md');

  // D1: as the base's DEFAULT template it moves into the primary group of the
  // still-open menu — and the expander disappears because nothing else is left.
  await expect(page.getByRole('button', { name: 'Projektvorlage', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alle Vorlagen anzeigen|Show all templates/ })).toHaveCount(0);
});

test('Template-database assignment: quick-assign regroups the menu, entries never inherit templateFor, new templates auto-assign', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  const chevron = page.getByRole('button', { name: /Vorlagen und Ablage-Ordner|Templates and storage folder/ });
  await chevron.click();
  // Unassigned template: empty-state hint, row only behind the expander.
  await expect(page.getByText(/Noch keine Vorlage dieser Datenbank zugeordnet|No template assigned to this database yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projektvorlage', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Alle Vorlagen anzeigen \(1\)|Show all templates \(1\)/ }).click();
  await expect(page.getByRole('button', { name: 'Projektvorlage', exact: true })).toBeVisible();

  // Quick-assign (plan D3) writes plainva.templateFor into the template file…
  await page.getByRole('button', { name: /Dieser Datenbank zuordnen|Assign to this database/ }).click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Templates/Projektvorlage.md']))
    .toContain('[[Cockpit.base]]');
  // …and the reloaded menu shows the row in the primary group, expander gone.
  await expect(page.getByText(/Noch keine Vorlage dieser Datenbank zugeordnet|No template assigned to this database yet/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Projektvorlage', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alle Vorlagen anzeigen|Show all templates/ })).toHaveCount(0);

  // An entry created from the assigned template must NOT inherit templateFor.
  await page.getByRole('button', { name: 'Projektvorlage', exact: true }).click();
  await expect(page.locator('.pv-peek-title')).toContainText('Cockpit_4');
  const item = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Cockpit_4.md']);
  expect(item).toContain('type: Projekt');
  expect(item).not.toContain('templateFor');
  await page.locator('.pv-peek-actions').getByRole('button', { name: /Schließen|Close/ }).click();

  // "Create new template" from this base starts assigned to it (plan P3).
  await page.getByRole('button', { name: /Vorlagen und Ablage-Ordner|Templates and storage folder/ }).click();
  await page.getByRole('button', { name: /Neue Vorlage erstellen|Create new template/ }).click();
  await expect
    .poll(async () =>
      await page.evaluate(() =>
        Object.keys((window as any).mockFs).some(
          (k) => k.startsWith('/test-vault/Templates/') && !k.includes('Projektvorlage')
        )
      )
    )
    .toBe(true);
  const newTpl = await page.evaluate(() => {
    const key = Object.keys((window as any).mockFs).find(
      (k) => k.startsWith('/test-vault/Templates/') && !k.includes('Projektvorlage')
    );
    return key ? (window as any).mockFs[key] : '';
  });
  expect(newTpl).toContain('templateFor');
  expect(newTpl).toContain('[[Cockpit.base]]');
});

// --- Filter groups (plan Base-Neu P10) --------------------------------------

test('Base filter groups: OR group narrows, switches logic and persists single-rooted', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  const table = page.locator('table');
  await expect(table.getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await configTab(page, 'filter');

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
  await configTab(page, 'columns');
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
  await configTab(page, 'columns');
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
  await configTab(page, 'columns');
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
  await configTab(page, 'columns');

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

test('pinboard: cards render note bodies; checkbox and pin write back to the files', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Pinnwand');

  // All three Zettel render as cards; the body is RENDERED markdown (bold),
  // a leading H1 becomes the card title (dedupe) and stays out of the body.
  const cards = page.locator('[data-pinboard-card]');
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: 'Solaranlage' }).locator('strong', { hasText: 'pruefen' })).toBeVisible();

  // The note's plainva.header_color tints its card (E7) — computed background
  // differs from an untinted card.
  const einkauf = cards.filter({ hasText: 'Milch' });
  const tinted = await einkauf.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plain = await cards.filter({ hasText: 'Nur Text' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(tinted).not.toBe(plain);

  // Enabled view properties render on the card (maintainer 2026-07-17): the
  // view's order ticks note.frist (a date), so the card shows the labelled
  // formatted value; cards without the property show no property block.
  await expect(einkauf.locator('[data-pinboard-props]')).toContainText('Frist');
  await expect(einkauf.locator('[data-pinboard-props]')).toContainText('2026');
  await expect(cards.filter({ hasText: 'Nur Text' }).locator('[data-pinboard-props]')).toHaveCount(0);

  // Checkbox toggle writes [x] into the note through the adapter chain and the
  // board re-renders from the fresh FTS content (plainva-note-saved channel).
  await einkauf.locator('input[type="checkbox"]').first().click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Zettel/Einkauf.md']))
    .toContain('- [x] Milch');

  // Pin via the hover control: the card moves into the pinned section and the
  // arrangement persists into the .base file (views[i].plainva.pinboardPinned).
  const idee = cards.filter({ hasText: 'Solaranlage' });
  await idee.hover();
  await idee.getByRole('button', { name: /Anpinnen|Pin/ }).click();
  await expect(page.getByText(/^(Angepinnt|Pinned)$/)).toBeVisible();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']))
    .toContain('pinboardPinned');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']))
    .toContain('Zettel/Idee.md');
});

test('pinboard: renaming a note in the tree retargets its pinned arrangement in the .base (P5 sweep)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Pinnwand');
  const cards = page.locator('[data-pinboard-card]');
  await expect(cards).toHaveCount(3);

  // Pin the Idee card so the arrangement carries its path.
  const idee = cards.filter({ hasText: 'Solaranlage' });
  await idee.hover();
  await idee.getByRole('button', { name: /Anpinnen|Pin/ }).click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']))
    .toContain('Zettel/Idee.md');

  // Rename the note through the file tree (inline rename) — the shared
  // renameFileWithLinkUpdates sweep must rewrite the pinboard path.
  const tree = page.getByTestId('file-tree');
  await tree.getByText('Zettel', { exact: true }).click();
  // The mock index titles carry the relative path, so the row reads "Zettel/Idee".
  await tree.getByText(/(^|\/)Idee$/).click({ button: 'right' });
  await page.getByText(/^(Umbenennen|Rename)$/).click();
  const field = tree.locator('input');
  await expect(field).toBeVisible();
  await field.fill('Idee Neu');
  await field.press('Enter');

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']))
    .toContain('Zettel/Idee Neu.md');
  const baseText = await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']);
  expect(baseText).not.toContain('Zettel/Idee.md');
  await page.evaluate(() => (window as any).mockFs['/test-vault/Zettel/Idee Neu.md'] !== undefined);
});

test('pinboard: chip bar filters by tags (AND, session-local) and quick capture creates a note', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Pinnwand');
  const cards = page.locator('[data-pinboard-card]');
  await expect(cards).toHaveCount(3);

  // Tag chips with counts; clicking #ideen narrows to the one carrying it.
  await expect(page.locator('[data-pinboard-chip="einkauf"]')).toContainText('2');
  await page.locator('[data-pinboard-chip="ideen"]').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Nur Text');
  // The selection is session-local: nothing was written to the .base file.
  const baseText = await page.evaluate(() => (window as any).mockFs['/test-vault/Pinnwand.base']);
  expect(baseText).not.toContain('ideen');
  await page.locator('[data-pinboard-chip="ideen"]').click();
  await expect(cards).toHaveCount(3);

  // Quick capture via the Keep-style title popup (2026-07-17): a typed title
  // becomes the file name AND the H1; the text is the body.
  await page.locator('[data-pinboard-capture]').click();
  await page.locator('[data-pinboard-capture-title]').fill('Schnell notiert');
  await page.locator('[data-pinboard-capture-text]').fill('und mehr Text');
  await page.locator('[data-pinboard-capture-save]').click();
  await expect(cards).toHaveCount(4);
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Zettel/Schnell notiert.md']))
    .toContain('und mehr Text');
  const captured = await page.evaluate(() => (window as any).mockFs['/test-vault/Zettel/Schnell notiert.md']);
  expect(captured).toContain('type:');
  expect(captured).toContain('# Schnell notiert');

  // WITHOUT a title the file gets a timestamp name ("YYYY-MM-DD HH.mm.ss")
  // and the note has no H1 — the text is the whole body.
  await page.locator('[data-pinboard-capture]').click();
  await page.locator('[data-pinboard-capture-text]').fill('Nur Body ohne Titel');
  await page.locator('[data-pinboard-capture-save]').click();
  await expect(cards).toHaveCount(5);
  const timestampFile = await expect
    .poll(async () =>
      await page.evaluate(() =>
        Object.keys((window as any).mockFs).find((p) =>
          /^\/test-vault\/Zettel\/\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.md$/.test(p),
        ),
      ),
    )
    .toBeTruthy()
    .then(async () =>
      page.evaluate(() =>
        Object.keys((window as any).mockFs).find((p) =>
          /^\/test-vault\/Zettel\/\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.md$/.test(p),
        ),
      ),
    );
  const tsContent = await page.evaluate((p) => (window as any).mockFs[p as string], timestampFile);
  expect(tsContent).toContain('Nur Body ohne Titel');
  expect(tsContent).not.toContain('# ');
});


// --- Config redesign 2026-07-18 (variant C): reiter panel ---
test('Config reiter: tabs switch areas; view-type tile grid; filter shows a chip sentence', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  const panel = page.locator('.base-config-panel');
  await expect(panel).toBeVisible();

  // The area tabs are an icon-only segmented control (maintainer 2026-07-18):
  // no visible label text, but each tab keeps an accessible name.
  await expect(panel.locator('.base-cfg-tab').first()).toHaveText('');
  await expect(panel.getByRole('tab', { name: /^(Ansicht|View)$/ })).toBeVisible();

  // The panel opens on the VIEW area: the view-type tile grid (icon tiles for
  // all view types) is shown, with the current type (Table) marked active.
  const tiles = panel.locator('.base-cfg-typetile');
  await expect(tiles).toHaveCount(8);
  await expect(panel.locator('.base-cfg-typetile.active')).toHaveText(/Tabelle|Table/);
  await expect(panel.getByRole('radio', { name: /^(Board)$/ })).toBeVisible();

  // The Columns tab shows the visible/hidden split (not the view tiles).
  await configTab(page, 'columns');
  await expect(tiles).toHaveCount(0);
  await expect(panel.getByText(/^(Sichtbar|Visible)$/)).toBeVisible();

  // The Filter tab: a committed rule renders as a readable chip sentence.
  await configTab(page, 'filter');
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: /^(Wert|Value)/ }).click();
  await page.getByRole('option', { name: 'active', exact: true }).click();
  const chip = panel.locator('.base-cfg-chipsentence').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/Status/);
  await expect(chip).toContainText('active');
});

test('Sub-items lives in the data-source tab for every view type; graph shows the compat hint', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');
  await expect(page.locator('table').getByText('Alpha')).toBeVisible();

  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  const panel = page.locator('.base-config-panel');
  await expect(panel).toBeVisible();

  // Sub-items is a database-STRUCTURE control (a self-relation), so it lives in
  // the data-source tab — and shows for every view type, not just the table
  // (maintainer 2026-07-18). Table view first:
  await configTab(page, 'source');
  await expect(panel.getByText(/^(Unterelemente|Sub-items)$/).first()).toBeVisible();

  // Switch the view type to List, then back to the data-source tab: the
  // sub-items control must still be there (it is not table-gated any more).
  await configTab(page, 'view');
  await panel.getByRole('radio', { name: /^(Liste|List)$/ }).click();
  await configTab(page, 'source');
  await expect(panel.getByText(/^(Unterelemente|Sub-items)$/).first()).toBeVisible();

  // Every Plainva-only view type shows the Obsidian-compatibility hint, incl.
  // graph (previously only board/calendar/timeline warned).
  await configTab(page, 'view');
  await panel.getByRole('radio', { name: /^(Graph)$/ }).click();
  await expect(page.getByRole('button', { name: /Trotzdem verwenden|Use anyway/ })).toBeVisible();
});

// --- Plan 2026-07-25 P4: a note opened on its own says which database it is in ---

test('Database context: opening an entry directly shows its databases and its parent', async ({ page }) => {
  // The gap this closes: reached from the tree, from search or through a link,
  // a database entry looked like any loose note — nothing said it was a row in
  // a database, let alone which one or under which parent.
  await page.goto('/');
  await expect(page.getByText('Projekte', { exact: true })).toBeVisible({ timeout: 10000 });

  // Reached through the file tree — i.e. WITHOUT any database on screen, which
  // is exactly the situation the bar is there for.
  await page.getByText('Projekte', { exact: true }).click();
  await page.locator('[data-tree-path="Projekte/Beta.md"]').click();

  const bar = page.getByTestId('note-db-bar');
  await expect(bar).toBeVisible({ timeout: 10000 });

  // Beta sits in several databases over the Projekte folder — all of them are
  // named (E6: no silent truncation), and the chip opens the database.
  await expect(bar.getByRole('button', { name: /Cockpit/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /Tasks/ })).toBeVisible();

  // Tasks.base declares sub-items via `parent`, and Beta's parent is Alpha —
  // so the trail reads Alpha › Beta rather than just naming the database.
  await expect(bar.getByRole('button', { name: /^Alpha$/ })).toBeVisible();
  await expect(bar).toContainText('Beta');

  await bar.getByRole('button', { name: /Cockpit/ }).click();
  await expect(page.getByRole('tab').filter({ hasText: 'Cockpit' })).toBeVisible();
});

test('the calendar view has three periods, and a spanning entry is one bar (S20)', async ({ page }) => {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const dayKey = (d: number) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(d)}`;

  // The fixture puts its entries on the 15th to the 17th of the CURRENT month, and
  // the week assertion below reads the column of the 16th. That only holds while
  // today falls in the same week as the 16th — so this test was green for a few
  // days a month and red for the rest: on 2026-08-18 the 16th (a Sunday) had moved
  // into the previous week and its column was not rendered at all. Pinning the
  // browser clock to the 16th makes month, week and day deterministic without
  // touching what is asserted. Same class of defect as the frozen clock in
  // taskCompletion.test.ts.
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), 16, 12, 0, 0));

  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Cal.base"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Cal.base"]').click();

  // The month is the default. The spanning entry (15th to 17th) is drawn as a
  // BAR — once per week row it touches, clipped at the edge, never as a chip on
  // each of its days. Whether that is one bar or two depends on where the week
  // boundary falls this month, which is exactly what "clipped, not repeated"
  // means; what must hold is that the days it covers carry no entry chip.
  await expect(page.getByTestId('base-span-bar').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('base-span-bar').first()).toContainText('Gamma');
  await expect(page.getByTestId(`base-day-${dayKey(16)}`).getByText('Gamma')).toHaveCount(0);

  // Week: the timed entry shows its clock time — a date column that carries one
  // must not lose it just because the cell is small.
  await page.getByTestId('base-range-week').click();
  await expect(page.getByTestId(`base-day-${dayKey(16)}`)).toContainText('14:30');

  // Day: exactly one column.
  await page.getByTestId('base-range-day').click();
  await expect(page.getByTestId(/^base-day-/)).toHaveCount(1);

  await page.getByTestId('base-range-month').click();
  await expect(page.getByTestId('base-span-bar').first()).toBeVisible();
});

test('a column footer sums the column it is configured on, and leaves the others blank', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Kundenkartei.base"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Kundenkartei.base"]').click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });

  // ACME has one open project, Globex none — the footer says 1 (S5).
  const foot = page.getByTestId('base-summary');
  await expect(foot).toBeVisible();
  const cells = foot.locator('td:not(.pv-selcol)');
  await expect(cells.nth(2)).toHaveText(/1$/);
  // A column without a summary stays empty rather than borrowing a number.
  await expect(cells.nth(0)).toHaveText('');
  await expect(cells.nth(1)).toHaveText('');
});

test('the timeline draws milestones as diamonds and dependencies as arrows', async ({ page }) => {
  // The fixture puts Alpha/Beta/Gamma on the 15th to the 17th of the CURRENT
  // month, while the timeline shows a 21-day window that `windowAround` starts
  // at today MINUS 7 days. So the 15th drops out of view the moment today
  // passes the 22nd: this case was green on 2026-08-22 and red on the 23rd
  // without a line of code changing. Pinning the browser clock to the 16th
  // keeps the whole fixture in the window without touching what is asserted.
  // Same class as the pinned clock in the calendar-periods case above.
  const pinned = new Date();
  await page.clock.setFixedTime(new Date(pinned.getFullYear(), pinned.getMonth(), 16, 12, 0, 0));
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Zeit.base"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Zeit.base"]').click();

  // Alpha and Beta have a date and NO end — a moment, not a span. They render
  // as diamonds; Gamma, which has both, stays a bar (plan Projektwerkzeug S7).
  await expect(page.locator('[data-testid="tl-milestone"][data-path="Projekte/Alpha.md"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="tl-milestone"][data-path="Projekte/Beta.md"]')).toBeVisible();
  await expect(page.locator('[data-testid="tl-bar"][data-path="Projekte/Gamma.md"]')).toBeVisible();
  // A bar and a diamond are different shapes, not the same shape twice.
  await expect(page.locator('[data-testid="tl-bar"][data-path="Projekte/Alpha.md"]')).toHaveCount(0);

  // Beta waits for Gamma (`blockedBy` in its frontmatter): one arrow, drawn in
  // the overlay above the rows (S9).
  const deps = page.getByTestId('tl-deps');
  await expect(deps).toBeVisible();
  const arrow = deps.locator('path[marker-end]');
  await expect(arrow).toHaveCount(1);

  // The arrow has to END on Beta's row, not merely exist. The first draft
  // derived the vertical position from a constant row height and from a grid
  // that included the day header — the line landed a whole row too high, and
  // an assertion that only counted arrows called that green.
  const arrowEndY = await arrow.evaluate((el) => {
    const svg = el.closest('svg')!.getBoundingClientRect();
    const b = (el as SVGGraphicsElement).getBoundingClientRect();
    // `M x1 y1 H mid V y2 H x2` — the last segment runs at y2, the bottom or
    // top edge of the box depending on direction. Take the end point directly.
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength());
    return { y: p.y + svg.top, boxTop: b.top };
  });
  const betaBox = await page.locator('[data-testid="tl-milestone"][data-path="Projekte/Beta.md"]').boundingBox();
  expect(betaBox).not.toBeNull();
  const betaCentre = betaBox!.y + betaBox!.height / 2;
  expect(Math.abs(arrowEndY.y - betaCentre)).toBeLessThan(12);
});

test('the timeline is a row per entry, and dragging an edge writes the end (S21)', async ({ page }) => {
  // The fixture puts Alpha/Beta/Gamma on the 15th to the 17th of the CURRENT
  // month, while the timeline shows a 21-day window that `windowAround` starts
  // at today MINUS 7 days. So the 15th drops out of view the moment today
  // passes the 22nd: this case was green on 2026-08-22 and red on the 23rd
  // without a line of code changing. Pinning the browser clock to the 16th
  // keeps the whole fixture in the window without touching what is asserted.
  // Same class as the pinned clock in the calendar-periods case above.
  const pinned = new Date();
  await page.clock.setFixedTime(new Date(pinned.getFullYear(), pinned.getMonth(), 16, 12, 0, 0));
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.locator('[data-tree-path="Zeit.base"]')).toBeVisible({ timeout: 10000 });
  await aside.locator('[data-tree-path="Zeit.base"]').click();

  // A bar per entry, and a today line across all of them.
  const bars = page.getByTestId('tl-bar');
  await expect(bars.first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('tl-today-line')).toBeVisible();

  // The colour follows the status column: the bar takes a PALETTE slot rather
  // than the accent. (Which slot two different values land on is the palette's
  // business — asserting they differ would be asserting a hash.)
  const gamma = page.locator('[data-testid="tl-bar"][data-path="Projekte/Gamma.md"]');
  await expect(gamma).toHaveAttribute('style', /--chip-\d+-bg/);

  // Drag Gamma's right edge two days further and the END column is written —
  // the whole point of the step.
  const handle = gamma.getByTestId('tl-handle-end');
  // Three weeks are wider than the window — scrolling to the handle first is
  // both what a user does and what proves the column arithmetic survives a
  // horizontal scroll.
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 112, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const expected = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-19`;
  await expect
    .poll(async () => await page.evaluate(() => (window as any).__writtenFiles?.['Projekte/Gamma.md'] ?? ''), { timeout: 8000 })
    .toContain(expected);
});

test('a rollup column shows the computed value and refuses to be edited', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Kundenkartei');
  await expect(page.locator('table').getByText('ACME')).toBeVisible();

  // ACME has one project (Alpha, status "active"), Globex has none. The rollup
  // counts the linked projects that are not done.
  const acmeRow = page.locator('table tbody tr').filter({ hasText: 'ACME' });
  const globexRow = page.locator('table tbody tr').filter({ hasText: 'Globex' });
  await expect(acmeRow.locator('td:not(.pv-selcol)').nth(2)).toHaveText('1');
  // Nothing linked is a real zero here — count measures notes, not values.
  await expect(globexRow.locator('td:not(.pv-selcol)').nth(2)).toHaveText('0');

  // Double-clicking a derived cell must not open an editor: the number does not
  // live in this note, so there is nothing here to type into.
  await acmeRow.locator('td:not(.pv-selcol)').nth(2).dblclick();
  await expect(acmeRow.locator('td:not(.pv-selcol)').nth(2).locator('input, textarea')).toHaveCount(0);
  await expect(acmeRow.locator('td:not(.pv-selcol)').nth(2)).toHaveText('1');
});

// S18: an empty view offers the one action the surface can keep. Five views
// each carried a bare sentence and the list view had none at all — a database
// with no matching entries rendered a blank canvas next to a "+ Eintrag"
// button the empty state never mentioned.
test('Base empty view: the sentence carries the create action (S18)', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'MultiView');
  await page.getByText('Liste', { exact: true }).click();
  await expect(page.locator('.base-view-tab.active')).toContainText('Liste');

  // Filter the list down to nothing: every row HAS a status, so "is empty"
  // matches none. (A free-text value would need the value combobox to accept
  // an unknown entry — the operator is the shorter honest route to zero rows.)
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await configTab(page, 'filter');
  await page.getByRole('button', { name: /Filter hinzufügen|Add filter/ }).click();
  await page.getByRole('button', { name: /Filterspalte|Filter column/ }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: /Filteroperator|Filter operator/ }).click();
  await page.getByRole('option', { name: /^(ist leer|is empty)$/ }).click();

  // Scoped by its action: since the Design-Runde (E3) every empty list in the
  // window says so through the same primitive, so the bare class matches the
  // sidebar's empty bookmarks as well.
  const empty = page.locator('.pv-empty', { has: page.getByTestId('base-empty-new') });
  await expect(empty).toBeVisible({ timeout: 10000 });
  await expect(empty.getByTestId('base-empty-new')).toBeVisible();
});

// Plan Mehrfachauswahl (2026-08-19): the click in a database view was already
// spoken for — a cell click opens the inline editor, a list title opens the
// note — so selecting several rows needed a surface of its own.
test('Base table: the checkbox column selects rows and the bar replaces the toolbar', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  const table = page.locator('table');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  // Nothing selected: the ordinary toolbar is there, the bar is not.
  await expect(page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ })).toBeVisible();
  await expect(page.getByTestId('base-selbar')).toHaveCount(0);

  await page.getByTestId('base-select-row').first().click();

  // The bar took the toolbar's place — it did not stack under it.
  await expect(page.getByTestId('base-selbar')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ })).toHaveCount(0);
  await expect(page.getByTestId('base-selbar')).toContainText(/1/);
  await expect(page.locator('tr.is-selected')).toHaveCount(1);

  // Shift extends from the anchor: three rows, one gesture.
  await page.getByTestId('base-select-row').nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('tr.is-selected')).toHaveCount(3);

  // A click on a TICKED box unticks it (finding 2026-09-03). Read as an
  // Explorer click it re-selected the row and the tick never came off.
  await page.getByTestId('base-select-row').nth(1).click();
  await expect(page.locator('tr.is-selected')).toHaveCount(2);
  await expect(page.getByTestId('base-select-row').nth(1)).not.toBeChecked();
  await page.getByTestId('base-select-row').nth(1).click();
  await expect(page.locator('tr.is-selected')).toHaveCount(3);

  // The header box clears when everything is already picked.
  await page.getByTestId('base-select-all').click();
  await expect(page.locator('tr.is-selected')).toHaveCount(0);
  await expect(page.getByTestId('base-selbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ })).toBeVisible();
});

test('Base table: a selection sets one property on every picked row', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  await page.getByTestId('base-select-all').click();
  await expect(page.locator('tr.is-selected')).toHaveCount(3);

  await page.getByTestId('base-sel-setvalue').click();
  const pop = page.getByTestId('base-bulkset');
  await expect(pop).toBeVisible();

  // Both footer buttons lie INSIDE the panel (finding 2026-09-03): the panel
  // used to inherit a 300px ceiling, and a right-aligned footer wider than that
  // spilled to the left, cutting "Abbrechen" off where no scroll could reach it.
  const panelBox = await pop.boundingBox();
  const applyBox = await pop.getByTestId('base-bulkset-apply').boundingBox();
  const cancelBox = await pop.getByRole('button', { name: /^(Abbrechen|Cancel)$/ }).boundingBox();
  for (const box of [applyBox, cancelBox]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
  }

  // Pick the status column and type a value (this fixture's status column is
  // untyped, so the popover offers a text field rather than an option list).
  await pop.getByTestId('base-bulkset-column').click();
  await page.getByRole('option', { name: /^Status$/ }).click();
  await pop.getByTestId('base-bulkset-value').fill('archiviert');
  await pop.getByTestId('base-bulkset-apply').click();

  // Every row of the view is picked, so the threshold question appears — the
  // same second look deleting asks (E5). Confirming it is part of the flow.
  await page.getByRole('button', { name: /^(OK|Bestätigen|Confirm)$/ }).click();

  // It reached the FILES — the only thing that really counts.
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await expect
      .poll(async () => await page.evaluate((n) => (window as any).mockFs[`/test-vault/Projekte/${n}.md`], name), { timeout: 10000 })
      .toContain('status: archiviert');
  }
});

test('Base list: the card checkbox selects without opening the note', async ({ page }) => {
  await page.goto('/');
  await openBase(page, 'Cockpit');

  // Switch this view to the list type.
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();
  await configTab(page, 'view');
  await page.locator('.base-config-panel').getByRole('radio', { name: /^(Liste|List)$/ }).click();
  await page.getByRole('button', { name: /^(Konfigurieren|Configure)$/ }).click();

  const cards = page.getByTestId('base-row');
  await expect(cards.first()).toBeVisible();

  await cards.first().getByTestId('base-select-row').click();
  await expect(page.getByTestId('base-selbar')).toBeVisible();
  // The peek did NOT open: the checkbox is its own target, not the title.
  await expect(page.locator('.pv-peek-card')).toHaveCount(0);
});
