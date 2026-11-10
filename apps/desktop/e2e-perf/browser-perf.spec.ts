/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFiles, summarizeFixture } from '../../../packages/core/scripts/perf/fixtureVault';

/**
 * The browser measurement of the performance plan (Gesamtplan Leistung L0,
 * § 4, decision E4: a report, not a gate). The production bundle runs in
 * Chromium against a stand-in for the Tauri side: the vault is the fixture
 * vault held in memory, and every SQL statement goes to a REAL SQLite in the
 * test process (`node:sqlite`), so the index, the search and the editor run
 * their own code on real data.
 *
 * Measured:
 * - time to an editable note: from navigation until a note opened from the
 *   file tree takes typing — on an empty index (the first start) and on a
 *   warm one (the same index, the page loaded again);
 * - typing latency in the long note with tables: from each key's event to
 *   the frame after it, 95th percentile of about 60 keys. The note is the
 *   fixture's note of 80 tables cut to its first `PERF_LONG_SECTIONS`
 *   sections (default 8, about 2 000 lines): at its full 19 600 lines the
 *   page did not answer a key for ten minutes (Performance_Notes.md, "Many
 *   tables in one note"). Saves go to the stand-in, so the time includes the
 *   app's own save and re-index of the note;
 * - search: from typing a term into the sidebar search to the first hit.
 *
 * Not measured: Tauri IPC and the Rust side (the stand-in answers at once),
 * a real disk, WebView2/WKWebView instead of Chromium. The numbers are a
 * lower bound for the app, comparable from run to run on one machine.
 */

const COUNT = Number(process.env.PERF_BROWSER_COUNT || 1000);
const VAULT = '/perf-vault';
const LONG_SECTIONS = Number(process.env.PERF_LONG_SECTIONS || 8);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'perf', 'browser-perf.json');

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** The notes and databases of the fixture; attachments stay out (the stand-in reads text). Two notes are copied to the vault root, so the tree shows them without opening a folder. */
function vaultFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  let start: string | null = null;
  for (const file of fixtureFiles({ count: COUNT })) {
    if (typeof file.data !== 'string') continue;
    files[file.path] = file.data;
    if (!start && file.path.startsWith('Projects/') && file.data.length > 2000) start = file.data;
  }
  const long = files['Resources/Long table note.md'];
  delete files['Resources/Long table note.md'];
  files['Long table note.md'] = long.split(/(?=^## Section )/m).slice(0, LONG_SECTIONS + 1).join('');
  files['Start note.md'] = start ?? '# Start note\n';
  return files;
}

function sqlBridge() {
  const db = new DatabaseSync(':memory:');
  const plain = (row: unknown) => JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  return (cmd: string, args: any) => {
    if (cmd === 'plugin:sql|execute') {
      const result = db.prepare(String(args.query)).run(...((args.values ?? []) as never[]));
      return [Number(result.changes), Number(result.lastInsertRowid)];
    }
    if (cmd === 'plugin:sql|select') return plain(db.prepare(String(args.query)).all(...((args.values ?? []) as never[])));
    if (cmd === 'db_batch') {
      db.exec('BEGIN');
      try {
        for (const statement of args.statements as { sql: string; params: unknown[] }[]) db.prepare(statement.sql).run(...((statement.params ?? []) as never[]));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return null;
    }
    throw new Error(`not a SQL command: ${cmd}`);
  };
}

async function install(page: Page, files: Record<string, string>, sql: ReturnType<typeof sqlBridge>) {
  await page.exposeFunction('__perfSql', (cmd: string, args: any) => sql(cmd, args));
  await page.addInitScript(({ files, root }) => {
    const fs: Record<string, any> = { [root]: { isDir: true }, [`${root}/.plainva`]: { isDir: true } };
    for (const [rel, text] of Object.entries(files)) {
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) fs[`${root}/${parts.slice(0, i).join('/')}`] = { isDir: true };
      fs[`${root}/${rel}`] = text;
    }
    (window as any).mockFs = fs;
    const clean = (p: string) => (p.endsWith('/') ? p.slice(0, -1) : p);
    const invoke = async (cmd: string, args: any, options: any): Promise<any> => {
      if (cmd === 'plugin:path|normalize') return String(args.path).replace(/\\/g, '/').replace(/\/+/g, '/');
      if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
      if (cmd === 'plugin:app|version') return '9.9.9';
      if (cmd === 'plugin:store|load') return 1;
      if (cmd === 'plugin:store|get') {
        const key = String(args.key || '');
        if (key === 'lastVaultPath') return [root, true];
        if (key === 'recentVaults') return [[root], true];
        if (key === 'autoOpenLastVault') return [true, true];
        if (key === 'whatsNewSeenVersion') return ['9.9.9', true];
        if (key.startsWith('okfPromptDismissed_')) return [true, true];
        if (key.startsWith('backupZipEnabled_')) return [false, true];
        return [null, false];
      }
      if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
      if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
      if (cmd === 'plugin:dialog|message') return 'Ok';
      if (cmd === 'plugin:sql|load') return args.db;
      if (cmd === 'plugin:sql|execute' || cmd === 'plugin:sql|select' || cmd === 'db_batch') return (window as any).__perfSql(cmd, args);
      if (cmd === 'plugin:sql|select_one') return null;
      if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
      if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
        const base = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
        const rel = String(args.relPath).replace(/^\/+/, '');
        const p = rel ? `${base}/${rel}` : base;
        if (cmd === 'checked_path_exists') return !!fs[p];
        if (!fs[p]) return null;
        if (cmd === 'checked_read_dir') return (await invoke('plugin:fs|read_dir', { path: p }, {})).map((e: any) => ({ ...e, isFile: !e.isDirectory }));
        return fs[p];
      }
      if (cmd === 'plugin:fs|exists') return !!fs[clean(args.path)];
      if (cmd === 'plugin:fs|stat' || cmd === 'plugin:fs|lstat') {
        const file = fs[clean(args.path)];
        if (!file) throw new Error('File not found');
        return { isDir: !!file.isDir, isDirectory: !!file.isDir, isFile: !file.isDir, isSymlink: false, mtime: 1_700_000_000_000, birthtime: 1_700_000_000_000, size: typeof file === 'string' ? file.length : 0 };
      }
      if (cmd === 'plugin:fs|read_dir') {
        const p = clean(args.path);
        const entries: Record<string, any> = {};
        for (const key of Object.keys(fs)) {
          if (key !== p && key.startsWith(p + '/')) {
            const name = key.substring(p.length + 1).split('/')[0];
            if (!entries[name]) {
              const isDir = !!fs[`${p}/${name}`]?.isDir;
              entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
            }
          }
        }
        return Object.values(entries);
      }
      if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
        const raw = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
        const content = fs[clean(raw)];
        if (content === undefined || content.isDir) throw new Error('File not found');
        return Array.from(new TextEncoder().encode(content));
      }
      // Saves land in the stand-in's files, so typing measures the app's own
      // save and re-index of the note as well (the same forms the E2E suite uses).
      if (cmd === 'write_file_atomic') {
        const base = String(args.rootId).replace(/^mock-root:/, '');
        const rel = String(args.relPath).replace(/^\/+/, '');
        fs[base ? `${base}/${rel}` : rel] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
        return null;
      }
      if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
        const raw = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
        fs[clean(raw)] = new TextDecoder().decode(new Uint8Array(cmd === 'plugin:fs|write_text_file' ? args : args.data || args));
        return null;
      }
      if (cmd === 'plugin:fs|mkdir') {
        fs[clean(args.path)] = { isDir: true };
        return null;
      }
      if (cmd === 'plugin:fs|watch') return 1;
      return null;
    };
    (window as any).__TAURI_INTERNALS__ = { plugins: { path: { sep: '/' } }, transformCallback: () => 1, invoke };
  }, { files, root: VAULT });
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(1)) : null;
};

async function openFromTree(page: Page, title: string, heading: string): Promise<{ treeMs: number; editableMs: number }> {
  const started = Date.now();
  await page.goto('/');
  const item = page.getByText(title, { exact: true }).first();
  await expect(item).toBeVisible({ timeout: 300_000 });
  const treeMs = Date.now() - started;
  await item.click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor.getByText(heading).first()).toBeVisible({ timeout: 120_000 });
  return { treeMs, editableMs: Date.now() - started };
}

test('browser measurement at the built bundle (report)', async ({ page }, testInfo) => {
  const files = vaultFiles();
  const sql = sqlBridge();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await install(page, files, sql);
  const report: Record<string, unknown> = {
    date: new Date().toISOString(),
    fixture: { ...summarizeFixture({ count: COUNT }), inBrowser: Object.keys(files).length, longNoteLines: files['Long table note.md'].split('\n').length, longNoteTables: LONG_SECTIONS },
    boundary: 'Production bundle in Chromium; Tauri replaced by an in-page stand-in whose SQL runs on node:sqlite. No IPC, no Rust, no WebView2/WKWebView.',
  };

  const startHeading = (files['Start note.md'].match(/^# (.+)$/m) ?? [])[1] ?? 'Start note';
  const save = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  };
  report.firstStart = await openFromTree(page, 'Start note', startHeading);
  save();
  // The index is built in the background after the tree shows; the warm
  // start comes once it holds every note.
  await expect.poll(async () => Number((sql('plugin:sql|select', { query: 'SELECT count(*) AS n FROM fts_notes' }) as any)[0].n), { timeout: 300_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(COUNT);
  report.warmStart = await openFromTree(page, 'Start note', startHeading);
  save();

  // Typing in the long note with tables.
  await openFromTree(page, 'Long table note', 'Long table note');
  const editor = page.locator('.cm-content').first();
  await editor.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.evaluate(() => {
    (window as any).__keyLatency = [];
    document.addEventListener('keydown', (event) => {
      const at = event.timeStamp;
      requestAnimationFrame(() => setTimeout(() => (window as any).__keyLatency.push(performance.now() - at), 0));
    }, true);
  });
  await page.keyboard.type(' typing in a table row with measured keys', { delay: 40 });
  for (let i = 0; i < 18; i++) await page.keyboard.press('ArrowLeft', { delay: 40 });
  await page.waitForTimeout(300);
  const latency: number[] = await page.evaluate(() => (window as any).__keyLatency);
  report.typing = { keys: latency.length, p50Ms: percentile(latency, 50), p95Ms: percentile(latency, 95), maxMs: percentile(latency, 100) };
  save();

  // Search from the sidebar.
  const searches: Record<string, number> = {};
  for (const term of ['project', 'review meeting', 'Müller', 'garden']) {
    const field = page.locator('aside[aria-label="Left Sidebar"] input').first();
    await field.fill('');
    const started = Date.now();
    await field.fill(term);
    await expect(page.locator('[data-search-occurrence]').first()).toBeVisible({ timeout: 60_000 });
    searches[term] = Date.now() - started;
  }
  report.searchMs = searches;
  // A save the stand-in refused would leave the typing above without its save and re-index.
  report.saveFailedShown = await page.getByText(/Save failed|Speichern fehlgeschlagen/).count();
  report.pageErrors = errors;

  save();
  await testInfo.attach('browser-perf.json', { path: OUT, contentType: 'application/json' });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('browser-perf.png') });
  console.log(JSON.stringify(report, null, 2));
});
