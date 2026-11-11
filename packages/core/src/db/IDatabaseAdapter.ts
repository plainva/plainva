/** One SQL statement plus its positional parameters, for {@link IDatabaseAdapter.runBatch}. */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

/**
 * What runs SQL: the database adapter itself, and the handle `transaction()`
 * gives its body ({@link IDatabaseAdapter.transaction}). A function that may
 * be called inside a transaction's body takes one of these and is handed the
 * body's handle there.
 */
export interface SqlStatements {
  /**
   * Executes a query that doesn't return results (e.g. INSERT, UPDATE, DELETE).
   */
  execute(query: string, params?: any[] | Record<string, any>): Promise<void>;

  /**
   * Executes a query and returns all matching rows.
   */
  query<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T[]>;

  /**
   * Executes a query and returns the first matching row, or null.
   */
  queryOne<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T | null>;

  /**
   * Runs an ORDERED batch of write statements atomically. Optional: adapters
   * without a native transactional path omit it, and callers fall back to
   * per-statement execute() via {@link runStatementsAtomic}. Reads inside a
   * batch are not supported — the statements must be pure writes whose
   * relative order is enough.
   *
   * On the adapter itself, a batch is a transaction of its own (BEGIN/COMMIT,
   * ROLLBACK on any error), and it waits for an open transaction (both
   * shells' adapters). On the handle of a
   * transaction's body, its statements run in that transaction and are
   * committed or rolled back with it.
   */
  runBatch?(statements: BatchStatement[]): Promise<void>;
}

export interface IDatabaseAdapter extends SqlStatements {
  /**
   * Initializes the database connection and ensures tables exist.
   */
  initialize(): Promise<void>;

  /**
   * Closes the database connection.
   */
  close(): Promise<void>;

  /**
   * Runs `fn` within a database transaction and hands it the transaction's
   * own handle, `tx`. If the function throws, the transaction is rolled back.
   *
   * Every statement of the body goes through `tx` — and so does every
   * statement of what the body calls (Datensicherheit D3, E1). A statement
   * sent to the adapter itself WAITS while a transaction is open and then runs
   * on its own, in both shells (the desktop's since stability plan R1, where
   * it would otherwise meet the transaction's write lock on another
   * connection). On the phone's single connection it used to run in whichever
   * transaction was open and was rolled back
   * with it — a sync row deleted, a merge base recorded, an entry of the
   * encrypted workspace's queue, all gone with somebody else's failure. A
   * body that sends a write to the adapter instead of `tx` would wait for
   * itself: both shells' adapters give up after a while and name the body
   * (`transactionTurns.ts`), and `transaction-nesting.test.ts` reads the
   * bodies for it. Reads do not wait — nothing of them can be rolled back.
   * `tx` is good for the body only; used after the body ended, it throws.
   *
   * Transactions do not nest, and both shells' adapters make a second one WAIT
   * for the first (the desktop's in its turns in front of Rust, the
   * phone's because its one connection refuses a second). So `fn` must never
   * open another transaction and wait for it — neither directly nor through
   * anything it calls: that one would wait for the turn `fn` holds, and with
   * it everything else that writes to this database. The same goes for a
   * write through the vault's chain (it waits for its entry in the sync queue,
   * a transaction), for a batch sent to the adapter itself instead of `tx`,
   * and for closing the database. What reacts to a transaction's result with
   * database work of its own (a hook, a callback) runs after it.
   * `transaction-nesting.test.ts` reads the sources for this.
   *
   * Both shells' transactions are real (the desktop's since stability plan
   * R1, on a connection Rust holds for it): a body that fails wrote nothing.
   */
  transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T>;
}
