/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    /** The version the app reports here; the seen-marker matches it. */
    (window as any).__E2E_APP_VERSION = '9.9.9';
    // Simple in-memory file system mock
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': "# Hello\nWelcome to the mock vault!"
    };

    (window as any).__TAURI_INTERNALS__ = {
      plugins: {
        path: { sep: '/' }
      },
      transformCallback: (callback: any) => {
        // Return a dummy channel id
        return 1;
      },
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;
        
        // --- PATH PLUGIN ---
        if (cmd === 'plugin:path|normalize') {
          // crude normalize mock
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
          // The splash is the default entry since 2026-07-04 — the suite keeps
          // the old auto-open behavior via the (now opt-in) setting.
          if (args.key === 'autoOpenLastVault') return [true, true];
          // The OKF offer must not interfere with the scenarios. It is a toast
          // now rather than the dialog that used to open by itself (P4.1) —
          // `__E2E_OKF_OFFER` lets the one test that WANTS it turn it back on.
          if (String(args.key || '').startsWith('okfPromptDismissed_')) {
            return [(window as any).__E2E_OKF_OFFER ? null : true, true];
          }
          // Neither must the release dialogs: a marker equal to the running
          // version means "already seen". Both are covered on purpose in
          // onboarding.spec.ts — this suite tests the app, not its first
          // five seconds. (Before the StrictMode fix they never appeared at
          // all, which is why no mock needed this.)
          if (args.key === 'whatsNewSeenVersion') return [(window as any).__E2E_APP_VERSION, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          // Everything else comes from a real in-memory store, so a test can
          // seed a setting AND a feature can persist one. Before this the mock
          // answered every unknown key with "unset" and swallowed every write,
          // which made round-trips through the settings surface untestable.
          const store = ((window as any).__E2E_STORE_SEED ??= {});
          if (Object.prototype.hasOwnProperty.call(store, args.key)) return [store[args.key], true];
          return [null, false];
        }
        if (cmd === 'plugin:app|version') return (window as any).__E2E_APP_VERSION;
        if (cmd === 'plugin:store|set') {
          ((window as any).__E2E_STORE_SEED ??= {})[args.key] = args.value;
          return null;
        }
        if (cmd === 'plugin:store|save') return null;

        // --- DIALOG PLUGIN --- plugin-dialog v2 routes ask()/confirm() through
        // the message command and compares the pressed button label ('Yes'/'Ok').
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
           // listBases(): inline `LIKE '%.base'` with no bind values — must
           // come before the generic LIKE branch (whose empty needle would
           // return EVERY file as a database).
           if (q.includes("WHERE path LIKE '%.base'")) {
             return Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && p.endsWith('.base'))
               .map(p => ({ path: p.replace('/test-vault/', ''), title: null }));
           }
           // Conflict lookup of the sync-error dialog (P3.11): LIKE over paths.
           if (q.includes('WHERE path LIKE')) {
             const pattern = String(args.values?.[0] ?? '');
             const needle = pattern.replace(/%/g, '');
             return Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && p.includes(needle))
               .map(p => ({ path: p.replace('/test-vault/', '') }));
           }
           // The tree listing and the index.md generator queries share one
           // row shape (path/title/mode) derived from the mock fs.
           if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
             const result = Object.keys(fs)
               .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
               .map(p => {
                 const relativePath = p.replace('/test-vault/', '');
                 const isNote = /\.(md|base)$/i.test(relativePath);
                 // Title mirrors the real indexer: basename without extension.
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

test('Note Lifecycle: Edit note and persist via mock fs', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the file tree to load the mocked "Welcome.md"
  // Note: the file tree displays the title from frontmatter, which is "Welcome", or strips .md.
  await expect(page.locator('.lucide-folder').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible();

  // Open the file
  await page.getByText('Welcome', { exact: true }).click();

  // Wait for the editor to render the content
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();

  // We should be able to create a new file
  // Hover over file actions or right-click
  // Wait, let's use the Quick Switcher or the "New Note" button if available.
  // The sidebar has a "New note in root" button (FilePlus2 or similar).
  // In `FileTree.tsx`, there is `Plus` for new note root.
  // We can just click the parent folder /test-vault and trigger a context menu, but easier:
  const newNoteBtn = page.locator('div[data-tip="New Note in Root"], div[data-tip="Neue Notiz im Hauptverzeichnis"]');
  if (await newNoteBtn.isVisible()) {
      await newNoteBtn.click();
  }
  
  // A11y Check
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  // Filter out any known acceptable violations or just assert empty
  expect(accessibilityScanResults.violations).toEqual([]);
});

test('Tabs: the close (X) button closes the tab', async ({ page }) => {
  // Regression guard for the pointer-drag tab reorder (#5): capturing the pointer
  // on press retargeted the click and swallowed clicks on the close button.
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();

  const tab = page.getByRole('tab').filter({ hasText: 'Welcome' });
  await expect(tab).toBeVisible();

  // Clicking the X must close the tab, not merely (re-)select it.
  await tab.locator('.lucide-x').click();

  await expect(tab).toHaveCount(0);
  await expect(page.getByText('Welcome to the mock vault!')).toHaveCount(0);
});

test('Editor ⋮ menu: rename prompts for a name, moves the file and retargets the tab', async ({ page }) => {
  // Plan UI-Menüs 2026-07-05 P4: the editor menu shares the tree's rename core.
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();

  await page.getByTestId('editor-menu-btn').click();
  await page.getByTestId('editor-menu-rename').click();

  const dlg = page.getByRole('dialog', { name: /Rename|Umbenennen/ });
  await expect(dlg).toBeVisible();
  const input = dlg.getByRole('textbox');
  await expect(input).toHaveValue('Welcome');
  await input.fill('Renamed');
  await dlg.getByRole('button', { name: /Confirm|Bestätigen/ }).click();

  // The open tab now shows the new name and the mock fs moved the file.
  await expect(page.getByRole('tab').filter({ hasText: 'Renamed' })).toBeVisible();
  const moved = await page.evaluate(() => ({
    renamed: '/test-vault/Renamed.md' in (window as any).mockFs,
    old: '/test-vault/Welcome.md' in (window as any).mockFs,
  }));
  expect(moved.renamed).toBe(true);
  expect(moved.old).toBe(false);
});

test('a vanished file shows a state, not an error string that gets saved', async ({ page }) => {
  // Issue #34: the read error used to be written INTO the editor buffer (in
  // German, in an English app), so the next keystroke made the autosave
  // recreate the deleted note with "Fehler beim Laden der Datei." as its body.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Vanished.md'] = '# Vanished\n\nStill here.\n';
  });
  await page.goto('/');
  await expect(page.getByText('Vanished', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByTestId('file-tree').getByText('Vanished', { exact: true }).click();
  await expect(page.getByText('Still here.')).toBeVisible();

  // The file disappears underneath us (deleted outside Plainva), then the tab
  // is revisited — exactly the stale-index path the reporter hit.
  await page.evaluate(() => { delete (window as any).mockFs['/test-vault/Vanished.md']; });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();
  // The tree row is still there (the index has not caught up yet) — that is
  // exactly the phantom entry a user clicks.
  await page.getByTestId('file-tree').getByText('Vanished', { exact: true }).click();

  const missing = page.getByTestId('editor-missing-file');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('no longer exists');
  // No editor surface, so nothing can be typed — and nothing was written back.
  await expect(page.locator('.cm-content')).toHaveCount(0);
  expect(await page.evaluate(() => '/test-vault/Vanished.md' in (window as any).mockFs)).toBe(false);
});

test('Lists: nested items get a stepped hanging indent in the editor', async ({ page }) => {
  // #2: verifies the listIndent decoration applies with the expected padding
  // (top level one step in from body, nested one step deeper) in live mode.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Lists.md'] = "# Lists\n\n- top level\n  - nested item\n";
  });

  await page.goto('/');
  await expect(page.getByText('Lists', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Lists', { exact: true }).click();

  const topLine = page.locator('.cm-line').filter({ hasText: 'top level' }).first();
  const nestedLine = page.locator('.cm-line').filter({ hasText: 'nested item' }).first();
  await expect(topLine).toBeVisible();

  // (depth+1) * 1.5em at 16px: depth 1 -> 48px, depth 2 -> 72px.
  await expect(topLine).toHaveCSS('padding-left', '48px');
  await expect(nestedLine).toHaveCSS('padding-left', '72px');
});

test('Document header: /icon sets an emoji icon via the picker (W3)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Icons.md'] = "---\ntype: Note\n---\n\nIcon test body\n";
  });

  await page.goto('/');
  await expect(page.getByText('Icons', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Icons', { exact: true }).click();
  await expect(page.getByText('Icon test body')).toBeVisible();

  // New line at the end of the body, then the slash command.
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/icon');
  await page
    .locator('.cm-tooltip-autocomplete li', { hasText: /Dokument-Icon|Document icon/ })
    .first()
    .click();

  // Emoji picker opens; search finds the rocket, selecting it writes the
  // plainva.icon frontmatter which the live-mode header widget renders.
  const picker = page.getByRole('dialog');
  await expect(picker).toBeVisible();
  await page.keyboard.type('rocket');
  await picker.locator('button[aria-label="rocket"]').first().click();

  await expect(page.locator('.pv-doc-header-icon').first()).toContainText('🚀', { timeout: 10000 });
});

test('Emoji: /emoji inserts a Unicode emoji into the text via the picker', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/EmojiText.md'] = "---\ntype: Note\n---\n\nEmoji body\n";
  });

  await page.goto('/');
  await expect(page.getByText('EmojiText', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('EmojiText', { exact: true }).click();
  await expect(page.getByText('Emoji body')).toBeVisible();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/emoji');
  await page
    .locator('.cm-tooltip-autocomplete li', { hasText: /Emoji/i })
    .first()
    .click();

  // The emoji-only picker opens (no icon-set mode switch); search + pick the
  // rocket. Unlike /icon this writes the CHARACTER into the note body.
  const picker = page.getByRole('dialog');
  await expect(picker).toBeVisible();
  await page.keyboard.type('rocket');
  await picker.locator('button[aria-label="rocket"]').first().click();

  await expect(editor).toContainText('🚀', { timeout: 10000 });
});

test('Emoji: typing :name autocompletes to the emoji character', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/EmojiColon.md'] = "---\ntype: Note\n---\n\nColon body\n";
  });

  await page.goto('/');
  await expect(page.getByText('EmojiColon', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('EmojiColon', { exact: true }).click();
  await expect(page.getByText('Colon body')).toBeVisible();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':rocket');

  // The `:` source shows the emoji completion; picking it inserts the Unicode
  // character (never a literal ":rocket:" shortcode).
  await page
    .locator('.cm-tooltip-autocomplete li', { hasText: /rocket/i })
    .first()
    .click();

  await expect(editor).toContainText('🚀', { timeout: 10000 });
  await expect(editor).not.toContainText(':rocket');
});

test('Code block: language grammar lazy-loads on demand', async ({ page }) => {
  // Runs after the beforeEach init script, so mockFs already exists.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Snippets.md'] = "# Snippets\n\n```python\ndef greet():\n    return 42\n```\n";
  });

  await page.goto('/');
  await expect(page.getByText('Snippets', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Snippets', { exact: true }).click();

  // Code block content renders in the editor…
  await expect(page.locator('.cm-line', { hasText: 'def greet' }).first()).toBeVisible();
  // …and the python grammar (loaded on demand via @codemirror/language-data)
  // kicked in: once it arrives, keywords get their own highlight spans.
  // 60s (raised from 15, then 30): the python grammar is a cold dynamic import;
  // under load (the full pre-push runs the unit suite + vite + Playwright at
  // once) it can take much longer to arrive, and this assertion is about
  // correctness, not speed. Isolated runs finish in a few seconds.
  await expect(page.locator('.cm-content span').filter({ hasText: /^def$/ }).first()).toBeVisible({ timeout: 60000 });
});

test('Code block: the read view highlights fenced code too (issue #13)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/ReadHighlight.md'] =
      "# Styles\n\n```css\na { color: red; }\n```\n\n```js\nconst answer = 42;\n```\n";
  });

  await page.goto('/');
  await expect(page.getByText('ReadHighlight', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('ReadHighlight', { exact: true }).click();

  // The code renders in the editor first…
  await expect(page.locator('.cm-line', { hasText: 'color: red' }).first()).toBeVisible();

  // …switch to the read view (BookOpen toggle)…
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();
  const reader = page.locator('.markdown-reader').first();
  await expect(reader).toBeVisible();
  // The code block renders (raw text is present)…
  await expect(reader.locator('pre code', { hasText: 'color: red' }).first()).toBeVisible();

  // …and it is syntax-highlighted, just like the editor: the grammar loads on
  // demand from the SAME @codemirror/language-data table and wraps tokens in
  // highlight spans. 30s: a cold dynamic import under full-suite load.
  await expect(reader.locator('pre code span').first()).toBeVisible({ timeout: 30000 });

  // The tokens are actually COLORED (the highlight stylesheet was injected),
  // not merely wrapped: at least one token differs from the base text color.
  const isColored = await reader.locator('pre code span').evaluateAll((spans) =>
    spans.some((span) => {
      const code = span.closest('code');
      return !!code && getComputedStyle(span).color !== getComputedStyle(code).color;
    }),
  );
  expect(isColored).toBe(true);
});

// --- File tree: folder selection targets "+ Neu", new notes start with an H1 (UI-UX P6/P7) ---
test('File tree: selected folder receives the + Neu note, which starts with an H1', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Ordner'] = { isDir: true };
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await aside.getByText('Ordner', { exact: true }).click(); // select (and expand) the folder
  await page.getByTestId('sidebar-new').click();
  await page.getByRole('menuitem', { name: /Neue Notiz|New note/i }).click();
  const input = page.getByPlaceholder(/Dateiname|File name/i);
  await expect(input).toBeVisible();
  await input.fill('Idee');
  await input.press('Enter');

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Ordner/Idee.md']), { timeout: 8000 })
    .toContain('# Idee');
});

// The rail carries the whole creation family now, not just notes — and it
// obeys the same target rule as the "+" menu: whatever the tree has selected.
test('Action rail: New Folder and New Base create inside the selected folder', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Ordner'] = { isDir: true };
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // A folder lands in the selected folder, not at the vault root.
  await aside.getByText('Ordner', { exact: true }).click();
  await page.getByTestId('ribbon-new-folder').click();
  const folderInput = page.getByPlaceholder(/Ordnername|Folder name/i);
  await expect(folderInput).toBeVisible();
  await folderInput.fill('Unter');
  await folderInput.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Ordner/Unter']), { timeout: 8000 })
    .toBeTruthy();

  // And the rail really asks for a DATABASE — the inline row names it as one
  // before handing over to the source wizard (covered in base.spec).
  await aside.getByText('Ordner', { exact: true }).click();
  await page.getByTestId('ribbon-new-base').click();
  await expect(page.getByPlaceholder(/Base-Name|Base name/i)).toBeVisible();
});

// --- File tree: multi-select + bulk delete (UI-UX P9) ---
test('File tree: Ctrl-selection deletes both notes after a single confirm', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/Beta.md': '# Beta\n',
      '/test-vault/Gamma.md': '# Gamma\n',
      // Enough unrelated files that deleting two stays under the 20% threshold
      // of the large-deletion double prompt (E2 2026-07-09) — the P9
      // single-confirm flow must keep working for ordinary deletions.
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/test-vault/Fill-${i}.md`, `# F${i}\n`])),
    });
  });
  await page.goto('/');
  const aside = page.getByTestId('file-tree');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await aside.getByText('Beta', { exact: true }).click();
  await aside.getByText('Gamma', { exact: true }).click({ modifiers: ['Control'] });
  await aside.getByText('Gamma', { exact: true }).click({ button: 'right' });
  await expect(page.getByText(/2 ausgewählt|2 selected/)).toBeVisible();
  await page.getByRole('menuitem', { name: /^(Löschen|Delete)$/ }).click();
  // ONE in-app confirm for the whole selection (plan Designsprache P3: the
  // native ask() dialog became a themed appConfirm modal).
  await page.locator('.pv-modal-footer button.pv-btn--danger').click();

  await expect
    .poll(async () => await page.evaluate(() => Object.keys((window as any).mockFs).filter((k) => /\/(Beta|Gamma)\.md$/.test(k)).length), { timeout: 8000 })
    .toBe(0);
  await expect(aside.getByText('Beta', { exact: true })).not.toBeVisible();
});

// --- File tree: the Delete key removes the current selection (Issue #13) ---
test('File tree: the Delete key deletes the multi-selection after one confirm', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/Beta.md': '# Beta\n',
      '/test-vault/Gamma.md': '# Gamma\n',
      // Keep the two deletions under the 20% large-deletion threshold (E2).
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/test-vault/Fill-${i}.md`, `# F${i}\n`])),
    });
  });
  await page.goto('/');
  const aside = page.getByTestId('file-tree');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Build a two-note selection with Ctrl+click (opens no note, so nothing steals
  // keyboard focus from the tree), then delete it with the keyboard — no menu.
  await aside.getByText('Beta', { exact: true }).click({ modifiers: ['Control'] });
  await aside.getByText('Gamma', { exact: true }).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  // ONE in-app confirm for the whole selection, exactly like the menu path.
  await page.locator('.pv-modal-footer button.pv-btn--danger').click();

  await expect
    .poll(async () => await page.evaluate(() => Object.keys((window as any).mockFs).filter((k) => /\/(Beta|Gamma)\.md$/.test(k)).length), { timeout: 8000 })
    .toBe(0);
  await expect(aside.getByText('Beta', { exact: true })).not.toBeVisible();
});

// --- File tree: a large share of the vault asks a second, sharper time (E2 2026-07-09) ---
test('File tree: deleting a large share of the vault shows the second prompt', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/Beta.md': '# Beta\n',
      '/test-vault/Gamma.md': '# Gamma\n',
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await aside.getByText('Beta', { exact: true }).click();
  await aside.getByText('Gamma', { exact: true }).click({ modifiers: ['Control'] });
  await aside.getByText('Gamma', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(Löschen|Delete)$/ }).click();
  await page.locator('.pv-modal-footer button.pv-btn--danger').click();

  // 2 of 3 vault files (>20%) -> the second, sharper prompt names the share.
  await expect(page.getByText(/2 von 3|2 of 3/)).toBeVisible();
  await page.locator('.pv-modal-footer button.pv-btn--danger').click();

  await expect
    .poll(async () => await page.evaluate(() => Object.keys((window as any).mockFs).filter((k) => /\/(Beta|Gamma)\.md$/.test(k)).length), { timeout: 8000 })
    .toBe(0);
});

// --- File tree: one toggle collapses/expands all folders (E3 2026-07-09) ---
test('File tree: the sidebar toggle collapses and expands all folders', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/Alpha-Ordner': { isDir: true },
      '/test-vault/Alpha-Ordner/eins.md': '# eins\n',
      '/test-vault/Beta-Ordner': { isDir: true },
      '/test-vault/Beta-Ordner/zwei.md': '# zwei\n',
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Nothing expanded yet -> the toggle expands every folder at once.
  await aside.getByRole('button', { name: /Alle Ordner ausklappen|Expand all folders/ }).click();
  await expect(aside.getByText('eins', { exact: true })).toBeVisible();
  await expect(aside.getByText('zwei', { exact: true })).toBeVisible();

  // Something is expanded -> the same button (flipped icon/label) collapses all.
  await aside.getByRole('button', { name: /Alle Ordner einklappen|Collapse all folders/ }).click();
  await expect(aside.getByText('eins', { exact: true })).not.toBeVisible();
  await expect(aside.getByText('zwei', { exact: true })).not.toBeVisible();
});

// --- Editor ⋮: "Reveal in file tree" expands + selects the note (2026-07-09) ---
test('Editor menu: reveal in file tree re-expands the folder and selects the note', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/Tief': { isDir: true },
      '/test-vault/Tief/Drin.md': '# Drin\n',
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  const tree = page.getByTestId('file-tree');
  await expect(tree.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Open the nested note, then collapse its folder again — the tree must NOT
  // auto-reveal open files (deliberate; only the explicit menu action does).
  await tree.getByText('Tief', { exact: true }).click();
  await tree.getByText('Drin', { exact: true }).click();
  await tree.getByText('Tief', { exact: true }).click();
  await expect(tree.getByText('Drin', { exact: true })).not.toBeVisible();

  // Switch to the tags tab: the tree unmounts. The reveal must switch back to
  // the files tab (App listener) AND apply on the remounted tree (parked
  // hand-off in lib/treeReveal). (Bookmarks is no longer a tab — it is a
  // collapsible section above the tree in the files tab.)
  await aside.getByRole('tab', { name: /Tags/ }).click();

  await page.getByTestId('editor-menu-btn').click();
  await page.getByTestId('editor-menu-reveal-tree').click();

  // Files tab is active again, the ancestors re-expanded, the row is in view.
  await expect(aside.getByRole('tab', { name: /Dateien|Files/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tree.getByText('Drin', { exact: true })).toBeVisible();
  await expect(tree.locator('[data-tree-path="Tief/Drin.md"]')).toBeVisible();
});

// --- Bookmarks list mirrors a file-tree row: name without extension + icon (2026-07-10) ---
test('Bookmarks: entries drop the .md extension and show an icon, like the file tree', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/MeineNotiz.md': '# MeineNotiz\n',
      '/test-vault/.plainva/bookmarks.json': JSON.stringify({ items: [{ type: 'file', path: 'MeineNotiz.md' }] }),
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Reference — a file-tree row: the display name without the .md extension and an icon.
  const treeRow = aside.locator('[data-tree-path="MeineNotiz.md"]');
  await expect(treeRow).toContainText('MeineNotiz');
  await expect(treeRow.locator('svg')).toBeVisible();

  // Bookmarks section (now a collapsible section above the tree, not a tab):
  // same shape (previously the raw "MeineNotiz.md" and no icon).
  const bmSection = aside.getByTestId('bookmarks-section');
  const bmRow = bmSection.getByRole('button', { name: 'MeineNotiz' });
  await expect(bmRow).toBeVisible();
  await expect(bmSection.getByText('MeineNotiz.md')).toHaveCount(0);
  await expect(bmRow.locator('svg')).toBeVisible();
});

// --- Right-click works in the pinned lists too, not just the tree (plan P4) ---
test('Bookmarks: right-click offers the file actions and drops the row from the list', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/MeineNotiz.md': '# MeineNotiz\n',
      '/test-vault/.plainva/bookmarks.json': JSON.stringify({ items: [{ type: 'file', path: 'MeineNotiz.md' }] }),
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  const bmSection = aside.getByTestId('bookmarks-section');
  const bmRow = bmSection.getByRole('button', { name: 'MeineNotiz' });
  await bmRow.click({ button: 'right' });

  // The same menu the tree shows — minus the entries that need a folder or a
  // multi-selection, plus the one the tree has no use for.
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Umbenennen|Rename/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Im Dateibaum anzeigen|Reveal in file tree/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Neue Notiz|New note/i })).toHaveCount(0);

  // "Remove from list" drops the bookmark; the note itself stays in the tree.
  await menu.getByRole('menuitem', { name: /Aus der Liste entfernen|Remove from list/i }).click();
  await expect(bmSection.getByRole('button', { name: 'MeineNotiz' })).toHaveCount(0);
  await expect(aside.locator('[data-tree-path="MeineNotiz.md"]')).toBeVisible();
});

test('Recently opened: a view row offers only open and forget, never rename or delete', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Open the vault map so it lands in "Recently opened" as a virtual row.
  await page.getByTestId('ribbon-graph').click();
  const recentRow = aside.getByTestId('recents-section').getByRole('button', { name: /^(Graph)$/ });
  await expect(recentRow).toBeVisible();

  await recentRow.click({ button: 'right' });
  const menu = page.getByRole('menu');
  // A view is not a file: renaming or deleting it would be nonsense.
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu.getByRole('menuitem', { name: /Umbenennen|Rename/i })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /L\u00f6schen|Delete/i })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Aus der Liste entfernen|Remove from list/i })).toBeVisible();
});

// --- Images open in the in-app viewer instead of the OS app (UI-UX P10) ---
test('File tree: clicking an image opens the in-app image viewer', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/foto.png'] = 'PNGDATA';
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await aside.getByText('foto.png', { exact: true }).click();
  await expect(page.getByTestId('image-viewer')).toBeVisible();
});

// --- index.md auto-update: managed listings refresh, none are created unasked (UI-UX P11) ---
test('index.md auto-update: creating a note refreshes the managed listing only', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/index.md': '---\nokf_version: "0.1"\n---\n\n# Vault\n\n<!-- plainva:index generated -->\n',
      '/test-vault/P': { isDir: true },
      '/test-vault/P/index.md': '# P\n\n* [Alt](Alt.md)\n\n<!-- plainva:index generated -->\n',
      '/test-vault/P/Alt.md': '# Alt\n',
      '/test-vault/Q': { isDir: true },
      '/test-vault/Q/Ding.md': '# Ding\n',
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Create in P: its managed index.md picks up the new entry (debounced).
  await aside.getByText('P', { exact: true }).click();
  await page.getByTestId('sidebar-new').click();
  await page.getByRole('menuitem', { name: /Neue Notiz|New note/i }).click();
  const input = page.getByPlaceholder(/Dateiname|File name/i);
  await input.fill('Frisch');
  await input.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/P/index.md']), { timeout: 8000 })
    .toContain('Frisch');

  // Create in Q: no index.md there — none may appear.
  await aside.getByText('Q', { exact: true }).click();
  await page.getByTestId('sidebar-new').click();
  await page.getByRole('menuitem', { name: /Neue Notiz|New note/i }).click();
  const input2 = page.getByPlaceholder(/Dateiname|File name/i);
  await input2.fill('Anders');
  await input2.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Q/Anders.md']), { timeout: 8000 })
    .toBeTruthy();
  await page.waitForTimeout(900); // debounce window — still no Q/index.md
  const qIndex = await page.evaluate(() => (window as any).mockFs['/test-vault/Q/index.md']);
  expect(qIndex).toBeUndefined();
});

// --- index.md read view: in-app links + hidden marker (Nachbesserung 2026-07-04) ---
test('index.md read view: listing links open in-app and the managed marker stays hidden', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign((window as any).mockFs, {
      '/test-vault/P': { isDir: true },
      '/test-vault/P/index.md': '# P\n\n* [Alt](Alt.md)\n\n<!-- plainva:index generated -->\n',
      '/test-vault/P/Alt.md': '# Alt\n',
    });
  });
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await aside.getByText('P', { exact: true }).click(); // expand the folder
  await aside.getByText('index', { exact: true }).click();

  // Managed listing: link cards render, the marker comment never shows as text.
  await expect(page.locator('.markdown-reader').getByRole('link', { name: 'Alt' })).toBeVisible();
  await expect(page.getByText('plainva:index generated')).toHaveCount(0);

  // Clicking a listing link opens the note in-app instead of reloading the vault.
  await page.locator('.markdown-reader').getByRole('link', { name: 'Alt' }).click();
  await expect(page.getByRole('tab', { name: 'Alt' })).toBeVisible();
});

/* ---------------------------------------------------------------- Gesamtplan 2026-07-04: Splash-Standard, Vault entfernen, Vault-Templates, Settings-UX */

test('Splash: shows by default despite lastVaultPath (auto-open is opt-in)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText(/Willkommen bei Plainva|Welcome to Plainva/)).toBeVisible({ timeout: 10000 });
  // The opt-in checkbox is offered right on the splash and starts unchecked.
  const checkbox = page.locator('input[type="checkbox"]');
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  // The frameless window must stay movable/closable without the title bar:
  // the splash carries a drag-region strip with the window controls.
  const strip = page.getByTestId('window-chrome-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-tauri-drag-region', /./);
  await expect(strip.getByTestId('window-close')).toBeVisible();
});

/* ---------------------------------------------------------------- Gesamtplan 2026-07-05: Kalender (Heute, Monat/Jahr-Schnellauswahl, Kalenderwochen) */

test('Calendar: today button, month/year quick-select and week numbers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  const label = page.getByTestId('calendar-month-label');
  await expect(label).toBeVisible();
  const initial = (await label.textContent())!.trim();

  // Quick-select: jump to January of the previous year via the popover.
  await label.click();
  const picker = page.getByTestId('calendar-month-picker');
  await expect(picker).toBeVisible();
  await page.getByTestId('calendar-picker-prev-year').click();
  await page.getByTestId('calendar-pick-month-0').click();
  await expect(picker).not.toBeVisible();
  expect(((await label.textContent()) || '').trim()).not.toBe(initial);

  // The dedicated today button returns to the current month.
  await page.getByTestId('calendar-today').click();
  await expect(label).toHaveText(initial);

  // Week numbers: opt-in via the picker checkbox, one per grid row,
  // persisted (localStorage) across reload.
  await label.click();
  await page.getByTestId('calendar-show-weeks').check();
  await expect(page.getByTestId('calendar-week-number')).toHaveCount(6);
  await page.reload();
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('calendar-week-number')).toHaveCount(6);
});

test('Calendar: the open daily note is highlighted with precedence over today', async ({ page }) => {
  await page.addInitScript(() => {
    // A daily note for a fixed past date (default format YYYY-MM-DD at the vault
    // root — the mock store has no custom daily-notes folder/format).
    (window as any).mockFs['/test-vault/2020-03-15.md'] = "# 2020-03-15\n\nDiary\n";
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Opening the note (like any file) makes the calendar auto-jump to its month
  // and mark the day with aria-current="date" — precedence over the real today.
  await page.getByText('2020-03-15', { exact: true }).click();

  const activeDay = page.locator('button[aria-current="date"]');
  await expect(activeDay).toHaveText('15', { timeout: 10000 });
  await expect(page.getByTestId('calendar-month-label')).toContainText('2020');
});

test('Sidebar calendar: a day click opens the calendar tab; right-click offers a menu with a date header + daily action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // No daily note yet; a click no longer creates one.
  await expect(page.evaluate((key) => (window as any).mockFs['/test-vault/' + key + '.md'] ?? null, todayKey)).resolves.toBeNull();

  // Right-click opens the context menu; its header shows which day we're over
  // (the day number is language-independent), plus the open-calendar action.
  // (Right-click first: a plain click opens the calendar tab, whose view type
  // collapses the right sidebar and hides this widget.)
  await page.getByTestId(`sidecal-day-${todayKey}`).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(String(now.getDate()));
  await expect(menu.getByRole('menuitem', { name: /Kalender öffnen|Open calendar/i })).toBeVisible();

  // The daily action creates (opens) the daily note straight away — no
  // confirmation, the same as every other entry point since plan § 7.2.
  await menu.getByRole('menuitem', { name: /Tageseintrag|Daily Note/i }).click();
  await expect
    .poll(() => page.evaluate((key) => (window as any).mockFs['/test-vault/' + key + '.md'] ?? null, todayKey))
    .toBeTruthy();

  // …and the day now carries the tiny sun marker instead of a plain dot.
  await expect(page.getByTestId(`sidecal-day-${todayKey}`).locator('svg.lucide-sun')).toBeVisible();

  // Finally, a plain CLICK opens the calendar tab at that day.
  await page.getByTestId(`sidecal-day-${todayKey}`).click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();
});

/* ---------------------------------------------------------------- Gesamtplan 2026-07-05: Tabellen-Widget rendert Inline-Markdown in Zellen */

test('Table widget: cells render inline formatting and clickable links', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Tabelle.md'] =
      '# Tabelle\n\n| Spalte A | Spalte B |\n| --- | --- |\n| **fett** und *kursiv* | [[Welcome]] mit https://example.org<br>Zeile 2 |\n';
    // The wiki-link resolver queries files by title/path — answer for the fixture.
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:sql|select' && String(args?.query || '').includes('WHERE title = ?')) {
        return String(args?.values?.[0] ?? '') === 'Welcome' ? [{ path: 'Welcome.md' }] : [];
      }
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Tabelle', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Tabelle', { exact: true }).click();

  const table = page.locator('.cm-md-table');
  await expect(table).toBeVisible();
  await expect(table.locator('td strong', { hasText: 'fett' })).toBeVisible();
  await expect(table.locator('td em', { hasText: 'kursiv' })).toBeVisible();
  await expect(table.locator('td br')).toHaveCount(1);
  // External URLs render as links (not clicked here — that would leave the app).
  await expect(table.locator('.cm-md-cell-link', { hasText: 'example.org' })).toBeVisible();

  // A wiki link inside a cell opens the note instead of the cell editor.
  await table.locator('.cm-md-cell-link', { hasText: 'Welcome' }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();
});

test('Splash: removing a recent vault only forgets it — files stay on disk', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('test-vault', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Aus Liste entfernen|Remove from list/ }).click();
  // The remove dialog (E1 2026-07-09) offers list-only removal vs. forgetting
  // app data; the list-only choice is the old non-destructive behavior.
  await page.getByTestId('splash-remove-list-only').click();
  await expect(page.getByText('test-vault', { exact: true })).toHaveCount(0);
  // Non-destructive: the vault files are untouched.
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Welcome.md'] !== undefined)).toBe(true);
});

test('Splash: "forget app data" purges the vault\'s per-vault settings keys', async ({ page }) => {
  await page.addInitScript(() => {
    const deleted: string[] = [];
    (window as any).__storeDeleted = deleted;
    const suffix = '_' + btoa(unescape(encodeURIComponent('/test-vault')));
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      if (cmd === 'plugin:store|keys') return ['appLanguage', 'syncIntervalSeconds' + suffix, 'templateFolder' + suffix];
      if (cmd === 'plugin:store|delete') { deleted.push(args?.key); return true; }
      if (cmd === 'plugin:path|resolve_directory') return '/appdata';
      if (cmd === 'keychain_delete') return null;
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('test-vault', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Aus Liste entfernen|Remove from list/ }).click();
  await page.getByTestId('splash-remove-forget').click();

  await expect(page.getByText('test-vault', { exact: true })).toHaveCount(0);
  // Both per-vault keys were purged via the shared suffix scan; globals stayed.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).__storeDeleted))
    .toEqual(expect.arrayContaining([expect.stringContaining('syncIntervalSeconds_'), expect.stringContaining('templateFolder_')]));
  expect(await page.evaluate(() => (window as any).__storeDeleted.includes('appLanguage'))).toBe(false);
  // The vault files themselves are untouched.
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Welcome.md'] !== undefined)).toBe(true);
});

test('Create vault: the PARA template scaffolds OKF structure with managed index.md files', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      if (cmd === 'plugin:dialog|open') return '/new-vault';
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  // Two-button model (2026-07-13): action first, then the place question.
  await page.getByRole('button', { name: /^(Neuer Vault|New Vault)$/ }).click();
  await expect(page.getByText(/Wo soll Dein Vault liegen|Where should your vault live/)).toBeVisible();
  await page.getByRole('button', { name: /Auf diesem Computer|On this computer/ }).click();
  // The chooser offers the empty vault plus the template cards.
  await expect(page.getByText(/Leerer Vault|Empty vault/)).toBeVisible();
  await page.getByRole('button', { name: /PARA/ }).click();

  // Scaffolded on disk: root index.md is the OKF bundle root with the managed marker.
  await page.waitForFunction(() => !!(window as any).mockFs['/new-vault/index.md'], undefined, { timeout: 10000 });
  const rootIndex = await page.evaluate(() => (window as any).mockFs['/new-vault/index.md']);
  expect(rootIndex).toContain('okf_version: "0.1"');
  expect(rootIndex).toContain('<!-- plainva:index generated -->');

  const files: string[] = await page.evaluate(() => Object.keys((window as any).mockFs).filter((p: string) => p.startsWith('/new-vault/')));
  // Six PARA folders (Projekte/Aufgaben/Bereiche/Ressourcen/Archiv + the
  // Vorlagen folder that ships with the databases), each with its own managed
  // (frontmatter-free) index.md.
  const folderIndexes = files.filter((p) => /^\/new-vault\/[^/]+\/index\.md$/.test(p));
  expect(folderIndexes.length).toBe(6);
  // PARA ships three databases (Projekte/Aufgaben/Bereiche), scaffolded at the
  // vault root as Obsidian-native .base files (language-agnostic — the names
  // follow the app language).
  const rootBases = files.filter((p) => /^\/new-vault\/[^/]+\.base$/.test(p));
  expect(rootBases.length).toBe(3);
  const subIndex = await page.evaluate((p) => (window as any).mockFs[p], folderIndexes[0]);
  expect(String(subIndex).startsWith('---')).toBe(false);
  expect(String(subIndex)).toContain('<!-- plainva:index generated -->');
  // The welcome note carries the OKF write-path frontmatter.
  const welcomePath = files.find((p) => /(Willkommen|Welcome)\.md$/.test(p))!;
  const welcome = await page.evaluate((p) => (window as any).mockFs[p], welcomePath);
  expect(welcome).toContain('type:');
  expect(welcome).toContain('okf_version:');

  // The new vault actually opened (no splash anymore).
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15000 });
});

test('Settings: X and overlay close the modal; plain settings persist without a Save button', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    const saved: Record<string, any> = {};
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|set' && args && typeof args.key === 'string') { saved[args.key] = args.value; return null; }
      if (cmd === 'plugin:store|get' && args && args.key in saved) return [saved[args.key], true];
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toBeVisible();

  // Hybrid model: the features block auto-saves — no Save button anywhere
  // (the sync-provider forms would have one, but no provider is configured).
  await expect(page.getByRole('button', { name: /^(Speichern|Save)$/ })).toHaveCount(0);

  // The daily-notes folder lives on the Content & structure page (pages redesign).
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /^(Inhalt & Struktur|Content & structure)$/ }).click();
  const folderInput = page.getByPlaceholder('Tagebuch/');
  await folderInput.fill('Journal');

  // Close via the top-right X — reopening shows the persisted value. (Scoped
  // to the dialog: the window titlebar has its own Close button.)
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /Schließen|Close/ }).click();
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toHaveCount(0);
  await page.keyboard.press('Control+,');
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /^(Inhalt & Struktur|Content & structure)$/ }).click();
  await expect(page.getByPlaceholder('Tagebuch/')).toHaveValue('Journal');

  // Clicking the overlay closes it as well.
  await page.mouse.click(5, 5);
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toHaveCount(0);
});

test('Online vault: chooser lists all providers; picking one opens the in-splash setup (connect first)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  // Two-button model (2026-07-13): "Open Vault" first, then the place question.
  await page.getByRole('button', { name: /^(Vault öffnen|Open Vault)$/ }).click();
  await expect(page.getByText(/Wo liegt Dein Vault|Where is your vault/)).toBeVisible();
  await page.getByRole('button', { name: /Online-Vault|Online vault/ }).click();

  // All five providers are offered; WebDAV now runs through the SAME unified
  // in-splash setup as the other four (E5) — no separate form/picker path.
  await expect(page.getByRole('button', { name: /OneDrive/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /S3/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Google Drive/ })).toBeVisible();
  await page.getByRole('button', { name: /WebDAV/ }).click();
  await expect(page.getByRole('heading', { name: /WebDAV \/ Nextcloud/ })).toBeVisible();
  await expect(page.getByPlaceholder('https://nextcloud.example.com/remote.php/webdav')).toBeVisible();
  await page.getByRole('button', { name: /Zurück|Back/ }).click();

  // The BYO handbook links sit under the provider grid; Google Drive stays BYO.
  await expect(page.getByRole('link', { name: 'Google Drive', exact: true })).toBeVisible();

  // Picking Dropbox opens the in-splash setup (CONNECT first), NOT a
  // deep-link into Settings and NOT a local-folder dialog up front.
  await page.getByRole('button', { name: /Dropbox/ }).click();
  await expect(page.getByRole('heading', { name: /Dropbox verbinden|Connect Dropbox/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Verbinden|Connect)$/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Einstellungen|Settings/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Zurück|Back/ }).click();

  // S3: the credentials form appears right away (endpoint field), before any
  // local folder dialog — the whole point of the unified flow.
  await page.getByRole('button', { name: /S3/ }).click();
  await expect(page.getByPlaceholder('https://s3.eu-central-1.amazonaws.com')).toBeVisible();
});

test('Create vault online: place -> template -> connect; the template scaffolds into the local folder', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      if (cmd === 'plugin:dialog|open') return '/new-online-vault';
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');

  // Place -> template (the agreed order: Ort -> Vorlage -> Verbindung).
  await page.getByRole('button', { name: /^(Neuer Vault|New Vault)$/ }).click();
  await page.getByRole('button', { name: /Bei einem Online-Dienst|With an online service/ }).click();
  await expect(page.getByText(/Leerer Vault|Empty vault/)).toBeVisible();
  await page.getByRole('button', { name: /PARA/ }).click();

  // The provider chooser carries the create-mode title.
  await expect(page.getByRole('heading', { name: /Neuer Vault bei einem Online-Dienst|New vault with an online service/ })).toBeVisible();

  // S3 keeps everything local until the picker (no OAuth loopback needed).
  await page.getByRole('button', { name: /S3/ }).click();
  const fields = page.locator('input.pv-field');
  await fields.nth(0).fill('https://s3.example.com');
  await fields.nth(1).fill('vaults');
  await fields.nth(2).fill('auto');
  await fields.nth(3).fill('AK');
  await fields.nth(4).fill('SK');
  await page.getByRole('button', { name: /^(Weiter|Continue)$/ }).click();

  // The cloud folder picker opens against the (unmocked) network — dismiss it
  // via Escape (a no-op if it already closed itself on the listing error); the
  // createFolder row itself is unit-tested. The connected screen shows the
  // chosen starter structure before the local folder is picked.
  await expect(page.getByText(/Connected to|verbunden/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/\(PARA\)/)).toBeVisible();

  // Local folder -> scaffold runs BEFORE the vault opens.
  await page.getByRole('button', { name: /Lokalen Ordner wählen und öffnen|local folder/i }).click();
  await page.waitForFunction(() => !!(window as any).mockFs['/new-online-vault/index.md'], undefined, { timeout: 10000 });
  const files: string[] = await page.evaluate(() => Object.keys((window as any).mockFs).filter((p: string) => p.startsWith('/new-online-vault/')));
  expect(files.some((p) => /^\/new-online-vault\/[^/]+\/index\.md$/.test(p))).toBe(true);
  expect(files.some((p) => /\.base$/.test(p))).toBe(true);

  // The new vault actually opened (no splash anymore).
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15000 });
});

test('Sync error dialog: preserves a transient failure while a retry succeeds', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.evaluate(async () => {
    const { syncStatusStore } = await import('/src/services/syncStatusStore.ts');
    syncStatusStore.set({
      status: 'error',
      message: 'Google Drive folder lookup failed (HTTP 503): backend unavailable',
      provider: 'drive',
    });
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-show-sync-error')));
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toBeVisible();
  await expect(page.getByText('Google Drive folder lookup failed (HTTP 503): backend unavailable')).toBeVisible();
  await expect(page.getByText(/vorübergehendes Netzwerk- oder Providerproblem|temporary network or provider problem/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Jetzt erneut versuchen|Try again now/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sync-Einstellungen öffnen|Open sync settings/ })).toHaveCount(0);

  // A successful automatic retry changes the live state but never erases the
  // failure that the user opened the dialog to inspect.
  await page.evaluate(async () => {
    const { syncStatusStore } = await import('/src/services/syncStatusStore.ts');
    syncStatusStore.set({ status: 'idle', message: null });
  });
  await expect(page.getByText('Google Drive folder lookup failed (HTTP 503): backend unavailable')).toBeVisible();
  await expect(page.getByText(/beim erneuten Versuch erfolgreich|succeeded on the next attempt/)).toBeVisible();
});

test('Sync auth error dialog: deep-links into the provider settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.evaluate(async () => {
    const { syncStatusStore } = await import('/src/services/syncStatusStore.ts');
    syncStatusStore.set({ status: 'error', message: 'Google Drive HTTP 401: token expired', provider: 'drive' });
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-show-sync-error')));
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toBeVisible();
  await expect(page.getByText(/Anmeldung ist abgelaufen|sign-in expired/)).toBeVisible();

  // The primary action opens Settings (provider form preselected when one is
  // active) so the user can reconnect right away; the error dialog closes.
  await page.getByRole('button', { name: /Sync-Einstellungen öffnen|Open sync settings/ }).click();
  await expect(page.getByRole('dialog', { name: /Einstellungen|Settings/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toHaveCount(0);
});

test('Sync error dialog: lists .CONFLICT copies and opens the merge UI (Nachfass P3.11)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // A conflict copy exists next to its original (the sync engine writes these).
  await page.evaluate(() => {
    (window as any).mockFs['/test-vault/Welcome.CONFLICT-2026-01-01T00-00-00Z.md'] = '# Hello\nLocal conflicting version!';
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-show-sync-error')));
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toBeVisible();

  // The dialog lists the conflict copy; clicking it opens the merge UI.
  await expect(page.getByText(/Gefundene Konfliktkopien|Conflict copies found/)).toBeVisible();
  await page.getByRole('button', { name: /Welcome\.CONFLICT-2026-01-01T00-00-00Z\.md/ }).click();
  await expect(page.getByRole('heading', { name: /Sync-Konflikt lösen|Resolve sync conflict/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toHaveCount(0);
});

test('Command palette: Ctrl+P opens it, a command runs (right sidebar toggles)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('aside[aria-label="Right Sidebar"]')).toBeVisible();

  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();

  // Type-to-filter, click the hit — the command hides the right sidebar.
  await palette.getByRole('textbox').fill('right');
  await palette.getByRole('button', { name: /right sidebar|Rechte Seitenleiste/i }).click();
  await expect(page.locator('aside[aria-label="Right Sidebar"]')).toHaveCount(0);
  await expect(palette).toHaveCount(0);

  // The shortcut variant brings it back (P6/L1: Mod+Alt+R).
  await page.keyboard.press('Control+Alt+r');
  await expect(page.locator('aside[aria-label="Right Sidebar"]')).toBeVisible();
});

test('Sidebar toggle shortcut hides and restores the left sidebar', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+Alt+b');
  await expect(aside).toHaveCount(0);
  await page.keyboard.press('Control+Alt+b');
  await expect(aside).toBeVisible();
});

test('Density setting switches compact mode on the html element', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();

  // The density select lives in the Appearance area of the APP world
  // (settings redesign 2026-07-11); the modal opens on the active vault by default.
  await dialog.getByRole('button', { name: /^(Erscheinungsbild|Appearance)$/ }).click();
  await dialog.getByLabel(/Dichte|Density/).click();
  await page.getByRole('option', { name: /Kompakt|Compact/ }).click();
  await expect
    .poll(async () => await page.evaluate(() => document.documentElement.getAttribute('data-density')))
    .toBe('compact');

  await dialog.getByLabel(/Dichte|Density/).click();
  await page.getByRole('option', { name: /Komfortabel|Comfortable/ }).click();
  await expect
    .poll(async () => await page.evaluate(() => document.documentElement.getAttribute('data-density')))
    .toBeNull();
});

test('Default view mode: files open in the configured mode, manual switches stick per file', async ({ page }) => {
  // A second note so the test never depends on whether Welcome.md is already open.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Zweite.md'] = '# Zweite\nInhalt der zweiten Notiz.';
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // Settings → General → default view = read mode.
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Editor & Notizen|Editor & notes)$/ }).click();
  await dialog.getByLabel(/Standard-Ansicht|Default view/).click();
  await page.getByRole('option', { name: /Lesemodus|Read Mode/ }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Opening a note now starts in the read view.
  await page.getByTestId('file-tree').getByText('Zweite', { exact: true }).click();
  await expect(page.locator('.markdown-reader').first()).toBeVisible();

  // Manual switch to live for THIS file…
  await page.locator('[data-tip="Live-Vorschau"], [data-tip="Live Preview"]').first().click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await expect(page.locator('.markdown-reader')).toHaveCount(0);

  // …other files still open in the default (read)…
  await page.getByTestId('file-tree').getByText('Welcome', { exact: true }).click();
  await expect(page.locator('.markdown-reader').first()).toBeVisible();

  // …and returning to the switched file keeps its session choice (live).
  await page.getByTestId('file-tree').getByText('Zweite', { exact: true }).click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await expect(page.locator('.markdown-reader')).toHaveCount(0);
});

test('Settings two-worlds nav: vault card switch opens the picker; cross-world clicks change the page', async ({ page }) => {
  // A second (not-open) vault so the picker has something to switch to.
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'recentVaults') return [['/test-vault', '/zweiter-vault'], true];
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();

  // Opens on the ACTIVE vault's first area — Cloud accounts (the service
  // areas are gated behind connected accounts): its title is the page heading.
  await expect(dialog.getByRole('heading', { name: /^(Cloud-Konten|Cloud accounts)$/ })).toBeVisible();

  // Cross-world: clicking an APP area renders exactly that page.
  await dialog.getByRole('button', { name: /^(Erscheinungsbild|Appearance)$/ }).click();
  await expect(dialog.getByRole('heading', { name: /^(Erscheinungsbild|Appearance)$/ })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^(Cloud-Konten|Cloud accounts)$/ })).toHaveCount(0);

  // …and a VAULT area click returns to the vault world (maintenance holds the reindex row).
  await dialog.getByRole('button', { name: /^(Wartung|Maintenance)$/ }).click();
  await expect(dialog.getByRole('button', { name: /neu aufbauen|Rebuild the index/ })).toBeVisible();

  // The identity card is no dropdown: its "switch" link opens the vault
  // picker; picking the not-open vault swaps the VAULT pages to it and the
  // maintenance page shows the "not open" hint instead of the reindex row.
  await expect(dialog.getByTestId('settings-vault-name')).toHaveText('test-vault');
  await dialog.getByRole('button', { name: /^(Wechseln|Switch)$/ }).click();
  const picker = page.getByRole('dialog', { name: /Vault wählen|Choose vault/ });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /zweiter-vault/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(dialog.getByTestId('settings-vault-name')).toHaveText('zweiter-vault');
  await expect(dialog.getByText(/Dieser Vault ist nicht geöffnet|This vault is not open/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /neu aufbauen|Rebuild the index/ })).toHaveCount(0);
});

test('Creating from another tab switches to Files instead of vanishing', async ({ page }) => {
  // The create request is answered by the FILE TREE, which is not mounted on
  // the Tags or Databases tab. Sent from there the event used to disappear
  // without a trace (plan § 7.1).
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.getByRole('tab', { name: /^(Tags)$/ }).click();
  await expect(page.getByTestId('file-tree')).toHaveCount(0);

  await page.getByTestId('sidebar-new').click();
  await page.getByRole('menuitem', { name: /Neue Notiz|New note/i }).click();

  // The tab switched back and the name field is there, ready.
  await expect(page.getByTestId('file-tree')).toBeVisible();
  const input = page.getByPlaceholder(/Dateiname|File name/i);
  await expect(input).toBeVisible();
  await input.fill('Aus Tags');
  await input.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Aus Tags.md']), { timeout: 8000 })
    .toContain('# Aus Tags');
});

test('The search placeholder says what is being searched', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  const field = page.locator('aside[aria-label="Left Sidebar"] input[type="search"], aside[aria-label="Left Sidebar"] input').first();

  await expect(field).toHaveAttribute('placeholder', /Notizen durchsuchen|Search notes/i);
  await page.getByRole('tab', { name: /^(Tags)$/ }).click();
  await expect(field).toHaveAttribute('placeholder', /Tags filtern|Filter tags/i);
  await page.getByRole('tab', { name: /^(Datenbanken|Databases)$/ }).click();
  await expect(field).toHaveAttribute('placeholder', /Datenbanken filtern|Filter databases/i);
});

test('Bars & areas: hiding a right-sidebar section from its own header removes it', async ({ page }) => {
  // The point of the bars plan: arrange a bar where it lives, and see the
  // change immediately — not only in a settings page far away from it.
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  const calendar = page.getByRole('button', { name: /^(Kalender|Calendar)$/ });
  await expect(calendar).toBeVisible();
  await calendar.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^(Kalender|Calendar)$/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^(Ausblenden|Hide)$/ }).click();
  await expect(calendar).toHaveCount(0);

  // …and the settings page lists it under "hidden", where it can come back.
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dialog.getByRole('button', { name: /^(Leisten & Bereiche|Bars & areas)$/ }).click();
  await expect(dialog.getByRole('heading', { name: /^(Leisten & Bereiche|Bars & areas)$/ })).toBeVisible();
  // All four bars are arranged in one place.
  await expect(dialog.getByText(/^(Aktionsleiste|Action rail)$/)).toBeVisible();
  await expect(dialog.getByText(/^(Rechte Seitenleiste|Right sidebar)$/)).toBeVisible();
});

// --- Dragging near an edge scrolls the list along (plan \u00a7 9.3) --------------
// Pointer capture is what keeps a drag alive outside the row \u2014 and what stops
// the surface underneath from scrolling. Without this the four bar blocks
// cannot be crossed in one gesture.
test('Bars & areas: dragging to the bottom edge scrolls the settings page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dialog.getByRole('button', { name: /^(Leisten & Bereiche|Bars & areas)$/ }).click();
  await expect(dialog.getByRole('heading', { name: /^(Leisten & Bereiche|Bars & areas)$/ })).toBeVisible();

  // The page carries the overflow now (see .pv-setpages in ui.css).
  const scroller = dialog.locator('.pv-setpage[data-active="true"]');
  const before = await scroller.evaluate((el) => el.scrollTop);

  // Grab the first drag handle and hold the pointer at the page's bottom edge.
  const handle = dialog.getByRole('button', { name: /Zum Verschieben|Press and hold to move/i }).first();
  const box = await handle.boundingBox();
  const view = page.viewportSize()!;
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, view.height - 12, { steps: 4 });
  // The loop runs per animation frame; a moment of holding still is the point.
  await page.waitForTimeout(500);
  const during = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.up();

  expect(during).toBeGreaterThan(before);
});

test('Cloud accounts derive the pre-existing sync slot; service areas gate on carried services', async ({ page }) => {
  // A vault that was connected to Nextcloud BEFORE the cloud-accounts area
  // existed: only the keychain slot is populated, no registry entry.
  await page.addInitScript(() => {
    const slot = 'webdav_credentials_' + btoa('/test-vault');
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'keychain_get' && args?.key === slot) {
        return JSON.stringify({ url: 'https://cloud.example.org/remote.php/dav/files/marco/', user: 'marco', pass: 'secret' });
      }
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();

  // Migration: the slot appears as ONE derived Nextcloud account carrying the
  // Files service — identity user@host, no re-auth, nothing else invented.
  const row = dialog.getByTestId('cloudacct-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('marco@cloud.example.org');
  await expect(row).toContainText(/Dateien|Files/);

  // Gating: Sync is visible (an account carries Files) and shows the slim
  // reference card; Calendar and Email stay hidden without their services.
  await dialog.getByRole('button', { name: /^(Synchronisation|Sync)$/ }).click();
  await expect(dialog.getByTestId('sync-manage-account')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^(Kalender|Calendar)$/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^(E-Mail|Email)$/ })).toHaveCount(0);

  // The account row opens the per-account detail (services + remove).
  await dialog.getByRole('button', { name: /^(Cloud-Konten|Cloud accounts)$/ }).click();
  await dialog.getByTestId('cloudacct-row').click();
  await expect(dialog.getByTestId('cloudacct-remove')).toBeVisible();
  await dialog.getByTestId('cloudacct-detail-back').click();
  await expect(dialog.getByTestId('cloudacct-add')).toBeVisible();
});

test('Provider catalog: tile search matches IMAP presets, dead-ends route to Microsoft', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Cloud-Konten|Cloud accounts)$/ }).click();
  await dialog.getByTestId('cloudacct-add').click();

  // 17 tiles, sorted by reach: Google first, the generic IMAP tile last.
  const tiles = dialog.locator('[data-testid^="cloudacct-provider-"]');
  await expect(tiles).toHaveCount(17);
  await expect(tiles.first()).toHaveAttribute('data-testid', 'cloudacct-provider-google');
  await expect(tiles.last()).toHaveAttribute('data-testid', 'cloudacct-provider-imap');

  // A preset search ("Orange" is an IMAP preset, not a tile) surfaces the
  // mail tile with the provider as subtitle; clicking preselects the preset.
  await dialog.getByTestId('cloudacct-tile-search').fill('Orange');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toHaveAttribute('data-testid', 'cloudacct-provider-imap');
  await expect(dialog.locator('.pv-provtile-hint')).toHaveText('Orange');
  await tiles.first().click();
  await dialog.getByTestId('cloudacct-to-signin').click();
  // Orange requires an app password — the catalog hint + official guide link show.
  await expect(dialog.getByText(/App-Passwort|app password/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Anleitung von Orange|Open the Orange guide/ })).toBeVisible();

  // Searching the dead Outlook IMAP preset routes to the MICROSOFT tile
  // (basic auth is gone) instead of finding nothing.
  await dialog.getByRole('button', { name: /^(Zurück|Back)$/ }).click();
  await dialog.getByRole('button', { name: /^(Zurück|Back)$/ }).click();
  await dialog.getByTestId('cloudacct-tile-search').fill('Outlook');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toHaveAttribute('data-testid', 'cloudacct-provider-microsoft');
  await expect(dialog.locator('.pv-provtile-hint')).toHaveText('Outlook / Microsoft 365');
});

test('Provider catalog: a suite tile connects every service through ONE credential form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Cloud-Konten|Cloud accounts)$/ }).click();
  await dialog.getByTestId('cloudacct-add').click();

  await dialog.getByTestId('cloudacct-tile-search').fill('Fastmail');
  await dialog.getByTestId('cloudacct-provider-fastmail').click();
  // Full three-service suite (files + calendar + mail) preselected.
  await expect(dialog.getByTestId('cloudacct-svc-files')).toBeChecked();
  await expect(dialog.getByTestId('cloudacct-svc-calendar')).toBeChecked();
  await expect(dialog.getByTestId('cloudacct-svc-mail')).toBeChecked();
  await dialog.getByTestId('cloudacct-to-signin').click();

  // ONE credential form; endpoints derive from the catalog per service.
  await expect(dialog.getByTestId('cloudacct-suite-email')).toBeVisible();
  await expect(dialog.getByTestId('cloudacct-suite-pass')).toBeVisible();
  await expect(dialog.getByText(/Endpunkt automatisch abgeleitet|Endpoint derived automatically/)).toHaveCount(3);
  await expect(dialog.getByText(/Fastmail verlangt ein App-Passwort|Fastmail requires an app password/)).toBeVisible();
  // Password mechanics: the connect button is the plain connect label, no OAuth.
  const connect = dialog.getByTestId('cloudacct-connect');
  await expect(connect).toHaveText(/^(Verbinden|Connect)$/);
  await expect(connect).toBeDisabled();
  await dialog.getByTestId('cloudacct-suite-email').fill('m@fastmail.com');
  await dialog.getByTestId('cloudacct-suite-pass').fill('app-pass');
  await expect(connect).toBeEnabled();

  // Apple: files is not offered at all and the tile explains why.
  await dialog.getByRole('button', { name: /^(Zurück|Back)$/ }).click();
  await dialog.getByRole('button', { name: /^(Zurück|Back)$/ }).click();
  await dialog.getByTestId('cloudacct-tile-search').fill('Apple');
  await dialog.getByTestId('cloudacct-provider-apple').click();
  await expect(dialog.getByTestId('cloudacct-svc-files')).toHaveCount(0);
  await expect(dialog.getByText(/iCloud Drive/)).toBeVisible();
});

test('Vault folder picker: browsing fills the daily-notes and template folder fields', async ({ page }) => {
  // Two real folders in the vault (the picker hides dot folders like .plainva).
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Tagebuch'] = { isDir: true };
    (window as any).mockFs['/test-vault/Vorlagen'] = { isDir: true };
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  // The folder fields live on the Content & structure page (pages redesign).
  await dialog.getByRole('button', { name: /^(Inhalt & Struktur|Content & structure)$/ }).click();

  // Daily-notes folder: browse → navigate into "Tagebuch" → use this folder.
  await page.getByTestId('browse-daily-folder').click();
  const picker = page.getByRole('dialog', { name: /Vault Ordner auswählen|Select Vault Folder/ });
  await expect(picker).toBeVisible();
  await expect(picker.getByText('.plainva')).toHaveCount(0);
  await picker.getByText('Tagebuch', { exact: true }).click();
  await picker.getByRole('button', { name: /Diesen Ordner verwenden|Use this folder/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByPlaceholder('Tagebuch/')).toHaveValue('Tagebuch');

  // Template folder: same picker, second field.
  await page.getByTestId('browse-template-folder').click();
  await picker.getByText('Vorlagen', { exact: true }).click();
  await picker.getByRole('button', { name: /Diesen Ordner verwenden|Use this folder/ }).click();
  await expect(page.getByPlaceholder('Templates/')).toHaveValue('Vorlagen');
});

test('Read view: a wiki link with an unbalanced paren in the target renders as a link', async ({ page }) => {
  // Maintainer find 2026-07-17: promoted checkbox lines like
  // [[Nataschas … (keine offenen|Alias]] rendered as literal "[Alias](wiki://…"
  // in read mode — the raw "(" swallowed the markdown link's closing paren.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/ParenLink.md'] =
      '# Links\n\n- [[Aufgaben (keine offenen|Sachen abholen (offen).]]\n- [[Ziel (a) b|Anzeige]]\n';
  });

  await page.goto('/');
  await expect(page.getByText('ParenLink', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('ParenLink', { exact: true }).click();
  await page.locator('[data-tip="Lesemodus"], [data-tip="Read Mode"]').first().click();

  const reader = page.locator('.markdown-reader').first();
  await expect(reader).toBeVisible();
  // Both aliases render as real links — no literal "(wiki://" leaks as text.
  await expect(reader.getByRole('link', { name: 'Sachen abholen (offen).' })).toBeVisible();
  await expect(reader.getByRole('link', { name: 'Anzeige' })).toBeVisible();
  await expect(reader.getByText(/wiki:\/\//)).toHaveCount(0);
});

test('Settings: creating a standard task database scaffolds folder + .base and selects it', async ({ page }) => {
  // PIM plan 1a: the vault designates one .base as its task database; the
  // create action scaffolds it in the vault-template shape.
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  // The task-database row lives on the Content & structure page (pages redesign).
  await dialog.getByRole('button', { name: /^(Inhalt & Struktur|Content & structure)$/ }).click();

  await page.getByTestId('create-task-db').click();
  const dlg = page.getByRole('dialog', { name: /Neue Datenbank anlegen|Create new database/ });
  await expect(dlg).toBeVisible();
  const input = dlg.getByRole('textbox');
  await expect(input).toHaveValue(/Aufgaben|Tasks/); // localized default name
  await input.fill('Aufgaben');
  await dlg.getByRole('button', { name: /Confirm|Bestätigen/ }).click();

  // The scaffold reached the mock fs: source folder + root-level .base in the
  // Obsidian-safe template shape (board persists as table + plainva.render).
  await expect
    .poll(async () => await page.evaluate(() => typeof (window as any).mockFs['/test-vault/Aufgaben.base'] === 'string'), { timeout: 8000 })
    .toBe(true);
  const state = await page.evaluate(() => ({
    folderIsDir: !!((window as any).mockFs['/test-vault/Aufgaben'] || {}).isDir,
    base: String((window as any).mockFs['/test-vault/Aufgaben.base'] ?? ''),
  }));
  expect(state.folderIsDir).toBe(true);
  expect(state.base).toContain('file.folder == "Aufgaben"');
  expect(state.base).toContain('note.status');
  expect(state.base).toContain('render: board');

  // The row now shows the fresh database as the selected value.
  await expect(dialog.getByLabel(/Standard-Aufgabendatenbank|Standard task database/)).toContainText('Aufgaben');
});

test('Settings nav: exactly the clicked area is active; one vault shows no switch link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();

  // Pages redesign: a rail click renders that page and highlights exactly its
  // entry (no scroll spy anymore — the highlight IS the active page).
  const updates = dialog.getByRole('button', { name: /^Updates$/ });
  await updates.click();
  await expect(updates).toHaveCSS('font-weight', '600');

  // Clicking another area hands the highlight over.
  const appearance = dialog.getByRole('button', { name: /^(Erscheinungsbild|Appearance)$/ });
  await appearance.click();
  await expect(appearance).toHaveCSS('font-weight', '600');
  await expect(updates).toHaveCSS('font-weight', '400');

  // Single known vault: the identity card is display-only (no switch link).
  await expect(dialog.getByTestId('settings-vault-name')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^(Wechseln|Switch)$/ })).toHaveCount(0);
});

test('Settings window keeps one stable height across areas (sized by the tallest page)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  // Tall enough that the max-height clamp does not mask a size jump.
  await page.setViewportSize({ width: 1280, height: 1000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();

  const heightOn = async (area: RegExp) => {
    await dialog.getByRole('button', { name: area }).click();
    const box = await dialog.boundingBox();
    return box ? box.height : 0;
  };

  // Tallest app page, a short app page and a vault page must all render the
  // window at the SAME height (stacked pages — feedback round 2: no jumping).
  const tall = await heightOn(/^(Erscheinungsbild|Appearance)$/);
  const short = await heightOn(/^Updates$/);
  const vault = await heightOn(/^Backup/);
  expect(tall).toBeGreaterThan(0);
  expect(Math.abs(tall - short)).toBeLessThanOrEqual(1);
  expect(Math.abs(tall - vault)).toBeLessThanOrEqual(1);

  // The active page's content is interactive, the stacked hidden pages not:
  // exactly one visible area heading at a time.
  await expect(dialog.getByRole('heading', { name: /^Updates$/ })).toBeHidden();
  await expect(dialog.getByRole('heading', { name: /^Backup/ })).toBeVisible();

  /* And the overflow belongs to the ACTIVE page, not to a shared scroll area
     (report 2026-07-29): with one scroller around the stack, every page showed
     a scrollbar — Updates scrolled into the invisible height of the tallest
     page. A window short enough that the tallest page has to scroll: */
  await page.setViewportSize({ width: 1280, height: 700 });
  const state = async (area: RegExp) => {
    await dialog.getByRole('button', { name: area }).click();
    return page.evaluate(() => {
      const host = document.querySelector('.pv-setcontent') as HTMLElement;
      const active = document.querySelector('.pv-setpage[data-active="true"]') as HTMLElement;
      return {
        hostScrolls: host.scrollHeight > host.clientHeight + 1,
        pageScrolls: active.scrollHeight > active.clientHeight + 1,
        modalH: (document.querySelector('.pv-modal') as HTMLElement).offsetHeight,
      };
    });
  };
  const appearance = await state(/^(Erscheinungsbild|Appearance)$/);
  const updates = await state(/^Updates$/);
  expect(appearance.hostScrolls).toBe(false);
  expect(updates.hostScrolls).toBe(false);
  expect(appearance.pageScrolls).toBe(true); // the theme gallery does not fit
  expect(updates.pageScrolls).toBe(false); // two rows: no scrollbar at all
  expect(updates.modalH).toBe(appearance.modalH); // and still no jump
});

/* -------------------- 2026-07-18: unresolved wiki links create the target note (Obsidian parity) */

test('Clicking an unresolved wiki link creates and opens the note', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/LinkTest.md'] = '# Link Test\n\nGo to [[Ghost]] now.\n';
    // The wiki resolver must report "Ghost" as non-existent so the click creates it.
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:sql|select' && String(args?.query || '').includes('WHERE title = ?')
        && String(args?.values?.[0] ?? '') === 'Ghost') {
        return [];
      }
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('LinkTest', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('LinkTest', { exact: true }).click();

  // Click the [[Ghost]] link in the live-preview editor.
  const link = page.locator('.cm-editor .cm-wiki-link', { hasText: 'Ghost' });
  await expect(link).toBeVisible();
  await link.click();

  // The note is created on disk (OKF + an H1 = its title) and opens.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Ghost.md'] ?? null), { timeout: 8000 })
    .toContain('# Ghost');
});

// --- Plan 2026-07-25 P1/P2: reading the vault again, and the tab menu ---

test('F5 reads the vault again and reports what changed', async ({ page }) => {
  // Root cause the plan named: a file that arrived outside Plainva (network
  // share, cloud client, another machine) stayed invisible because nothing
  // rescanned. F5 used to be swallowed outright; now it triggers the reread.
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // A file appears in the vault without Plainva ever writing it.
  await page.evaluate(() => {
    (window as any).mockFs['/test-vault/Arrived.md'] = '# Arrived\n\nCame from elsewhere.\n';
  });

  await page.keyboard.press('F5');

  // The tree picks it up, and the report says so instead of staying silent —
  // a non-zero "new" count is the point: a silent rescan would leave the user
  // guessing whether anything happened at all.
  await expect(page.getByText('Arrived', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.pv-toast')).toContainText(/[1-9]\d*\s+(new|neu)/);
});

test('Tab menu: pinning survives "close all", unpinning releases the tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.getByText('Welcome to the mock vault!')).toBeVisible();

  const tab = page.getByRole('tab').filter({ hasText: 'Welcome' });
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Tab anheften|Pin tab/ }).click();

  // A pinned tab trades its close cross for a pin — the visible promise that
  // mass-closing will not take it.
  await expect(tab.locator('.lucide-pin')).toBeVisible();

  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Alle Tabs schließen|Close all tabs/ }).click();
  await expect(tab).toHaveCount(1);

  // Unpin, then the same command closes it — proving the pin was the reason.
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Anheftung aufheben|Unpin/ }).click();
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Alle Tabs schließen|Close all tabs/ }).click();
  await expect(tab).toHaveCount(0);
});

test('A narrow right sidebar degrades in three named steps, and the calendar becomes a week row', async ({ page }) => {
  // Measured rather than assumed: a month grid at 210 px has 14 px cells, which
  // is a pattern, not a calendar. Each width is a fresh load because the panel
  // width is restored from localStorage.
  const at = async (width: number) => {
    await page.addInitScript((w) => {
      localStorage.setItem('plainva-right-sidebar-width', String(w));
    }, width);
    await page.goto('/');
    await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
    const root = page.locator('.pv-side-right');
    await expect(root).toHaveCount(1);
    return {
      step: await root.getAttribute('data-side-step'),
      days: await page.locator('[data-testid^="sidecal-day-"]').count(),
      weekLabel: await page.getByTestId('calendar-row-week').count(),
      monthNav: await page.getByTestId('calendar-month-label').isVisible().catch(() => false),
    };
  };

  const wide = await at(320);
  expect(wide.step).toBe('comfortable');
  expect(wide.days).toBe(42); // six rows of the month grid

  const mid = await at(260);
  expect(mid.step).toBe('compact');
  expect(mid.days).toBe(42); // still the month, only tighter

  const narrow = await at(210);
  expect(narrow.step).toBe('minimal');
  expect(narrow.days).toBe(7); // one week
  expect(narrow.weekLabel).toBe(1);
  // The month navigation would be a dead control here: the row follows the open
  // day, so paging the month moves nothing.
  expect(narrow.monthNav).toBe(false);
});

// A narrow LEFT sidebar used to push its own head out of the panel: the search
// field could not shrink (the caller's `flex: 1; min-width: 0` landed on the
// inner <input>, not on the field), so the "+" button was drawn over the
// editor and was unreachable. The panel goes down to 150 px.
test('A narrow left sidebar keeps its head inside the panel', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(aside).toBeVisible({ timeout: 10000 });

  for (const width of [300, 200, 150]) {
    await page.evaluate((w) => localStorage.setItem('plainva-left-sidebar-width', String(w)), width);
    await page.reload();
    await expect(aside).toBeVisible({ timeout: 10000 });

    const panel = (await aside.boundingBox())!;
    const plus = (await page.getByTestId('sidebar-new').boundingBox())!;
    // Right edge of the button never crosses the right edge of the panel.
    expect(plus.x + plus.width, `"+" escapes the panel at ${width}px`)
      .toBeLessThanOrEqual(panel.x + panel.width);
    // And it stays a real target rather than being squeezed to nothing.
    expect(plus.width).toBeGreaterThan(20);
  }

  // Below the two thresholds the panel names its own step, exactly like the
  // right one — the tree rows read the tighter density from it.
  await expect(aside).toHaveAttribute('data-side-step', 'minimal');
});

test('Sidebar tabs carry labels while they fit, then fall back to the active one', async ({ page }) => {
  // Measured in the real font rather than keyed to a pixel guess: "Databases"
  // is more than twice the width of "Tags", so a fixed threshold would either
  // cut the long label or hide the short one long before it had to.
  const labelsAt = async (width: number) => {
    await page.addInitScript((w) => {
      localStorage.setItem('plainva-left-sidebar-width', String(w));
    }, width);
    await page.goto('/');
    await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-left-tab]')).toHaveCount(3);
    return (await page.locator('[data-left-tab]').allInnerTexts()).map((s) => s.trim());
  };

  expect(await labelsAt(400)).toEqual(['Files', 'Tags', 'Databases']);
  // At the DEFAULT width all three do not fit — the tab you are standing on
  // keeps its name, so the labels never disappear entirely.
  expect(await labelsAt(250)).toEqual(['Files', '', '']);
  expect(await labelsAt(190)).toEqual(['', '', '']);

  // A label is DROPPED, never clipped: the row has to be allowed to shrink
  // below its content, or it keeps reporting the width the labels wanted and
  // the panel cuts the last tab off at its edge.
  for (const width of [320, 260, 215, 180]) {
    const labels = await labelsAt(width);
    const panel = (await page.locator('aside[aria-label="Left Sidebar"]').boundingBox())!;
    const last = (await page.locator('[data-left-tab]').last().boundingBox())!;
    expect(last.x + last.width, `tabs overflow the panel at ${width}px`)
      .toBeLessThanOrEqual(panel.x + panel.width);
    // Whatever survives is shown whole — no ellipsis on a label we kept.
    for (const l of labels) expect(l).not.toContain('…');
  }
});

test('OKF: a vault with violations gets a toast with an action — never a dialog', async ({ page }) => {
  // The explainer used to open BY ITSELF once per vault, for every vault, even
  // one that conformed. Now the only automatic thing is the offer, and only
  // when there is something to offer (P4.1 / E2).
  await page.addInitScript(() => { (window as any).__E2E_OKF_OFFER = true; });
  await page.goto('/');
  // The suite's mock auto-opens the vault (autoOpenLastVault), so the tree is
  // the signal that the scan has something to look at.
  await expect(page.locator('.lucide-folder').first()).toBeVisible({ timeout: 20000 });

  // Welcome.md in the fixture has no frontmatter, so it violates OKF.
  const toast = page.locator('.pv-toast', { hasText: /OKF/ });
  await expect(toast).toBeVisible({ timeout: 20000 });
  // No modal in the way: the dialog role belongs to nothing on screen.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Its action leads where the conversion lives.
  await toast.getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

// --- TEMPORARY: daily-note repair -------------------------------------------
// Remove this block together with services/dailyNoteRepair.ts and
// components/DailyNoteRepairModal.tsx by 2026-11-01 (plan Vorlagen-Engine E4,
// Sammelplan C13).
test('Maintenance: the daily-note repair finds an inherited marker and strips it', async ({ page }) => {
  await page.addInitScript(() => {
    // A daily note that inherited its template's `plainva.tasks: false` — the
    // exact damage the old raw-replace path produced. Vault root + default
    // format, so no per-vault settings are needed.
    (window as any).mockFs['/test-vault/2026-07-20.md'] =
      '---\ntype: Daily Note\nokf_version: "0.1"\nplainva:\n  tasks: false\n---\n\n# 2026-07-20\n\n- [ ] Eine Aufgabe\n';
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dialog.getByRole('button', { name: /^(Wartung|Maintenance)$/ }).click();
  await dialog.getByTestId('settings-repair-daily').click();

  // Settings close, the repair modal takes over and lists the affected note.
  const repair = page.getByTestId('daily-repair-modal');
  await expect(repair).toBeVisible({ timeout: 10000 });
  await expect(repair.getByTestId('daily-repair-row')).toHaveCount(1, { timeout: 10000 });

  await repair.getByTestId('daily-repair-run').click();

  // The marker is gone from disk; the note itself is untouched.
  await expect
    .poll(async () => page.evaluate(() => (window as any).mockFs['/test-vault/2026-07-20.md']), { timeout: 10000 })
    .not.toContain('tasks: false');
  const after = await page.evaluate(() => (window as any).mockFs['/test-vault/2026-07-20.md']);
  expect(after).toContain('- [ ] Eine Aufgabe');
  expect(after).toContain('type: Daily Note');
});

test('Folder templates: a new note in a mapped folder starts from its template', async ({ page }) => {
  // Plan Vorlagen-Engine P4. Two things are proven here: the rule is written by
  // the settings surface and READ by the creation path — the two halves live in
  // different modules, and a mapping that only one of them understands is worse
  // than none.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Projekte'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates/Projekt.md'] =
      '---\ntype: Projekt\n---\n\n# {{title}}\n\nAngelegt am {{date}}\n';
  });

  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });

  // 1) Map Projekte → Projekt.md in the settings.
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Inhalt & Struktur|Content & structure)$/ }).click();
  await dialog.getByTestId('add-folder-template').click();
  const rules = dialog.getByTestId('folder-template-rules');
  await rules.getByPlaceholder(/Ordner|Folder/).fill('Projekte');
  await rules.locator('.pv-selecttrigger').first().click();
  await page.getByRole('option', { name: 'Projekt.md' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // 2) Create a note in that folder — the tree's own "new note" flow.
  const aside = page.getByTestId('file-tree');
  await aside.getByText('Projekte', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Neue Notiz hier|New note here/i }).click();
  await aside.getByRole('textbox').last().fill('Solaranlage');
  await page.keyboard.press('Enter');

  // The rule applied: the template's frontmatter and its interpolated body.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Solaranlage.md']), { timeout: 10000 })
    .toContain('type: Projekt');
  const written = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Solaranlage.md']);
  expect(written).toContain('# Solaranlage');
  expect(written).toMatch(/Angelegt am \d{4}-\d{2}-\d{2}/);
  // The template's own keys never travel into the note.
  expect(written).not.toContain('{{title}}');
});

test('Folder templates: an unmapped folder still creates a plain note', async ({ page }) => {
  // The counter-proof to the test above — a rule must not leak into folders it
  // was never meant for, which is what "longest matching path" hinges on.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Projekte'] = { isDir: true };
    (window as any).mockFs['/test-vault/Woanders'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates/Projekt.md'] = '---\ntype: Projekt\n---\n\n# {{title}}\n';
    // The rule as the settings store holds it.
    (window as any).__E2E_STORE_SEED = {
      [`folderTemplates_${btoa(unescape(encodeURIComponent('/test-vault')))}`]: [
        { folder: 'Projekte', template: 'Projekt.md' },
      ],
    };
  });

  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });

  const aside = page.getByTestId('file-tree');
  await aside.getByText('Woanders', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Neue Notiz hier|New note here/i }).click();
  await aside.getByRole('textbox').last().fill('Frei');
  await page.keyboard.press('Enter');

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Woanders/Frei.md']), { timeout: 10000 })
    .toContain('# Frei');
  const written = await page.evaluate(() => (window as any).mockFs['/test-vault/Woanders/Frei.md']);
  expect(written).not.toContain('type: Projekt');
});


test('"New note from template …" beats the folder rule', async ({ page }) => {
  // The explicit pick has to win: someone who opens the picker has already
  // answered the question the rules exist to answer (plan Vorlagen-Engine P4).
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Projekte'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates/Projekt.md'] = '---\ntype: Projekt\n---\n\n# {{title}}\n';
    (window as any).mockFs['/test-vault/Templates/Besprechung.md'] = '---\ntype: Meeting\n---\n\n# {{title}}\n\nTeilnehmer:\n';
    (window as any).__E2E_STORE_SEED = {
      [`folderTemplates_${btoa(unescape(encodeURIComponent('/test-vault')))}`]: [
        { folder: 'Projekte', template: 'Projekt.md' },
      ],
    };
  });

  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });

  const aside = page.getByTestId('file-tree');
  await aside.getByText('Projekte', { exact: true }).click({ button: 'right' });
  await page.getByTestId('tree-new-from-template').click();
  // The picker offers the templates; choosing one overrides the folder rule.
  await page.getByText('Besprechung', { exact: true }).click();
  await aside.getByRole('textbox').last().fill('Jour fixe');
  await page.keyboard.press('Enter');

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Jour fixe.md']), { timeout: 10000 })
    .toContain('type: Meeting');
  const written = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Jour fixe.md']);
  expect(written).toContain('# Jour fixe');
  expect(written).toContain('Teilnehmer:');
});

test('Type templates: they apply where no folder rule reaches, and lose to one that does', async ({ page }) => {
  // Plan Vorlagen-Engine P4b. Precedence is the whole point of having both:
  // where a note LIES is the more deliberate statement than what it IS.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Projekte'] = { isDir: true };
    (window as any).mockFs['/test-vault/Woanders'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates/Projekt.md'] = '---\ntype: Projekt\n---\n\n# {{title}}\n';
    (window as any).mockFs['/test-vault/Templates/Standard.md'] = '---\nquelle: Typregel\n---\n\n# {{title}}\n\nAus der Typ-Vorlage\n';
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    (window as any).__E2E_STORE_SEED = {
      [`folderTemplates_${b64('/test-vault')}`]: [{ folder: 'Projekte', template: 'Projekt.md' }],
      // Every new note carries the default type "Note" unless configured
      // otherwise, so this rule covers everything the folder rule misses.
      [`typeTemplates_${b64('/test-vault')}`]: [{ type: 'Note', template: 'Standard.md' }],
    };
  });

  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });
  const aside = page.getByTestId('file-tree');

  // Unmapped folder → the type rule applies.
  await aside.getByText('Woanders', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Neue Notiz hier|New note here/i }).click();
  await aside.getByRole('textbox').last().fill('Irgendwas');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Woanders/Irgendwas.md']), { timeout: 10000 })
    .toContain('Aus der Typ-Vorlage');

  // Mapped folder → the folder rule wins over the type rule.
  await aside.getByText('Projekte', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Neue Notiz hier|New note here/i }).click();
  await aside.getByRole('textbox').last().fill('Solar');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Solar.md']), { timeout: 10000 })
    .toContain('type: Projekt');
  const written = await page.evaluate(() => (window as any).mockFs['/test-vault/Projekte/Solar.md']);
  expect(written).not.toContain('Aus der Typ-Vorlage');
});

test('A template with a clipboard token asks about it instead of pasting silently', async ({ page }) => {
  // Decision E7: a password manager puts credentials on the clipboard, and a
  // template carrying {{clipboard}} would otherwise write them into a note that
  // then syncs. The value arrives pre-filled in the dialog, where it is visible
  // and editable — and the ANSWER is what lands in the note.
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/Templates'] = { isDir: true };
    (window as any).mockFs['/test-vault/Templates/Quelle.md'] = '---\ntype: Note\n---\n\n# {{title}}\n\nQuelle: {{clipboard}}\n';
    (window as any).__E2E_STORE_SEED = {
      [`folderTemplates_${btoa(unescape(encodeURIComponent('/test-vault')))}`]: [
        { folder: '', template: 'Quelle.md' },
      ],
    };
    // The shell reads the clipboard through the web API.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => 'hunter2' },
    });
  });

  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });

  // A root rule covers the whole vault, so a plain new note picks it up.
  await page.getByTestId('sidebar-new').click();
  await page.getByRole('menuitem', { name: /Neue Notiz|New note/i }).click();
  const name = page.getByPlaceholder(/Dateiname|File name/i);
  await expect(name).toBeVisible();
  await name.fill('Fundstelle');
  await name.press('Enter');

  // One dialog, the clipboard pre-filled and editable.
  const fields = page.getByTestId('template-answers');
  await expect(fields).toBeVisible({ timeout: 10000 });
  const input = fields.getByRole('textbox').first();
  await expect(input).toHaveValue('hunter2');
  await input.fill('etwas Harmloses');
  await page.getByRole('button', { name: /Bestätigen|Confirm/i }).click();

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Fundstelle.md']), { timeout: 10000 })
    .toContain('Quelle: etwas Harmloses');
  const written = await page.evaluate(() => (window as any).mockFs['/test-vault/Fundstelle.md']);
  expect(written).not.toContain('hunter2');
});

test('Create vault: the Plainva tour is the recommended card and scaffolds a fully populated vault', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      if (cmd === 'plugin:dialog|open') return '/tour-vault';
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^(Neuer Vault|New Vault)$/ }).click();
  await page.getByRole('button', { name: /Auf diesem Computer|On this computer/ }).click();

  // The tour is the first card and the one carrying the badge — an empty vault
  // demonstrates nothing, so "recommended to start" belongs here (E1).
  const cards = page.locator('button.pv-cardhover');
  const tour = page.getByRole('button', { name: /Plainva.?(Tour|tour)/ });
  await expect(tour).toBeVisible();
  await expect(tour.getByText(/Empfohlen für den Einstieg|Recommended to start/)).toBeVisible();
  // Directly after the empty-vault card, i.e. first among the templates.
  await expect(cards.nth(1)).toHaveText(/Plainva.?(Tour|tour)/);
  await expect(cards.nth(0)).not.toHaveText(/Empfohlen für den Einstieg|Recommended to start/);

  // The card is a teaser, not an inventory: nine folders and seven databases
  // wrapped over four rows and filled half the scroll area, so both lists are
  // capped with a "+N" chip. Two rows keeps the tour the same height as PARA.
  const chipRows = await tour.evaluate((card) => {
    const rows = [...card.querySelectorAll('div')] as HTMLElement[];
    const chipRow = rows.find((r) => r.style.flexWrap === 'wrap' && r.children.length > 2)!;
    return new Set([...chipRow.children].map((c) => Math.round(c.getBoundingClientRect().top))).size;
  });
  expect(chipRows).toBeLessThanOrEqual(2);
  await expect(tour.getByText(/^\+\d+$/).first()).toBeVisible();

  await tour.click();
  await page.waitForFunction(() => !!(window as any).mockFs['/tour-vault/index.md'], undefined, { timeout: 15000 });
  const files: string[] = await page.evaluate(() =>
    Object.keys((window as any).mockFs).filter((p: string) => p.startsWith('/tour-vault/') && !(window as any).mockFs[p].isDir)
  );

  // Nine folders, each with its own managed index.md, and seven databases at
  // the vault root — the shape the tour promises on the chooser card.
  const folderIndexes = files.filter((p) => /^\/tour-vault\/[^/]+\/index\.md$/.test(p));
  expect(folderIndexes.length).toBe(9);
  expect(files.filter((p) => /^\/tour-vault\/[^/]+\.base$/.test(p)).length).toBe(7);

  // Both sample attachments are written byte-for-byte (they are raw files, not
  // notes: no frontmatter is stamped onto them) and never listed in an index.
  const svgs = files.filter((p) => p.endsWith('.svg'));
  expect(svgs.length).toBe(2);
  const svg = await page.evaluate((p) => (window as any).mockFs[p], svgs[0]);
  expect(String(svg).startsWith('<svg')).toBe(true);
  const attachmentIndex = folderIndexes.find((p) => svgs.some((s) => s.startsWith(p.replace(/index\.md$/, ''))))!;
  const attachmentListing = await page.evaluate((p) => (window as any).mockFs[p], attachmentIndex);
  expect(String(attachmentListing)).not.toContain('.svg');

  // Scaffold-time tokens resolved, engine tokens survived: the journal samples
  // are named by date, while the daily template still asks the engine for one.
  expect(files.some((p) => /\/\d{4}-\d{2}-\d{2}\.md$/.test(p))).toBe(true);
  expect(files.some((p) => p.includes('{{'))).toBe(false);
  const dailyTemplate = files.find((p) => /(Tagesnotiz|Daily note)\.md$/i.test(p))!;
  const daily = await page.evaluate((p) => (window as any).mockFs[p], dailyTemplate);
  expect(String(daily)).toContain('{{daily-1}}');
  expect(String(daily)).toContain('{{cursor}}');

  // The pinboard database keeps its Obsidian-native shape on disk: a table view
  // carrying the Plainva render hint, so Obsidian opens it as a table.
  const pinboardBase = files.find((p) => p.endsWith('.base') && /(Notizzettel|Quick notes)/i.test(p))!;
  const pinboard = await page.evaluate((p) => (window as any).mockFs[p], pinboardBase);
  expect(String(pinboard)).toContain('type: table');
  expect(String(pinboard)).toContain('render: pinboard');

  // The new vault actually opened.
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15000 });
});

/**
 * P4.2: both picker modes are the same surface now (F10-F13). Pinned here
 * because every one of these four was missing on one side before: the icon mode
 * had no categories and no recents, the search field wore a different metric per
 * mode, and the tint row was a hand-built circle strip with a bare system field.
 */
test('Icon picker: both modes share one head zone, categories and recents (P4.2)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).mockFs['/test-vault/PickerModes.md'] = "---\ntype: Note\n---\n\nPicker body\n";
  });

  await page.goto('/');
  // Once, NOT in the init script: that runs on every navigation and would undo
  // itself on the reload this test ends with.
  await page.evaluate(() => { try { localStorage.removeItem('plainva-recent-icons'); } catch { /* not available */ } });
  await expect(page.getByText('PickerModes', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('PickerModes', { exact: true }).click();
  await expect(page.getByText('Picker body')).toBeVisible();

  const openPicker = async () => {
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/icon');
    await page.locator('.cm-tooltip-autocomplete li', { hasText: /Dokument-Icon|Document icon/ }).first().click();
    const picker = page.getByTestId('emoji-picker');
    await expect(picker).toBeVisible();
    return picker;
  };

  let picker = await openPicker();
  // One search field, in the NORMAL form metric (34px), in both modes — it used
  // to be the compact 28px variant.
  const search = picker.getByTestId('picker-search');
  const fieldHeight = async () =>
    Math.round((await picker.locator('.pv-searchfield').first().boundingBox())!.height);
  expect(await fieldHeight()).toBeGreaterThanOrEqual(32);
  await picker.getByTestId('picker-mode-icons').click();
  expect(await fieldHeight()).toBeGreaterThanOrEqual(32);
  await expect(search).toBeVisible();

  // Icon mode has category tabs (ten of them) and the custom-colour action.
  const tabs = picker.getByTestId('picker-icon-tabs');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(10); // no recents yet
  await expect(picker.getByTestId('picker-tint-custom')).toBeVisible();

  // A tab switches the grid: "hourglass" lives in work, not in knowledge.
  await tabs.getByRole('tab').nth(1).click(); // work
  await expect(picker.locator('button[aria-label="hourglass"]')).toBeVisible();
  await tabs.getByRole('tab').nth(0).click(); // knowledge
  await expect(picker.locator('button[aria-label="hourglass"]')).toHaveCount(0);
  await expect(picker.locator('button[aria-label="book-open"]')).toBeVisible();

  // Pick a tinted icon: the tint lands in the frontmatter next to the icon.
  await picker.locator('button[aria-label="#2f6f6f"]').first().click();
  await picker.locator('button[aria-label="folder-open"]').first().click();
  await expect(page.locator('.pv-doc-header-icon svg').first()).toBeVisible({ timeout: 10000 });

  // Re-opening offers the icon under "recently used" — an eleventh tab.
  picker = await openPicker();
  await picker.getByTestId('picker-mode-icons').click();
  await expect(picker.getByTestId('picker-icon-tabs').getByRole('tab')).toHaveCount(11);
  await expect(picker.locator('button[aria-label="folder-open"]')).toBeVisible();

  // And it survives a restart: the recents key is global, not per session.
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByText('Picker body')).toBeVisible({ timeout: 20000 });
  picker = await openPicker();
  await picker.getByTestId('picker-mode-icons').click();
  await expect(picker.getByTestId('picker-icon-tabs').getByRole('tab')).toHaveCount(11);
  await expect(picker.locator('button[aria-label="folder-open"]')).toBeVisible();
});

test('background settings: two switches, both off, and the reminder condition follows them', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    const saved: Record<string, any> = {};
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|set' && args && typeof args.key === 'string') { saved[args.key] = args.value; return null; }
      if (cmd === 'plugin:store|get' && args && args.key in saved) return [saved[args.key], true];
      if (cmd === 'plugin:autostart|is_enabled') return false;
      if (String(cmd).startsWith('plugin:autostart|')) return null;
      // The tray builds fine here; whether it is VISIBLE is what the person is
      // asked, and the dialog below answers that.
      if (cmd === 'tray_enable' || cmd === 'tray_disable' || cmd === 'tray_set_next') return null;
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dlg.getByRole('button', { name: /^(Start & Verhalten|Startup & behavior)$/ }).click();

  const card = dlg.getByRole('group', { name: /Hintergrund|Background/ });
  await expect(card).toBeVisible();
  const switches = card.getByRole('switch');
  await expect(switches).toHaveCount(2);
  // Both off by default — never registered unasked.
  await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'false');
  await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'false');
  await expect(card).toContainText(/solange Plainva läuft|while Plainva is running/);
  await card.screenshot({ path: '/tmp/bg-off.png' });

  // Saying "no, I cannot see it" must leave the switch off — otherwise the
  // window could be closed with no way back.
  await switches.nth(1).click();
  await page.getByRole('button', { name: /^(Nein|No)$/ }).click();
  await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'false');
  await expect(card).toContainText(/nicht erschienen|did not appear/);
  await card.screenshot({ path: '/tmp/bg-refused.png' });

  // Saying yes keeps it, and the condition line follows.
  await switches.nth(1).click();
  await page.getByRole('button', { name: /(Ja, ich sehe es|Yes, I see it)/ }).click();
  await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(card).toContainText(/auch bei geschlossenem Fenster|even with the window closed/);
  await card.screenshot({ path: '/tmp/bg-on.png' });
});
