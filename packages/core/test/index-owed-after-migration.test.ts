import { describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { initializeSchema } from "../src/db/Schema.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * A format migration that hands the notes to the next full pass leaves the
 * index owed a full scan (second review of 11.11.). Before, the app held such
 * an index as whole while every note waited to be read again: planners and
 * find-and-replace ran over it, the latter over an empty full text.
 */
describe("an index after a format migration", () => {
  it("is owed a full scan when the migration handed notes to the next pass", async () => {
    const db = await realSqlite();
    await db.execute(
      `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state, fts_rowid) VALUES ('a', 'A.md', 'A', 'x', 5, 5, 1, 1, 'obsidian', 'synced', 0)`,
    );
    // An index written by a build three formats back: every note is read again.
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', '3')`);
    await initializeSchema(db);
    const indexer = new VaultIndexer({} as never, db);
    expect(await indexer.indexComplete()).toBe(false);
    await db.close();
  });

  it("is not owed one when nothing waits: an index a scan went through stays whole", async () => {
    const db = await realSqlite();
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', '3')`);
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_scan_whole', '1')`);
    await initializeSchema(db);
    expect(await new VaultIndexer({} as never, db).indexComplete()).toBe(true);
    await db.close();
  });
});
