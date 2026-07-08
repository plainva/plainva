import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("SyncQueue", () => {
  let tmpDir: string;
  let vaultAdapter: LocalVaultAdapter;
  let db: MockDatabaseAdapter;
  let queue: SyncQueue;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-sync-"));
    vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();

    db = new MockDatabaseAdapter();
    await db.initialize();

    queue = new SyncQueue(db);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("queues a write and updates sync state", async () => {
    await queue.queueWrite("note.md");
    
    const insertQ = db.queries.find(q => q.query.includes("INSERT INTO offline_queue") && q.params.includes("write"));
    expect(insertQ).toBeDefined();
    expect(insertQ?.params).toContain("note.md");

    const updateQ = db.queries.find(q => q.query.includes("UPDATE files SET sync_state = 'local_ahead'"));
    expect(updateQ).toBeDefined();
  });

  it("queues a delete and updates sync state", async () => {
    await queue.queueDelete("note.md");
    
    const insertQ = db.queries.find(q => q.query.includes("INSERT INTO offline_queue") && q.params.includes("delete"));
    expect(insertQ).toBeDefined();

    const updateQ = db.queries.find(q => q.query.includes("is_deleted = 1"));
    expect(updateQ).toBeDefined();
  });

  it("marks a queue item as synced", async () => {
    // mock the check for remaining pending items to return null
    db.mockedOneResults.push(null);
    
    await queue.markSynced(1, "note.md");

    const deleteQ = db.queries.find(q => q.query.includes("DELETE FROM offline_queue"));
    expect(deleteQ).toBeDefined();

    const updateQ = db.queries.find(q => q.query.includes("UPDATE files SET sync_state = 'synced'"));
    expect(updateQ).toBeDefined();
  });

  it("marks the new path as synced after a rename operation", async () => {
    db.mockedOneResults.push(null);

    await queue.markSynced(7, "old.md", "new.md");

    const pendingQ = db.queries.find(q => q.query.includes("SELECT id FROM offline_queue"));
    expect(pendingQ?.params).toEqual(["old.md", "new.md", "new.md"]);

    const updateQ = db.queries.find(q => q.query.includes("UPDATE files SET sync_state = 'synced'"));
    expect(updateQ?.params).toEqual(["new.md"]);
  });

  it("does not mark a file synced while another pending operation remains", async () => {
    db.mockedOneResults.push({ id: 2 });

    await queue.markSynced(1, "note.md");

    const updateQ = db.queries.find(q => q.query.includes("UPDATE files SET sync_state = 'synced'"));
    expect(updateQ).toBeUndefined();
  });

  it("returns only the earliest pending operation per file (per-file FIFO)", async () => {
    db.mockedResults.push([
      { id: 1, file_path: "a.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 1 },
      { id: 2, file_path: "a.md", operation: "rename", new_path: "b.md", retry_count: 0, next_retry_at: 0, queued_at: 2 },
      { id: 3, file_path: "c.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 3 },
    ]);

    const pending = await queue.getPendingOperations(1000);

    // a.md exposes only its head (id 1); its later op (id 2) stays blocked; c.md proceeds.
    expect(pending.map(o => o.id)).toEqual([1, 3]);
  });

  it("keeps later same-file operations blocked while the head op is in backoff", async () => {
    const now = 1000;
    db.mockedResults.push([
      { id: 1, file_path: "a.md", operation: "write", retry_count: 1, next_retry_at: now + 5000, queued_at: 1 },
      { id: 2, file_path: "a.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 2 },
      { id: 3, file_path: "c.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 3 },
    ]);

    const pending = await queue.getPendingOperations(now);

    // a.md head is in backoff -> the whole file waits (id 2 must not leapfrog); c.md is independent.
    expect(pending.map(o => o.id)).toEqual([3]);
  });

  it("blocks later same-file ops when the head requires manual intervention", async () => {
    db.mockedResults.push([
      { id: 1, file_path: "a.md", operation: "write", retry_count: 5, next_retry_at: 0, requires_manual_intervention: 1, queued_at: 1 },
      { id: 2, file_path: "a.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 2 },
    ]);

    const pending = await queue.getPendingOperations(1000);

    expect(pending).toHaveLength(0);
  });

  it("coalesces consecutive writes to the same path", async () => {
    // No structural (rename/delete) op queued for the path.
    db.mockedOneResults.push(null);

    await queue.queueWrite("note.md");

    const coalesceDelete = db.queries.find(
      q => q.query.includes("DELETE FROM offline_queue") && q.query.includes("operation = 'write'")
    );
    expect(coalesceDelete).toBeDefined();
    expect(coalesceDelete?.params).toContain("note.md");

    const insertQ = db.queries.find(
      q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[]).includes("write")
    );
    expect(insertQ).toBeDefined();
  });

  it("does not coalesce writes when a rename or delete is queued for the path", async () => {
    // A structural op already exists for the path -> ordering must be preserved.
    db.mockedOneResults.push({ id: 9 });

    await queue.queueWrite("note.md");

    const coalesceDelete = db.queries.find(
      q => q.query.includes("DELETE FROM offline_queue") && q.query.includes("operation = 'write'")
    );
    expect(coalesceDelete).toBeUndefined();

    const insertQ = db.queries.find(
      q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[]).includes("write")
    );
    expect(insertQ).toBeDefined();
  });

  it("hasPendingStructuralOp matches only delete/rename ops (3a)", async () => {
    db.mockedOneResults.push({ id: 1 });
    expect(await queue.hasPendingStructuralOp("a.md")).toBe(true);

    const q = db.queries.find(qq => qq.query.includes("operation IN ('rename', 'delete')"));
    expect(q).toBeDefined();
    expect(q?.params).toEqual(["a.md", "a.md"]);

    db.mockedOneResults.push(null);
    expect(await queue.hasPendingStructuralOp("b.md")).toBe(false);
  });

  it("enqueueLocalOnlyFiles enqueues only files the remote has not confirmed (3c)", async () => {
    db.mockedResults.push([{ path: "new-local.md" }]); // LEFT JOIN result: no remote_etag
    db.mockedOneResults.push(null);                     // not already queued

    await queue.enqueueLocalOnlyFiles();

    const selectQ = db.queries.find(q => q.query.includes("LEFT JOIN sync_state"));
    expect(selectQ).toBeDefined();
    expect(selectQ?.query).toContain("s.remote_etag IS NULL");
    expect(selectQ?.query).toContain("NOT LIKE '.plainva%'");
    expect(selectQ?.query).toContain("NOT LIKE '%.CONFLICT%'");

    const insertQ = db.queries.find(
      q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[]).includes("new-local.md")
    );
    expect(insertQ).toBeDefined();
    expect(insertQ?.params).toContain("write");
  });

  it("enqueueLocalOnlyFiles skips files that are already queued (3c)", async () => {
    db.mockedResults.push([{ path: "already.md" }]);
    db.mockedOneResults.push({ id: 5 }); // already queued

    await queue.enqueueLocalOnlyFiles();

    const insertQ = db.queries.find(
      q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[]).includes("already.md")
    );
    expect(insertQ).toBeUndefined();
  });
});
