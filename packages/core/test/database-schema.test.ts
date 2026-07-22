import { describe, expect, it, beforeEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";

describe("Database Schema", () => {
  let db: MockDatabaseAdapter;

  beforeEach(async () => {
    db = new MockDatabaseAdapter();
    await db.initialize();
  });

  it("executes table creation queries", async () => {
    await initializeSchema(db);
    
    const queries = db.queries.map(q => q.query);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS files"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS sync_state"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_meta"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_object"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_revision"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_operation"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_queue"))).toBe(true);
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS workspace_checkpoint"))).toBe(true);
  });

  it("creates the links table with property_key and the meta table", async () => {
    await initializeSchema(db);

    const queries = db.queries.map(q => q.query);
    const linksCreate = queries.find(q => q.includes("CREATE TABLE IF NOT EXISTS links"));
    expect(linksCreate).toContain("property_key TEXT");
    expect(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS meta"))).toBe(true);
  });

  it("creates the hot-path indices (P2.1)", async () => {
    await initializeSchema(db);

    const queries = db.queries.map(q => q.query);
    // ON DELETE CASCADE of the per-save re-index otherwise full-scans these:
    expect(queries.some(q => q.includes("idx_links_source") && q.includes("ON links(source_id)"))).toBe(true);
    expect(queries.some(q => q.includes("idx_props_file") && q.includes("ON properties(file_id)"))).toBe(true);
    // Wiki-link lookups compare COLLATE NOCASE — the index must match, or
    // SQLite ignores it and scans `files` on every link resolution.
    expect(queries.some(q => q.includes("idx_files_title") && q.includes("ON files(title COLLATE NOCASE)"))).toBe(true);
  });

  it("adds property_key to pre-existing links tables and indexes it afterwards", async () => {
    await initializeSchema(db);

    const queries = db.queries.map(q => q.query);
    const alterIdx = queries.findIndex(q => q.includes("ALTER TABLE links ADD COLUMN property_key"));
    const indexIdx = queries.findIndex(q => q.includes("idx_links_property"));
    expect(alterIdx).toBeGreaterThan(-1);
    expect(indexIdx).toBeGreaterThan(alterIdx);
    expect(queries[indexIdx]).toContain("ON links(property_key, target_path)");
  });

  it("forces a full reindex when the stored index format is outdated", async () => {
    // queryOne on meta returns null (no mocked row) -> version 0 -> migrate.
    await initializeSchema(db);

    const queries = db.queries.map(q => q.query);
    const reset = queries.find(q => q.includes("UPDATE files SET mtime_local = 0"));
    expect(reset).toContain(`LIKE '%.md'`);
    const stamp = db.queries.find(q => q.query.includes("INSERT OR REPLACE INTO meta"));
    expect(stamp).toBeDefined();
    expect(stamp!.params).toEqual(["3"]);
  });

  it("skips the reindex when the stored index format is current", async () => {
    db.mockedOneResults.push({ value: "3" });
    await initializeSchema(db);

    const queries = db.queries.map(q => q.query);
    expect(queries.some(q => q.includes("UPDATE files SET mtime_local = 0"))).toBe(false);
    expect(queries.some(q => q.includes("INSERT OR REPLACE INTO meta"))).toBe(false);
  });

  it("can execute insert and select on sync_state", async () => {
    // This is purely verifying that our mock records the queries correctly,
    // which simulates what the SyncStateRepository will do.
    await db.execute(
      "INSERT INTO sync_state (path, local_sha256, remote_etag) VALUES (?, ?, ?)",
      ["test.md", "hash123", "etag123"]
    );
    
    db.mockedOneResults.push({ path: "test.md", local_sha256: "hash123", remote_etag: "etag123" });
    const row = await db.queryOne("SELECT * FROM sync_state WHERE path = ?", ["test.md"]);
    
    expect(row).toEqual({ path: "test.md", local_sha256: "hash123", remote_etag: "etag123" });
    const queryLog = db.queries[db.queries.length - 1];
    expect(queryLog.query).toBe("SELECT * FROM sync_state WHERE path = ?");
    expect(queryLog.params).toEqual(["test.md"]);
  });
});
