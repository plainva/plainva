/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
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
          // The one-time OKF explainer (P12) must not block the scenarios.
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
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
  const newNoteBtn = page.locator('div[title="New Note in Root"], div[title="Neue Notiz im Hauptverzeichnis"]');
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
  await expect(page.locator('.cm-content span').filter({ hasText: /^def$/ }).first()).toBeVisible({ timeout: 15000 });
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
  await page.getByRole('button', { name: /^(Neu|New)$/ }).click();
  const input = page.getByPlaceholder(/Dateiname|File name/i);
  await expect(input).toBeVisible();
  await input.fill('Idee');
  await input.press('Enter');

  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/Ordner/Idee.md']), { timeout: 8000 })
    .toContain('# Idee');
});

// --- File tree: multi-select + bulk delete (UI-UX P9) ---
test('File tree: Ctrl-selection deletes both notes after a single confirm', async ({ page }) => {
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
  await page.getByRole('button', { name: /^(Neu|New)$/ }).click();
  const input = page.getByPlaceholder(/Dateiname|File name/i);
  await input.fill('Frisch');
  await input.press('Enter');
  await expect
    .poll(async () => await page.evaluate(() => (window as any).mockFs['/test-vault/P/index.md']), { timeout: 8000 })
    .toContain('Frisch');

  // Create in Q: no index.md there — none may appear.
  await aside.getByText('Q', { exact: true }).click();
  await page.getByRole('button', { name: /^(Neu|New)$/ }).click();
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
  await expect(page.getByText('test-vault', { exact: true })).toHaveCount(0);
  // Non-destructive: the vault files are untouched.
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
  await page.getByRole('button', { name: /Neuen Vault erstellen|Create New Vault/ }).click();
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

  const folderInput = page.getByPlaceholder('Tagebuch/');
  await folderInput.fill('Journal');

  // Close via the top-right X — reopening shows the persisted value. (Scoped
  // to the dialog: the window titlebar has its own Close button.)
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /Schließen|Close/ }).click();
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toHaveCount(0);
  await page.keyboard.press('Control+,');
  await expect(page.getByPlaceholder('Tagebuch/')).toHaveValue('Journal');

  // Clicking the overlay closes it as well.
  await page.mouse.click(5, 5);
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toHaveCount(0);
});

test('Online vault: chooser lists all providers; a provider pick deep-links into Settings', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:store|get' && args?.key === 'autoOpenLastVault') return [null, false];
      if (cmd === 'plugin:dialog|open') return '/sync-vault';
      return orig(cmd, args, options);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Online-Vault öffnen|Open Online Vault/ }).click();

  // All five providers are offered; WebDAV leads to the connect form (and Back
  // returns to the chooser, not the main view).
  await expect(page.getByRole('button', { name: /OneDrive/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /S3/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Google Drive/ })).toBeVisible();
  await page.getByRole('button', { name: /WebDAV/ }).click();
  await expect(page.getByText(/Mit WebDAV verbinden|Connect to WebDAV/)).toBeVisible();
  await page.getByRole('button', { name: /Zurück|Back/ }).click();
  await expect(page.getByRole('button', { name: /Dropbox/ })).toBeVisible();

  // OAuth/key providers: pick the local sync folder, the vault opens and the
  // Settings modal comes up with the provider's form preselected.
  // The BYO handbook links sit under the provider grid (Nachfass P3.12);
  // Google Drive is the provider that stays BYO.
  await expect(page.getByRole('link', { name: 'Google Drive', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Dropbox/ }).click();
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dlg).toBeVisible({ timeout: 15000 });
  await expect(dlg.getByRole('button', { name: /Mit Dropbox verbinden|Connect to Dropbox/ })).toBeVisible();
  // Dropbox ships a central app key since 2026-07-06 (providerDefaults filled)
  // — its form must NOT carry the BYO badge anymore.
  await expect(dlg.getByText(/Eigene App-ID nötig|Own app ID required/)).toHaveCount(0);
});

test('Sync error dialog: deep-links into the sync settings (broken connection recovery)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  // The status bar's "Offline" button (and the vault-switcher triangle) fire this
  // event; a real sync failure is not reproducible against the mocked backend.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-show-sync-error')));
  await expect(page.getByRole('heading', { name: /Sync-Fehler|Sync Error/ })).toBeVisible();
  // The dialog explains the common expired-sign-in cause next to the message.
  await expect(page.getByText(/Sync-Einstellungen kannst Du die Verbindung|reconnect in the sync settings/)).toBeVisible();

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

  // The density select lives in the appearance group of the GENERAL section
  // (plan §2.5); the modal opens on the active vault by default.
  await dialog.getByRole('button', { name: /^(Allgemein|General)$/ }).click();
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
  await dialog.getByRole('button', { name: /^(Allgemein|General)$/ }).click();
  await dialog.getByLabel(/Standard-Ansicht|Default view/).click();
  await page.getByRole('option', { name: /Lesemodus|Read Mode/ }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Opening a note now starts in the read view.
  await page.getByText('Zweite', { exact: true }).click();
  await expect(page.locator('.markdown-reader').first()).toBeVisible();

  // Manual switch to live for THIS file…
  await page.getByTitle(/Live-Vorschau|Live Preview/).first().click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await expect(page.locator('.markdown-reader')).toHaveCount(0);

  // …other files still open in the default (read)…
  await page.getByText('Welcome', { exact: true }).click();
  await expect(page.locator('.markdown-reader').first()).toBeVisible();

  // …and returning to the switched file keeps its session choice (live).
  await page.getByText('Zweite', { exact: true }).click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await expect(page.locator('.markdown-reader')).toHaveCount(0);
});

test('Settings subnav: clicking a late anchor highlights it even when it cannot scroll to the top', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^(Allgemein|General)$/ }).click();

  // "Updates" is the LAST group: the container cannot scroll it up to the spy
  // line, so before the click-wins fix the highlight never moved (the click
  // looked dead). The clicked entry must become the active one regardless.
  const updates = dialog.getByRole('button', { name: /^Updates$/ });
  await updates.click();
  await expect(updates).toHaveCSS('font-weight', '600');

  // Clicking another anchor hands the highlight over.
  const appearance = dialog.getByRole('button', { name: /^(Darstellung|Appearance)$/ });
  await appearance.click();
  await expect(appearance).toHaveCSS('font-weight', '600');
  await expect(updates).toHaveCSS('font-weight', '400');
});
