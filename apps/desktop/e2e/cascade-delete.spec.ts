/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test';

// E2E of the cascade deletion (plan Kaskadenloeschung): deleting a relation
// target offers its assigned elements (recursive, shared ones excluded by
// default, per-element opt-out), deleting a `.base` offers its rows plus a
// two-step card per linked database, and a plain note keeps the existing slim
// confirmation. The mock mirrors base.spec.ts with a focused fixture:
// Projektliste.base (folder Projekte) <- Aufgabenliste.base (folder Aufgaben,
// note.projekt relation) with a self-relation note.parent for sub-elements.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  await page.addInitScript(() => {
    const projekteYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Projekte"',
      'properties:',
      '  note.status:',
      '    plainva:',
      '      input: select',
      '      options:',
      '        - value: active',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.status',
      '',
    ].join('\n');
    const aufgabenYaml = [
      'filters:',
      '  and:',
      '    - file.folder == "Aufgaben"',
      'properties:',
      '  note.projekt:',
      '    plainva:',
      '      input: relation',
      '      relationBase: Projektliste.base',
      '  note.parent:',
      '    plainva:',
      '      input: relation',
      '      relationBase: Aufgabenliste.base',
      '      relationLimit: one',
      'views:',
      '  - type: table',
      '    name: Tabelle',
      '    order:',
      '      - file.name',
      '      - note.projekt',
      '',
    ].join('\n');

    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Aufgaben': { isDir: true },
      '/test-vault/Notizen': { isDir: true },
      '/test-vault/Projektliste.base': projekteYaml,
      '/test-vault/Aufgabenliste.base': aufgabenYaml,
      '/test-vault/Projekte/Website.md': '---\nstatus: active\n---\n# Website',
      '/test-vault/Projekte/Q3.md': '---\nstatus: active\n---\n# Q3',
      '/test-vault/Aufgaben/T1.md': '---\nprojekt: "[[Website]]"\n---\n# T1',
      '/test-vault/Aufgaben/T2.md': '---\nprojekt:\n  - "[[Website]]"\n  - "[[Q3]]"\n---\n# T2',
      '/test-vault/Aufgaben/T3.md': '---\nprojekt: "[[Q3]]"\n---\n# T3',
      '/test-vault/Aufgaben/U1.md': '---\nparent: "[[T1]]"\n---\n# U1',
      '/test-vault/Notizen/Lose.md': '# Lose Notiz',
    };

    const dbFiles = [
      { id: '1', path: 'Projekte/Website.md', title: 'Website', mtime_local: 1750000000000, size_bytes: 10 },
      { id: '2', path: 'Projekte/Q3.md', title: 'Q3', mtime_local: 1750000001000, size_bytes: 10 },
      { id: '3', path: 'Aufgaben/T1.md', title: 'T1', mtime_local: 1750000002000, size_bytes: 10 },
      { id: '4', path: 'Aufgaben/T2.md', title: 'T2', mtime_local: 1750000003000, size_bytes: 10 },
      { id: '5', path: 'Aufgaben/T3.md', title: 'T3', mtime_local: 1750000004000, size_bytes: 10 },
      { id: '6', path: 'Aufgaben/U1.md', title: 'U1', mtime_local: 1750000005000, size_bytes: 10 },
      { id: '7', path: 'Notizen/Lose.md', title: 'Lose', mtime_local: 1750000006000, size_bytes: 10 },
    ];
    const dbProps: Record<string, { key: string; value: string; type: string }[]> = {
      '1': [{ key: 'status', value: 'active', type: 'text' }],
      '2': [{ key: 'status', value: 'active', type: 'text' }],
      '3': [{ key: 'projekt', value: '[[Website]]', type: 'text' }],
      '4': [{ key: 'projekt', value: '["[[Website]]","[[Q3]]"]', type: 'list' }],
      '5': [{ key: 'projekt', value: '[[Q3]]', type: 'text' }],
      '6': [{ key: 'parent', value: '[[T1]]', type: 'text' }],
    };
    // Frontmatter-property link rows (links.property_key) — the cascade edges.
    const dbLinks = [
      { source_path: 'Aufgaben/T1.md', source_title: 'T1', target_path: 'Website', property_key: 'projekt' },
      { source_path: 'Aufgaben/T2.md', source_title: 'T2', target_path: 'Website', property_key: 'projekt' },
      { source_path: 'Aufgaben/T2.md', source_title: 'T2', target_path: 'Q3', property_key: 'projekt' },
      { source_path: 'Aufgaben/T3.md', source_title: 'T3', target_path: 'Q3', property_key: 'projekt' },
      { source_path: 'Aufgaben/U1.md', source_title: 'U1', target_path: 'T1', property_key: 'parent' },
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
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save' || cmd === 'plugin:store|delete') return null;
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const query: string = args.query || '';
          const values: any[] = args.values || [];
          if (query.includes('SELECT path, title, mode FROM files')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
              .map(p => {
                const rel = p.replace('/test-vault/', '');
                return { path: rel, title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''), mode: 'note' };
              });
          }
          if (query.includes('SELECT DISTINCT path FROM files')) {
            return dbFiles.map(f => ({ path: f.path }));
          }
          if (query.includes('SELECT path, title FROM files')) {
            return dbFiles.map(f => ({ path: f.path, title: f.title }));
          }
          if (query.includes('COUNT(*)')) {
            return [{ n: dbFiles.length }];
          }
          if (query.includes(`SELECT path FROM files WHERE mode != 'attachment'`)) {
            return dbFiles.map(f => ({ path: f.path }));
          }
          if (query.includes('COLLATE NOCASE')) {
            const target = String(values[0] ?? '').toLowerCase();
            const hit = dbFiles.find(f =>
              f.title.toLowerCase() === target || f.path.toLowerCase() === target || f.path.toLowerCase() === `${target}.md`
            );
            return hit ? [{ path: hit.path }] : [];
          }
          // Cascade edge set: every frontmatter-property link (new core query).
          if (query.includes('property_key IS NOT NULL')) {
            return dbLinks.map(l => ({ ...l }));
          }
          if (query.includes('l.property_key = ?')) {
            return dbLinks.filter(l => l.property_key === values[0]).map(l => ({ ...l }));
          }
          if (query.includes(`WHERE path LIKE '%.base'`)) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.endsWith('.base'))
              .map(p => ({ path: p.replace('/test-vault/', '') }));
          }
          if (query.includes('FROM files f')) {
            const prefixes = values
              .filter((v: any) => typeof v === 'string' && v.endsWith('%'))
              .map((v: string) => v.slice(0, -1));
            let rows = dbFiles;
            if (prefixes.length > 0) {
              rows = query.includes(' OR ')
                ? dbFiles.filter(f => prefixes.some(p => f.path.startsWith(p)))
                : dbFiles.filter(f => prefixes.every(p => f.path.startsWith(p)));
            }
            return rows.map(r => ({ ...r }));
          }
          if (query.includes('FROM properties')) {
            // Bulk form passes file IDs; getFileProperties passes the path.
            const out: any[] = [];
            for (const v of values) {
              const id = dbProps[String(v)] ? String(v) : (dbFiles.find(f => f.path === String(v))?.id ?? '');
              for (const p of dbProps[id] || []) out.push({ file_id: id, ...p });
            }
            return out;
          }
          return [];
        }
        if (cmd === 'move_to_trash') {
          const p = String(args.path).replace(/\/$/, '');
          if (fs[p] === undefined) throw new Error('File not found');
          delete fs[p];
          const rel = p.replace('/test-vault/', '');
          const idx = dbFiles.findIndex(f => f.path === rel);
          if (idx !== -1) dbFiles.splice(idx, 1);
          return null;
        }
        if (cmd === 'plugin:fs|remove') {
          const p = String(args.path).replace(/\/$/, '');
          delete fs[p];
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'register_write_root') {
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

async function deleteViaTree(page: any, folder: string, name: string) {
  const tree = page.getByTestId('file-tree');
  await tree.getByText(folder, { exact: true }).click();
  await tree.getByText(name, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(Löschen|Delete)$/ }).click();
}

test('deleting a relation target cascades: recursive list, shared excluded, opt-out, cleanup', async ({ page }) => {
  await page.goto('/');
  await deleteViaTree(page, 'Projekte', 'Website');

  // The cascade dialog opens with the assigned-elements card of the tasks base.
  const modal = page.getByTestId('cascade-delete-modal');
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText(/Zugeordnete Elemente · Aufgabenliste|Assigned elements · Aufgabenliste/);
  // Shared T2 (also assigned to Q3) is excluded by default.
  await expect(modal).toContainText(/geteiltes Element ausgenommen|shared element excluded/);
  // Website + T1 + U1 (recursive sub-element) — T2 stays.
  await expect(page.getByTestId('cascade-confirm')).toContainText('3');

  // Open the element list: T2 is off with the shared badge, U1 is indented.
  await page.getByTestId('cascade-show-items').click();
  const t2Row = modal.locator('.pv-cascade-item', { hasText: 'T2' });
  await expect(t2Row).toHaveClass(/is-off/);
  await expect(t2Row).toContainText(/auch .Q3.|also .Q3./);
  await expect(modal.locator('.pv-cascade-item--sub', { hasText: 'U1' })).toBeVisible();

  // Per-element opt-out: keep T1 — the danger button re-counts live.
  await modal.locator('.pv-cascade-item', { hasText: 'T1' }).getByRole('checkbox').uncheck();
  await expect(page.getByTestId('cascade-confirm')).toContainText('2');

  await page.getByTestId('cascade-confirm').click();
  // The tiny fixture vault trips the existing large-deletion threshold
  // (2 of 7 files > 20%) — the unchanged second prompt appears and confirms.
  await page.getByRole('button', { name: /Ja, alles löschen|Yes, delete everything/ }).click();

  // Website + U1 gone; T1 (opted out) and T2 (shared) survive.
  await expect.poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Website.md'])).toBeUndefined();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/U1.md'])).toBeUndefined();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/T1.md'])).toBeTruthy();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/T2.md'])).toBeTruthy();

  // Reference cleanup: surviving notes lose their links onto the deleted target.
  await expect.poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/T2.md'])).not.toContain('Website');
  await expect.poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/T1.md'])).not.toContain('projekt');
});

test('deleting a base offers its rows plus a two-step linked-database card', async ({ page }) => {
  await page.goto('/');
  await deleteViaTree(page, 'Projekte', 'Projektliste');

  const modal = page.getByTestId('cascade-delete-modal');
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText(/Elemente dieser Datenbank|Elements of this database/);
  await expect(modal).toContainText(/Verknüpfte Datenbank · Aufgabenliste|Linked database · Aufgabenliste/);

  // Default: base file + its two rows; nothing from the linked base.
  await expect(page.getByTestId('cascade-confirm')).toContainText('3');

  // Step 1: also delete the assigned tasks (all four cascade in, none shared —
  // both of their projects die).
  await page.getByTestId('cascade-group-linkedAssigned').check();
  await expect(page.getByTestId('cascade-confirm')).toContainText('7');

  // Step 2: the whole linked database (adds its .base file) and implies step 1.
  await page.getByTestId('cascade-group-linkedAll').check();
  await expect(page.getByTestId('cascade-group-linkedAssigned')).toBeDisabled();
  await expect(page.getByTestId('cascade-confirm')).toContainText('8');

  // Cancel deletes nothing.
  await page.getByRole('button', { name: /^(Abbrechen|Cancel)$/ }).click();
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Projektliste.base'])).toBeTruthy();
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben/T1.md'])).toBeTruthy();
});

test('a plain note without incoming relations keeps the slim confirmation', async ({ page }) => {
  await page.goto('/');
  await deleteViaTree(page, 'Notizen', 'Lose');

  // The slim appConfirm dialog — not the cascade modal.
  await expect(page.getByText(/Löschen bestätigen|Confirm Deletion/i)).toBeVisible({ timeout: 10000 });
  expect(await page.getByTestId('cascade-delete-modal').count()).toBe(0);
  await page.getByRole('button', { name: /^(Löschen|Delete)$/ }).click();

  await expect.poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Notizen/Lose.md'])).toBeUndefined();
});
