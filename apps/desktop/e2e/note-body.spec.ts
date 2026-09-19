/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * The note body (finding 2026-09-19, plan Rueckmeldungen P8): a callout is ONE
 * card in the live editor and in the reading view, a done task is muted and
 * struck through in both, and nested list levels carry an indent guide. The
 * editor has only lines to build the card from, so this measures the
 * silhouette: corners and top on the first line, sides on every line, bottom
 * on the last. The fixture is the links suite's plain vault.
 */
const BODY_NOTE = [
  '# Body',
  '',
  '> [!info] Window',
  '> Saturday from six.',
  '> The practice knows.',
  '',
  '> [!warning] Alone',
  '',
  '> A plain quote keeps its bar.',
  '',
  '- [x] export mailboxes',
  '- [ ] switch over',
  '',
  '- follow-up',
  '  - set up clients',
  '    - reception',
  '- done',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript((BODY_NOTE) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Body.md': BODY_NOTE,
    };
    const fs = (window as any).mockFs;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p) && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.replace(/\.md$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
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
        // The version the marker above is compared against. Without it the
        // command falls through to `null` and every start looks like an update.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'tagColors') return [(window as any).__tagColors === true, true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          // Stage D remounts `App` when the shown vault arrives, which is when
          // the release dialog finally gets a vault to render over. A marker
          // equal to the running version means "already seen" - this suite
          // tests the app, not its first five seconds (onboarding.spec covers
          // those on purpose).
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
          if (q.includes('FROM tags t')) return [{ id: 1, path: 'Tags.md', title: 'Tags', mtime_local: 1000, size_bytes: 10 }];
          if (q.includes('FROM tags')) return [{ tag: 'project/site', count: 1 }, { tag: 'project/print', count: 1 }, { tag: 'idea', count: 1 }];
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          }
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === "register_write_root") return "mock-root:" + String(args.path).replace(/\/$/, "");
        // Checked native reads use the same files as the plugin fixture.
        if (cmd === "checked_path_exists" || cmd === "checked_read_text_file" || cmd === "checked_read_dir") {
          const root = String(args.rootId).replace(/^mock-root:/, "").replace(/\/$/, "");
          const rel = String(args.relPath).replace(/^\/+/, "");
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|exists", { path });
          if (cmd === "checked_path_exists") return present;
          if (!present) return null;
          if (cmd === "checked_read_dir") {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_dir", { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_text_file", { path });
          return typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
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
  }, BODY_NOTE);
});



async function openBody(page: any) {
  await page.goto('/');
  await expect(page.getByText('Body', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('Body', { exact: true }).first().click();
  await expect(page.locator('.cm-content .cm-callout').first()).toBeVisible({ timeout: 20000 });
}

const box = (el: Element) => {
  const s = getComputedStyle(el);
  return {
    top: s.borderTopWidth, bottom: s.borderBottomWidth, left: s.borderLeftWidth, right: s.borderRightWidth,
    topRadius: s.borderTopLeftRadius, bottomRadius: s.borderBottomLeftRadius,
    ground: s.backgroundColor, line: s.borderLeftColor,
  };
};

test('live preview: a callout is one card built from its lines', async ({ page }) => {
  await openBody(page);
  const lines = page.locator('.cm-content .cm-callout');
  await expect(lines).toHaveCount(4);
  const [first, middle, last, alone] = await lines.evaluateAll((els: Element[], fn: string) => els.map((el) => (new Function('el', `return (${fn})(el)`))(el)), box.toString());
  // Sides and tint on every line ...
  for (const line of [first, middle, last, alone]) {
    expect(line.left).toBe('1px');
    expect(line.right).toBe('1px');
    expect(line.ground).not.toBe('rgba(0, 0, 0, 0)');
  }
  // ... the top and its corners on the first, the bottom on the last.
  expect([first.top, first.bottom, first.topRadius, first.bottomRadius]).toEqual(['1px', '0px', '12px', '0px']);
  expect([middle.top, middle.bottom, middle.topRadius, middle.bottomRadius]).toEqual(['0px', '0px', '0px', '0px']);
  expect([last.top, last.bottom, last.topRadius, last.bottomRadius]).toEqual(['0px', '1px', '0px', '12px']);
  // A one-line callout is a whole card, in ITS colour.
  expect([alone.top, alone.bottom, alone.topRadius, alone.bottomRadius]).toEqual(['1px', '1px', '12px', '12px']);
  expect(alone.line).not.toBe(first.line);
  // The lines of one card touch: no gap the height map does not know.
  const rects = await lines.evaluateAll((els: Element[]) => els.slice(0, 3).map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
  expect(Math.abs(rects[0][1] - rects[1][0])).toBeLessThan(0.5);
  expect(Math.abs(rects[1][1] - rects[2][0])).toBeLessThan(0.5);
  // The body of a card reads like the note's text, not like a quotation.
  const quoteStyle = await page.locator('.cm-content .cm-callout', { hasText: 'Saturday' }).locator('.cm-md-quote').first().evaluate((el: Element) => getComputedStyle(el).fontStyle);
  expect(quoteStyle).toBe('normal');
  // A plain quote keeps its bar and its voice.
  const plain = page.locator('.cm-content .cm-blockquote-line');
  await expect(plain).toHaveCount(1);
  expect(await plain.evaluate((el: Element) => getComputedStyle(el).borderLeftWidth)).toBe('4px');
});

test('live preview: a done task is muted and struck through, an open one is not; nested levels get a guide', async ({ page }) => {
  await openBody(page);
  const done = page.locator('.cm-content .cm-md-task-done');
  await expect(done).toHaveText(['export mailboxes']);
  expect(await done.evaluate((el: Element) => getComputedStyle(el).textDecorationLine)).toBe('line-through');
  const open = page.locator('.cm-content .cm-line', { hasText: 'switch over' });
  expect(await open.evaluate((el: Element) => getComputedStyle(el).textDecorationLine)).toBe('none');

  const layers = (text: string) => page.locator('.cm-content .cm-line', { hasText: text }).first().evaluate((el: Element) => {
    const image = getComputedStyle(el).backgroundImage;
    return image === 'none' ? 0 : image.split('linear-gradient').length - 1;
  });
  expect(await layers('follow-up')).toBe(0);
  expect(await layers('set up clients')).toBe(1);
  expect(await layers('reception')).toBe(2);
  // The guide of a level runs under that level's bullet.
  const under = await page.evaluate(() => {
    const find = (text: string) => Array.from(document.querySelectorAll('.cm-content .cm-line')).find((el) => (el.textContent || '').includes(text)) as HTMLElement;
    const parent = find('follow-up');
    const child = find('set up clients');
    const bullet = parent.querySelector('.cm-md-bullet') as HTMLElement;
    const b = bullet.getBoundingClientRect();
    const guideX = parseFloat(getComputedStyle(child).backgroundPosition) + child.getBoundingClientRect().left;
    return Math.abs(b.left + b.width / 2 - guideX - 0.5);
  });
  expect(under).toBeLessThan(2);
});

test('reading view: the same card, the same done task, the same guide', async ({ page }) => {
  await openBody(page);
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const reader = page.locator('.markdown-reader').first();
  const cards = reader.locator('.pv-reader-callout');
  await expect(cards).toHaveCount(2, { timeout: 10000 });
  const card = await cards.first().evaluate((el: Element) => { const s = getComputedStyle(el); return [s.borderTopWidth, s.borderLeftWidth, s.borderTopLeftRadius, s.backgroundColor]; });
  expect(card.slice(0, 3)).toEqual(['1px', '1px', '12px']);
  expect(card[3]).not.toBe('rgba(0, 0, 0, 0)');
  // No empty first line where the header line used to be.
  await expect(cards.first().locator('br')).toHaveCount(1);
  const done = reader.locator('.pv-reader-task-done');
  await expect(done).toHaveCount(1);
  await expect(done).toContainText('export mailboxes');
  expect(await done.evaluate((el: Element) => getComputedStyle(el).textDecorationLine)).toBe('line-through');
  expect(await reader.locator('li > ul').first().evaluate((el: Element) => getComputedStyle(el).borderLeftWidth)).toBe('1px');
});
