import { DatabaseSync } from "node:sqlite";
import { initializeSchema, resetEmbeddingStores, sha256Hex, VaultQueryService, type IDatabaseAdapter } from "@plainva/core";

/** The index database on real SQLite (node:sqlite), as the vault opens it. */
export class NodeSqliteAdapter implements IDatabaseAdapter {
  private readonly db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.query<T>(sql, params))[0] as T) ?? null;
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

/** A vault's index with these notes, as the indexer would have written it; `notes` is the disk and can change. */
export async function vaultWith(notes: Record<string, string>) {
  resetEmbeddingStores();
  const db = new NodeSqliteAdapter();
  await initializeSchema(db);
  for (const [path, content] of Object.entries(notes)) {
    await db.execute(`INSERT INTO files (id, path, title, sha256, mtime_local, mode, size_bytes) VALUES (?, ?, ?, ?, ?, 'obsidian', ?)`, [
      path,
      path,
      path.replace(/^.*\//, "").replace(/\.md$/, ""),
      await sha256Hex(content),
      1000,
      new TextEncoder().encode(content).length,
    ]);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, '', '')`, [content, path.replace(/^.*\//, "").replace(/\.md$/, ""), path]);
  }
  return { db, query: new VaultQueryService(db), readText: async (path: string) => notes[path] ?? null };
}

/** Waits until a condition holds (the controllers open and embed asynchronously). */
export async function until(test: () => boolean): Promise<boolean> {
  for (let i = 0; i < 300 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  return test();
}
