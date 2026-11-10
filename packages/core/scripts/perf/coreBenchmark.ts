/**
 * The core measurements of the performance plan (Gesamtplan Leistung § 1 and
 * § 4, package L0) on the fixture vault (`fixtureVault.ts`), on disk and
 * against a real SQLite (`node:sqlite`): first index, a pass without changes,
 * reading one note again after a save, full-text search, listing every task,
 * the size of the index — and a calibration loop measured in the same run, so
 * a result can be read relative to the machine it ran on (`core-gate.ts`).
 *
 * Disk and SQLite only: no Tauri IPC, no WebView, no native code. Never
 * touches a user's vault; everything lives in a fresh folder.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { initializeSchema } from "../../src/db/Schema.js";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../../src/vault/VaultQueryService.js";
import { parseMarkdownAst } from "../../src/markdown-parser.js";
import { writeFixtureVault, type FixtureSummary } from "./fixtureVault.js";

type DatabaseSyncT = InstanceType<typeof import("node:sqlite").DatabaseSync>;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * The adapter the desktop's indexer meets, as far as SQLite goes: statements
 * one by one, a batch as one savepoint (the shape `db_batch` runs natively).
 */
export class NodeSqlitePort implements IDatabaseAdapter {
  constructor(readonly raw: DatabaseSyncT) {}
  async initialize() { await initializeSchema(this); }
  async close() { this.raw.close(); }
  async execute(sql: string, params: unknown[] = []) { this.raw.prepare(sql).run(...(params as never[])); }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> { return this.raw.prepare(sql).all(...(params as never[])) as T[]; }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> { return (await this.query<T>(sql, params))[0] ?? null; }
  async transaction<T>(action: (tx: SqlStatements) => Promise<T>) {
    this.raw.exec("SAVEPOINT operation");
    try { const value = await action(this); this.raw.exec("RELEASE operation"); return value; }
    catch (error) { this.raw.exec("ROLLBACK TO operation; RELEASE operation"); throw error; }
  }
  async runBatch(statements: BatchStatement[]) {
    this.raw.exec("SAVEPOINT batch");
    try { for (const statement of statements) await this.execute(statement.sql, (statement.params ?? []) as unknown[]); this.raw.exec("RELEASE batch"); }
    catch (error) { this.raw.exec("ROLLBACK TO batch; RELEASE batch"); throw error; }
  }
}

export interface CoreMetrics {
  /** First index of the whole vault into an empty index, ms. */
  coldIndexMs: number;
  /** A full pass that finds nothing changed, ms (median of 3). */
  warmIndexMs: number;
  /** One note saved and read again (`indexPath`), median and 95th percentile of 40, ms. */
  saveP50Ms: number;
  saveP95Ms: number;
  /** Full-text search, first 50 hits: median over 6 queries × 7 rounds, ms. */
  searchMs: number;
  /** `listTasks`, median of 5, ms. */
  listTasksMs: number;
  /** Size of the index database file after the cold index, bytes. */
  dbBytes: number;
}

export interface CoreResult {
  meta: { date: string; node: string; os: string; cpu: string; logicalCpus: number; totalMemory: number; wal: boolean };
  fixture: FixtureSummary & { count: number };
  shape: Record<string, number>;
  /** The calibration loop of this run, ms (median of three: before, between, after). */
  calibrationMs: number;
  calibrationSamplesMs: number[];
  metrics: CoreMetrics;
  /** Other numbers worth keeping, not gated. */
  extra: Record<string, number>;
  boundary: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round = (ms: number) => Number(ms.toFixed(2));
async function time<T>(action: () => Promise<T> | T): Promise<[number, T]> {
  const start = performance.now();
  const value = await action();
  return [performance.now() - start, value];
}

const CALIBRATION_TEXT = Array.from({ length: 40 }, (_, i) =>
  `## Part ${i}\n\nA paragraph with [[Link ${i}]], #tag${i % 7} and **bold** text.\n\n- [ ] task ${i} 📅 2026-01-0${(i % 9) + 1}\n- [x] done ${i}\n\n| a | b |\n|---|---|\n| ${i} | x |\n`,
).join("\n");

/**
 * A fixed piece of the work the measured code does — Markdown parsing in
 * JavaScript, full-text inserts, deletes and queries in SQLite on a file in
 * the same folder — so that its duration tracks the speed of this machine
 * for exactly that mix. About a second on a recent laptop.
 */
export async function calibrate(dir: string): Promise<number> {
  const file = path.join(dir, `calibration-${process.pid}-${Math.round(performance.now())}.sqlite`);
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(content, title, path UNINDEXED, tokenize = 'unicode61 remove_diacritics 1');
             CREATE TABLE f (id INTEGER PRIMARY KEY, path TEXT UNIQUE, n INTEGER)`);
    const start = performance.now();
    for (let i = 0; i < 40; i++) parseMarkdownAst(CALIBRATION_TEXT, { preserveObsidianSyntax: true });
    db.exec("BEGIN");
    const insert = db.prepare("INSERT INTO t (rowid, content, title, path) VALUES (?, ?, ?, ?)");
    const row = db.prepare("INSERT INTO f (id, path, n) VALUES (?, ?, ?)");
    for (let i = 1; i <= 3000; i++) {
      insert.run(i, `${CALIBRATION_TEXT.slice((i * 37) % 2000, ((i * 37) % 2000) + 600)} note${i}`, `Title ${i}`, `p/${i}.md`);
      row.run(i, `p/${i}.md`, i);
    }
    db.exec("COMMIT");
    const search = db.prepare("SELECT path FROM t WHERE t MATCH ? ORDER BY bm25(t) LIMIT 50");
    for (let i = 0; i < 60; i++) search.all(`part* OR tag${i % 7}`);
    db.exec("BEGIN");
    const remove = db.prepare("DELETE FROM t WHERE rowid = ?");
    for (let i = 1; i <= 3000; i += 3) remove.run(i);
    db.exec("COMMIT");
    return performance.now() - start;
  } finally {
    db.close();
    await fs.rm(file, { force: true });
  }
}

export interface CoreBenchmarkOptions {
  count: number;
  /** A fresh folder for the vault and the index; created when missing, must be empty. */
  root: string;
  /** Run the index database in WAL mode with `synchronous=NORMAL`, as the desktop does. */
  wal?: boolean;
  log?: (line: string) => void;
}

const SEARCHES = ["project", "Müller", "review meeting", "garden*", "Übersicht", "議事録"];

export async function runCoreBenchmark(options: CoreBenchmarkOptions): Promise<CoreResult> {
  const log = options.log ?? (() => {});
  const wal = options.wal ?? true;
  await fs.mkdir(options.root, { recursive: true });
  const vaultPath = path.join(options.root, "vault");
  const calibrationSamplesMs: number[] = [];
  calibrationSamplesMs.push(await calibrate(options.root));
  log(`calibration ${calibrationSamplesMs[0].toFixed(0)} ms`);

  // Without the note of 80 tables: see FixtureOptions.longTableNote.
  const fixture = await writeFixtureVault(vaultPath, { count: options.count, longTableNote: false });
  log(`fixture: ${fixture.notes} notes, ${fixture.attachments} attachments, ${fixture.bases} bases, ${(fixture.bytes / 1e6).toFixed(1)} MB, digest ${fixture.digest.slice(0, 12)}`);

  const dbPath = path.join(options.root, "index.sqlite");
  const db = new NodeSqlitePort(new DatabaseSync(dbPath));
  if (wal) { db.raw.exec("PRAGMA journal_mode=WAL"); db.raw.exec("PRAGMA synchronous=NORMAL"); }
  const extra: Record<string, number> = {};
  const [schemaMs] = await time(() => db.initialize());
  extra.schemaMs = round(schemaMs);
  const adapter = new LocalVaultAdapter(vaultPath);
  const indexer = new VaultIndexer(adapter, db);

  const [coldIndexMs] = await time(() => indexer.indexVaultFull());
  log(`cold index ${(coldIndexMs / 1000).toFixed(1)} s`);
  const shape: Record<string, number> = {};
  for (const table of ["files", "fts_notes", "links", "tags", "properties"]) {
    shape[table] = Number((await db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n);
  }
  if (shape.fts_notes !== fixture.notes || shape.files !== fixture.notes + fixture.attachments + fixture.bases) {
    throw new Error(`The index does not hold the fixture: ${JSON.stringify(shape)} for ${JSON.stringify(fixture)}`);
  }
  db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const dbBytes = (await fs.stat(dbPath)).size;

  calibrationSamplesMs.push(await calibrate(options.root));

  const warm: number[] = [];
  for (let k = 0; k < 3; k++) warm.push((await time(() => indexer.indexVaultFull()))[0]);
  log(`warm pass ${median(warm).toFixed(0)} ms`);

  // A save: a medium note of a project folder, rewritten 40 times.
  const savePath = (await db.queryOne<{ path: string }>(
    `SELECT path FROM files WHERE path LIKE 'Projects/%' AND path LIKE '%.md' AND size_bytes BETWEEN 1500 AND 5000 ORDER BY path LIMIT 1`,
  ))!.path;
  const original = await adapter.readTextFile(savePath);
  const saves: number[] = [];
  for (let k = 0; k < 40; k++) {
    await adapter.writeTextFile(savePath, `${original}\nEdit ${k}: another line about the review.\n`);
    saves.push((await time(() => indexer.indexPath(savePath)))[0]);
  }
  await adapter.writeTextFile(savePath, original);
  await indexer.indexPath(savePath);
  log(`save p50 ${median(saves).toFixed(1)} ms, p95 ${percentile(saves, 95).toFixed(1)} ms`);

  const service = new VaultQueryService(db);
  const searches: number[] = [];
  for (let round = 0; round < 7; round++) {
    for (const query of SEARCHES) {
      const [ms] = await time(() => service.searchFullText(query, 50));
      if (round > 0) searches.push(ms);
    }
  }
  log(`search median ${median(searches).toFixed(1)} ms`);
  for (const query of SEARCHES) extra[`search hits "${query}"`] = (await service.searchFullText(query, 50)).length;

  const tasks: number[] = [];
  let taskCount = 0;
  for (let k = 0; k < 5; k++) {
    const [ms, rows] = await time(() => service.listTasks());
    tasks.push(ms);
    taskCount = rows.length;
  }
  extra.tasksListed = taskCount;
  log(`listTasks ${median(tasks).toFixed(0)} ms (${taskCount} tasks)`);

  const [occurrenceMs] = await time(() => service.searchOccurrencesPage("project"));
  extra.occurrencePageMs = round(occurrenceMs);
  const [boardMs, boardRows] = await time(() =>
    service.queryDatabaseFiles({ filters: { and: ['file.inFolder("Projects")'] }, views: [{ type: "board", name: "Board", groupBy: "note.status", order: ["file.name", "file.tasks"] }] } as never),
  );
  extra.boardQueryMs = round(boardMs);
  extra.boardRows = (boardRows as unknown[]).length;

  calibrationSamplesMs.push(await calibrate(options.root));
  await db.close();

  return {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      os: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model.trim() ?? "unknown",
      logicalCpus: os.cpus().length,
      totalMemory: os.totalmem(),
      wal,
    },
    fixture: { ...fixture, count: options.count },
    shape,
    calibrationMs: round(median(calibrationSamplesMs)),
    calibrationSamplesMs: calibrationSamplesMs.map(round),
    metrics: {
      coldIndexMs: round(coldIndexMs),
      warmIndexMs: round(median(warm)),
      saveP50Ms: round(median(saves)),
      saveP95Ms: round(percentile(saves, 95)),
      searchMs: round(median(searches)),
      listTasksMs: round(median(tasks)),
      dbBytes,
    },
    extra,
    boundary: "Disk and SQLite core workload on node:sqlite; excludes Tauri IPC, the SQL plugin, WebView rendering, native code and process start.",
  };
}
