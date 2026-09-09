import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realSqlite } from "../helpers/realSqlite.js";
import { initializeSchema } from "../../src/db/Schema.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { DeletionJournal } from "../../src/sync/deletionJournal.js";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.js";

describe("operation-specific deletion confirmation", () => {
  let db: Awaited<ReturnType<typeof realSqlite>>;
  let root: string;
  let raw: LocalVaultAdapter;
  let queue: SyncQueue;
  let chain: ConflictAwareVaultAdapter;
  let state: SyncStateRepository;
  let target: ISyncTarget;
  let remote: Map<string, string>;
  let deleted: string[];

  beforeEach(async () => {
    db = await realSqlite();
    root = await mkdtemp(join(tmpdir(), "plainva-delete-confirmation-"));
    raw = new LocalVaultAdapter(root);
    await raw.initialize();
    queue = new SyncQueue(db);
    state = new SyncStateRepository(db);
    chain = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(raw), queue), state);
    remote = new Map();
    deleted = [];
    target = {
      async push(op) {
        if (op.operation === "delete") {
          deleted.push(op.file_path);
          for (const p of remote.keys()) if (p === op.file_path || p.startsWith(op.file_path + "/")) remote.delete(p);
        } else if (op.operation === "write") {
          remote.set(op.file_path, new TextDecoder().decode(op.content));
        }
      },
      async pull() {
        return { etagMap: new Map([...remote.keys()].filter((p) => !p.startsWith(".plainva")).map((p) => [p, "remote-etag"])) };
      },
      async download(p) { return remote.has(p) ? new TextEncoder().encode(remote.get(p)) : null; },
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
  function worker(journal?: DeletionJournal) {
    const result = new SyncWorker(new SyncEngine(queue, target, chain, state), target, state, raw, queue, 60000, { deletionJournal: journal });
    result["isRunning"] = true;
    return result;
  }
  async function seed(p: string) {
    await raw.writeTextFile(p, "preserve me");
    remote.set(p, "preserve me");
    await db.execute("INSERT OR REPLACE INTO sync_state (path, remote_etag, last_sync_ts) VALUES (?, 'remote-etag', 1)", [p]);
  }
  async function batch(prefix: string, count = 12, confirmed = false) {
    for (let i = 0; i < count; i++) {
      const p = prefix + i + ".md";
      await seed(p);
      if (confirmed) await chain.deleteItem(p, false, { confirmed: true });
      else {
        await raw.deleteItem(p);
        await queue.queueDelete(p);
      }
    }
  }
  const approveWithoutScheduling = (w: SyncWorker) => {
    w["isRunning"] = false;
    w.approveMassDeletion();
    w["isRunning"] = true;
  };

  it("migrates old queued deletes as unconfirmed and keeps their identities", async () => {
    await db.execute("ALTER TABLE offline_queue DROP COLUMN delete_confirmed_at");
    await db.execute("ALTER TABLE offline_queue DROP COLUMN delete_journaled");
    await db.execute("INSERT INTO offline_queue (file_path, operation, queued_at) VALUES ('old.md', 'delete', 1)");
    const before = await db.queryOne<SyncOperation>("SELECT * FROM offline_queue");
    await initializeSchema(db);
    await initializeSchema(db);
    expect(await queue.getPendingDeleteOperations()).toMatchObject([{ id: before!.id, delete_confirmed_at: null, delete_journaled: 0 }]);
  });

  it("preserves a successful confirmation across retries, repeated scans and a new queue instance", async () => {
    await seed("note.md");
    await chain.deleteItem("note.md", false, { confirmed: true });
    const [original] = await queue.getPendingDeleteOperations();
    await queue.incrementRetry(original.id, Date.now() + 60000, "network unavailable");
    queue = new SyncQueue(db);
    await queue.queueDelete("note.md");
    const pending = await queue.getPendingDeleteOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: original.id, delete_confirmed_at: original.delete_confirmed_at, retry_count: 1 });
    expect(pending[0].delete_confirmed_at).toBeTypeOf("number");
  });

  it("does not retain a confirmation when the actual delete fails", async () => {
    await seed("note.md");
    vi.spyOn(raw, "deleteItem").mockRejectedValue(new Error("access denied"));
    await expect(chain.deleteItem("note.md", false, { confirmed: true })).rejects.toThrow("access denied");
    expect(await queue.getPendingDeleteOperations()).toEqual([]);
    expect(await raw.readTextFile("note.md")).toBe("preserve me");
  });

  it("confirms only the folder and its actually removed children", async () => {
    await seed("folder/a.md");
    await seed("folder/sub/b.md");
    await seed("sibling/keep.md");
    await chain.deleteItem("folder", true, { confirmed: true });
    const rows = await queue.getPendingDeleteOperations();
    expect(rows.map((r) => r.file_path).sort()).toEqual(["folder", "folder/a.md", "folder/sub/b.md"]);
    expect(rows.every((r) => r.delete_confirmed_at === rows[0].delete_confirmed_at)).toBe(true);
    expect(rows[0].delete_confirmed_at).toBeTypeOf("number");
    expect(await raw.exists("folder")).toBe(false);
    expect(await raw.exists("sibling/keep.md")).toBe(true);
  });

  it("does not delete or confirm a folder when its listing is incomplete", async () => {
    await seed("folder/a.md");
    Object.assign(raw, { listDirReport: vi.fn().mockResolvedValue({ files: [], skipped: [{ path: "folder/a.md", reason: "unreadable" }] }) });
    await expect(chain.deleteItem("folder", true, { confirmed: true })).rejects.toThrow("could not be read");
    expect(await queue.getPendingDeleteOperations()).toEqual([]);
    expect(await raw.exists("folder/a.md")).toBe(true);
  });

  it("keeps delete/recreate/delete as different operations without inherited confirmation", async () => {
    await seed("note.md");
    await chain.deleteItem("note.md", false, { confirmed: true });
    await chain.writeTextFile("note.md", "new document");
    await chain.deleteItem("note.md");
    const rows = await queue.getPendingDeleteOperations();
    expect(rows).toHaveLength(2);
    expect(rows[0].delete_confirmed_at).toBeTypeOf("number");
    expect(rows[1].delete_confirmed_at).toBeNull();
    expect(rows[1].id).toBeGreaterThan(rows[0].id);
    await queue.queueDelete("note.md");
    expect(await queue.getPendingDeleteOperations()).toHaveLength(2);
  });

  it("keeps folder recreation as a new generation even when the first mkdir is still queued", async () => {
    await chain.createDir("folder");
    await chain.deleteItem("folder", true, { confirmed: true });
    await chain.createDir("folder");
    await chain.deleteItem("folder", true);
    const rows = await queue.getPendingDeleteOperations();
    expect(rows).toHaveLength(2);
    expect(rows[0].delete_confirmed_at).toBeTypeOf("number");
    expect(rows[1].delete_confirmed_at).toBeNull();
    expect(await db.query("SELECT * FROM offline_queue WHERE operation = 'mkdir'")).toHaveLength(2);
  });

  it("gives a fresh confirmed filesystem deletion its own ID even if an external recreation was not indexed", async () => {
    await seed("note.md");
    await chain.deleteItem("note.md", false, { confirmed: true });
    await raw.writeTextFile("note.md", "external recreation");
    await chain.deleteItem("note.md", false, { confirmed: true });
    const rows = await queue.getPendingDeleteOperations();
    expect(rows).toHaveLength(2);
    expect(rows[1].id).not.toBe(rows[0].id);
  });

  it("does not use old journal paths to approve a new mass deletion", async () => {
    await batch("old/");
    const journal = new DeletionJournal(raw, "device");
    await journal.recordPathEntries([{ path: "old", deletedAt: Date.now() - 60000 }]);
    const w = worker(journal);
    const prompt = vi.fn();
    w.onMassDeletionPending = prompt;
    await w.runCycle();
    expect(prompt).toHaveBeenCalledOnce();
    expect(deleted).toEqual([]);
    expect(await queue.getPendingDeleteOperations()).toHaveLength(12);
  });

  it("journals a confirmed queue operation with its original timestamp after restart", async () => {
    await batch("confirmed/", 12, true);
    const initial = await queue.getPendingDeleteOperations();
    queue = new SyncQueue(db);
    const journal = new DeletionJournal(raw, "device", { now: () => Date.now() + 86400000 });
    const w = worker(journal);
    const prompt = vi.fn();
    w.onMassDeletionPending = prompt;
    await w.runCycle();
    expect(prompt).not.toHaveBeenCalled();
    expect(deleted).toHaveLength(12);
    expect(journal.list().find((e) => e.kind === "path" && e.path === initial[0].file_path)?.deletedAt).toBe(initial[0].delete_confirmed_at);
  });

  it("keeps the confirmed operation if its intent cannot be saved in the journal", async () => {
    await seed("note.md");
    await chain.deleteItem("note.md", false, { confirmed: true });
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementation(async (p, text) => {
      if (p === ".plainva/sync/deletions.json") throw new Error("journal disk error");
      return write(p, text);
    });
    await worker(new DeletionJournal(raw, "device")).runCycle();
    expect(deleted).toEqual([]);
    expect(await queue.getPendingDeleteOperations()).toMatchObject([{ file_path: "note.md", delete_journaled: 0 }]);
  });

  it("approves only the displayed IDs while a new mass deletion asks separately", async () => {
    await batch("first-");
    const w = worker();
    const prompt = vi.fn();
    w.onMassDeletionPending = prompt;
    await w.runCycle();
    await batch("later-");
    approveWithoutScheduling(w);
    await w.runCycle();
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveLength(12);
    expect(deleted.every((p) => p.startsWith("first-"))).toBe(true);
    expect((await queue.getPendingDeleteOperations()).every((op) => op.file_path.startsWith("later-"))).toBe(true);
  });

  it("does not authorize a new queue row arriving after the guard snapshot", async () => {
    await seed("initial.md");
    await raw.deleteItem("initial.md");
    await queue.queueDelete("initial.md");
    const get = queue.getPendingOperations.bind(queue);
    vi.spyOn(queue, "getPendingOperations").mockImplementationOnce(async () => {
      await queue.queueDelete("late.md");
      return get();
    });
    await worker().runCycle();
    expect(deleted).toEqual(["initial.md"]);
    expect(await queue.getPendingDeleteOperations()).toMatchObject([{ file_path: "late.md" }]);
  });

  it("does not persist a mass-deletion approval into a new worker session", async () => {
    await batch("held-");
    const first = worker();
    await first.runCycle();
    approveWithoutScheduling(first);
    const restarted = worker();
    const prompt = vi.fn();
    restarted.onMassDeletionPending = prompt;
    await restarted.runCycle();
    expect(prompt).toHaveBeenCalledOnce();
    expect(deleted).toEqual([]);
  });

  it("restores only the displayed operations and leaves later queue rows untouched", async () => {
    await batch("shown-");
    const w = worker();
    await w.runCycle();
    await batch("later-", 2);
    w["isRunning"] = false;
    expect(await w.discardMassDeletion()).toBe(12);
    const pending = await queue.getPendingDeleteOperations();
    expect(pending).toHaveLength(2);
    expect(pending.every((op) => op.file_path.startsWith("later-"))).toBe(true);
  });
});

