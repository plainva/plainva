/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Import wizard E2E (P2.1).
 *
 * The wizard had no end-to-end coverage at all until here — every one of its
 * findings so far was caught by reading the code, not by a failing test. These
 * drive the real modal against the mock filesystem: the source is recognised
 * from the selection, the target is a radio group that can only hold one
 * answer, and a run actually writes notes and a report.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': '# Welcome',
      // The "export" the user picks in the file dialog.
      '/exports': { isDir: true },
      '/exports/keep-note.json': JSON.stringify({
        title: 'Shopping',
        textContent: 'milk',
        isPinned: false,
        createdTimestampUsec: 1552555613000000,
      }),
      '/exports/plain.md': '# Plain note\n\nJust markdown.',
      // A note the user deleted in Keep — skipped unless the wizard's switch says otherwise.
      '/exports/keep-trashed.json': JSON.stringify({
        title: 'Old idea',
        textContent: 'never mind',
        isTrashed: true,
        createdTimestampUsec: 1552555613000000,
      }),
    };
    const fs = (window as any).mockFs;
    /** Paths the mocked file dialog hands back on the next call. */
    (window as any).mockDialogPick = ['/exports/keep-note.json'];

    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
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
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        // The file dialog: hands back whatever the test staged.
        if (cmd === 'plugin:dialog|open') {
          const picked = (window as any).mockDialogPick;
          if (!picked) return null;
          return args?.directory || args?.options?.directory ? picked[0] : picked;
        }
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('content FROM fts_notes')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, content: fs['/test-vault/' + r.path] }));
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
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
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
        if (cmd === 'set_file_times') return null;
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  });
});

/**
 * Picks a source in the wizard's dropdown.
 *
 * Needed before choosing files for a multi-file source: the file dialog asks
 * for a FOLDER while "Markdown folder" is selected, so a multi-file selection
 * only makes sense once the source is set.
 */
async function chooseSource(page: any, label: string | RegExp) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: label }).click();
}

async function openWizard(page: any) {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog');
  await palette.getByRole('textbox').fill('Import');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByText(/Import aus|Import from|importieren/i).first()).toBeVisible();
}

test('recognises the picked export and names the source it chose', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: /Dateien wählen|Choose files/i }).click();

  // Google Keep's per-note JSON is recognised without the user saying so — the
  // wizard used to open on "Markdown folder" and stay there.
  const detected = dialog.getByTestId('import-detected');
  await expect(detected).toBeVisible({ timeout: 10000 });
  await expect(detected).toContainText(/Keep/);
});

test('the import target is one choice, not two independent switches', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  const subfolder = dialog.getByTestId('import-target-subfolder');
  const newVault = dialog.getByTestId('import-target-newvault');

  // A radiogroup: exactly one option is selected at any time.
  await expect(subfolder).toHaveAttribute('aria-checked', 'true');
  await expect(newVault).toHaveAttribute('aria-checked', 'false');

  await newVault.click();
  await expect(newVault).toHaveAttribute('aria-checked', 'true');
  await expect(subfolder).toHaveAttribute('aria-checked', 'false');
  // The new-vault target asks for its folder instead of a subfolder name.
  await expect(dialog.getByRole('button', { name: /Ordner wählen|Choose folder/i })).toBeVisible();

  await subfolder.click();
  await expect(subfolder).toHaveAttribute('aria-checked', 'true');
});

test('imports the selection into the vault and writes a report', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: /Dateien wählen|Choose files/i }).click();
  await expect(dialog.getByTestId('import-detected')).toBeVisible({ timeout: 10000 });

  await dialog.getByRole('button', { name: /Weiter zur Vorschau|Continue to preview/i }).click();
  await expect(dialog.getByText(/^(Vorschau|Preview):/).first()).toBeVisible({ timeout: 10000 });

  await dialog.getByRole('button', { name: /Import starten|Start import/i }).click();
  await expect(dialog.getByText(/Import abgeschlossen|Import finished/i).first()).toBeVisible({ timeout: 20000 });

  const written = await page.evaluate(() =>
    Object.keys((window as any).mockFs).filter((p: string) => p.includes('/test-vault/') && p.includes('Import'))
  );
  // The note landed in the import subfolder, and the run left a report behind.
  expect(written.some((p: string) => p.endsWith('Shopping.md'))).toBe(true);
  expect(written.some((p: string) => p.includes('Import report'))).toBe(true);

  // The undo is a folder, and the wizard says so before the user closes it.
  await expect(dialog.getByTestId('import-undo-hint')).toBeVisible();
});

test('shows the switches the chosen source understands, and no others', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  await page.evaluate(() => {
    (window as any).mockDialogPick = ['/exports/keep-note.json'];
  });
  await dialog.getByRole('button', { name: /Dateien wählen|Choose files/i }).click();
  await expect(dialog.getByTestId('import-detected')).toBeVisible({ timeout: 10000 });

  // Keep carries its own trash, so it offers both switches.
  await expect(dialog.getByTestId('import-option-preserveTimestamps')).toBeVisible();
  await expect(dialog.getByTestId('import-option-includeTrashed')).toBeVisible();
  // Deleted notes stay behind unless asked for (maintainer decision G5).
  await expect(dialog.getByTestId('import-option-includeTrashed')).not.toBeChecked();

  // A plain Markdown folder has no trash — the switch is simply absent there,
  // rather than present and doing nothing.
  await page.evaluate(() => {
    (window as any).mockDialogPick = ['/exports/plain.md'];
  });
  await dialog.getByRole('button', { name: /Dateien wählen|Choose files/i }).click();
  await expect(dialog.getByTestId('import-option-preserveTimestamps')).toBeVisible();
  await expect(dialog.getByTestId('import-option-includeTrashed')).toHaveCount(0);
});

test('the trash switch decides what reaches the vault', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  // Set the source first: while "Markdown folder" is selected the picker asks
  // for a folder, and a two-file selection would collapse to the first entry.
  await chooseSource(page, /Google Keep/);
  await page.evaluate(() => {
    (window as any).mockDialogPick = ['/exports/keep-note.json', '/exports/keep-trashed.json'];
  });
  await dialog.getByRole('button', { name: /Dateien wählen|Choose files/i }).click();

  await dialog.getByTestId('import-option-includeTrashed').check();

  await dialog.getByRole('button', { name: /Weiter zur Vorschau|Continue to preview/i }).click();
  await expect(dialog.getByText(/^(Vorschau|Preview):/).first()).toBeVisible({ timeout: 10000 });
  await dialog.getByRole('button', { name: /Import starten|Start import/i }).click();
  await expect(dialog.getByText(/Import abgeschlossen|Import finished/i).first()).toBeVisible({ timeout: 20000 });

  const written = await page.evaluate(() => Object.keys((window as any).mockFs));
  // Switched on, the deleted note comes across too — the option is not decoration.
  expect(written.some((p: string) => p.includes('Old idea'))).toBe(true);
});

test('tells Obsidian users there is nothing to import', async ({ page }) => {
  await openWizard(page);
  const dialog = page.getByRole('dialog');

  await chooseSource(page, 'Obsidian');

  // No file picker, no target: the answer is "open your vault".
  await expect(dialog.getByTestId('import-obsidian-card')).toBeVisible();
  await expect(dialog.getByTestId('import-target-subfolder')).toHaveCount(0);
  await expect(dialog.getByTestId('import-options')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Vault öffnen|Open vault/i })).toBeVisible();
});
