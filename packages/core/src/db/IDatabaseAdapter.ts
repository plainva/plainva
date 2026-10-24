/** One SQL statement plus its positional parameters, for {@link IDatabaseAdapter.runBatch}. */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

/** How a batch is delivered, for {@link IDatabaseAdapter.runBatch}. */
export interface BatchOptions {
  /**
   * The caller runs this batch inside the body of its OWN `transaction()` —
   * the indexer's full scan flushes its writes there. An adapter whose
   * database is a single connection (the phone's) has no transaction to give
   * such a batch: it runs the statements in the one that is open. Every other
   * batch is a transaction of its own there and waits for an open one; set on
   * a batch that is not inside its caller's transaction, it would run in
   * somebody else's.
   */
  inOpenTransaction?: boolean;
}

export interface IDatabaseAdapter {
  /**
   * Initializes the database connection and ensures tables exist.
   */
  initialize(): Promise<void>;

  /**
   * Closes the database connection.
   */
  close(): Promise<void>;

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
   * Runs a function within a database transaction.
   * If the function throws, the transaction is rolled back.
   *
   * Transactions do not nest, and both shells' adapters make a second one WAIT
   * for the first (the desktop's with a queue in front of its pool, the
   * phone's because its one connection refuses a second). So `fn` must never
   * open another transaction and wait for it — neither directly nor through
   * anything it calls: that one would wait for the turn `fn` holds, and with
   * it everything else that writes to this database. The same goes for a
   * write through the vault's chain (it waits for its entry in the sync queue,
   * a transaction) and for closing the database. What reacts to a
   * transaction's result with database work of its own (a hook, a callback)
   * runs after it. `transaction-nesting.test.ts` reads the sources for this.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * True where `transaction()` does NOT roll back. The desktop's adapter sits
   * on a connection pool and cannot hold a transaction across calls: there
   * `transaction()` only keeps a second one out, every statement is committed
   * as it runs, and every `runBatch` is a transaction of its own. Whoever
   * says what it wrote once its transaction is through has to say what it
   * had written when the transaction fails — nobody takes it back
   * (`VaultIndexer.announceWhatStays`). Absent or false: a transaction that
   * failed wrote nothing.
   */
  readonly keepsWhatAFailedTransactionWrote?: boolean;

  /**
   * Runs an ORDERED batch of write statements atomically in a single database
   * transaction (BEGIN/COMMIT, ROLLBACK on any error). Optional: adapters without
   * a native transactional path omit it, and callers fall back to per-statement
   * execute() via {@link runStatementsAtomic}. Reads inside a batch are not
   * supported — the statements must be pure writes whose relative order is enough.
   *
   * A batch sent from inside the body of a `transaction()` says so
   * ({@link BatchOptions.inOpenTransaction}); without that word it is a
   * transaction of its own and, on a single connection, waits for the open one
   * — its caller's, if that is where it came from.
   */
  runBatch?(statements: BatchStatement[], options?: BatchOptions): Promise<void>;
}
