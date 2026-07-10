/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

// Sidebar full-text search (Gesamtplan Suche 2026-07-05): search-as-you-type
// with prefix matching, X button, snippet <mark>s, name/content grouping,
// -exclusion and jump-to-match. The SQL layer is mocked like in every suite;
// the MATCH branch below implements a tiny FTS evaluator for the exact query
// grammar the core generates (quoted terms, trailing *, NOT IN subquery).

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': "# Hello\nWelcome to the mock vault!",
      '/test-vault/Projekte': { isDir: true },
      '/test-vault/Projekte/Projektplan.md': "# Projektplan\nDer Marathon beginnt im Herbst mit dem Training.",
      '/test-vault/Notizen': { isDir: true },
      '/test-vault/Notizen/Lauftagebuch.md': "# Lauftagebuch\nHeute den Projektplan besprochen. Review folgt.",
    };

    (window as any).__TAURI_INTERNALS__ = {
      plugins: {
        path: { sep: '/' }
      },
      transformCallback: (_callback: any) => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;

        // --- PATH PLUGIN ---
        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') {
          return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        }

        // --- STORE PLUGIN ---
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ["/test-vault", true];
          if (args.key === 'recentVaults') return [["/test-vault"], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
        if (cmd === 'plugin:store|save') return null;

        // --- DIALOG PLUGIN ---
        if (cmd === 'plugin:dialog|ask') return true;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') {
          return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        }

        // --- SQL PLUGIN ---
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);

          // Mini-FTS evaluator for the search query the core builds: values[0]
          // is the AND-joined positive expression of quoted (optionally
          // prefix-starred) terms; with a `NOT IN (... MATCH ?)` clause the
          // next value carries the OR-joined excluded terms.
          if (q.includes('MATCH ?') && q.includes('snippet(')) {
            const MARK_START = String.fromCharCode(1);
            const MARK_END = String.fromCharCode(2);
            const values: any[] = args.values || [];
            const matchExpr = String(values[0] ?? '');
            const notExpr = q.includes('NOT IN') ? String(values[1] ?? '') : '';
            const parseTerms = (expr: string) =>
              Array.from(expr.matchAll(/"((?:[^"]|"")*)"(\*)?/g)).map((m: any) => ({
                text: String(m[1]).replace(/""/g, '"').toLowerCase(),
                prefix: m[2] === '*',
              }));
            const tokensOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
            const hitsIn = (text: string, t: { text: string; prefix: boolean }) => {
              const parts = tokensOf(t.text);
              if (parts.length === 0) return false;
              if (parts.length === 1) {
                return tokensOf(text).some(w => (t.prefix ? w.startsWith(parts[0]) : w === parts[0]));
              }
              return text.toLowerCase().includes(parts.join(' '));
            };
            const pos = parseTerms(matchExpr);
            const neg = parseTerms(notExpr);
            const markFirst = (text: string, terms: { text: string }[], context: number) => {
              for (const t of terms) {
                const needle = tokensOf(t.text)[0] ?? '';
                if (!needle) continue;
                const idx = text.toLowerCase().indexOf(needle);
                if (idx >= 0) {
                  const from = Math.max(0, idx - context);
                  const to = Math.min(text.length, idx + needle.length + context * 2);
                  return (
                    (from > 0 ? '…' : '') +
                    text.slice(from, idx) +
                    MARK_START + text.slice(idx, idx + needle.length) + MARK_END +
                    text.slice(idx + needle.length, to)
                  );
                }
              }
              return null;
            };
            const rows = Object.keys(fs)
              .filter(p => !fs[p].isDir && /\.md$/i.test(p) && p.startsWith('/test-vault/'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const title = relativePath.split('/').pop()!.replace(/\.md$/i, '');
                const content = String(fs[p]);
                return { path: relativePath, title, content };
              })
              .filter(r =>
                pos.length > 0 &&
                pos.every(t => hitsIn(`${r.title} ${r.content}`, t)) &&
                !neg.some(t => hitsIn(`${r.title} ${r.content}`, t))
              )
              .map(r => {
                const titleHl = pos.some(t => hitsIn(r.title, t)) ? markFirst(r.title, pos, 0) : null;
                return {
                  id: r.path,
                  path: r.path,
                  title: r.title,
                  mtime_local: 0,
                  size_bytes: r.content.length,
                  snippet: markFirst(r.content, pos, 30) ?? r.content.slice(0, 60),
                  titleHighlighted: titleHl ?? r.title,
                  titleHit: titleHl !== null,
                };
              })
              // bm25 substitute: title hits first (column weight 4 vs 1).
              .sort((a, b) => Number(b.titleHit) - Number(a.titleHit))
              .map(({ titleHit, ...row }) => row);
            return rows;
          }

          // Quick-switcher corpus (P3.3): plain path/title over all files.
          if (q.trim().startsWith('SELECT path, title FROM files')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && /\.md$/i.test(p) && p.startsWith('/test-vault/'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, '') };
              });
          }

          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            const result = Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
            return result;
          }
          return [];
        }

        // --- FS PLUGIN ---
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error("File not found");
          return { isDir: !!file.isDir, isFile: !file.isDir, mtime: Date.now(), size: typeof file === 'string' ? file.length : 0 };
        }
        if (cmd === 'plugin:fs|read_dir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const entries: Record<string, {name: string, isDirectory: boolean, isFile: boolean, isSymlink: boolean}> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const relative = path.substring(p.length + 1);
              const name = relative.split('/')[0];
              if (!entries[name]) {
                const childPath = `${p}/${name}`;
                const isDir = !!fs[childPath]?.isDir;
                entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
              }
            }
          }
          return Object.values(entries);
        }
        if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || "");
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error("File not found");
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || "");
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          let str: string;
          if (cmd === 'plugin:fs|write_text_file') {
             str = new TextDecoder().decode(new Uint8Array(args));
          } else {
             str = new TextDecoder().decode(new Uint8Array(args.data || args));
          }
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
          for (const key of Object.keys(fs)) {
            if (key === p || key.startsWith(p + '/')) delete fs[key];
          }
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
      }
    };
  });
});

const searchInput = (page: any) => page.getByLabel('Search...');

test('Search: results appear while typing a partial word, with mark + groups', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Only a PREFIX of "Projektplan" is typed — no Enter anywhere.
  await searchInput(page).fill('projektpl');

  // Name hit (Projektplan.md) and content hit (Lauftagebuch.md), grouped.
  await expect(page.getByText('2 results', { exact: true })).toBeVisible();
  const nameHeader = page.getByText('File name (1)', { exact: true });
  const contentHeader = page.getByText('Content (1)', { exact: true });
  await expect(nameHeader).toBeVisible();
  await expect(contentHeader).toBeVisible();
  // Name group renders above the content group.
  const headerOrder = await Promise.all([nameHeader.boundingBox(), contentHeader.boundingBox()]);
  expect(headerOrder[0]!.y).toBeLessThan(headerOrder[1]!.y);

  // The title of the name hit carries a <mark>; the content hit shows a
  // snippet with the match marked (both fixture bodies contain the term, so
  // two snippet marks exist — assert on the first).
  await expect(page.locator('mark.pv-search-mark').first()).toBeVisible();
  const snippetMark = page.locator('.pv-search-snippet mark.pv-search-mark').first();
  await expect(snippetMark).toHaveText(/projektpl/i);
  await expect(page.getByText('Lauftagebuch', { exact: true })).toBeVisible();
});

test('Search: the X button clears the query and restores the tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await searchInput(page).fill('projektpl');
  await expect(page.getByText('2 results', { exact: true })).toBeVisible();

  const clear = page.getByRole('button', { name: 'Clear search' });
  await expect(clear).toBeVisible();
  await clear.click();

  await expect(searchInput(page)).toHaveValue('');
  await expect(clear).toHaveCount(0);
  // Tree is back: folders render again, the search result list is gone.
  await expect(page.getByText('Projekte', { exact: true })).toBeVisible();
  await expect(page.getByText('2 results', { exact: true })).toHaveCount(0);
});

test('Search: operator characters do not break the query (clean empty state)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Formerly an FTS5 syntax error that left the list stale.
  await searchInput(page).fill('xyz (unfinished "');
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Search: -term excludes matching notes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await searchInput(page).fill('projektplan');
  await expect(page.getByText('2 results', { exact: true })).toBeVisible();

  // Lauftagebuch contains "Review" and drops out. (The surviving row's title
  // is fully marked, so target the <mark> — the plain text locator would hit
  // both the mark and its parent span.)
  await searchInput(page).fill('projektplan -review');
  await expect(page.getByText('1 result', { exact: true })).toBeVisible();
  await expect(page.locator('mark.pv-search-mark').filter({ hasText: 'Projektplan' }).first()).toBeVisible();
  await expect(page.getByText('Lauftagebuch', { exact: true })).toHaveCount(0);
});

test('QuickSwitcher: full-text group with snippet marks, Enter opens at the match (P3.3c)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+o');
  const input = page.locator('.pv-palette-input');
  await expect(input).toBeVisible();
  // Prefix that matches "Projektplan" by TITLE (fuzzy group) and
  // "Lauftagebuch" only by CONTENT (full-text group).
  await input.fill('projektpl');

  const palette = page.locator('.pv-palette');
  await expect(palette.getByText('File name', { exact: true })).toBeVisible();
  await expect(palette.getByText('Content', { exact: true })).toBeVisible();
  await expect(palette.getByText('Lauftagebuch', { exact: true })).toBeVisible();
  // The content row carries a sentinel-rendered <mark> snippet.
  await expect(palette.locator('mark.pv-search-mark').first()).toHaveText(/projektpl/i);

  // Row order: fuzzy title hit first, content hit second.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // The note opens AT the match: the first occurrence is selected.
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await page.waitForFunction(() => (window.getSelection()?.toString() ?? '').toLowerCase() === 'projektpl');
});

test('Search: clicking a content hit opens the note and selects the match', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await searchInput(page).fill('besprochen');
  await expect(page.getByText('1 result', { exact: true })).toBeVisible();

  await page.getByText('Lauftagebuch', { exact: true }).click();

  // The editor opens and the first occurrence is selected (the selection IS
  // the highlight) and scrolled into view.
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await page.waitForFunction(() => (window.getSelection()?.toString() ?? '').toLowerCase() === 'besprochen');
});
