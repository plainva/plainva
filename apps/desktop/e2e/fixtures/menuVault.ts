/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The vault of menus.spec.ts: one database with a board and a table over three
 * notes, a template to offer, and a second vault to switch to.
 *
 * Self-contained on purpose — it is handed to `page.addInitScript`, which
 * serialises the function and runs it in the page before the app loads, so it
 * may not reach for anything outside its own body.
 */
export function installMenuVault(): void {
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
    '  - type: table',
    '    name: Tabelle',
    '    order:',
    '      - file.name',
    '      - note.status',
    '',
  ].join('\n');

  const fs: Record<string, any> = {
    '/test-vault': { isDir: true },
    '/test-vault/.plainva': { isDir: true },
    '/test-vault/Welcome.md': '# Welcome\n\nHello.\n',
    '/test-vault/Projekte': { isDir: true },
    '/test-vault/Projekte/Alpha.md': '---\nstatus: active\n---\n# Alpha\n\nFirst.\n',
    '/test-vault/Projekte/Beta.md': '---\nstatus: paused\n---\n# Beta\n',
    '/test-vault/Projekte/Gamma.md': '---\nstatus: active\n---\n# Gamma\n',
    '/test-vault/Templates': { isDir: true },
    '/test-vault/Templates/Projektvorlage.md': '---\nstatus: active\n---\n\n# {{title}}\n',
    '/test-vault/Board.base': boardYaml,
  };
  (window as any).mockFs = fs;

  const dbFiles = [
    { id: '1', path: 'Projekte/Alpha.md', title: 'Alpha', mtime_local: 1750000000000, size_bytes: 10 },
    { id: '2', path: 'Projekte/Beta.md', title: 'Beta', mtime_local: 1750000001000, size_bytes: 10 },
    { id: '3', path: 'Projekte/Gamma.md', title: 'Gamma', mtime_local: 1750000002000, size_bytes: 10 },
    { id: '4', path: 'Welcome.md', title: 'Welcome', mtime_local: 1750000003000, size_bytes: 10 },
  ];
  const dbProps: Record<string, { key: string; value: string; type: string }[]> = {
    '1': [{ key: 'status', value: 'active', type: 'text' }],
    '2': [{ key: 'status', value: 'paused', type: 'text' }],
    '3': [{ key: 'status', value: 'active', type: 'text' }],
  };
  const hidden = /(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/;
  const vaultFiles = () => Object.keys(fs).filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !hidden.test(p));
  const clean = (p: string) => (p.endsWith('/') ? p.slice(0, -1) : p);

  (window as any).__TAURI_INTERNALS__ = {
    plugins: { path: { sep: '/' } },
    transformCallback: () => 1,
    invoke: async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:path|normalize') {
        let p = args.path.replace(/\\/g, '/');
        while (p.includes('//')) p = p.replace('//', '/');
        return p;
      }
      if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
      if (cmd === 'plugin:store|load') return 1;
      // The version the "what's new" marker below is compared against.
      if (cmd === 'plugin:app|version') return '9.9.9';
      if (cmd === 'plugin:store|get') {
        if (args.key === 'lastVaultPath') return ['/test-vault', true];
        // Two more vaults, so the vault menu has somewhere to switch to — one
        // of them with a name longer than any line of the sidebar.
        if (args.key === 'recentVaults') {
          return [['/test-vault', '/zweiter-vault', '/ein-vault-mit-einem-namen-der-laenger-ist-als-jede-zeile-der-seitenleiste'], true];
        }
        if (args.key === 'autoOpenLastVault') return [true, true];
        if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
        if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
        if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
        return [null, false];
      }
      if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
      if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
      if (cmd === 'plugin:sql|load') return args.db;
      if (cmd === 'plugin:sql|execute') return [0, 0];
      if (cmd === 'plugin:sql|select') {
        const query: string = args.query || '';
        const values: any[] = args.values || [];
        // The link rule's corpus: the indexed notes, and every other file
        // under its file name.
        if (query.includes('FROM files WHERE is_deleted IS NULL OR is_deleted = 0')) {
          const others = vaultFiles().filter((p) => !/\.md$/i.test(p)).map((p) => p.replace('/test-vault/', ''));
          return [
            ...dbFiles.map((f) => ({ path: f.path, title: f.title, mode: 'obsidian' })),
            ...others.map((path) => ({ path, title: path.split('/').pop()!, mode: 'attachment' })),
          ];
        }
        if (query.includes('SELECT path, title, mode FROM files')) {
          return vaultFiles().map((p) => ({ path: p.replace('/test-vault/', ''), title: p.replace('/test-vault/', ''), mode: 'note' }));
        }
        if (query.includes('SELECT DISTINCT path FROM files')) return dbFiles.map((f) => ({ path: f.path }));
        if (query.includes('SELECT path, title FROM files')) return dbFiles.map((f) => ({ path: f.path, title: f.title }));
        if (query.includes(`SELECT path FROM files WHERE mode != 'attachment'`)) return dbFiles.map((f) => ({ path: f.path }));
        // The backlinks' link rows: this vault keeps no body links.
        if (query.includes('COLLATE NOCASE')) return [];
        if (query.includes(`WHERE path LIKE '%.base'`)) {
          return vaultFiles().filter((p) => p.endsWith('.base')).map((p) => ({ path: p.replace('/test-vault/', '') }));
        }
        if (query.includes('FROM tags')) return [];
        // The database's rows: the files under its folder source.
        if (query.includes('FROM files f')) {
          const prefixes = values.filter((v: any) => typeof v === 'string' && v.endsWith('%')).map((v: string) => v.slice(0, -1));
          return dbFiles.filter((f) => prefixes.every((p) => f.path.startsWith(p))).map((f) => ({ ...f }));
        }
        if (query.includes('LEFT JOIN properties')) {
          const out: any[] = [];
          for (const v of values) {
            const f = dbFiles.find((x) => x.path === String(v));
            if (!f) continue;
            const props = dbProps[f.id] || [];
            if (props.length === 0) out.push({ path: f.path, title: f.title, mtime_local: f.mtime_local, size_bytes: f.size_bytes, key: null, value: null, type: null });
            for (const pr of props) out.push({ path: f.path, title: f.title, mtime_local: f.mtime_local, size_bytes: f.size_bytes, ...pr });
          }
          return out;
        }
        if (query.includes('FROM properties')) {
          const out: any[] = [];
          for (const v of values) {
            const key = String(v);
            const id = dbFiles.some((f) => f.id === key) ? key : (dbFiles.find((f) => f.path === key)?.id ?? key);
            for (const p of dbProps[id] || []) out.push({ file_id: id, ...p });
          }
          return out;
        }
        return [];
      }
      if (cmd === 'plugin:sql|select_one') return null;
      if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
      // Checked native reads use the same files as the plugin fixture.
      if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
        const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
        const rel = String(args.relPath).replace(/^\/+/, '');
        const path = rel ? `${root}/${rel}` : root;
        const present = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|exists', { path });
        if (cmd === 'checked_path_exists') return present;
        if (!present) return null;
        if (cmd === 'checked_read_dir') {
          const entries = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', { path });
          return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
        }
        const bytes = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path });
        return typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
      }
      if (cmd === 'plugin:fs|exists') return !!fs[clean(args.path)];
      if (cmd === 'plugin:fs|stat') {
        const file = fs[clean(args.path)];
        if (!file) throw new Error('File not found');
        return { isDir: !!file.isDir, isFile: !file.isDir, mtime: Date.now(), size: typeof file === 'string' ? file.length : 0 };
      }
      if (cmd === 'plugin:fs|read_dir') {
        const p = clean(args.path);
        const entries: Record<string, any> = {};
        for (const path of Object.keys(fs)) {
          if (path === p || !path.startsWith(p + '/')) continue;
          const name = path.substring(p.length + 1).split('/')[0];
          if (entries[name]) continue;
          const isDir = !!fs[`${p}/${name}`]?.isDir;
          entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
        }
        return Object.values(entries);
      }
      if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
        const content = fs[clean(options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '')];
        if (content === undefined || content.isDir) throw new Error('File not found');
        return Array.from(new TextEncoder().encode(content));
      }
      if (cmd === 'write_file_atomic') {
        const root = String(args.rootId).replace(/^mock-root:/, '');
        const rel = String(args.relPath).replace(/^\/+/, '');
        fs[root ? `${root}/${rel}` : rel] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
        return null;
      }
      if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
        const p = clean(options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '');
        fs[p] = new TextDecoder().decode(new Uint8Array(cmd === 'plugin:fs|write_text_file' ? args : args.data || args));
        return null;
      }
      if (cmd === 'plugin:fs|mkdir') {
        fs[clean(args.path)] = { isDir: true };
        return null;
      }
      if (cmd === 'plugin:fs|watch') return 1;
      if (cmd === 'plugin:fs|unwatch') return null;
      return null;
    },
  };
}
