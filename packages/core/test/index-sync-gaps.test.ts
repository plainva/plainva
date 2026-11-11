import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { sweepPlainOwed, sweepWorkspaceOwed, type OwedSweepHandlers } from "../src/sync/owedToRemote.js";
import { SqlWorkspaceStateStore } from "../src/workspace/state.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * Three gaps between the index pass and the sync, all older than wave 1 of the
 * review (stability plan R22). Real files and a real SQLite.
 *
 *  1. A deletion is lost when the app ends between the index's last
 *     transaction and the host's entry in the queue: the row is gone, the sync
 *     row stays, nothing is queued, and the next pass has nothing to report.
 *  2. `SyncQueue.queueRename` failed on `files.path`'s UNIQUE when a pass had
 *     read the destination already.
 *  3. The encrypted workspace's queue never took the index's `local_ahead`
 *     off, and nothing queued a change the index had marked and an ended app
 *     had not queued.
 */

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-r22-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const onDisk = (p: string) => path.join(root, p);
const queued = async () => (await db.query<{ operation: string; file_path: string; new_path: string | null }>(
  "SELECT operation, file_path, new_path FROM offline_queue ORDER BY id",
)).map((op) => (op.new_path ? `${op.operation} ${op.file_path} -> ${op.new_path}` : `${op.operation} ${op.file_path}`));

/** A note the remote has: indexed, with a sync row of a confirmed remote version. */
async function synced(p: string, text = `# ${p}\n`): Promise<void> {
  await vault.writeTextFile(p, text);
  await new VaultIndexer(vault, db).indexVaultFull("open");
  await db.execute("INSERT OR REPLACE INTO sync_state (path, remote_etag, base_sha256) VALUES (?, 'e1', 'b1')", [p]);
  await db.execute("UPDATE files SET sync_state = 'synced'");
}

function handlers(over: Partial<OwedSweepHandlers> = {}) {
  const queue = new SyncQueue(db);
  const removed: string[] = [];
  const written: string[] = [];
  const h: OwedSweepHandlers = {
    vaultIsThere: () => vault.exists(""),
    stillGone: async (p) => !(await vault.exists(p)),
    remove: async (p) => { removed.push(p); await queue.queueDelete(p); },
    write: async (p) => { written.push(p); },
    ...over,
  };
  return { h, queue, removed, written };
}

describe("1 — a deletion the index committed and the app ended before it was queued", () => {
  /** The pass removes the row; the host never hears of it: the app ended right after the commit. */
  async function lostDeletion(p: string) {
    await synced(p);
    await synced("Stays.md");
    await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    expect(await db.query("SELECT path FROM files WHERE path = ?", [p]), "the scene: the row is gone").toEqual([]);
    // The next start: a pass has nothing left to report, and the sweep of the plain sync queues no deletion.
    const reported: string[] = [];
    await new VaultIndexer(vault, db, { onLocalFileDeleted: (gone) => void reported.push(gone) }).indexVaultFull("open");
    expect(reported).toEqual([]);
  }

  it("was lost at the code before R22: the next start reports nothing and the first cycle's sweep queues nothing", async () => {
    await lostDeletion("Gone.md");
    await new SyncQueue(db).enqueueLocalOnlyFiles();
    expect(await queued()).toEqual([]);
    expect(await db.query("SELECT path FROM sync_state WHERE path = 'Gone.md'"), "the remote copy is still owed its deletion").toHaveLength(1);
  });

  it("is queued by the sweep of what is owed, once, and only for the file that went", async () => {
    await lostDeletion("Gone.md");
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0 });
    expect(removed).toEqual(["Gone.md"]);
    expect(await queued()).toEqual(["delete Gone.md"]);
    // Queued: the next sweep finds nothing owed.
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0 });
    expect(await queued()).toEqual(["delete Gone.md"]);
  });

  it("queues nothing for a file that is there without a row (an index still being read), nor while the vault's folder is away", async () => {
    await synced("Known.md");
    // Rows gone, files there: a rebuilt index the first scan has not reached.
    await db.execute("DELETE FROM files");
    const { h } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0 });
    await fs.rm(onDisk("Known.md"));
    expect(await sweepPlainOwed(db, { ...h, vaultIsThere: async () => false })).toEqual({ deletions: 0, writes: 0 });
    // A folder that drops between the looks proves nothing either.
    let asked = 0;
    expect(await sweepPlainOwed(db, { ...h, vaultIsThere: async () => ++asked === 1 })).toEqual({ deletions: 0, writes: 0 });
    // A look that fails proves nothing.
    expect(await sweepPlainOwed(db, { ...h, stillGone: async () => { throw new Error("share dropped"); } })).toEqual({ deletions: 0, writes: 0 });
    expect(await queued()).toEqual([]);
  });

  it("queues nothing for what is on its way already: a queued rename away from it, or the worker's own mirrored deletion", async () => {
    await synced("Moved.md");
    await synced("Mirrored.md");
    await fs.rename(onDisk("Moved.md"), onDisk("Elsewhere.md"));
    await new SyncQueue(db).queueRename("Moved.md", "Elsewhere.md");
    // The worker mirrors a remote deletion: its sync row goes first, then the file.
    await db.execute("DELETE FROM sync_state WHERE path = 'Mirrored.md'");
    await fs.rm(onDisk("Mirrored.md"));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    const { h } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0 });
    expect(await queued()).toEqual(["rename Moved.md -> Elsewhere.md"]);
  });
});

describe("2 — a rename whose destination a pass had read already", () => {
  it("is queued, and the index keeps one row for the file, under its new path, searchable", async () => {
    await synced("Old.md", "# Old\n\nzeppelin over the lake\n");
    await fs.rename(onDisk("Old.md"), onDisk("New.md"));
    // The watcher's event for the destination is followed first.
    await new VaultIndexer(vault, db).indexFile(await vault.getFileInfo("New.md"));
    expect((await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path), "the scene").toEqual(["New.md", "Old.md"]);

    // It used to throw "UNIQUE constraint failed: files.path" and queue nothing.
    await new SyncQueue(db).queueRename("Old.md", "New.md");
    expect(await queued()).toEqual(["rename Old.md -> New.md"]);
    const rows = await db.query<{ path: string; sync_state: string; mtime_local: number }>("SELECT path, sync_state, mtime_local FROM files");
    expect(rows).toEqual([{ path: "New.md", sync_state: "local_ahead", mtime_local: 0 }]);
    expect(await db.query("SELECT path FROM sync_state")).toEqual([{ path: "New.md" }]);

    // The next pass reads the destination again and reports nothing gone.
    const gone: string[] = [];
    await new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => void gone.push(p) }).indexVaultFull("automatic refresh");
    expect(gone).toEqual([]);
    expect((await new VaultQueryService(db).searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["New.md"]);
  });

  it("…also for a folder, child by child, where only some children were read at their new place", async () => {
    await synced("Folder/a.md");
    await synced("Folder/b.md");
    await fs.rename(onDisk("Folder"), onDisk("Moved"));
    await new VaultIndexer(vault, db).indexFile(await vault.getFileInfo("Moved/a.md"));
    await new SyncQueue(db).queueRename("Folder", "Moved");
    expect((await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path)).toEqual(["Moved/a.md", "Moved/b.md"]);
    expect(await queued()).toEqual(["rename Folder -> Moved"]);
  });
});

describe("3 — the encrypted workspace's queue and the index's local_ahead", () => {
  const meta = {} as never;
  const object = (p: string, sha: string | null) => ({
    objectId: `o:${p}`, path: p, currentRevisionId: `r:${p}`, payloadHash: "ph", plaintextSha256: sha,
    contentKind: "text" as const, deleted: false, authorMemberId: "m", createdAt: "2026-11-11T00:00:00Z", modifiedAt: "2026-11-11T00:00:00Z",
  });
  const commit = (state: SqlWorkspaceStateStore, id: number, p: string, sha: string) =>
    state.commitQueued(id, { object: object(p, sha), revision: null, operationHash: `op:${id}`, operationDocument: "{}", deviceId: "d", sequence: id }, meta);
  const sha = async (p: string) => (await db.queryOne<{ sha256: string }>("SELECT sha256 FROM files WHERE path = ?", [p]))!.sha256;
  const markOf = async (p: string) => (await db.queryOne<{ sync_state: string }>("SELECT sync_state FROM files WHERE path = ?", [p]))?.sync_state;

  /** Another program changes a note; the index marks it, and the app ends before the host queued it. */
  async function lostChange(state: SqlWorkspaceStateStore, p: string) {
    await vault.writeTextFile(p, "# first\n");
    await new VaultIndexer(vault, db).indexVaultFull("open");
    await commit(state, await state.enqueue("write", p), p, await sha(p));
    await fs.writeFile(onDisk(p), "# changed elsewhere\n", "utf8");
    await fs.utimes(onDisk(p), new Date(), new Date(Date.now() + 5000));
    await new VaultIndexer(vault, db, { onExternalModification: () => {} }).indexVaultFull("automatic refresh");
    expect(await markOf(p), "the scene: the index marked the change").toBe("local_ahead");
  }

  it("a committed entry takes the mark off its path — it never did — and a discarded one too", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await vault.writeTextFile("a.md", "# a\n");
    await vault.writeTextFile("b.md", "# b\n");
    await new VaultIndexer(vault, db).indexVaultFull("open");
    await db.execute("UPDATE files SET sync_state = 'local_ahead'");
    const first = await state.enqueue("write", "a.md");
    // A second entry for a.md is still queued: the mark stays until it is through.
    await state.enqueue("rename", "a.md", "c.md");
    await commit(state, first, "a.md", await sha("a.md"));
    expect(await markOf("a.md")).toBe("local_ahead");
    await state.discardQueue((await state.listQueue())[0].id);
    expect(await markOf("a.md")).toBe("synced");
    await commit(state, await state.enqueue("write", "b.md"), "b.md", await sha("b.md"));
    expect(await markOf("b.md")).toBe("synced");
  });

  it("a change the index marked and an ended app never queued is queued by the sweep — before R22, nothing ever did", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await lostChange(state, "Note.md");
    expect(await state.listQueue(), "nothing queued it").toEqual([]);
    const { h, written } = handlers({ write: async (p) => { written.push(p); await state.enqueue("write", p); } });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 1 });
    expect(written).toEqual(["Note.md"]);
    expect((await state.listQueue()).map((e) => `${e.operation} ${e.path}`)).toEqual(["write Note.md"]);
    // Queued: the next sweep finds nothing owed.
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0 });
  });

  it("a mark on content that is the object's already goes without an entry; a deletion owed to the workspace is queued", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await vault.writeTextFile("Up.md", "# up\n");
    await vault.writeTextFile("Gone.md", "# gone\n");
    await new VaultIndexer(vault, db).indexVaultFull("open");
    await commit(state, await state.enqueue("write", "Up.md"), "Up.md", await sha("Up.md"));
    await commit(state, await state.enqueue("write", "Gone.md"), "Gone.md", await sha("Gone.md"));
    // An index older than R22 left the mark on a change that went up.
    await db.execute("UPDATE files SET sync_state = 'local_ahead' WHERE path = 'Up.md'");
    await fs.rm(onDisk("Gone.md"));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    const removed: string[] = [];
    const { h, written } = handlers({ remove: async (p) => { removed.push(p); await state.enqueue("delete", p); } });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 1, writes: 0 });
    expect(written).toEqual([]);
    expect(removed).toEqual(["Gone.md"]);
    expect(await markOf("Up.md")).toBe("synced");
    expect((await state.listQueue()).map((e) => `${e.operation} ${e.path}`)).toEqual(["delete Gone.md"]);
  });
});
