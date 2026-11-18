import { createRequire } from "node:module";
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../../src/db/Schema.js";
import { INSERT_FULL_TEXT_ROW } from "../../src/db/fullTextRows.js";
import { segmentedIndexText } from "../../src/vault/spacelessText.js";
// See realSqlite.ts: the builtin is loaded through Node itself.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * A vault's index database in a real SQLite FILE, with the words each driver
 * uses for a failure — so that a page of it can be destroyed on the disk
 * between two opens (`destroyLeafPage`), as a damaged file is.
 */
/** `ios-plain`: every failure only as SQLite's generic words for a damaged page, as iOS may pass them on. */
export type Mode = "desktop" | "ios" | "ios-plain";
const dirs: string[] = [];
/** Removes the folders `seededFile` made. */
export function removeSeededFiles(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function fileDatabase(file: string, mode: Mode): IDatabaseAdapter & { close(): Promise<void> } {
  const sqlite = new DatabaseSync(file);
  const said = (error: unknown): Error => {
    const e = error as { errcode?: number; message?: string };
    const message = String(e?.message ?? error);
    if (mode === "ios-plain" && ((e?.errcode ?? 0) & 0xff) === 11) return new Error("Error: prepareSQL step failed rc: 11 message: database disk image is malformed");
    if (mode !== "desktop") return new Error(`Error: prepareSQL step failed rc: ${(e?.errcode ?? 1) & 0xff} message: ${message}`);
    return new Error(`error returned from database: (code: ${e?.errcode ?? "?"}) ${message}`);
  };
  const run = <T>(f: () => T): T => {
    try { return f(); } catch (error) { throw said(error); }
  };
  const statements: SqlStatements = {
    execute: async (sql, params = []) => { run(() => sqlite.prepare(sql).run(...(params as never[]))); },
    query: async (sql, params = []) => run(() => sqlite.prepare(sql).all(...(params as never[]))) as never,
    queryOne: async (sql, params = []) => (run(() => sqlite.prepare(sql).get(...(params as never[]))) ?? null) as never,
  };
  const batch = (list: BatchStatement[]) => { for (const st of list) run(() => sqlite.prepare(st.sql).run(...((st.params ?? []) as never[]))); };
  return {
    ...statements,
    async initialize() {},
    async close() { sqlite.close(); },
    async runBatch(list) {
      sqlite.exec("BEGIN");
      try { batch(list); sqlite.exec("COMMIT"); } catch (error) { if (sqlite.isTransaction) sqlite.exec("ROLLBACK"); throw error; }
    },
    async transaction(fn) {
      sqlite.exec("BEGIN");
      try { const result = await fn({ ...statements, runBatch: async (list) => batch(list) }); sqlite.exec("COMMIT"); return result; }
      catch (error) { if (sqlite.isTransaction) sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

/** A vault's index with `n` notes, written the way the indexer writes them, a sync state and a queued push. */
export async function seededFile(n = 300): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "plainva-fts-page-"));
  dirs.push(dir);
  const file = join(dir, "index.db");
  const db = fileDatabase(file, "desktop");
  await initializeSchema(db);
  const list: BatchStatement[] = [];
  for (let i = 0; i < n; i++) {
    const path = `N${i}.md`;
    const content = `note ${i} body alpha${i} ${"word ".repeat(40)}`;
    list.push({ sql: `INSERT INTO files (id, path, title, sha256, mtime_local, size_bytes, is_cached, fts_rowid) VALUES (?, ?, ?, ?, ?, ?, 1, 0)`, params: [`id${i}`, path, `N${i}`, `h${i}`, 1000 + i, 10] });
    list.push({ sql: INSERT_FULL_TEXT_ROW, params: [content, `N${i}`, path, segmentedIndexText(content), segmentedIndexText(`N${i}`), path] });
    list.push({ sql: `INSERT INTO sync_state (path, base_sha256, remote_etag) VALUES (?, ?, ?)`, params: [path, `h${i}`, `e${i}`] });
  }
  list.push({ sql: `INSERT INTO offline_queue (file_path, operation) VALUES ('N0.md', 'push')` });
  await db.runBatch!(list);
  await db.close();
  return file;
}

/** Destroys one leaf page of `table`'s storage on the disk, the middle one: its root stays whole. */
export function destroyLeafPage(file: string, table: string) {
  const look = new DatabaseSync(file);
  const pageSize = Number((look.prepare(`PRAGMA page_size`).get() as { page_size: number }).page_size);
  const pages = (look.prepare(`SELECT pageno FROM dbstat WHERE name = ? AND pagetype = 'leaf' ORDER BY pageno`).all(table) as { pageno: number }[]).map((p) => p.pageno);
  look.close();
  expect(pages.length, `${table} has leaf pages to destroy`).toBeGreaterThan(2);
  const page = pages[Math.floor(pages.length / 2)];
  const junk = Buffer.alloc(pageSize - 200, 0xa7);
  const fd = openSync(file, "r+");
  writeSync(fd, junk, 0, junk.length, (page - 1) * pageSize + 100);
  closeSync(fd);
}

