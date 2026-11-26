/**
 * What one save costs the index, with and without the note's row of the task
 * table (db/noteTasks.ts), measured in turns on the same index so that the
 * machine's own spread falls on both alike: blocks of saves of the same note,
 * the task row written in every other block. Reports median and 95th
 * percentile of each, and the parts of the task row alone (reading the
 * task lines, and the statement).
 *
 *   pnpm --filter @plainva/core exec tsx scripts/perf/save-cost.ts [notes] [rounds]
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { noteTasksOf } from "../../src/db/noteTasks.js";
import { NodeSqlitePort } from "./coreBenchmark.js";
import { writeFixtureVault } from "./fixtureVault.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const count = Number(process.argv[2] ?? 10_000);
const rounds = Number(process.argv[3] ?? 20);
const perBlock = 20;

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const p95 = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-save-cost-"));
  try {
    const vaultPath = path.join(root, "vault");
    await writeFixtureVault(vaultPath, { count, longTableNote: false });
    const db = new NodeSqlitePort(new DatabaseSync(path.join(root, "index.sqlite")));
    db.raw.exec("PRAGMA journal_mode=WAL");
    db.raw.exec("PRAGMA synchronous=NORMAL");
    await db.initialize();
    const adapter = new LocalVaultAdapter(vaultPath);
    const indexer = new VaultIndexer(adapter, db);
    await indexer.indexVaultFull();
    const savePath = (await db.queryOne<{ path: string }>(
      `SELECT path FROM files WHERE path LIKE 'Projects/%' AND path LIKE '%.md' AND size_bytes BETWEEN 1500 AND 5000 ORDER BY path LIMIT 1`,
    ))!.path;
    const original = await adapter.readTextFile(savePath);
    const own = indexer as unknown as { writeNoteTasks: (...args: unknown[]) => Promise<void> };
    const write = own.writeNoteTasks.bind(indexer);
    const withRow: number[] = [];
    const without: number[] = [];
    let edit = 0;
    for (let round = 0; round < rounds; round++) {
      for (const on of round % 2 === 0 ? [true, false] : [false, true]) {
        own.writeNoteTasks = on ? write : async () => {};
        for (let k = 0; k < perBlock; k++) {
          await adapter.writeTextFile(savePath, `${original}\nEdit ${edit++}: another line about the review.\n- [ ] a task of edit ${edit}\n`);
          const start = performance.now();
          await indexer.indexPath(savePath);
          (on ? withRow : without).push(performance.now() - start);
        }
      }
    }
    own.writeNoteTasks = write;
    await adapter.writeTextFile(savePath, original);
    await indexer.indexPath(savePath);
    // The parts of the row alone: reading the task lines of this note, and the statement.
    const text = await adapter.readTextFile(savePath);
    const scans: number[] = [];
    for (let k = 0; k < 400; k++) { const s = performance.now(); noteTasksOf(text); scans.push(performance.now() - s); }
    const row = noteTasksOf(text);
    const statements: number[] = [];
    for (let k = 0; k < 400; k++) {
      const s = performance.now();
      await db.execute(`INSERT OR REPLACE INTO note_tasks (file_rowid, sha256, reading, excluded, tasks) SELECT rowid, sha256, 1, ?, ? FROM files WHERE path = ?`, [row.excluded ? 1 : 0, row.tasks, savePath]);
      statements.push(performance.now() - s);
    }
    const fmt = (v: number) => v.toFixed(2);
    console.log(JSON.stringify({
      notes: count,
      saves: { withRow: withRow.length, without: without.length },
      withRow: { p50: fmt(median(withRow)), p95: fmt(p95(withRow)) },
      without: { p50: fmt(median(without)), p95: fmt(p95(without)) },
      rowParts: { readTasksP50: fmt(median(scans)), statementP50: fmt(median(statements)), noteBytes: text.length, tasks: JSON.parse(row.tasks || "[]").length },
    }, null, 2));
    await db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void main();
