import { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.ts";

export class MockDatabaseAdapter implements IDatabaseAdapter {
  public queries: { query: string; params: any[] | Record<string, any> }[] = [];
  public mockedResults: any[] = [];
  public mockedOneResults: any[] = [];

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    this.queries.push({ query, params });
  }

  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    this.queries.push({ query, params });
    return (this.mockedResults.shift() || []) as T[];
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    this.queries.push({ query, params });
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
