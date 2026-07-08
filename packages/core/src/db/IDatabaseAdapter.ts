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
   * If nested transactions are not supported, this might simulate them or throw.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
