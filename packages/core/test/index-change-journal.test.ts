import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { INDEX_CHANGES_TABLE, JOURNALED_TABLES, indexChangeMark, indexChangedSince, noteIndexChange, trimIndexChanges } from "../src/db/indexChanges.js";

/**
 * The index's change journal (db/indexChanges.ts): what it notes, and that no
 * table that holds paths of the vault stays out of it unnoticed.
 */

let db: IDatabaseAdapter;

beforeEach(async () => {
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
});

/**
 * Tables with a path of the vault whose changes are none of the index's
 * concern — a reading of a file is not older than anything they hold.
 */
const NOT_JOURNALED: Record<string, string> = {
  links: "written by the index itself, from the reading it writes",
  index_removed: "the index's own marks of what it reported gone; the rows go with a journaled delete of `files`",
  pim_task_state: "which note a task of a task list lives in; the note's text is the file's",
  workspace_comment_outbox: "comments waiting to be sent; no text of the file",
  workspace_local_probe: "the encrypted workspace's cache of what it hashed; no change of the file",
  workspace_revision: "the history of an object; the object's place is `workspace_object`",
  workspace_local_fork: "a fork is written as a file of its own, and its original's change is journaled by `workspace_object`",
};

const journal = async () => (await db.query<{ path: string }>(`SELECT path FROM ${INDEX_CHANGES_TABLE} ORDER BY seq`)).map((row) => row.path);

describe("the index's change journal", () => {
  it("every table that holds a path of the vault is journaled, or says why not", async () => {
    const tables = (await db.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((row) => row.name);
    const withPaths: string[] = [];
    for (const table of tables) {
      if (table === INDEX_CHANGES_TABLE || table.startsWith("fts_")) continue;
      const columns = await db.query<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [table]);
      if (columns.some((column) => column.name === "path" || column.name.endsWith("_path"))) withPaths.push(table);
    }
    const unexplained = withPaths.filter((table) => !(JOURNALED_TABLES as readonly string[]).includes(table) && !(table in NOT_JOURNALED));
    expect(unexplained, "journal these tables (indexChanges.ts) or say here why their changes are none of the index's concern").toEqual([]);
    const triggers = (await db.query<{ tbl_name: string }>(`SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'index_changes_%'`)).map((row) => row.tbl_name);
    for (const table of JOURNALED_TABLES) expect(triggers, `a trigger journals ${table}`).toContain(table);
  });

  it("notes a moved row at both ends and the folder it left, and a removed one", async () => {
    await db.execute(`INSERT INTO files (id, path) VALUES ('1', 'A/x.md'), ('2', 'top.md')`);
    await db.execute(`UPDATE files SET path = 'B/x.md' WHERE path = 'A/x.md'`);
    await db.execute(`UPDATE files SET path = 'moved.md' WHERE path = 'top.md'`);
    await db.execute(`DELETE FROM files WHERE path = 'moved.md'`);
    // The vault's own top level is no folder a reading lies "in".
    expect(await journal()).toEqual(["A/x.md", "B/x.md", "A", "top.md", "moved.md", "moved.md"]);
  });

  it("notes a sync row that changes what it records, and not one that only records an upload", async () => {
    await db.execute(`INSERT INTO sync_state (path, local_sha256) VALUES ('X.md', 'a')`);
    await db.execute(`UPDATE sync_state SET local_sha256 = 'b' WHERE path = 'X.md'`);
    await db.execute(`UPDATE sync_state SET remote_etag = 'e', last_sync_ts = 1 WHERE path = 'X.md'`);
    await db.execute(`DELETE FROM sync_state WHERE path = 'X.md'`);
    expect(await journal()).toEqual(["X.md", "X.md", "X.md"]);
  });

  it("notes what either queue takes in, and keeps it when the entry goes", async () => {
    await db.execute(`INSERT INTO offline_queue (file_path, operation, new_path) VALUES ('A', 'rename', 'B')`);
    await db.execute(`INSERT INTO workspace_queue (operation, path, new_path, queued_at) VALUES ('write', 'W.md', NULL, 0)`);
    await db.execute(`DELETE FROM offline_queue`);
    expect(await journal()).toEqual(["A", "B", "W.md"]);
  });

  it("sets aside a reading whose path or folder changed after its mark, and no other", async () => {
    await noteIndexChange(["Early.md"], db);
    const mark = await indexChangeMark(db);
    await noteIndexChange(["A", "Exact.md"], db);
    const changed = await indexChangedSince(db, mark);
    expect(changed("A/deep/n.md", mark)).toBe(true);
    expect(changed("Exact.md", mark)).toBe(true);
    expect(changed("AB/n.md", mark), "a folder of another name").toBe(false);
    expect(changed("Early.md", mark), "changed before the read began").toBe(false);
    expect(changed("A/n.md", await indexChangeMark(db)), "a reading begun after the change").toBe(false);
  });

  it("is trimmed up to a mark, or entirely, and its marks keep growing", async () => {
    await noteIndexChange(["a", "b"], db);
    const mark = await indexChangeMark(db);
    await noteIndexChange(["c"], db);
    await trimIndexChanges(db, mark);
    expect(await journal()).toEqual(["c"]);
    await trimIndexChanges(db, null);
    expect(await journal()).toEqual([]);
    await noteIndexChange(["d"], db);
    expect(await indexChangeMark(db)).toBeGreaterThan(mark);
  });
});
