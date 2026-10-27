import { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.ts";

export class MockDatabaseAdapter implements IDatabaseAdapter {
  public queries: { query: string; params: any[] | Record<string, any> }[] = [];
  public mockedResults: any[] = [];
  public mockedOneResults: any[] = [];
  private conflictMeta = new Map<string, string>();

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    this.queries.push({ query, params });
    // The meta rows the repository keeps of its own (conflict sessions, files
    // refused for good) live here, so they never take a mocked result.
    if (Array.isArray(params) && typeof params[0] === "string" && /^(conflict-(session|diagnostic)|sync-unsyncable):/.test(params[0])) {
      if (/^DELETE FROM meta WHERE key LIKE/.test(query)) { for (const key of [...this.conflictMeta.keys()]) if (key.startsWith(params[0].replace(/%$/, ""))) this.conflictMeta.delete(key); return; }
      if (/^DELETE FROM meta/.test(query)) this.conflictMeta.delete(params[0]);
      else if (/^INSERT INTO meta/.test(query)) this.conflictMeta.set(params[0], params[1]);
    }
  }

  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    this.queries.push({ query, params });
    if (/SELECT value FROM meta WHERE key LIKE \?/.test(query) && Array.isArray(params) && typeof params[0] === "string" && params[0].startsWith("sync-unsyncable:")) {
      const prefix = params[0].replace(/%$/, "");
      return [...this.conflictMeta].filter(([key]) => key.startsWith(prefix)).map(([, value]) => ({ value })) as T[];
    }
    if (/SELECT value FROM meta WHERE key LIKE 'conflict-/.test(query)) {
      const prefix = query.includes("conflict-session:") ? "conflict-session:" : "conflict-diagnostic:";
      return [...this.conflictMeta].filter(([key]) => key.startsWith(prefix)).map(([, value]) => ({ value })) as T[];
    }
    return (this.mockedResults.shift() || []) as T[];
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    this.queries.push({ query, params });
    if (Array.isArray(params) && typeof params[0] === "string" && /^(conflict-session|sync-unsyncable):/.test(params[0])) {
      const value = this.conflictMeta.get(params[0]);
      return (value === undefined ? null : { value }) as T | null;
    }
    return (this.mockedOneResults.shift() || null) as T;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.queries.push({ query: "BEGIN", params: [] });
    try {
      const result = await fn();
      this.queries.push({ query: "COMMIT", params: [] });
      return result;
    } catch (e) {
      this.queries.push({ query: "ROLLBACK", params: [] });
      throw e;
    }
  }

  clear() {
    this.queries = [];
    this.mockedResults = [];
    this.mockedOneResults = [];
  }
}
