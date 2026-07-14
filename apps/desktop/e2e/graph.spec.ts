/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Graph views E2E (plan Graph P11): context graph suggestion -> real link
 * write, vault map open/menus/new note, cleanup mention -> wiki link, base
 * graph view incl. option persistence, pin persistence across reload, axe.
 * Canvas pixels are not asserted — every scenario drives DOM affordances
 * (sections, menus, dialogs, stats) and verifies through the mock fs.
 */

const BASE_FILE = [
  'columns:',
  '  projekt:',
  '    input: relation',
  'views:',
  '  - type: table',
  '    name: Netz',
  '    plainva:',
  '      render: graph',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(({ baseFile }) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Projekt X.md': '# Projekt X\nZentrale Notiz.',
      '/test-vault/mention.md': '# Mention\nWir sprachen über Projekt X gestern.',
      '/test-vault/linked.md': '# Linked\nSiehe [[Projekt X]].',
      '/test-vault/P': { isDir: true },
      '/test-vault/P/a.md': '# a\nGehört zu [[Projekt X]].',
      '/test-vault/Aufgaben.base': baseFile,
    };
    // Resolved link rows the GraphService reads (source/target already vault-relative).
    (window as any).mockLinks = [
      { source_path: 'linked.md', target_path: 'Projekt X', target_raw: 'Projekt X', link_type: 'wikilink', property_key: null, line_number: 2 },
      { source_path: 'P/a.md', target_path: 'Projekt X', target_raw: 'Projekt X', link_type: 'wikilink', property_key: 'projekt', line_number: 1 },
    ];

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
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
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          const noteRows = () =>
            Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
              .map(p => {
                const rel = p.replace('/test-vault/', '');
                const isMd = /\.md$/i.test(rel);
                return {
                  path: rel,
                  title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''),
                  mode: isMd ? 'obsidian' : 'attachment',
                  mtime_local: 1000,
                  ctime: 500,
                };
              });
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes("p.key = 'type'")) return [];
          if (q.includes("p.key = 'aliases'")) return [];
          if (q.includes("IN ('date', 'datum', 'created')")) return [];
          if (q.includes('FROM links l JOIN files f')) return (window as any).mockLinks;
          if (q.includes('fts_notes MATCH')) {
            const param = String((args.values ?? [])[0] ?? '');
            // Only the exact-phrase scan for "Projekt X" has a hit in this vault.
            if (param.includes('Projekt X')) return [{ path: 'mention.md' }, { path: 'linked.md' }];
            return [];
          }
          if (q.includes('HAVING COUNT(DISTINCT file_id)')) return [];
          if (q.includes('FROM tags')) return [];
          if (q.includes('SELECT content FROM fts_notes')) return [];
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map(r => ({ path: r.path, title: r.title, mode: r.mode === 'obsidian' ? 'note' : r.mode }));
          }
          if (q.includes('SELECT path, title FROM files')) {
            return noteRows().filter(r => r.mode !== 'attachment' && !r.path.endsWith('.base')).map(r => ({ path: r.path, title: r.title }));
          }
          if (q.includes('SELECT path FROM files')) return noteRows().map(r => ({ path: r.path }));
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
        if (cmd === 'plugin:fs|remove' || cmd === 'move_to_trash') {
          const raw = (args?.path ?? args?.paths?.[0] ?? '') as string;
          const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
          for (const key of Object.keys(fs)) if (key === p || key.startsWith(p + '/')) delete fs[key];
          return null;
        }
        if (cmd === 'plugin:fs|rename') {
          const from = (args.oldPath as string).replace(/\/$/, '');
          const to = (args.newPath as string).replace(/\/$/, '');
          for (const key of Object.keys(fs)) {
            if (key === from || key.startsWith(from + '/')) {
              fs[to + key.slice(from.length)] = fs[key];
              delete fs[key];
            }
          }
          return null;
        }
        return null;
      },
    };
  }, { baseFile: BASE_FILE });
});

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('Projekt X').first()).toBeVisible({ timeout: 20000 });
}

async function openVaultMap(page: any) {
  // The graph shortcut can be missed right after load (the handlers may not be
  // wired yet) — retry pressing it until the map opens, but never re-press once
  // it is visible (so it can't open a second graph tab). Fixes a long-standing
  // flake in this helper.
  const map = page.getByTestId('vault-graph-view');
  await expect(async () => {
    if (!(await map.isVisible())) {
      await page.keyboard.press('Control+Shift+G');
    }
    await expect(map).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 20000 });
}

test('context graph section shows suggestions and accepting one writes a real wiki link', async ({ page }) => {
  await openVault(page);
  await page.getByText('Projekt X', { exact: true }).first().click();

  // Open the Graph sidebar section (5th section header).
  await page.getByRole('button', { name: /^Graph$/ }).click();
  await expect(page.getByTestId('graph-context-canvas')).toBeVisible();

  // The mocked FTS hit surfaces mention.md as an unlinked mention of the
  // focused note; linked.md is already linked and must NOT appear.
  const suggestion = page.getByTestId('graph-suggestion');
  await expect(suggestion).toHaveCount(1, { timeout: 10000 });
  await expect(suggestion).toContainText('mention'); // note title = basename

  // The preview shows WHICH passage will be linked, BEFORE accepting: the
  // unlinked "Projekt X" inside mention.md. It is an incoming mention, so the
  // edit lands in that other note and the preview is prefixed with its title.
  const preview = suggestion.getByTestId('graph-suggestion-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Projekt X');

  await suggestion.getByTestId('graph-suggestion-accept').click();
  // Accepting links the passage INLINE, not appended at the document end.
  await expect
    .poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/mention.md']))
    .toContain('über [[Projekt X]] gestern');
});

test('vault map opens via shortcut with stats, canvas menu creates a note', async ({ page }) => {
  await openVault(page);
  await openVaultMap(page);

  await expect(page.getByTestId('graph-stat-notes')).toContainText('4'); // 4 notes (base excluded)
  // Right-click on empty canvas space opens the map menu.
  // Corner (5,5): zoomToFit keeps every node >= 40px from the edges, so this
  // point is guaranteed empty space -> the CANVAS menu (not a node menu).
  // dispatchEvent targets the canvas listener directly (the synthetic
  // right-click pipeline does not deliver contextmenu in this harness).
  const box = (await page.getByTestId('graph-map-canvas').boundingBox())!;
  await page.getByTestId('graph-map-canvas').dispatchEvent('contextmenu', {
    clientX: Math.round(box.x + 5),
    clientY: Math.round(box.y + 5),
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await page.getByRole('menuitem', { name: /New note|Neue Notiz/ }).click();
  const dialogInput = page.locator('.pv-overlay--dialog input, .pv-modal input').first();
  await dialogInput.fill('Frisch');
  await page.locator('.pv-overlay--dialog .pv-btn--primary, .pv-overlay--dialog .pv-btn--danger').first().click();
  await expect
    .poll(async () => page.evaluate(() => Object.keys((window as any).mockFs).some(p => p.endsWith('/Frisch.md'))))
    .toBe(true);
});

test('empty-area drag lassoes multiple nodes; the pin needle toggles the mode', async ({ page }) => {
  await openVault(page);
  await openVaultMap(page);
  await expect(page.getByTestId('graph-stat-notes')).toContainText('4');

  // New gesture model: an empty left-drag draws a selection lasso (panning is
  // on middle button / Ctrl now). Real mouse input so pointer capture works;
  // zoomToFit keeps nodes >= 40px from the edges, so the corners are empty.
  const box = (await page.getByTestId('graph-map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('graph-bulk-bar')).toBeVisible();

  // The discreet pin needle starts ON and flips to OFF on click (which also
  // clears this view's pins so the force layout returns).
  const pin = page.getByTestId('graph-pin-toggle');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
});

test('cleanup panel scans mentions and links one into the source note', async ({ page }) => {
  await openVault(page);
  await openVaultMap(page);

  await page.getByTestId('graph-cleanup-btn').click();
  await expect(page.getByTestId('graph-cleanup-panel')).toBeVisible();
  await page.getByTestId('graph-cleanup-tab-mentions').click();
  await page.getByTestId('graph-cleanup-scan').click();

  const mention = page.getByTestId('graph-cleanup-mention');
  await expect(mention).toHaveCount(1, { timeout: 15000 });
  await mention.getByTestId('graph-cleanup-link-mention').click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/mention.md']))
    .toContain('[[Projekt X]]');
});

test('orphans tab lists unconnected notes and deletes one', async ({ page }) => {
  await openVault(page);
  await openVaultMap(page);
  await page.getByTestId('graph-cleanup-btn').click();

  // mention.md has no links at all -> orphan.
  const orphan = page.getByTestId('graph-cleanup-orphan').filter({ hasText: 'mention' });
  await expect(orphan).toHaveCount(1, { timeout: 10000 });
  await orphan.locator('button').last().click();
  // appConfirm dialog (danger) — confirm.
  await page.locator('.pv-overlay--dialog .pv-btn--danger, .pv-overlay--dialog .pv-btn--primary').first().click();
  await expect
    .poll(async () => page.evaluate(() => !!(window as any).mockFs['/test-vault/mention.md']))
    .toBe(false);
});

test('base graph view renders from plainva.render and persists option changes', async ({ page }) => {
  await openVault(page);
  await page.getByText('Aufgaben', { exact: true }).first().click();
  await expect(page.getByTestId('base-graph-view')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('base-graph-canvas')).toBeVisible();

  await page.getByTestId('base-graph-external').check();
  await expect
    .poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben.base']))
    .toContain('graphShowExternal: true');

  // Incoming cross-DB relations (report 2026-07-07): its own persisted toggle.
  await page.getByTestId('base-graph-incoming').check();
  await expect
    .poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/Aufgaben.base']))
    .toContain('graphShowIncoming: true');
});

test('vault map passes axe and the graph tab label is localized', async ({ page }) => {
  await openVault(page);
  await openVaultMap(page);
  await expect(page.getByRole('tab', { name: 'Graph' }).first()).toBeVisible().catch(() => {});

  const results = await new AxeBuilder({ page }).include('[data-testid="vault-graph-view"]').analyze();
  expect(results.violations).toEqual([]);
});
