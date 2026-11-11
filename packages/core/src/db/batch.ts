import { BatchStatement, SqlStatements } from "./IDatabaseAdapter.js";

/**
 * Runs an ordered list of write statements atomically when the adapter offers a
 * native transactional batch ({@link SqlStatements.runBatch}) — BEGIN/COMMIT
 * with ROLLBACK on error — and otherwise replays them one statement at a time.
 *
 * The fallback is exactly the pre-batch behavior (one auto-committed execute per
 * statement): not crash-atomic, but correct and what the in-memory test adapter
 * and any non-Tauri adapter use. Callers therefore get atomicity + far fewer IPC
 * hops on the desktop, without a hard dependency on the native command.
 *
 * The statements must be pure writes (no reads) whose relative order is enough —
 * see the indexer's cold-full-scan, where reads are pre-loaded before the batch.
 *
 * A caller inside the body of its own `transaction()` passes the body's handle
 * (`tx`): its statements then run in that transaction. Sent to the adapter
 * itself from there, the batch would be a transaction of its own and wait for
 * its own caller (D3).
 */
// The fallback stays, deliberately: both shipping adapters (the desktop's
// `db_batch`, the phone's `executeSet`) and the phone's E2E fixture adapter
// have `runBatch`, and inside a transaction's body the handle's statements are
// in that transaction anyway. Without one are the SDK's adapter for Node
// (`SqliteDatabaseAdapter`, used by scripts and other tools), the core's test
// adapters and the mock — the format-9 tests use exactly that to stop a
// numbering half way and prove the fallback rebuild. Making it throw would
// take the SDK's writes away; what needs atomicity on a device has it.
export async function runStatementsAtomic(
  db: SqlStatements,
  statements: BatchStatement[],
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
