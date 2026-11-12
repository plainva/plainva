import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEveryWrite, realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { createLocalQueueing, sweepPlainOwed, sweepWorkspaceOwed, type OwedSweepHandlers } from "../src/sync/owedToRemote.js";
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
    remove: async (p) => { removed.push(p); await queue.queueDelete(p); return "queued"; },
    // Queues nothing: as a workspace's refusal does.
    write: async (p) => { written.push(p); return "refused"; },
    ...over,
  };
  return { h, queue, removed, written };
}

describe("1 — a deletion the index committed and the app ended before it was queued", () => {
  const markOf = async (p: string) => (await db.query("SELECT path FROM index_removed WHERE path = ?", [p])).length;

  /** The pass removes the row; the host never hears of it: the app ended right after the commit. */
  async function lostDeletion(p: string) {
    await synced(p);
    await synced("Stays.md");
    await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    expect(await db.query("SELECT path FROM files WHERE path = ?", [p]), "the scene: the row is gone").toEqual([]);
    // The next start: a pass has nothing left to report.
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

  it("the index marks it in the transaction that removes the row; the sweep queues it once and the mark goes", async () => {
    await lostDeletion("Gone.md");
    expect(await markOf("Gone.md")).toBe(1);
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
    expect(removed).toEqual(["Gone.md"]);
    expect(await queued()).toEqual(["delete Gone.md"]);
    expect(await markOf("Gone.md")).toBe(0);
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(await queued()).toEqual(["delete Gone.md"]);
  });

  it("a deletion the host did queue leaves no mark: queueing takes it off in its own transaction", async () => {
    await synced("Gone.md");
    await fs.rm(onDisk("Gone.md"));
    const queue = new SyncQueue(db);
    const later: Promise<void>[] = [];
    await new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => void later.push(queue.queueDelete(p)) }).indexVaultFull("automatic refresh");
    await Promise.all(later);
    expect(await markOf("Gone.md")).toBe(0);
    expect(await queued()).toEqual(["delete Gone.md"]);
  });

  it("rests on the mark, not on absence: internal paths with sync rows the index never held are left alone (review M3)", async () => {
    await synced("Note.md");
    // Pulled from a remote whose listing skips none of them; never indexed; gone from disk.
    for (const p of [".git/objects/ab/cdef", ".obsidian/plugins/old/main.js", ".vscode/settings.json", "._Note.md", "node_modules/x/index.js"]) {
      await db.execute("INSERT OR REPLACE INTO sync_state (path, remote_etag) VALUES (?, 'e')", [p]);
    }
    await new VaultIndexer(vault, db).indexVaultFull("open");
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(removed).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("an interrupted restore of a held mass deletion leaves nothing owed, and the restore itself is one transaction (review B1)", async () => {
    const held = Array.from({ length: 12 }, (_, i) => `Folder/n${i}.md`);
    for (const p of held) await synced(p);
    for (const p of held) await fs.rm(onDisk(p));
    // The pass reports them, the host queues them: the guard holds the deletions.
    const queue = new SyncQueue(db);
    // One after the other, as the app's transactions take turns (this SQLite refuses a second one).
    let later: Promise<void> = Promise.resolve();
    await new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => { later = later.then(() => queue.queueDelete(p)); } }).indexVaultFull("automatic refresh");
    await later;
    const ids = new Set((await queue.getPendingDeleteOperations()).map((op) => op.id));
    expect(ids.size).toBe(12);
    // "Restore": both go together, or neither does.
    const restore = beforeEveryWrite(db, (sql, params) => {
      if (/DELETE FROM sync_state/.test(sql) && params[0] === "Folder/n7.md") throw new Error("the app ended here");
    });
    await expect(queue.discardDeletesForRestore(ids)).rejects.toThrow("the app ended here");
    restore();
    expect(await queued()).toHaveLength(12);
    expect(await db.query("SELECT path FROM sync_state WHERE path LIKE 'Folder/%'")).toHaveLength(12);
    // The sync rows that a two-step restore left behind owe nothing: the marks went with the queueing.
    await db.execute("DELETE FROM offline_queue");
    for (const p of held.slice(0, 7)) await db.execute("DELETE FROM sync_state WHERE path = ?", [p]);
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(removed).toEqual([]);
    // The restore that goes through takes both.
    for (const p of held.slice(0, 2)) await queue.queueDelete(p);
    const again = new Set((await queue.getPendingDeleteOperations()).map((op) => op.id));
    expect(await queue.discardDeletesForRestore(again)).toEqual(held.slice(0, 2));
    expect(await queued()).toEqual([]);
  });

  it("queues the same unconfirmed entries a report queues: the mass-deletion guard counts 30 owed like 30 reported", async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Bulk/n${i}.md`);
    for (const p of names) await synced(p);
    for (const p of names) await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    const { h } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 30, writes: 0, failed: 0 });
    const owed = await new SyncQueue(db).getPendingDeleteOperations();
    // The guard holds unconfirmed deletions (SyncWorker, MASS_DELETE_MIN): these are unconfirmed, as reported ones are.
    expect(owed).toHaveLength(30);
    expect(owed.every((op) => op.delete_confirmed_at == null)).toBe(true);
  });

  it("drops marks that are settled: the worker's own mirrored deletion, a path indexed again, a file back, a queued rename", async () => {
    for (const p of ["Mirrored.md", "Again.md", "Back.md", "Moved.md"]) await synced(p);
    for (const p of ["Mirrored.md", "Again.md", "Back.md", "Moved.md"]) await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    // The worker mirrored a remote deletion: its sync row went first (review m5).
    await db.execute("DELETE FROM sync_state WHERE path = 'Mirrored.md'");
    // Written again and indexed; back on disk without a row; renamed away in the queue.
    await vault.writeTextFile("Again.md", "# again\n");
    await new VaultIndexer(vault, db).indexFile(await vault.getFileInfo("Again.md"));
    await fs.writeFile(onDisk("Back.md"), "# back\n", "utf8");
    await db.execute("INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES ('Moved.md', 'rename', 'Elsewhere.md', 1)");
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(removed).toEqual([]);
    expect(await db.query("SELECT path FROM index_removed")).toEqual([]);
  });

  it("decides nothing while the vault's folder is away, or a look fails: the marks wait", async () => {
    await lostDeletion("Gone.md");
    const { h } = handlers();
    expect(await sweepPlainOwed(db, { ...h, vaultIsThere: async () => false })).toEqual({ deletions: 0, writes: 0, failed: 0 });
    let asked = 0;
    expect(await sweepPlainOwed(db, { ...h, vaultIsThere: async () => ++asked === 1 })).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(await markOf("Gone.md")).toBe(1);
    // A handler that throws keeps the mark for the next start (no shell's does: see "answers what happened" below).
    expect(await sweepPlainOwed(db, { ...h, remove: async () => { throw new Error("database is locked"); } })).toEqual({ deletions: 0, writes: 0, failed: 1 });
    expect(await markOf("Gone.md")).toBe(1);
    expect(await queued()).toEqual([]);
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
  });

  it("an older build's removal carries no mark and stays inert, as it always was", async () => {
    await synced("Old.md");
    await fs.rm(onDisk("Old.md"));
    // v0.8.7 removes the row and writes no mark.
    await db.execute("DELETE FROM files WHERE path = 'Old.md'");
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(removed).toEqual([]);
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

  it("a committed entry takes the mark off its path where it committed the row's content — it never did — and a discarded one too", async () => {
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

  it("a commit of older content leaves the mark of a newer change the index wrote meanwhile (review m1)", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await vault.writeTextFile("a.md", "# S1\n");
    await new VaultIndexer(vault, db).indexVaultFull("open");
    const s1 = await sha("a.md");
    const entry = await state.enqueue("write", "a.md");
    // While S1 uploads, another program writes S2 and the index marks it; the app ends before its entry.
    await fs.writeFile(onDisk("a.md"), "# S2\n", "utf8");
    await fs.utimes(onDisk("a.md"), new Date(), new Date(Date.now() + 5000));
    await new VaultIndexer(vault, db, { onExternalModification: () => {} }).indexVaultFull("automatic refresh");
    await commit(state, entry, "a.md", s1);
    expect(await markOf("a.md")).toBe("local_ahead");
    const queuedNow: string[] = [];
    const { h } = handlers({ write: async (p) => { queuedNow.push(p); await state.enqueue("write", p); return "queued"; } });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 1, failed: 0 });
    expect(queuedNow).toEqual(["a.md"]);
  });

  it("a change the index marked and an ended app never queued is queued by the sweep — before R22, nothing ever did", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await lostChange(state, "Note.md");
    expect(await state.listQueue(), "nothing queued it").toEqual([]);
    const { h, written } = handlers({ write: async (p) => { written.push(p); await state.enqueue("write", p); return "queued"; } });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 1, failed: 0 });
    expect(written).toEqual(["Note.md"]);
    expect((await state.listQueue()).map((e) => `${e.operation} ${e.path}`)).toEqual(["write Note.md"]);
    // Queued: the next sweep finds nothing owed.
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
  });

  it("a change the workspace's policy refuses is offered once: no second fork at the next start (review M2)", async () => {
    const state = new SqlWorkspaceStateStore(db);
    await lostChange(state, "Theirs.md");
    // The permission check refuses, keeps a fork and queues nothing.
    const forks: string[] = [];
    const { h } = handlers({ write: async (p) => { forks.push(p); return "refused"; }, remove: async (p) => { forks.push(`delete ${p}`); return "refused"; } });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(forks).toEqual(["Theirs.md"]);
    expect(await markOf("Theirs.md")).toBe("synced");
  });

  it("a deletion owed to the workspace is queued once, by its mark; a refused one is not offered again; a mark on content that is up goes", async () => {
    const state = new SqlWorkspaceStateStore(db);
    for (const p of ["Up.md", "Gone.md", "Refused.md"]) await vault.writeTextFile(p, `# ${p}\n`);
    await new VaultIndexer(vault, db).indexVaultFull("open");
    for (const p of ["Up.md", "Gone.md", "Refused.md"]) await commit(state, await state.enqueue("write", p), p, await sha(p));
    // An index older than R22 left the mark on a change that went up.
    await db.execute("UPDATE files SET sync_state = 'local_ahead' WHERE path = 'Up.md'");
    for (const p of ["Gone.md", "Refused.md"]) await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    const asked: string[] = [];
    const { h, written } = handlers({
      remove: async (p) => {
        asked.push(p);
        if (p !== "Gone.md") return "refused";
        await state.enqueue("delete", p);
        return "queued";
      },
    });
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
    expect(written).toEqual([]);
    expect(asked).toEqual(["Gone.md", "Refused.md"]);
    expect(await markOf("Up.md")).toBe("synced");
    expect((await state.listQueue()).map((e) => `${e.operation} ${e.path}`)).toEqual(["delete Gone.md"]);
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 0 });
    expect(asked).toEqual(["Gone.md", "Refused.md"]);
  });
});

describe("the hosts' queueing answers what happened, and only a queued or refused entry settles a debt (review F1-F4)", () => {
  const markOf = async (p: string) => (await db.query("SELECT path FROM index_removed WHERE path = ?", [p])).length;
  const stateOf = async (p: string) => (await db.queryOne<{ sync_state: string }>("SELECT sync_state FROM files WHERE path = ?", [p]))?.sync_state;

  /** Removed on disk and marked by the index; the app ended before anything was queued. */
  async function owedDeletion(...paths: string[]) {
    for (const p of paths) await synced(p);
    for (const p of paths) await fs.rm(onDisk(p));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    for (const p of paths) expect(await markOf(p), `the scene: ${p} is marked`).toBe(1);
  }

  /** The plain queue, whose next entries fail while `failing.on` is set (a locked or closing database). */
  function failingQueue() {
    const queue = new SyncQueue(db);
    const failing = { on: true, deletionCalls: 0 };
    const plain = {
      queueWrite: async (p: string) => { if (failing.on) throw new Error("database is locked"); await queue.queueWrite(p); },
      queueDeletePaths: async (ps: readonly string[]) => {
        failing.deletionCalls += 1;
        if (failing.on) throw new Error("database is locked");
        await queue.queueDeletePaths(ps);
      },
    };
    return { plain, failing };
  }

  /** The desktop's queueing (VaultContext): an entry made directly, its error logged — and now answered. */
  function desktopShaped(plain: ReturnType<typeof failingQueue>["plain"]) {
    const local = createLocalQueueing({ queuesChanges: () => true, plain: () => plain, workspace: () => null, onError: () => {} });
    const h: OwedSweepHandlers = {
      vaultIsThere: () => vault.exists(""),
      stillGone: async (p) => !(await vault.exists(p)),
      remove: local.deletion,
      removeAll: local.deletions,
      write: local.change,
    };
    return { local, h };
  }

  it("F1: a deletion whose entry fails during the sweep keeps its mark and is queued at the next start — it used to be lost for good", async () => {
    await owedDeletion("Gone.md");
    const { plain, failing } = failingQueue();
    const { h } = desktopShaped(plain);
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 1 });
    expect(await markOf("Gone.md"), "the debt is still written down").toBe(1);
    expect(await queued()).toEqual([]);
    failing.on = false;
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
    expect(await queued()).toEqual(["delete Gone.md"]);
    expect(await markOf("Gone.md")).toBe(0);
  });

  it("F1b: a workspace change whose entry fails keeps local_ahead, its only record; a refused one is offered once", async () => {
    const state = new SqlWorkspaceStateStore(db);
    for (const p of ["Fails.md", "Refused.md"]) await vault.writeTextFile(p, "# first\n");
    await new VaultIndexer(vault, db).indexVaultFull("open");
    for (const p of ["Fails.md", "Refused.md"]) {
      await fs.writeFile(onDisk(p), "# changed elsewhere\n", "utf8");
      await fs.utimes(onDisk(p), new Date(), new Date(Date.now() + 5000));
    }
    await new VaultIndexer(vault, db, { onExternalModification: () => {} }).indexVaultFull("automatic refresh");
    let fail = true;
    const offered: string[] = [];
    const local = createLocalQueueing({
      queuesChanges: () => true,
      permission: () => async (p) => { offered.push(p); return p !== "Refused.md"; },
      workspace: () => ({
        enqueue: async (op, p) => { if (fail) throw new Error("database is locked"); return state.enqueue(op, p); },
      }),
      onError: () => {},
    });
    const h: OwedSweepHandlers = { vaultIsThere: () => vault.exists(""), stillGone: async (p) => !(await vault.exists(p)), remove: local.deletion, write: local.change };
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 0, failed: 1 });
    expect(await stateOf("Fails.md")).toBe("local_ahead");
    expect(await stateOf("Refused.md")).toBe("synced");
    fail = false;
    expect(await sweepWorkspaceOwed(db, h)).toEqual({ deletions: 0, writes: 1, failed: 0 });
    expect((await state.listQueue()).map((e) => `${e.operation} ${e.path}`)).toEqual(["write Fails.md"]);
    expect(offered).toEqual(["Fails.md", "Refused.md", "Fails.md"]);
  });

  it("F1: a permission check that fails is a failure, not a refusal", async () => {
    await owedDeletion("Gone.md");
    const queue = new SyncQueue(db);
    const local = createLocalQueueing({
      queuesChanges: () => true,
      permission: () => async () => { throw new Error("the workspace is locked"); },
      plain: () => queue,
      onError: () => {},
    });
    expect(await local.deletion("Gone.md")).toBe("failed");
    expect(await local.change("Note.md")).toBe("failed");
  });

  it("F2: a queued write settles no deletion — edited offline, deleted, ended before the deletion was queued", async () => {
    await synced("A.md");
    await new SyncQueue(db).queueWrite("A.md");
    await fs.rm(onDisk("A.md"));
    await new VaultIndexer(vault, db, { onLocalFileDeleted: () => {} }).indexVaultFull("automatic refresh");
    const { h, removed } = handlers();
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
    expect(removed).toEqual(["A.md"]);
    expect(await queued()).toContain("delete A.md");
  });

  it("F3: one rule for internal paths in the host and the sweep — `notes.plainva.md` is a note, `.plainva/` is not", async () => {
    await owedDeletion("notes.plainva.md");
    const { plain, failing } = failingQueue();
    failing.on = false;
    const { local, h } = desktopShaped(plain);
    expect(await local.deletion(".plainva/cache/x.json")).toBe("refused");
    expect(await local.change("Folder/a.CONFLICT.md")).toBe("refused");
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 1, writes: 0, failed: 0 });
    expect(await queued()).toEqual(["delete notes.plainva.md"]);
  });

  it("F4: the plain sweep queues its deletions in one transaction: a cycle never sees a slice under the mass-deletion threshold", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `Bulk/n${i}.md`);
    await owedDeletion(...names);
    const { plain, failing } = failingQueue();
    failing.on = false;
    const { h } = desktopShaped(plain);
    expect(await sweepPlainOwed(db, h)).toEqual({ deletions: 12, writes: 0, failed: 0 });
    expect(failing.deletionCalls, "one call: one transaction").toBe(1);
    expect(await queued()).toHaveLength(12);
  });
});
