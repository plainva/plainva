/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect, type Page } from '@playwright/test';

/**
 * The parse budget in the desktop's editor and reading view (open-items plan
 * 3.133 no. 4). A note with a line of 100 000 `]` held the reading view for
 * minutes: the Markdown parser looks back over a whole paragraph at each `]`,
 * `*`, `_` and `~`, and the same work came from 1 250 short lines without a
 * blank line between them, from a long run of `*a` and from a table of
 * 6 000 rows. Each note here opens, shows its last heading in the editor and
 * in the reading view, and leaves the page answering — within a budget the
 * old parse exceeded by minutes. The stretch itself is shown as written.
 *
 * And what a note fetches from the web (decision E1 of the bug-clearing plan,
 * open-items plan 3.79): a picture in a note, written `![x](https://…)`, is
 * loaded by the editor and the reading view. That is what a note is for — and
 * why a filed mail must not carry one in (`mail.spec.ts`).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    const longLine = ']'.repeat(100_000);
    const shortLines = Array.from({ length: 1_250 }, () => ']'.repeat(80)).join('\n');
    const emphasis = '*a'.repeat(150_000);
    const table = ['| a | b |', '|---|---|', ...Array.from({ length: 6_000 }, (_, i) => `| row ${i} | [[n${i}]] |`)].join('\n');
    const around = (stretch: string) => `# Title\n\nBefore [[Kept]] and *em*.\n\n${stretch}\n\n## After\n\nThe end.\n`;
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/LongLine.md': around(longLine),
      '/test-vault/ShortLines.md': around(shortLines),
      '/test-vault/Emphasis.md': around(emphasis),
      '/test-vault/BigTable.md': around(table),
      '/test-vault/Remote.md': [
        '# Remote',
        '',
        '![pixel](https://tracker.example.org/md.png)',
        '',
        '![[https://tracker.example.org/wiki.png]]',
        '',
        '<img src="https://tracker.example.org/html.png">',
        '',
        '![ref][r]',
        '',
        '[r]: https://tracker.example.org/ref.png',
        '',
        'The end.',
        '',
      ].join('\n'),
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
  });
});

const NOTES = ['LongLine', 'ShortLines', 'Emphasis', 'BigTable'];

async function openNote(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(name, { exact: true }).first().click();
}

/** How long the page takes to answer a script: a frozen main thread does not. */
async function answers(page: Page): Promise<number> {
  const start = Date.now();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  return Date.now() - start;
}

for (const name of NOTES) {
  test(`${name}: opens in the editor and the reading view in a moment, the stretch as written`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const start = Date.now();
    await page.getByText(name, { exact: true }).first().click();
    const editor = page.locator('.cm-content');
    await expect(editor.getByText('Title').first()).toBeVisible({ timeout: 30_000 });
    // To the end of the note: the editor's parser has to read through the stretch.
    await editor.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+End');
    await expect(editor.getByText('The end.')).toBeVisible({ timeout: 30_000 });
    expect(await answers(page)).toBeLessThan(5_000);
    const editorDone = Date.now() - start;

    await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
    const reader = page.locator('.markdown-reader').first();
    await expect(reader.locator('h2', { hasText: 'After' })).toHaveCount(1, { timeout: 30_000 });
    await expect(reader.locator('h1', { hasText: 'Title' })).toHaveCount(1);
    await expect(reader.locator('em', { hasText: 'em' })).toHaveCount(1);
    expect(await answers(page)).toBeLessThan(5_000);
    console.log(`${name}: editor ${editorDone} ms, with the reading view ${Date.now() - start} ms`);
    // The old parse took minutes for each of these notes; a generous budget for the whole way.
    expect(Date.now() - start).toBeLessThan(60_000);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath(`parse-budget-${name}.png`) });
  });
}

test('a picture from the web in a note: the editor and the reading view fetch it, HTML in the note fetches nothing', async ({ page }, testInfo) => {
  const fetched: string[] = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://tracker.example.org/**', (route) => {
    fetched.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
  });
  await openNote(page, 'Remote');
  await expect(page.locator('.cm-content').getByText('The end.')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => [...new Set(fetched)].sort(), { timeout: 15_000 }).toEqual(['/md.png', '/wiki.png']);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('remote-editor.png') });
  fetched.length = 0;
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  await expect(page.locator('.markdown-reader').first().getByText('The end.')).toBeVisible({ timeout: 15_000 });
  // The editor fetched `md.png` already, and the browser takes it from its cache now: the pictures the reader draws, loaded.
  await expect.poll(() => [...new Set(fetched)], { timeout: 15_000 }).toContain('/ref.png');
  const drawn = () => page.locator('.markdown-reader img').evaluateAll((imgs) => imgs.map((img) => {
    const image = img as HTMLImageElement;
    return [new URL(image.src).pathname, image.complete && image.naturalWidth > 0];
  }));
  await expect.poll(drawn, { timeout: 15_000 }).toEqual([['/md.png', true], ['/ref.png', true]]);
  expect(fetched).not.toContain('/html.png');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('remote-reader.png') });
});
