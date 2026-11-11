/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Note links (F2, ADR 0037): `plainva://open?vault=…&path=…` opens a note at
 * a heading or a block — from the system (here: what the Rust side hands the
 * window on a cold start, `note_links_take`), and from a link clicked in a
 * note, which the opener's guard keeps inside the app. "Copy link" and "Copy
 * block link" at a line write the block's id into the editor and put the link
 * on the clipboard. The fixture is the links suite's.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Plan.md': '# Plan\n\nFiller line 1.\n\nFiller line 2.\n\nFiller line 3.\n\nFiller line 4.\n\nFiller line 5.\n\nFiller line 6.\n\nFiller line 7.\n\nFiller line 8.\n\nFiller line 9.\n\nFiller line 10.\n\nFiller line 11.\n\nFiller line 12.\n\nFiller line 13.\n\nFiller line 14.\n\nFiller line 15.\n\nFiller line 16.\n\nFiller line 17.\n\nFiller line 18.\n\nFiller line 19.\n\nFiller line 20.\n\nFiller line 21.\n\nFiller line 22.\n\nFiller line 23.\n\nFiller line 24.\n\nFiller line 25.\n\nFiller line 26.\n\nFiller line 27.\n\nFiller line 28.\n\nFiller line 29.\n\nFiller line 30.\n\nFiller line 31.\n\nFiller line 32.\n\nFiller line 33.\n\nFiller line 34.\n\nFiller line 35.\n\nFiller line 36.\n\nFiller line 37.\n\nFiller line 38.\n\nFiller line 39.\n\nFiller line 40.\n\nFiller line 41.\n\nFiller line 42.\n\nFiller line 43.\n\nFiller line 44.\n\nFiller line 45.\n\nFiller line 46.\n\nFiller line 47.\n\nFiller line 48.\n\nFiller line 49.\n\nFiller line 50.\n\nFiller line 51.\n\nFiller line 52.\n\nFiller line 53.\n\nFiller line 54.\n\nFiller line 55.\n\nFiller line 56.\n\nFiller line 57.\n\nFiller line 58.\n\nFiller line 59.\n\nFiller line 60.\n\n## Goals\n\nShip the links.\n\nKeep notes plain ^keep01\n',
      '/test-vault/Hub.md': '# Hub\n\nGo to [the goals](plainva://open?vault=test-vault&path=Plan.md&heading=Goals) or [elsewhere](plainva://open?vault=Elsewhere&path=Plan.md) or [nowhere](plainva://open?vault=Elsewhere&path=Gone.md).\n\nFirst point to link\n\n| A |\n| - |\n| B |\n',
    };
    // The addresses the Rust side holds for the window (src-tauri/src/note_links.rs)
    // are `__noteLinksOnStart`: what a cold start through a note link handed over.
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
        if (cmd === 'note_links_take') { const urls = (window as any).__noteLinksOnStart ?? []; (window as any).__noteLinksOnStart = []; return urls; }
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
          // The index lookup a note link opens by (`fileRecords`): never the disk.
          if (q.includes('FROM files WHERE path IN')) {
            const asked: string[] = (args.values ?? []).map(String);
            return noteRows().filter((r) => asked.includes(r.path)).map((r) => ({ id: 1, path: r.path, title: r.title, mtime_local: 1000, size_bytes: 1 }));
          }
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
        // Saves: the editor writes through the atomic command; the fixture keeps
        // what it wrote, so a test can read the note as it was saved.
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          fs[`${root}/${String(args.relPath).replace(/^\/+/, '')}`] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'set_file_times') return null;
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  });
});


const cmLine = (page: any, text: string) => page.locator('.cm-line', { hasText: text }).first();

async function openNote(page: any, name: string, marker: string) {
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText(name, { exact: true }).first().click();
  await expect(cmLine(page, marker)).toBeVisible({ timeout: 20000 });
}

test('a note link the system started the app with opens the note at its heading', async ({ page }, testInfo) => {
  await page.addInitScript(() => { (window as any).__noteLinksOnStart = ['plainva://open?vault=test-vault&path=Plan.md&heading=Goals']; });
  await page.goto('/');
  await expect(cmLine(page, 'Ship the links')).toBeInViewport({ timeout: 20000 });
  await expect(cmLine(page, 'Filler line 1.')).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('cold-start-heading.png') });
});

test('a note link clicked in a note opens inside Plainva; one to an unknown vault says so', async ({ page }, testInfo) => {
  await page.goto('/');
  await openNote(page, 'Hub', 'First point');
  await page.locator('.cm-line', { hasText: 'Go to' }).locator('text=the goals').first().click();
  await expect(cmLine(page, 'Ship the links')).toBeInViewport({ timeout: 20000 });

  // A vault this device does not know, but the note is in the open one: asked, never opened silently.
  await openNote(page, 'Hub', 'First point');
  await page.locator('.cm-line', { hasText: 'Go to' }).locator('text=elsewhere').first().click();
  const question = page.getByRole('dialog').filter({ hasText: /Elsewhere/ });
  await expect(question).toBeVisible({ timeout: 10000 });
  await expect(question).toContainText('Plan');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('open-here-question.png') });
  await question.getByRole('button', { name: /^(Öffnen|Open)$/ }).click();
  await expect(cmLine(page, 'Ship the links')).toBeVisible({ timeout: 20000 });

  // Neither vault nor note: said as such.
  await openNote(page, 'Hub', 'First point');
  await page.locator('.cm-line', { hasText: 'Go to' }).locator('text=nowhere').first().click();
  await expect(page.locator('.pv-toast').filter({ hasText: /Elsewhere/ }).first()).toBeVisible({ timeout: 10000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('unknown-vault.png') });
});

test('Copy block link from the right-click menu writes an id and copies [[Hub#^id]]; Copy link copies the address', async ({ page }, testInfo) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openNote(page, 'Hub', 'First point');
  const line = cmLine(page, 'First point to link');
  await line.click();
  await line.click({ button: 'right' });
  const blockLink = page.getByTestId('context-copy-block-link');
  await expect(blockLink).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('context-menu.png') });
  await blockLink.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\[\[Hub#\^[a-z0-9]{6}\]\]$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const id = /\^([a-z0-9]{6})/.exec(copied)![1];
  await expect(cmLine(page, 'First point to link')).toContainText(`^${id}`);

  // The address of the same block: no second id.
  await cmLine(page, 'First point to link').click({ button: 'right' });
  await page.getByTestId('context-copy-link').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`plainva://open?vault=test-vault&path=Hub.md&block=${id}`);
  await expect(page.locator('.cm-line', { hasText: '^' })).toHaveCount(1);
  // Saved as an ordinary edit: the file holds the id, and the editor says so.
  await expect.poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Hub.md'] as string), { timeout: 15000 }).toContain(`First point to link ^${id}\n`);
  await expect(page.getByText(/Save failed|Speichern fehlgeschlagen/)).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('block-id-written.png') });
});

test('the block menu links a table on a line of its own, and the note menu copies the note\'s address', async ({ page }, testInfo) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openNote(page, 'Hub', 'First point');
  // The handle's menu for the table (the shared block-handle event).
  const from = await page.evaluate(() => {
    const text = (window as any).mockFs['/test-vault/Hub.md'] as string;
    return text.indexOf('| A |');
  });
  await page.evaluate((at) => window.dispatchEvent(new CustomEvent('plainva-open-block-menu', { detail: { from: at, x: 300, y: 300 } })), from);
  await expect(page.getByTestId('block-copy-block-link')).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('block-menu.png') });
  await page.getByTestId('block-copy-block-link').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\[\[Hub#\^[a-z0-9]{6}\]\]$/);
  const id = /\^([a-z0-9]{6})/.exec(await page.evaluate(() => navigator.clipboard.readText()))![1];
  await expect(page.locator('.cm-content')).toContainText(`^${id}`);
  // On a line of its own behind the table, a blank line before it.
  await expect.poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Hub.md'] as string), { timeout: 15000 }).toContain(`| B |\n\n^${id}`);

  await page.getByTestId('editor-menu-btn').first().click();
  await page.getByTestId('editor-menu-copy-link').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('plainva://open?vault=test-vault&path=Hub.md');
});
