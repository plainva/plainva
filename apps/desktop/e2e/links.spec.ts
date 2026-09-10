/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Anchor links (issue #92, plan Kalender, Anker-Links, Dependabot 2026-09-10,
 * P5): `[[#Heading]]`, `[[Note#Heading]]`, `[text](#heading)`,
 * `[text](other.md#heading)`, `[[Note#^block]]` — in the live preview and
 * in the reading view. The fixture is the shortcuts suite's (a plain vault,
 * no PIM); the SQL mock answers every note query with ALL rows, so the note
 * that a wiki lookup must find is listed FIRST.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Other.md': '# Other\n\nIntro line.\n\nFiller line 1.\n\nFiller line 2.\n\nFiller line 3.\n\nFiller line 4.\n\nFiller line 5.\n\nFiller line 6.\n\nFiller line 7.\n\nFiller line 8.\n\nFiller line 9.\n\nFiller line 10.\n\nFiller line 11.\n\nFiller line 12.\n\nFiller line 13.\n\nFiller line 14.\n\nFiller line 15.\n\nFiller line 16.\n\nFiller line 17.\n\nFiller line 18.\n\nFiller line 19.\n\nFiller line 20.\n\nFiller line 21.\n\nFiller line 22.\n\nFiller line 23.\n\nFiller line 24.\n\nFiller line 25.\n\nFiller line 26.\n\nFiller line 27.\n\nFiller line 28.\n\nFiller line 29.\n\nFiller line 30.\n\nFiller line 31.\n\nFiller line 32.\n\nFiller line 33.\n\nFiller line 34.\n\nFiller line 35.\n\nFiller line 36.\n\nFiller line 37.\n\nFiller line 38.\n\nFiller line 39.\n\nFiller line 40.\n\nFiller line 41.\n\nFiller line 42.\n\nFiller line 43.\n\nFiller line 44.\n\nFiller line 45.\n\nFiller line 46.\n\nFiller line 47.\n\nFiller line 48.\n\nFiller line 49.\n\nFiller line 50.\n\nFiller line 51.\n\nFiller line 52.\n\nFiller line 53.\n\nFiller line 54.\n\nFiller line 55.\n\nFiller line 56.\n\nFiller line 57.\n\nFiller line 58.\n\nFiller line 59.\n\nFiller line 60.\n\nFiller line 61.\n\nFiller line 62.\n\nFiller line 63.\n\nFiller line 64.\n\nFiller line 65.\n\nFiller line 66.\n\nFiller line 67.\n\nFiller line 68.\n\nFiller line 69.\n\nFiller line 70.\n\nFiller line 71.\n\nFiller line 72.\n\nFiller line 73.\n\nFiller line 74.\n\nFiller line 75.\n\nFiller line 76.\n\nFiller line 77.\n\nFiller line 78.\n\nFiller line 79.\n\nFiller line 80.\n\n## Cool Header\n\nTarget text here.\n\nLine with block ^b1\n',
      '/test-vault/A.md': '# A\n\nLinks: [[#Second]] · [[Other#Cool Header]] · [GitHub](#second) · [rel](Other.md#cool-header) · [[Other#^b1]] · [[#Nowhere]]\n\nFiller line 1.\n\nFiller line 2.\n\nFiller line 3.\n\nFiller line 4.\n\nFiller line 5.\n\nFiller line 6.\n\nFiller line 7.\n\nFiller line 8.\n\nFiller line 9.\n\nFiller line 10.\n\nFiller line 11.\n\nFiller line 12.\n\nFiller line 13.\n\nFiller line 14.\n\nFiller line 15.\n\nFiller line 16.\n\nFiller line 17.\n\nFiller line 18.\n\nFiller line 19.\n\nFiller line 20.\n\nFiller line 21.\n\nFiller line 22.\n\nFiller line 23.\n\nFiller line 24.\n\nFiller line 25.\n\nFiller line 26.\n\nFiller line 27.\n\nFiller line 28.\n\nFiller line 29.\n\nFiller line 30.\n\nFiller line 31.\n\nFiller line 32.\n\nFiller line 33.\n\nFiller line 34.\n\nFiller line 35.\n\nFiller line 36.\n\nFiller line 37.\n\nFiller line 38.\n\nFiller line 39.\n\nFiller line 40.\n\nFiller line 41.\n\nFiller line 42.\n\nFiller line 43.\n\nFiller line 44.\n\nFiller line 45.\n\nFiller line 46.\n\nFiller line 47.\n\nFiller line 48.\n\nFiller line 49.\n\nFiller line 50.\n\nFiller line 51.\n\nFiller line 52.\n\nFiller line 53.\n\nFiller line 54.\n\nFiller line 55.\n\nFiller line 56.\n\nFiller line 57.\n\nFiller line 58.\n\nFiller line 59.\n\nFiller line 60.\n\nFiller line 61.\n\nFiller line 62.\n\nFiller line 63.\n\nFiller line 64.\n\nFiller line 65.\n\nFiller line 66.\n\nFiller line 67.\n\nFiller line 68.\n\nFiller line 69.\n\nFiller line 70.\n\nFiller line 71.\n\nFiller line 72.\n\nFiller line 73.\n\nFiller line 74.\n\nFiller line 75.\n\nFiller line 76.\n\nFiller line 77.\n\nFiller line 78.\n\nFiller line 79.\n\nFiller line 80.\n\n## Second\n\nSecond section text.\n',
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

async function openA(page: any) {
  await page.goto('/');
  await expect(page.getByText('A', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText('A', { exact: true }).first().click();
  await expect(page.locator('.cm-wiki-link', { hasText: '#Second' }).first()).toBeVisible({ timeout: 20000 });
}

/** The editor line that holds the text, once CodeMirror has scrolled it in. */
const cmLine = (page: any, text: string) => page.locator('.cm-line', { hasText: text }).first();

test('live preview: [[#Heading]] jumps within the note, [[Note#Heading]] opens the note at the heading, a block id lands on its line', async ({ page }) => {
  await openA(page);
  // The heading is far below the links: not in view before the click.
  await expect(cmLine(page, 'Second section text')).toHaveCount(0);
  await page.locator('.cm-wiki-link', { hasText: '#Second' }).first().click();
  await expect(cmLine(page, 'Second')).toBeInViewport({ timeout: 10000 });

  // Back to the top, then across notes: Other opens AT "Cool Header".
  await page.keyboard.press('Control+Home');
  await page.locator('.cm-wiki-link', { hasText: 'Other#Cool Header' }).first().click();
  await expect(cmLine(page, 'Cool Header')).toBeInViewport({ timeout: 10000 });
  await expect(cmLine(page, 'Links: ')).toHaveCount(0); // it is Other now, not A

  // Back to A: the block reference lands on the line that ends in ^b1.
  await page.getByText('A', { exact: true }).first().click();
  await expect(page.locator('.cm-wiki-link', { hasText: 'Other#^b1' }).first()).toBeVisible({ timeout: 20000 });
  await page.locator('.cm-wiki-link', { hasText: 'Other#^b1' }).first().click();
  await expect(cmLine(page, 'Line with block')).toBeInViewport({ timeout: 10000 });
});

test('live preview: a heading that does not exist says so instead of doing nothing', async ({ page }) => {
  await openA(page);
  await page.locator('.cm-wiki-link', { hasText: '#Nowhere' }).first().click();
  await expect(page.locator('.pv-toast, [role="status"], [role="alert"]').filter({ hasText: 'Nowhere' }).first()).toBeVisible({ timeout: 10000 });
});

test('reading view: a GitHub-style fragment link scrolls to the heading, a relative link with a fragment opens the note there', async ({ page }) => {
  await openA(page);
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const reader = page.locator('.markdown-reader').first();
  await expect(reader.getByRole('link', { name: 'GitHub' })).toBeVisible({ timeout: 10000 });
  await expect(reader.locator('#second')).not.toBeInViewport();
  await reader.getByRole('link', { name: 'GitHub' }).click();
  await expect(reader.locator('#second')).toBeInViewport({ timeout: 10000 });

  await reader.getByRole('link', { name: 'rel' }).scrollIntoViewIfNeeded();
  await reader.getByRole('link', { name: 'rel' }).click();
  // Other opens in whichever mode it last had — the live preview by default,
  // the reading view when the session remembers it — and lands on the heading
  // either way.
  await expect(page.locator('.cm-line:has-text("Cool Header"), .markdown-reader #cool-header').first()).toBeInViewport({ timeout: 10000 });
});
