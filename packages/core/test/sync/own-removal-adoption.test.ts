import { afterEach, describe, expect, it } from "vitest";
import { realSqlite } from "../helpers/realSqlite.js";
import { adoptOwnRemovals, noteOwnRemoval, type OwnRemovalLooks } from "../../src/sync/ownRemovalNotes.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { removalLooks } from "../helpers/crashedRuntime.js";

/**
 * Taking over, at the start, the sync's own removals a runtime left
 * unrecorded (`adoptOwnRemovals`) — decided only where it can be decided:
 * the vault's folder there before and after the looks, every look answered,
 * nothing queued for the path. And a note never outlives its file's sync
 * row: it goes wherever the row goes.
 */

const dbs: IDatabaseAdapter[] = [];
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()!.close();
});

async function vaultWithNote(path = "Gone.md") {
  const db = await realSqlite();
  dbs.push(db);
  await db.execute(`INSERT INTO sync_state (path, remote_etag, base_sha256) VALUES (?, '"e1"', 'abc')`, [path]);
  await noteOwnRemoval(db, path, [{ mtime: 5 }]);
  const row = async () => (await db.query(`SELECT path FROM sync_state WHERE path = ?`, [path])).length;
  const note = async () => (await db.query(`SELECT key FROM meta WHERE key LIKE 'sync-own-removal:%'`)).length;
  return { db, row, note };
}
const gone: OwnRemovalLooks = removalLooks(async () => true, async () => false);

describe("taking over the notes of the sync's own removals", () => {
  it("takes a removal over where the folder is there and the file is gone: its row goes, the index's report is the sync's", async () => {
    const v = await vaultWithNote();
    const register = new OwnDeletionRegister();
    expect(await adoptOwnRemovals(v.db, register, gone)).toBe(1);
    expect(await v.row()).toBe(0);
    expect(await v.note()).toBe(0);
    expect(register.consume("Gone.md", { mtime: 5 })).toBe(true);
  });

  it("decides nothing while the vault's folder is away — every file would look gone", async () => {
    const v = await vaultWithNote();
    const register = new OwnDeletionRegister();
    expect(await adoptOwnRemovals(v.db, register, removalLooks(async () => false, async () => false))).toBe(0);
    expect(await v.row(), "the row of a file that may well be there stays").toBe(1);
    expect(await v.note(), "the note waits for the next start").toBe(1);
    expect(register.consume("Gone.md", { mtime: 5 })).toBe(false);
  });

  it("decides nothing where the folder went during the looks", async () => {
    const v = await vaultWithNote();
    let asked = 0;
    expect(await adoptOwnRemovals(v.db, new OwnDeletionRegister(), removalLooks(async () => ++asked === 1, async () => false))).toBe(0);
    expect(asked).toBe(2);
    expect(await v.row()).toBe(1);
    expect(await v.note()).toBe(1);
  });

  it("decides nothing for a file whose look fails: the note waits", async () => {
    const v = await vaultWithNote();
    expect(await adoptOwnRemovals(v.db, new OwnDeletionRegister(), removalLooks(async () => true, async () => { throw new Error("EIO"); }))).toBe(0);
    expect(await v.row()).toBe(1);
    expect(await v.note()).toBe(1);
  });

  it("drops only the note where the file is still there: the removal did not happen", async () => {
    const v = await vaultWithNote();
    expect(await adoptOwnRemovals(v.db, new OwnDeletionRegister(), removalLooks(async () => true, async () => true))).toBe(0);
    expect(await v.row()).toBe(1);
    expect(await v.note()).toBe(0);
  });

  for (const [what, queue] of [
    ["a deletion queued in the plain sync", `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES ('Gone.md', 'delete', 1)`],
    ["a rename queued in the plain sync", `INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES ('Other.md', 'rename', 'Gone.md', 1)`],
    ["a deletion queued in the workspace", `INSERT INTO workspace_queue (operation, path, queued_at) VALUES ('delete', 'Gone.md', 1)`],
  ] as const) {
    it(`touches no row where something is queued for the path — ${what}`, async () => {
      const v = await vaultWithNote();
      await v.db.execute(queue);
      const register = new OwnDeletionRegister();
      expect(await adoptOwnRemovals(v.db, register, gone)).toBe(0);
      expect(await v.row(), "the queue owns the path: its row stays").toBe(1);
      expect(await v.note(), "the note goes").toBe(0);
      expect(register.consume("Gone.md", { mtime: 5 })).toBe(false);
    });
  }
});

describe("a note goes wherever its file's sync row goes", () => {
  it("with the row's record", async () => {
    const v = await vaultWithNote();
    await new SyncStateRepository(v.db).deleteSyncState("Gone.md");
    expect(await v.note()).toBe(0);
  });

  it("with any other way the row goes: dropped for a new folder, renamed away", async () => {
    const a = await vaultWithNote();
    await new SyncStateRepository(a.db).clearAll();
    expect(await a.note()).toBe(0);
    const b = await vaultWithNote();
    await b.db.execute(`UPDATE sync_state SET path = 'Elsewhere.md' WHERE path = 'Gone.md'`);
    expect(await b.note()).toBe(0);
  });

  it("and stays while the row does", async () => {
    const v = await vaultWithNote();
    await v.db.execute(`UPDATE sync_state SET remote_etag = '"e2"' WHERE path = 'Gone.md'`);
    expect(await v.note()).toBe(1);
  });
});
