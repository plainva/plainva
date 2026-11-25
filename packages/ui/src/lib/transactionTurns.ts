import { logDiagnostic } from "../services/diagnosticsLog";

/**
 * One transaction at a time on the index database, in both shells (finding
 * 2026-10-12; the desktop since stability plan R1, whose transactions are real
 * since then: `TauriDatabaseAdapter` holds one connection per transaction in
 * Rust, and a write sent to the adapter itself must not reach SQLite while
 * one is open — it would wait for the write lock behind it, or, on the
 * phone's single connection, run inside it).
 *
 * What follows was written for the phone, where the turns began.
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
 * Waiting has a limit (decision E14 of the bug-clearing plan, Sammelplan § 3.89
 * Nr. 3): a turn that never ends — a body whose native read hangs — held every
 * later transaction and every write through the vault's chain behind it, for
 * as long as the app ran. A turn that has waited `TURN_WAIT_MS` for the ones in
 * front of it gives up with `TransactionTurnTimeout` and is never run, and the
 * diagnostics say which turn held the database and for how long. The one that
 * holds it is not touched: cutting a body off mid-way would leave its
 * statements to run in whichever transaction comes next. What comes after the
 * turn that gave up still waits for the one that holds — and gives up in its
 * own time.
 *
 * A single write sent to the adapter itself — outside any transaction's body
 * — takes a turn as well (Datensicherheit D3, E1). It used to be sent at once,
 * and the connection ran it in whichever transaction was open and rolled it
 * back with that one: a sync row deleted, a merge base recorded, an entry of
 * the encrypted workspace's queue, gone with somebody else's failure. A body
 * runs its own statements through the handle its `transaction()` gives it,
 * without a turn; a body that sends a write to the adapter instead waits for
 * itself, and gives up after `TURN_WAIT_MS` like any turn. Under the unit
 * tests it gives up after `STATEMENT_WAIT_IN_TESTS_MS`, and the error names
 * where the transaction it waited for was opened (`takeStatement`).
 *
 * Reads take turns too, on the phone (`read`, `takeRead`). They used to take
 * none — nothing of a read can be rolled back — but on one connection a read
 * sent while a transaction is open runs IN it and sees what it has written so
 * far: a note's row in `files` without its properties yet, sorted differently,
 * for a query that met an index pass half-way. The desktop never had this: its
 * reads go to the pool, outside the transaction's connection, and see what was
 * committed. Here a read waits for the transaction in front of it and nothing
 * else: reads that arrive one after the other share ONE turn and run side by
 * side, and a transaction asked for meanwhile waits for them. A full scan does
 * not hold the reads off for its whole length either — it gives the connection
 * back between its transactions (`scanTransactionMs`).
 */
export const TURN_WAIT_MS = 60_000;

/**
 * Under the unit tests, a statement that waits this long for a transaction is
 * taken for one sent from that transaction's own body (`takeStatement`).
 */
export const STATEMENT_WAIT_IN_TESTS_MS = 2_000;

function underUnitTests(): boolean {
  try {
    return import.meta.env?.MODE === "test";
  } catch {
    return false;
  }
}

/**
 * What a transaction's turn is called in the diagnostics: under the unit
 * tests, with the place in the sources that opened it — what a statement that
 * waits for its own body names (`takeStatement`).
 */
export function transactionLabel(): string {
  if (!underUnitTests()) return "transaction";
  const frames = (new Error().stack ?? "").split(/\r?\n/).slice(1).map((line) => line.trim());
  const opener = frames.find((line) => !/transactionTurns|CapacitorSqliteAdapter|FixtureSqliteAdapter|TauriDatabaseAdapter\.ts|node_modules/.test(line));
  return opener ? `transaction opened ${opener}` : "transaction";
}

/**
 * A write sent to the adapter itself, in its turn. Under the unit tests it
 * waits `STATEMENT_WAIT_IN_TESTS_MS` at most and then fails, naming the
 * transaction it waited for: a body that sends a write to the adapter instead
 * of its handle waits for itself, and a test should say so at once rather than
 * after a minute.
 */
export function takeStatement<T>(turns: TransactionTurns, work: () => Promise<T>): Promise<T> {
  if (!underUnitTests()) return turns.take(work, "statement");
  return turns.take(work, "statement", STATEMENT_WAIT_IN_TESTS_MS).catch((error: unknown) => {
    if (!(error instanceof TransactionTurnTimeout)) throw error;
    throw new Error(
      `A statement sent to the database adapter waited ${STATEMENT_WAIT_IN_TESTS_MS} ms for the ${error.holder}. ` +
      "A transaction's body that sends its statements to the adapter instead of its handle (tx) waits for itself.",
    );
  });
}

/**
 * A read, in its turn (`TransactionTurns.read`). Under the unit tests it waits
 * `STATEMENT_WAIT_IN_TESTS_MS` at most, like a statement: a body that reads
 * through the adapter instead of its handle waits for itself.
 */
export function takeRead<T>(turns: TransactionTurns, work: () => Promise<T>): Promise<T> {
  if (!underUnitTests()) return turns.read(work);
  return turns.read(work, STATEMENT_WAIT_IN_TESTS_MS).catch((error: unknown) => {
    if (!(error instanceof TransactionTurnTimeout)) throw error;
    throw new Error(
      `A read sent to the database adapter waited ${STATEMENT_WAIT_IN_TESTS_MS} ms for the ${error.holder}. ` +
      "A transaction's body that reads through the adapter instead of its handle (tx) waits for itself.",
    );
  });
}

/** A transaction that waited `TURN_WAIT_MS` for its turn and was not run. */
export class TransactionTurnTimeout extends Error {
  constructor(readonly holder: string, readonly heldMs: number) {
    super(`The database was busy for ${Math.round(heldMs / 1000)} s (${holder}); this change was not made`);
    this.name = "TransactionTurnTimeout";
  }
}

export class TransactionTurns {
  private last: Promise<unknown> = Promise.resolve();
  /** The turn that runs now, and since when: what a turn that gives up names. */
  private running: { label: string; since: number } | null = null;

  /**
   * The reads that share the turn at the end of the line, while it is still
   * there: a read asked for after them joins them instead of waiting for them.
   */
  private reads: { tail: Promise<unknown>; active: number; gate: Promise<void>; finish: () => void } | null = null;

  constructor(
    private readonly waitMs = TURN_WAIT_MS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /**
   * Runs `work` once everything asked for before it is through, whether that
   * succeeded or not - or rejects with `TransactionTurnTimeout`, without
   * running it, when that takes longer than the limit (`waitMs`, or the one
   * the turns were made with). `label` names the turn in the diagnostics
   * ("transaction", "batch", "statement", "close").
   */
  take<T>(work: () => Promise<T>, label = "transaction", waitMs = this.waitMs): Promise<T> {
    const before = this.last;
    let gaveUp = false;
    const asked = this.clock();
    const turn = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        gaveUp = true;
        const holder = this.running;
        const heldMs = holder ? this.clock() - holder.since : this.clock() - asked;
        const holderName = holder?.label ?? "a turn in front";
        logDiagnostic("database", `turn gave up after ${Math.round((this.clock() - asked) / 1000)} s: ${label} waited, ${holderName} held the connection for ${Math.round(heldMs / 1000)} s`);
        reject(new TransactionTurnTimeout(holderName, heldMs));
      }, waitMs);
      void before.then(() => {
        clearTimeout(timer);
        if (gaveUp) return;
        const mine = { label, since: this.clock() };
        this.running = mine;
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          if (this.running === mine) this.running = null;
        });
      });
    });
    // The next turn waits for this one to end - or, when this one gave up, for
    // the one this one was waiting for.
    this.last = before.then(() => (gaveUp ? undefined : turn)).catch(() => {});
    return turn;
  }

  /**
   * Runs the read `work` once every transaction, batch, statement or close
   * asked for before it is through — side by side with the reads asked for
   * right before or after it, which share its turn. What is asked for after
   * the shared turn waits until the last of its reads has ended. Gives up
   * like `take` (`TransactionTurnTimeout`, never run).
   */
  read<T>(work: () => Promise<T>, waitMs = this.waitMs): Promise<T> {
    let group = this.reads;
    if (!group || group.tail !== this.last) {
      let open!: () => void;
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const started = new Promise<void>((resolve) => { open = resolve; });
      const turn = this.take(() => { open(); return finished; }, "read", waitMs);
      const fresh = { tail: this.last, active: 0, gate: Promise.race([started, turn.then(() => {})]), finish };
      group = fresh;
      this.reads = fresh;
    }
    const mine = group;
    mine.active += 1;
    const done = () => {
      mine.active -= 1;
      if (mine.active > 0) return;
      // The last of them: the turn ends, and nothing joins it any more.
      if (this.reads === mine) this.reads = null;
      mine.finish();
    };
    return mine.gate.then(work).finally(done);
  }
}
