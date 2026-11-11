/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { fixtureFiles } from '../../../../packages/core/scripts/perf/fixtureVault';

/**
 * A stand-in for the Tauri side with a REAL SQLite behind it (performance plan
 * L0): the vault is the fixture vault held in the page, and every SQL
 * statement goes to `node:sqlite` in the test process, so the index, the
 * search and the editor run their own code on real data. Shared by the
 * browser measurement (`e2e-perf/`) and the E2E of the first open of a vault
 * (`first-open.spec.ts`, performance plan L3).
 *
 * The reads of the index can be held (`holdIndexReads`): a test then sees the
 * app while its first index is being built, for as long as it needs to.
 */

export const STAND_IN_VAULT = '/perf-vault';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** The notes and databases of the fixture; attachments stay out (the stand-in reads text). Two notes are copied to the vault root, so the tree shows them without opening a folder. */
export function standInFiles(count: number, longSections: number): Record<string, string> {
  const files: Record<string, string> = {};
  let start: string | null = null;
  for (const file of fixtureFiles({ count })) {
    if (typeof file.data !== 'string') continue;
    files[file.path] = file.data;
    if (!start && file.path.startsWith('Projects/') && file.data.length > 2000) start = file.data;
  }
  const long = files['Resources/Long table note.md'];
  delete files['Resources/Long table note.md'];
  files['Long table note.md'] = long.split(/(?=^## Section )/m).slice(0, longSections + 1).join('');
  files['Start note.md'] = start ?? '# Start note\n';
  return files;
}

export type SqlBridge = (cmd: string, args: any) => unknown;

export function sqlBridge(): SqlBridge {
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

export interface StandInOptions {
  /** Answer `read_files_for_index` as the desktop's Rust side does (default true). */
  manyAtOnce?: boolean;
  /** Hold the index's reads from the start, until `releaseIndexReads` (needs `manyAtOnce`). */
  holdIndexReads?: boolean;
}

export async function installStandIn(page: Page, files: Record<string, string>, sql: SqlBridge, options: StandInOptions = {}) {
  await page.exposeFunction('__perfSql', (cmd: string, args: any) => sql(cmd, args));
  await page.addInitScript(({ files, root, manyAtOnce, holdAtStart }) => {
    const fs: Record<string, any> = { [root]: { isDir: true }, [`${root}/.plainva`]: { isDir: true } };
    for (const [rel, text] of Object.entries(files)) {
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) fs[`${root}/${parts.slice(0, i).join('/')}`] = { isDir: true };
      fs[`${root}/${rel}`] = text;
    }
    (window as any).mockFs = fs;
    // Reads of files for the index wait while this is a promise (`holdIndexReads`).
    (window as any).__indexReadsHeld = null;
    (window as any).__holdIndexReads = () => {
      let release: () => void = () => {};
      (window as any).__indexReadsHeld = new Promise<void>((resolve) => { release = resolve; });
      (window as any).__releaseIndexReads = () => { (window as any).__indexReadsHeld = null; release(); };
    };
    if (holdAtStart) (window as any).__holdIndexReads();
    const held = async () => { while ((window as any).__indexReadsHeld) await (window as any).__indexReadsHeld; };
    const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
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
      if (cmd === 'read_files_for_index') {
        if (!manyAtOnce) throw new Error('unknown command read_files_for_index');
        await held();
        const base = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
        return Promise.all((args.files as { relPath: string; text: boolean }[]).map(async (request) => {
          const content = fs[`${base}/${request.relPath}`];
          if (typeof content !== 'string') return { kind: 'fallback' };
          const sha256 = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
          return request.text ? { kind: 'text', text: content, sha256 } : { kind: 'bytes', sha256 };
        }));
      }
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
  }, { files, root: STAND_IN_VAULT, manyAtOnce: options.manyAtOnce ?? true, holdAtStart: options.holdIndexReads ?? false });
}

/** Holds every read of files for the index (`read_files_for_index`) until `releaseIndexReads`; the listing and the app's own reads go on. */
export async function holdIndexReads(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__holdIndexReads());
}

export async function releaseIndexReads(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__releaseIndexReads?.());
}
