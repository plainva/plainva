/**
 * What index format 9 costs where it runs once (Gesamtplan Leistung L1):
 * numbering a format-8 index of the 10 000-note fixture at the first start,
 * and numbering after an older build wrote to it (a downgrade and back).
 * Also the point reads by number against the same reads by path.
 *
 *   pnpm --filter @plainva/core exec tsx scripts/perf/numbering-cost.ts [--count 10000] [--json out.json]
 *
 * Disk and node:sqlite. The phone's adapter sends the numbering's reads as two
 * queries and its writes as one `executeSet`: the bridge adds a few calls, the
 * time is SQLite's.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { initializeSchema } from "../../src/db/Schema.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../../src/vault/VaultQueryService.js";
import { NodeSqlitePort } from "./coreBenchmark.js";
import { writeFixtureVault } from "./fixtureVault.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const args = process.argv.slice(2);
const count = Number(args.includes("--count") ? args[args.indexOf("--count") + 1] : 10_000);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-numbering-"));
const ms = (t: number) => Number((performance.now() - t).toFixed(1));
const out: Record<string, unknown> = { count };
try {
  const vault = path.join(root, "vault");
  await writeFixtureVault(vault, { count, longTableNote: false });
  const dbPath = path.join(root, "index.sqlite");
  const open = (file: string) => {
    const db = new NodeSqlitePort(new DatabaseSync(file));
    db.raw.exec("PRAGMA journal_mode=WAL");
    db.raw.exec("PRAGMA synchronous=NORMAL");
    return db;
  };
  let db = open(dbPath);
  await db.initialize();
  await new VaultIndexer(new LocalVaultAdapter(vault), db).indexVaultFull();
  db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await db.close();

  // An index of format 8: the same rows, numbered by SQLite, files naming none.
  const eight = path.join(root, "eight.sqlite");
  await fs.copyFile(dbPath, eight);
  db = open(eight);
  // A format-8 index has no triggers of format 9 (and SQLite refuses the rename while one names the table).
  db.raw.exec(`DROP TRIGGER IF EXISTS files_takes_its_full_text_row; DROP TRIGGER IF EXISTS files_full_text_row_goes; DROP TRIGGER IF EXISTS files_written_by_older_index;`);
  db.raw.exec(`CREATE VIRTUAL TABLE fts_old USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1');
    INSERT INTO fts_old (content, title, path, seg_content, seg_title) SELECT content, title, path, seg_content, seg_title FROM fts_notes WHERE rowid <> 0 ORDER BY rowid DESC;
    DROP TABLE fts_notes; ALTER TABLE fts_old RENAME TO fts_notes;
    UPDATE files SET fts_rowid = NULL; UPDATE meta SET value = '8' WHERE key = 'index_format_version';
    PRAGMA wal_checkpoint(TRUNCATE);`);
  await db.close();
  db = open(eight);
  let t = performance.now();
  await initializeSchema(db);
  out.numberFormatEightMs = ms(t);
  t = performance.now();
  await initializeSchema(db);
  out.startWithNothingToDoMs = ms(t);
  // For comparison: what a copy of the whole table under new numbers costs (the first design).
  t = performance.now();
  db.raw.exec(`CREATE VIRTUAL TABLE fts_copy USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1');
    INSERT INTO fts_copy (rowid, content, title, path, seg_content, seg_title) SELECT -rowid, content, title, path, seg_content, seg_title FROM fts_notes;`);
  out.copyWholeTableMs = ms(t);
  db.raw.exec("DROP TABLE fts_copy");
  await db.close();

  // A downgrade: an older build saves 50 notes (its statements), then this build starts.
  db = open(dbPath);
  const paths = (await db.query<{ path: string }>(`SELECT path FROM files WHERE path LIKE '%.md' ORDER BY rowid LIMIT 50`)).map((r) => r.path);
  for (const p of paths) {
    const text = await fs.readFile(path.join(vault, ...p.split("/")), "utf8");
    await db.execute(`DELETE FROM files WHERE id = ? OR path = ?`, [`older:${p}`, p]);
    await db.execute(`DELETE FROM fts_notes WHERE path = ?`, [p]);
    await db.execute(`INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, ?, 'h', 1, 1, 1, 1, 'obsidian', 'synced')`, [`older:${p}`, p, p]);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, '', '')`, [text, p, p]);
  }
  t = performance.now();
  await initializeSchema(db);
  out.numberAfterDowngradeMs = ms(t);
  out.downgradedNotes = paths.length;

  // Point reads: 500 cards by number (now) and by path (before).
  const query = new VaultQueryService(db);
  const cards = (await db.query<{ path: string }>(`SELECT path FROM files WHERE path LIKE '%.md' ORDER BY path LIMIT 500`)).map((r) => r.path);
  t = performance.now();
  await query.getCardData(cards);
  out.cardData500ByNumberMs = ms(t);
  t = performance.now();
  await db.query(`SELECT path, content FROM fts_notes WHERE path IN (${cards.map(() => "?").join(",")})`, cards);
  out.cardData500ByPathMs = ms(t);
  t = performance.now();
  await query.searchFullText("project", 50, 0, true);
  out.searchWithSourceMs = ms(t);
  t = performance.now();
  await db.query(`SELECT f.path, (SELECT content FROM fts_notes WHERE path = f.path LIMIT 1) AS c FROM fts_notes fn JOIN files f ON f.path = fn.path WHERE fts_notes MATCH 'project' LIMIT 50`);
  out.searchWithSourceByPathMs = ms(t);
  await db.close();
  console.log(JSON.stringify(out, null, 2));
  if (args.includes("--json")) await fs.writeFile(path.resolve(args[args.indexOf("--json") + 1]), JSON.stringify(out, null, 2) + "\n");
} catch (error) {
  console.error("numbering-cost failed:", error);
  process.exitCode = 1;
} finally {
  // Windows can hold a closed database file a moment longer; the folder is a temp folder.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) => console.warn(`could not remove ${root}:`, error));
}
