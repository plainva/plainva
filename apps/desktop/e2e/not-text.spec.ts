/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * A file whose name says text and whose bytes are not UTF-8 (finding
 * 2026-10-11): a note from an old program and a `.csv` Excel saved, both in
 * Windows-1252. The desktop reads text through its Rust side, which refuses
 * such bytes — and every failed load counted as a missing file: the editor said
 * "This file no longer exists" for a file that lay there untouched. Now it says
 * what the file is, as for a file the first bytes give away, and offers it to
 * the system's program. Nothing is written to either file.
 *
 * The fixture is the note-body suite's plain vault, with two files kept as
 * bytes and a checked text read that refuses them the way Rust does.
 */
const WINDOWS_1252 = (text: string) => [...text].map((char) => char.charCodeAt(0));
const OLD_NOTE = WINDOWS_1252('# Grüße\r\n\r\nAus einem alten Programm.\r\n');
const TABLE = WINDOWS_1252('id;name\r\n1;Grün\r\n2;Blau\r\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(({ OLD_NOTE, TABLE }) => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Start.md': '# Start\n\nA note in UTF-8.\n',
      '/test-vault/Alt.md': { bytes: OLD_NOTE },
      '/test-vault/Data.csv': { bytes: TABLE },
    };
    (window as any).writes = [] as string[];
    const fs = (window as any).mockFs;
    const isFile = (p: string) => fs[p] !== undefined && !fs[p].isDir;
    const bytesOf = (entry: any): number[] => (typeof entry === 'string' ? Array.from(new TextEncoder().encode(entry)) : entry.bytes);
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => isFile(p) && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
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
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          const overrides = (window as any).storeOverrides ?? {};
          if (args.key in overrides) return [overrides[args.key], true];
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
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        // Every write is noted — none may reach the two files unasked — and
        // lands as what it is: bytes as bytes, a text as its UTF-8.
        if (cmd === 'write_file_atomic') {
          (window as any).writes.push(String(args.relPath));
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          fs[`${root}/${rel}`] = args.encoding === 'base64'
            ? { bytes: Array.from(atob(String(args.contents)), (char) => char.charCodeAt(0)) }
            : String(args.contents);
          return null;
        }
        if (cmd === 'move_to_trash' || cmd === 'plugin:fs|remove') {
          const p = String(args.path).replace(/\/$/, '');
          for (const key of Object.keys(fs)) if (key === p || key.startsWith(p + '/')) delete fs[key];
          return null;
        }
        // Checked native reads use the same files as the plugin fixture. The
        // text read decodes strictly, as Rust's `read_to_string` does: bytes
        // that are not UTF-8 are refused, not replaced.
        if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|exists', { path });
          if (cmd === 'checked_path_exists') return present;
          if (!present) return null;
          if (cmd === 'checked_read_dir') {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path });
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
          } catch {
            throw 'cannot read text file: stream did not contain valid UTF-8';
          }
        }
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error('File not found');
          return { isDir: !!file.isDir, isFile: !file.isDir, mtime: 1000, size: file.isDir ? 0 : bytesOf(file).length };
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
          return bytesOf(content);
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  }, { OLD_NOTE, TABLE });
});

async function open(page: any, name: string) {
  await page.goto('/');
  await expect(page.getByText('Start', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByText(name, { exact: true }).first().click();
}

const untouched = async (page: any) => {
  const state = await page.evaluate(() => ({ writes: (window as any).writes as string[], note: (window as any).mockFs['/test-vault/Alt.md'].bytes, table: (window as any).mockFs['/test-vault/Data.csv'].bytes }));
  expect(state.writes.filter((path) => path === 'Alt.md' || path === 'Data.csv')).toEqual([]);
  expect(state.note).toEqual(OLD_NOTE);
  expect(state.table).toEqual(TABLE);
};

test('a note in Windows-1252 shows that it is not text — not that it is missing — and nothing is written to it', async ({ page }) => {
  await open(page, 'Alt');
  const notText = page.getByTestId('editor-not-text');
  await expect(notText).toBeVisible({ timeout: 20000 });
  await expect(notText).toContainText('Alt.md');
  await expect(page.getByTestId('editor-missing-file')).toHaveCount(0);
  // No editor holds a reading of it, and the status bar names no encoding and counts no words of it.
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await expect(page.getByText('UTF-8', { exact: true })).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('not-text-desktop-note.png') });
  await untouched(page);
});

test('a table in Windows-1252 opens in no text view either', async ({ page }) => {
  await open(page, 'Data.csv');
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('editor-missing-file')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await untouched(page);
});

test('the read view says it as well — not an empty note', async ({ page }) => {
  await page.addInitScript(() => { (window as any).storeOverrides = { defaultViewMode: 'read' }; });
  await open(page, 'Alt');
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('editor-not-text')).toContainText('Alt.md');
  await untouched(page);
});

test('what was typed into a note that another program saved in Windows-1252 meanwhile is kept beside it, as a conflict copy the banner names', async ({ page }) => {
  await open(page, 'Start');
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('A note in UTF-8.', { timeout: 20000 });
  // Another program saves the open note in its own encoding; no watcher tells the editor.
  await page.evaluate((bytes) => { (window as any).mockFs['/test-vault/Start.md'] = { bytes }; }, OLD_NOTE);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('Typed meanwhile.');
  // The save cannot go into the note: the text goes beside it, the note shows as what it is now.
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  const state = await page.evaluate(() => {
    const fs = (window as any).mockFs;
    const copies = Object.keys(fs).filter((p) => p.startsWith('/test-vault/Start.CONFLICT-'));
    return { copies, kept: copies.map((p) => fs[p]), note: fs['/test-vault/Start.md'] };
  });
  expect(state.copies).toHaveLength(1);
  expect(state.kept[0]).toContain('A note in UTF-8.');
  expect(state.kept[0]).toContain('Typed meanwhile.');
  expect(state.note).toEqual({ bytes: OLD_NOTE });
  const copyName = state.copies[0].replace('/test-vault/', '');
  const banner = page.locator('.pv-banner', { hasText: copyName });
  await expect(banner).toBeVisible();
  // Nothing of what was typed is left to count, or to write properties into.
  await expect(page.getByText('UTF-8', { exact: true })).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('not-text-desktop-kept.png') });
  // And no editor is left behind the state: a command that inserts text
  // (Insert template) finds none, and nothing more is kept.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-insert-text', { detail: { text: 'Inserted later.' } })));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => {
    const fs = (window as any).mockFs;
    return Object.keys(fs).filter((p) => p.startsWith('/test-vault/Start.CONFLICT-')).map((p) => fs[p]);
  })).toEqual(state.kept);
  // The file changes once more and loads anew: the banner leads to the copy
  // again — dismissed first, so that it is the new load that brings it back.
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-external-update', { detail: { path: 'Start.md', vaultPath: '/test-vault' } })));
  await expect(page.getByTestId('editor-not-text')).toBeVisible();
  await expect(banner).toBeVisible();
  expect(await page.evaluate(() => Object.keys((window as any).mockFs).filter((p) => p.startsWith('/test-vault/Start.CONFLICT-')).length)).toBe(1);
  // From the banner, the comparison takes the copy in the note's place, byte
  // for byte — and the open editor hears of it: the note is text again, and
  // shows what was typed.
  await banner.getByRole('button', { name: 'Resolve conflict…' }).click();
  await expect(page.getByTestId('compare-modal')).toBeVisible();
  await expect(page.getByTestId('compare-not-text')).toBeVisible();
  await page.getByTestId('compare-adopt').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').last().click();
  await expect(page.getByTestId('compare-modal')).not.toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('editor-not-text')).toHaveCount(0);
  await expect(page.locator('.cm-content').first()).toContainText('Typed meanwhile.', { timeout: 20000 });
  expect(await page.evaluate(() => Object.keys((window as any).mockFs).filter((p) => p.startsWith('/test-vault/Start.CONFLICT-')).length)).toBe(0);
});

test('a text typed after the note is text again and loaded anew is kept in a copy of its own — the copy kept before stays as it is', async ({ page }) => {
  await open(page, 'Start');
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('A note in UTF-8.', { timeout: 20000 });
  const copiesNow = () => page.evaluate(() => {
    const fs = (window as any).mockFs;
    return Object.keys(fs).filter((p) => p.startsWith('/test-vault/Start.CONFLICT-')).sort().map((p) => ({ path: p, text: fs[p] as string }));
  });
  await page.evaluate((bytes) => { (window as any).mockFs['/test-vault/Start.md'] = { bytes }; }, OLD_NOTE);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('Typed meanwhile.');
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  const [first] = await copiesNow();
  expect(first.text).toContain('Typed meanwhile.');
  // The other program saves the note as UTF-8 again, and the editor loads it anew.
  await page.evaluate(() => {
    (window as any).mockFs['/test-vault/Start.md'] = '# Start\n\nA note in UTF-8 again.\n';
    window.dispatchEvent(new CustomEvent('plainva-external-update', { detail: { path: 'Start.md', vaultPath: '/test-vault' } }));
  });
  await expect(editor).toContainText('A note in UTF-8 again.', { timeout: 20000 });
  // Typed into that text — and before the save, the file is Windows-1252 once more.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('Typed later.');
  await page.evaluate((bytes) => { (window as any).mockFs['/test-vault/Start.md'] = { bytes }; }, OLD_NOTE);
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  // Another text, another copy: the one kept before is not written into.
  const copies = await copiesNow();
  expect(copies).toHaveLength(2);
  expect(copies.find((copy) => copy.path === first.path)?.text).toBe(first.text);
  expect(copies.find((copy) => copy.path !== first.path)?.text).toContain('Typed later.');
});

/** The draft journal's file name for a path (`pathHash` in src/services/draftJournal.ts). */
function journalHash(input: string): string {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    lo ^= input.charCodeAt(i);
    const loNew = (lo >>> 0) * 0x1b3 + (((hi >>> 0) * 0x1b3) % 0x100000000) * 0x100000000;
    hi = Math.floor(loNew / 0x100000000) % 0x100000000;
    lo = loNew % 0x100000000;
  }
  return ((hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0'));
}

/** The draft journal as an earlier run left it: an editor held changes to Alt.md when the app went — in an older journal's shape, with a mark and `\r\n`. */
const JOURNAL = `/drafts/${journalHash('/test-vault')}/${journalHash('Alt.md')}.json`;
const LEFT_UNSAVED = { vaultPath: '/test-vault', notePath: 'Alt.md', text: `${String.fromCharCode(0xfeff)}# Alt\r\n\r\nLeft unsaved.\r\n`, revision: 3, savedAt: 1, sessionId: 'earlier' };

/** Opens Alt.md over that journal and waits for the copy the draft was kept in; hands back the copies beside the note. */
async function openOverJournal(page: any) {
  await page.addInitScript(({ journal, entry }: { journal: string; entry: typeof LEFT_UNSAVED }) => {
    (window as any).mockFs[journal] = JSON.stringify({ version: 2, entries: [entry] });
  }, { journal: JOURNAL, entry: LEFT_UNSAVED });
  await open(page, 'Alt');
  await expect(page.getByTestId('editor-not-text')).toBeVisible({ timeout: 20000 });
  const copies = () => page.evaluate(() => {
    const fs = (window as any).mockFs;
    return Object.keys(fs).filter((p) => p.startsWith('/test-vault/Alt.CONFLICT-')).map((p) => ({ path: p, text: fs[p] }));
  }) as Promise<{ path: string; text: string }[]>;
  // Kept in the editor's shape: the old journal's mark and line ends do not come along.
  await expect.poll(async () => (await copies()).map((copy) => copy.text)).toEqual(['# Alt\n\nLeft unsaved.\n']);
  const [kept] = await copies();
  const banner = page.locator('.pv-banner', { hasText: kept.path.replace('/test-vault/', '') });
  await expect(banner).toBeVisible();
  return { copies, banner };
}

/** Loads Alt.md anew, and proves it did: the banner, dismissed first, comes back with the load. */
async function loadAgain(page: any, banner: any) {
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-external-update', { detail: { path: 'Alt.md', vaultPath: '/test-vault' } })));
  await expect(page.getByTestId('editor-not-text')).toBeVisible();
  await expect(banner).toBeVisible();
}

test('a draft an earlier run of the app journalled for a note that is no text now is kept beside it, as a conflict copy the banner names', async ({ page }) => {
  const { copies, banner } = await openOverJournal(page);
  // The note stays as it lies there, and the journal lets go of the draft it kept.
  await untouched(page);
  await expect.poll(() => page.evaluate((path: string) => (window as any).mockFs[path], JOURNAL)).toBeUndefined();
  // Loaded anew, nothing is kept a second time.
  await loadAgain(page, banner);
  expect(await copies()).toHaveLength(1);
});

test('a draft an earlier run journalled is kept once in a run, though the journal could not let go of it', async ({ page }) => {
  // The journal cannot remove the entry: it is still there at the next load.
  await page.addInitScript(() => {
    const tauri = (window as any).__TAURI_INTERNALS__;
    const invoke = tauri.invoke;
    tauri.invoke = async (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:fs|remove' && String(args?.path ?? '').startsWith('/drafts/')) throw new Error('refused');
      return invoke(cmd, args, options);
    };
  });
  const { copies, banner } = await openOverJournal(page);
  await loadAgain(page, banner);
  expect(await page.evaluate((path: string) => (window as any).mockFs[path], JOURNAL)).toBeDefined();
  expect(await copies()).toHaveLength(1);
});

const COPY = '/test-vault/Data.CONFLICT-2026-10-11T08-00-00-000Z.csv';
const COPY_BYTES = WINDOWS_1252('id;name\r\n1;Grün\r\n2;Blau\r\n3;Weiß\r\n');

test('the copy a sync left beside such a table takes its place byte for byte from the comparison, and the table it replaces is kept', async ({ page }) => {
  await page.addInitScript(({ COPY, COPY_BYTES }) => { (window as any).mockFs[COPY] = { bytes: COPY_BYTES }; }, { COPY, COPY_BYTES });
  await page.goto('/');
  await expect(page.getByText('Start', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  const copy = page.getByTestId('file-tree').getByText(/Data\.CONFLICT-/);
  await expect(copy).toBeVisible();
  await copy.click({ button: 'right' });
  await page.getByTestId('tree-resolve-conflict').click();
  await expect(page.getByTestId('compare-modal')).toBeVisible();
  // Nothing of either file is shown — and the three exits are there.
  await expect(page.getByTestId('compare-not-text')).toBeVisible();
  await expect(page.locator('.pv-merge-host')).toHaveCount(0);
  await page.getByTestId('compare-adopt').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').last().click();
  await expect(page.getByTestId('compare-modal')).not.toBeVisible({ timeout: 10000 });
  const state = await page.evaluate((copyPath) => {
    const fs = (window as any).mockFs;
    const kept = Object.keys(fs).filter((p) => p.startsWith('/test-vault/.plainva/backups/') && p.includes('Data.csv'));
    return { table: fs['/test-vault/Data.csv'], copy: fs[copyPath], kept: kept.map((p) => fs[p]) };
  }, COPY);
  expect(state.table).toEqual({ bytes: COPY_BYTES });
  expect(state.copy).toBeUndefined();
  // The table it replaced is in the version history, byte for byte.
  expect(state.kept).toContainEqual({ bytes: TABLE });
});

/**
 * A draft journal file of the old name (open-items plan 3.124). The old hash
 * gave "Kapitel 1.md" and "Kapitel 2.md" one file name: a draft of the one was
 * offered at the other, and restoring it wrote it into the wrong note. Files of
 * the old name are still read — each entry only at the note it names.
 */
test('a draft in a journal file of the old name is offered at its own note — never at a note whose name differs only at the end', async ({ page }) => {
  const journal = `/drafts/${journalHash('/test-vault')}/${journalHash('Kapitel 1.md')}.json`;
  expect(journalHash('Kapitel 2.md')).toBe(journalHash('Kapitel 1.md'));
  await page.addInitScript(({ journal }) => {
    const fs = (window as any).mockFs;
    fs['/test-vault/Kapitel 1.md'] = '# Kapitel 1\n\nSaved.\n';
    fs['/test-vault/Kapitel 2.md'] = '# Kapitel 2\n\nSaved.\n';
    fs[journal] = JSON.stringify({ version: 2, entries: [
      { vaultPath: '/test-vault', notePath: 'Kapitel 1.md', text: '# Kapitel 1\n\nLeft unsaved.\n', revision: 3, savedAt: 1, sessionId: 'earlier' },
    ] });
  }, { journal });
  const restore = page.getByRole('button', { name: 'Restore draft' });
  // Its own note offers it…
  await open(page, 'Kapitel 1');
  await expect(restore).toBeVisible({ timeout: 20000 });
  // …the note next to it does not.
  await page.getByTestId('file-tree').getByText('Kapitel 2', { exact: true }).click();
  await expect(page.locator('.cm-content').first()).toContainText('Kapitel 2', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await expect(restore).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('draft-journal-desktop-neighbour.png') });
  // Back at its own note it is offered again, and restoring it lands there.
  await page.getByTestId('file-tree').getByText('Kapitel 1', { exact: true }).click();
  await expect(restore).toBeVisible({ timeout: 20000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('draft-journal-desktop-own.png') });
  await restore.click();
  await expect(page.locator('.cm-content').first()).toContainText('Left unsaved.');
  await expect.poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Kapitel 1.md']), { timeout: 20000 }).toContain('Left unsaved.');
  expect(await page.evaluate(() => (window as any).mockFs['/test-vault/Kapitel 2.md'])).toBe('# Kapitel 2\n\nSaved.\n');
});
