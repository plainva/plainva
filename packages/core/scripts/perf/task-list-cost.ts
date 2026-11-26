/**
 * What listing every task costs in each state of the task table
 * (db/noteTasks.ts), against the list as it was before the table — the same
 * statement, word for word — in the same run, in turns, on one index of the
 * fixture vault: the fastest of each, after a warm-up.
 *
 *   pnpm --filter @plainva/core exec tsx scripts/perf/task-list-cost.ts [notes] [rounds]
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../../src/vault/VaultQueryService.js";
import { fillNoteTasks } from "../../src/db/noteTasks.js";
import { FULL_TEXT_ROW_IS_FILED } from "../../src/db/fullTextRows.js";
import { scanTasks } from "../../src/vault/taskScan.js";
import { readFrontmatterPath } from "../../src/frontmatter-surgical.js";
import { isHiddenPath } from "../../src/vault/internalPath.js";
import { NodeSqlitePort } from "./coreBenchmark.js";
import { writeFixtureVault } from "./fixtureVault.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const count = Number(process.argv[2] ?? 10_000);
const rounds = Number(process.argv[3] ?? 7);

/** The list as it was before the task table, statement for statement (without the journal's stamp: no daily notes here). */
async function asBefore(db: NodeSqlitePort): Promise<number> {
  const rows = await db.query<{ path: string; title: string | null; content: string | null }>(
    `SELECT path, title, content FROM fts_notes WHERE ${FULL_TEXT_ROW_IS_FILED} ORDER BY rowid DESC`, [],
  );
  const out: unknown[] = [];
  for (const r of rows) {
    if (!r.path || isHiddenPath(r.path)) continue;
    const content = r.content ?? "";
    const scanned = scanTasks(content);
    if (scanned.length === 0) continue;
    const title = r.title || r.path.split("/").pop()!.replace(/\.md$/i, "");
    const excluded = readFrontmatterPath(content, ["plainva", "tasks"]) === false;
    for (const task of scanned) out.push({ path: r.path, title, excluded, ...task });
  }
  return out.length;
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-task-list-cost-"));
  try {
    const vaultPath = path.join(root, "vault");
    await writeFixtureVault(vaultPath, { count, longTableNote: false });
    const db = new NodeSqlitePort(new DatabaseSync(path.join(root, "index.sqlite")));
    db.raw.exec("PRAGMA journal_mode=WAL");
    db.raw.exec("PRAGMA synchronous=NORMAL");
    await db.initialize();
    await new VaultIndexer(new LocalVaultAdapter(vaultPath), db).indexVaultFull();
    const service = new VaultQueryService(db);
    const states: Record<string, () => Promise<void>> = {
      whole: async () => { await fillNoteTasks(db); },
      half: async () => { await fillNoteTasks(db); await db.execute(`DELETE FROM note_tasks WHERE file_rowid % 2 = 0`); },
      none: async () => { await db.execute(`DELETE FROM note_tasks`); },
    };
    const best: Record<string, number> = {};
    let tasks: Record<string, number> = {};
    for (let round = 0; round <= rounds; round++) {
      for (const [state, set] of Object.entries(states)) {
        await set();
        const start = performance.now();
        const listed = await service.listTasks();
        const ms = performance.now() - start;
        tasks[state] = listed.length;
        if (round > 0) best[state] = Math.min(best[state] ?? Infinity, ms);
      }
      const start = performance.now();
      tasks.asBefore = await asBefore(db);
      const ms = performance.now() - start;
      if (round > 0) best.asBefore = Math.min(best.asBefore ?? Infinity, ms);
    }
    console.log(JSON.stringify({ notes: count, fastestOfMs: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, Number(v.toFixed(1))])), tasks }, null, 2));
    await db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void main();
