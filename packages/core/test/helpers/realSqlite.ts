import { DatabaseSync } from "node:sqlite";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../../src/db/Schema.js";

export async function realSqlite(): Promise<IDatabaseAdapter> {
  const sqlite = new DatabaseSync(":memory:");
  const db: IDatabaseAdapter = {
    async initialize() {},
    async close() { sqlite.close(); },
    async execute(sql, params = []) { sqlite.prepare(sql).run(...params as never[]); },
    async query<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...params as never[]) as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).get(...params as never[]) as T ?? null;
    },
    async transaction(fn) {
      sqlite.exec("BEGIN");
      try {
        const result = await fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  await initializeSchema(db);
  return db;
}
