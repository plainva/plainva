/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

/**
 * List items the way many generators write Markdown (finding 2026-11-02): a
 * marker followed by SEVERAL spaces (`*   item`, `4.  item` - CommonMark
 * allows one to four), content that starts with emphasis, strong, code, an
 * emoji or a formula, nested under ordered and unordered items, after a line
 * that ends in emphasis. In the live preview every such item keeps its
 * bullet - the glyph of its level - and its wrapped lines start exactly under
 * the first letter of its text. The fixture is neutral; the shape is the one
 * of the reported note.
 */
const WRAP = 'and enough further words to wrap onto a second and a third display line in the editor so the hanging indent shows';
const NOTE = [
  '# Items',
  '',
  'Intro sentence for the list.',
  '',
  `3.  **Third item with a bold title:** ${WRAP}.`,
  `    *   Plain sub item ${WRAP}.`,
  '4.  **Fourth item with a bold title (~100–120 m² + more):**',
  `    *   *Italic lead-in:* Text after an italic lead-in ${WRAP}.`,
  '    *   *Second lead-in:* More text with **bold part** in it and an italic tail *(in parentheses ~6.000–8.000 €)*.',
  `    *   👉 **Bold summary line (points 1–4):** **ca. 7.300 – 11.500 €** *(italic remark ${WRAP})*.`,
  `    *   $\\Rightarrow$ **Arrow summary:** **ca. 1.500 €** *(remark ${WRAP})*.`,
  '5.  **Fifth item with a bold title:**',
  `    *   *Profile:* Text with **bold words** ${WRAP}.`,
  '    *   *Italic line that is the whole item (ca. 1.500 – 4.000 €):*',
  `        *   **Option A – bold lead:** Deeper sub item with *„quoted italic“* ${WRAP}.`,
  `        *   \`code\` lead ${WRAP}.`,
  '',
  `- One space after the dash ${WRAP}.`,
  `-   *Three spaces* after the dash ${WRAP}.`,
  `+    **Four spaces** after the plus ${WRAP}.`,
  `1)  ~~Struck~~ lead after a parenthesis number ${WRAP}.`,
  `- [ ] *Task* with an italic lead ${WRAP}.`,
  `-   [ ] Task after three spaces ${WRAP}.`,
  '',
  'end',
].join('\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript((NOTE) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Items.md': NOTE,
    };
    const fs = (window as any).mockFs;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.replace(/\.md$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
        });
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
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
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
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          }
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const path = rel ? `${root}/${rel}` : root;
          const present = !!fs[path];
          if (cmd === 'checked_path_exists') return present;
          if (!present) return null;
          if (cmd === 'checked_read_dir') return (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', { path });
          return fs[path];
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
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  }, NOTE);
});

/** Per list line of the note: its bullet, and where its first and wrapped rows start. */
async function listGeometry(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector('.cm-content') as any;
    const view = content?.cmTile?.root?.view;
    if (!view) throw new Error('no editor view');
    const out: Array<{ line: number; text: string; bullet: string | null; box: boolean; bulletLeft: number | null; lineLeft: number; first: number | null; wrapped: number | null }> = [];
    const marker = /^(\s*)([-*+]|\d+[.)])( {1,4}|\t)(\[[ xX]\] +)?/;
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n);
      const m = marker.exec(line.text);
      if (!m) continue;
      const start = line.from + m[0].length;
      const first = view.coordsAtPos(start, 1);
      let wrapped: number | null = null;
      for (let pos = start + 1; first && pos < line.to; pos++) {
        const c = view.coordsAtPos(pos, 1);
        if (c && c.top > first.top + 8) { wrapped = c.left; break; }
      }
      const dom = view.domAtPos(line.from).node as Node;
      const el = (dom.nodeType === 1 ? dom as Element : dom.parentElement)!.closest('.cm-line') as HTMLElement;
      const bullet = el.querySelector('.cm-md-bullet') as HTMLElement | null;
      out.push({
        line: n,
        text: line.text.trim().slice(0, 24),
        bullet: bullet ? bullet.textContent : null, box: !!el.querySelector('.cm-md-task'),
        bulletLeft: bullet ? bullet.getBoundingClientRect().left : null,
        lineLeft: el.getBoundingClientRect().left,
        first: first ? first.left : null,
        wrapped,
      });
    }
    return out;
  });
}

test('live preview: every list item keeps its bullet and its wrapped lines start under its text, whatever follows the marker', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 1400 });
  await page.goto('/');
  await expect(page.getByText('Items', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('Items', { exact: true }).first().click();
  await expect(page.locator('.cm-content .cm-md-bullet').first()).toBeVisible({ timeout: 20000 });
  // Let the measured hanging indent settle.
  await page.waitForTimeout(600);
  if (process.env.PLAINVA_EVIDENCE) await page.locator('.cm-editor').first().screenshot({ path: testInfo.outputPath('list-items-live.png') });
  const rows = await listGeometry(page);
  console.log(JSON.stringify(rows, null, 1));
  const byText = (start: string) => {
    const row = rows.find((r) => r.text.startsWith(start));
    expect(row, start).toBeTruthy();
    return row!;
  };
  // Every unordered, non-task item draws the bullet of its level.
  const glyphs: Array<[string, string]> = [
    ['*   Plain sub item', '◦'],
    ['*   *Italic lead-in:*', '◦'],
    ['*   *Second lead-in:*', '◦'],
    ['*   👉', '◦'],
    ['*   $\\Rightarrow$', '◦'],
    ['*   *Profile:*', '◦'],
    ['*   *Italic line that', '◦'],
    ['*   **Option A', '▪'],
    ['*   `code` lead', '▪'],
    ['- One space', '•'],
    ['-   *Three spaces*', '•'],
    ['+    **Four spaces**', '•'],
  ];
  for (const [start, glyph] of glyphs) {
    const row = byText(start);
    expect(row.bullet, start).toBe(glyph);
    // The bullet stands inside the line, before the text.
    expect(row.bulletLeft!, start).toBeGreaterThanOrEqual(row.lineLeft - 0.5);
    expect(row.bulletLeft!, start).toBeLessThan(row.first!);
  }
  // A task item draws its box and no bullet, however many spaces stand before the box.
  for (const start of ['- [ ] *Task*', '-   [ ] Task after']) {
    const row = byText(start);
    expect(row.bullet, start).toBeNull();
    expect(row.box, start).toBe(true);
  }
  // Every wrapped row starts under the first letter of its item's text.
  for (const row of rows) {
    if (row.wrapped === null) continue;
    expect(Math.abs(row.wrapped - row.first!), JSON.stringify(row)).toBeLessThanOrEqual(1.5);
  }
  expect(rows.filter((r) => r.wrapped !== null).length).toBeGreaterThanOrEqual(12);
});

test('reading view: the same items, nested the same way', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 1400 });
  await page.goto('/');
  await expect(page.getByText('Items', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('Items', { exact: true }).first().click();
  await expect(page.locator('.cm-content .cm-md-bullet').first()).toBeVisible({ timeout: 20000 });
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const reader = page.locator('.markdown-reader').first();
  await expect(reader.locator('ol').first()).toBeVisible({ timeout: 10000 });
  if (process.env.PLAINVA_EVIDENCE) await reader.screenshot({ path: testInfo.outputPath('list-items-reader.png') });
  // 3., 4., 5. each carry their bullet list; the fifth nests a third level.
  await expect(reader.locator('ol').first().locator(':scope > li')).toHaveCount(3);
  await expect(reader.locator('ol').first().locator(':scope > li > ul > li')).toHaveCount(1 + 4 + 2);
  await expect(reader.locator('ol').first().locator(':scope > li > ul > li > ul > li')).toHaveCount(2);
  const leads = await reader.locator('ol').first().locator(':scope > li > ul > li').evaluateAll((els) => els.map((el) => (el.firstElementChild?.tagName ?? '') + ':' + (el.textContent ?? '').trim().slice(0, 12)));
  expect(leads[1].startsWith('EM:')).toBe(true);
});
