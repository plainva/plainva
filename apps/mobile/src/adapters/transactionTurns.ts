/**
 * One transaction at a time on a database that is a single connection
 * (finding 2026-10-12).
 *
 * The phone's index database is one native connection, and the SQLite plugin
 * refuses a second transaction while one is open: Android answers "Already in
 * transaction" (`Database.beginTransaction`), iOS hands back SQLite's own
 * refusal of the second BEGIN. The app has many flows that open one — every
 * write through the vault's chain for its entry in the sync queue, the index
 * for every path it follows, the sync worker for every upload it marks done,
 * the calendar cache — and they do not know of each other. Whoever came second
 * was refused, and what that cost depended on who it was: a note that was
 * changed on disk and counted as failed, with no entry in the sync queue and
 * a state the chain did not know (typing on ended in a conflict copy of a note
 * nobody else had touched); a rename that left its sync row behind; a
 * confirmed deletion that was never queued.
 *
 * So they take turns here, in the order they asked, as the desktop's database
 * adapter has always had its transactions do. Nothing is refused any more; a
 * transaction that meets another one waits for it.
 *
 * That makes ONE thing fatal that used to be an error: a transaction opened
 * inside another one's body, and waited for there. It would wait for the turn
 * its own caller holds. There is none in the app — `transaction-nesting.test.ts`
 * in the core's tests reads the sources for it — and the one thing that does
 * run inside a transaction on purpose, the index flushing a batch, is not a
 * turn of its own (see the adapters' `runBatch`).
 *
 * What taking turns does NOT do: a single statement sent outside any
 * transaction is not held back. The connection runs it in whichever
 * transaction is open, and commits it or rolls it back with that one.
 */
export class TransactionTurns {
  private last: Promise<unknown> = Promise.resolve();

  /** Runs `work` once everything asked for before it is through, whether that succeeded or not. */
  take<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.last.then(work);
    this.last = turn.catch(() => {});
    return turn;
  }
}
