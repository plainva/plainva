import { BatchStatement, IDatabaseAdapter } from "./IDatabaseAdapter.js";

/**
 * Runs an ordered list of write statements atomically when the adapter offers a
 * native transactional batch ({@link IDatabaseAdapter.runBatch}) — BEGIN/COMMIT
 * with ROLLBACK on error — and otherwise replays them one statement at a time.
 *
 * The fallback is exactly the pre-batch behavior (one auto-committed execute per
 * statement): not crash-atomic, but correct and what the in-memory test adapter
 * and any non-Tauri adapter use. Callers therefore get atomicity + far fewer IPC
 * hops on the desktop, without a hard dependency on the native command.
 *
 * The statements must be pure writes (no reads) whose relative order is enough —
 * see the indexer's cold-full-scan, where reads are pre-loaded before the batch.
 */
export async function runStatementsAtomic(
  db: IDatabaseAdapter,
  statements: BatchStatement[]
): Promise<void> {
  if (statements.length === 0) return;
  if (db.runBatch) {
    await db.runBatch(statements);
    return;
  }
  for (const s of statements) {
    await db.execute(s.sql, (s.params ?? []) as unknown[]);
  }
}
