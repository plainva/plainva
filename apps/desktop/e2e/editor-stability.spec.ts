/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// E2E for the editor-stability plan (Gesamtplan Editor-Stabilitaet 2026-07-05):
// the editor must stay visually still — table widgets and list indents survive
// typing, the save cycle (debounced save + re-index + context updates), an
// external no-op update and a right-click on a table cell. Before the fix,
// every React render reconfigured CodeMirror; the language reset re-parsed
// only the first ~3000 characters synchronously, so everything below that
// window collapsed and was rebuilt 100–500 ms later. The fixture therefore
// puts the table/list far beyond 3000 characters.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    const filler = Array.from(
      { length: 60 },
      (_, i) => `Zeile ${i} mit genug Fuelltext, damit die Notiz weit ueber die 3000-Zeichen-Grenze des synchronen Init-Parsers hinauswaechst.`
    ).join('\n');
    const big = [
      '# Big',
      '',
      filler,
      '',
      '| Spalte A | Spalte B |',
      '| --- | --- |',
      '| Wert 1 | Wert 2 |',
      '| Wert 3 | [[Welcome]] |',
      '',
      '- oben',
      '  - verschachtelt',
      '',
      'ENDE',
      '',
    ].join('\n');

    const math = [
      '# Math',
      '',
      'Inline $E=mc^2$ Formel.',
      '',
      '$$',
      'x^2 + y^2 = z^2',
      '$$',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      'ENDE',
      '',
    ].join('\n');

    const links = [
      '# Kopf',
      '',
      'Text davor.',
      '',
      'Link [[Welcome]] hier.',
      '',
      'ENDE',
      '',
    ].join('\n');

    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
      '/test-vault/Big.md': big,
      '/test-vault/Math.md': math,
      '/test-vault/Links.md': links,
    };

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
        if (cmd === 'plugin:path|join') {
          return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        }

        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
        if (cmd === 'plugin:store|save') return null;

        if (cmd === 'plugin:dialog|ask') return true;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') {
          return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        }

        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
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
          const entries: Record<string, { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }> = {};
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
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

        return null;
      },
    };
  });
});

/** Opens Big.md, waits for the rendered table widget and arms a mutation
 *  counter: any REMOVAL of a table-widget node from the editor DOM counts.
 *  With the session host that count must stay 0 — the old reconfigure host
 *  rebuilt the widget DOM on every React render. */
async function openBigAndArm(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Big', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Big', { exact: true }).click();

  // CodeMirror virtualizes the viewport: the table (far below the 3000-char
  // boundary) only gets DOM once we scroll to the end of the document.
  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.click();
  await page.keyboard.press('Control+End');

  const table = page.locator('.cm-md-table');
  await expect(table).toBeVisible({ timeout: 10000 });

  await page.evaluate(() => {
    const w = window as any;
    w.__removedTableNodes = 0;
    const wrap = document.querySelector('.cm-md-table-wrap') as HTMLElement;
    wrap.dataset.pvMarker = '1';
    const scroller = document.querySelector('.cm-scroller')!;
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        m.removedNodes.forEach(n => {
          const el = n as HTMLElement;
          if (el.nodeType !== 1) return;
          if (el.classList?.contains('cm-md-table-wrap') || el.querySelector?.('.cm-md-table-wrap')) {
            w.__removedTableNodes++;
          }
        });
      }
    });
    mo.observe(scroller, { childList: true, subtree: true });
  });
}

const removedTableNodes = (page: Page) => page.evaluate(() => (window as any).__removedTableNodes as number);
const markerAlive = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-pv-marker="1"]') !== null);
const scrollTop = (page: Page) =>
  page.evaluate(() => (document.querySelector('.cm-scroller') as HTMLElement).scrollTop);

test('live mode renders KaTeX + mermaid in place; clicking flips to source (Nachfass P3.4)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Math', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Math', { exact: true }).click();

  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible({ timeout: 10000 });

  // Real KaTeX renders the inline formula and the $$ block (2 widgets); the
  // lazy chunks may take a moment on a cold dev server.
  await expect(page.locator('.pv-math-widget .katex')).toHaveCount(2, { timeout: 20000 });
  // Real mermaid renders the fence into an SVG.
  const mermaid = page.locator('.pv-mermaid-live');
  await expect(mermaid.locator('svg')).toBeVisible({ timeout: 30000 });
  // The raw fence marker is hidden while rendered.
  await expect(editor).not.toContainText('```mermaid');

  // Clicking the diagram puts the caret inside the fence -> raw source shows.
  await mermaid.click();
  await expect(editor).toContainText('```mermaid');
  await expect(page.locator('.pv-mermaid-live')).toHaveCount(0);
});

test('typing + save cycle far below the init-parse window keeps the view still', async ({ page }) => {
  await openBigAndArm(page);

  // Caret onto the trailing END line (below the >3000-char boundary, next to
  // table and list) and type — every keystroke used to trigger a reconfigure.
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' still', { delay: 40 });

  // Let the full save pipeline run: 1 s save debounce + re-index +
  // triggerFileTreeUpdate + isSaving toggles + 150 ms content sync.
  await page.waitForTimeout(2600);

  expect(await removedTableNodes(page)).toBe(0);
  expect(await markerAlive(page)).toBe(true);

  // The list indent decorations must be in place the whole time (same values
  // the smoke suite asserts: (depth+1) * 1.5em at 16px).
  const topLine = page.locator('.cm-line').filter({ hasText: 'oben' }).first();
  const nestedLine = page.locator('.cm-line').filter({ hasText: 'verschachtelt' }).first();
  await expect(topLine).toHaveCSS('padding-left', '48px');
  await expect(nestedLine).toHaveCSS('padding-left', '72px');
});

test('an identical external update is a complete no-op', async ({ page }) => {
  await openBigAndArm(page);

  const before = await scrollTop(page);
  // The watcher/sync path fires this event; the file content is unchanged, so
  // the editor must not dispatch anything (minimalDocChange returns null).
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('plainva-external-update', { detail: { path: 'Big.md' } }));
  });
  await page.waitForTimeout(400);

  expect(await removedTableNodes(page)).toBe(0);
  expect(await markerAlive(page)).toBe(true);
  expect(await scrollTop(page)).toBe(before);
});

test('inactive headings sit flush; links unfold under the keyboard caret (2026-07-06)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Links', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Links', { exact: true }).click();

  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible({ timeout: 10000 });

  // Park the caret on the trailing ENDE line — heading + link line inactive.
  await page.locator('.cm-line').filter({ hasText: 'ENDE' }).first().click();

  // The "# " mark is hidden INCLUDING its space: no phantom indent.
  // (textContent via evaluate — toHaveText would normalize the leading space away.)
  const heading = page.locator('.cm-line').filter({ hasText: 'Kopf' }).first();
  expect(await heading.evaluate((el) => el.textContent)).toBe('Kopf');

  // The wiki-link syntax is folded away on the inactive line.
  const linkLine = page.locator('.cm-line').filter({ hasText: 'Welcome' }).first();
  expect(await linkLine.evaluate((el) => el.textContent)).toBe('Link Welcome hier.');

  // Caret to the START of the link line, then arrow INTO the link — a
  // selection change WITHOUT a line change. The old plugin only rebuilt on
  // line changes, so the raw syntax never appeared under the keyboard caret.
  await linkLine.click({ position: { x: 2, y: 4 } });
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  expect(await linkLine.evaluate((el) => el.textContent)).toBe('Link [[Welcome]] hier.');

  // Leaving the link (End of line, past the trailing text) folds it again.
  await page.keyboard.press('End');
  expect(await linkLine.evaluate((el) => el.textContent)).toBe('Link Welcome hier.');
});

test('block menu opened near the bottom edge stays fully on screen', async ({ page }) => {
  await openBigAndArm(page);

  // The block handle dispatches exactly this event; y sits at the very
  // bottom, where the old fixed "innerHeight - 380" clamp cut the menu off.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('plainva-open-block-menu', {
      detail: { from: 0, x: 200, y: window.innerHeight - 30 },
    }));
  });

  const menu = page.getByRole('menu', { name: /Block actions|Block-Aktionen/ });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // The last (danger) item is actually reachable.
  await expect(menu.getByRole('menuitem', { name: /Delete block|Block löschen/ })).toBeVisible();
});

test('right-click on a table cell opens the menu without moving the view', async ({ page }) => {
  await openBigAndArm(page);

  const cell = page.locator('.cm-md-table td').first();
  await cell.scrollIntoViewIfNeeded();
  const before = await scrollTop(page);

  await cell.click({ button: 'right' });
  // The table context menu opens (Editor.tsx listens for the widget's event).
  await expect(page.getByText(/Zeile oberhalb einfügen|Insert row above/).first()).toBeVisible();

  // Opening the menu re-renders the Editor component — the session host must
  // keep the widget DOM and the scroll position untouched.
  const after = await scrollTop(page);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  expect(await removedTableNodes(page)).toBe(0);
  expect(await markerAlive(page)).toBe(true);
});
