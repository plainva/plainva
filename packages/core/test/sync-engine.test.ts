import { describe, expect, it, beforeEach } from "vitest";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import { SyncEngine } from "../src/sync/SyncEngine.ts";
import { ISyncTarget, SyncOperation } from "../src/sync/ISyncTarget.ts";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

class MockSyncTarget implements ISyncTarget {
  public pushes: SyncOperation[] = [];
  public shouldFail = false;
  /** Paths whose push throws (a "poisoned" file, unlike the global shouldFail). */
  public failPaths = new Set<string>();
  /** Rename ops on these paths report a missing remote source (P1.2). */
  public renameSourceMissingPaths = new Set<string>();

  async push(op: SyncOperation): Promise<{etag?: string; renameSourceMissing?: boolean}> {
    if (this.shouldFail || this.failPaths.has(op.file_path)) {
      throw new Error("Network error");
    }
    if (op.operation === "rename" && this.renameSourceMissingPaths.has(op.file_path)) {
      return { renameSourceMissing: true };
    }
    this.pushes.push(op);
    return { etag: "mock-etag" };
  }

  async pull() { return { etagMap: new Map() }; }
  async download() { return new Uint8Array(); }
}

class MockVaultAdapter {
  /** Optional per-path contents; unknown paths read as empty bytes (legacy behavior). */
  public files = new Map<string, Uint8Array>();
  public failWith: Error | null = null;

  async readBinaryFile(path?: string) {
    if (this.failWith) throw this.failWith;
    if (path && this.files.has(path)) return this.files.get(path)!;
    return new Uint8Array();
  }
}

describe("SyncEngine", () => {
  let db: MockDatabaseAdapter;
  let queue: SyncQueue;
  let target: MockSyncTarget;
  let vault: MockVaultAdapter;
  let engine: SyncEngine;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    queue = new SyncQueue(db);
    target = new MockSyncTarget();
    vault = new MockVaultAdapter();
    engine = new SyncEngine(queue, target, vault as any);
  });

  it("processes pending operations successfully", async () => {
    db.mockedResults.push([
      { id: 1, file_path: "test.md", operation: "write", content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);
    db.mockedResults.push([]); // For markSynced

    await engine.processQueue();

    expect(target.pushes.length).toBe(1);
    expect(target.pushes[0].file_path).toBe("test.md");

    // verify markSynced was called
    const deleteQuery = db.queries.find(q => q.query.includes("DELETE FROM offline_queue"));
    expect(deleteQuery).toBeDefined();
    const deleteParams = deleteQuery?.params as any[];
    expect(deleteParams[0]).toBe(1); // queueId
  });

  it("reports push progress per pending operation (WP6)", async () => {
    db.mockedResults.push([
      { id: 1, file_path: "test.md", operation: "write", content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);
    db.mockedResults.push([]); // For markSynced

    const ticks: Array<[number, number]> = [];
    await engine.processQueue(undefined, (c, t) => ticks.push([c, t]));

    expect(ticks[0]).toEqual([0, 1]);
  });

  it("applies exponential backoff on failure", async () => {
    db.mockedResults.push([
      { id: 2, file_path: "fail.md", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);

    target.shouldFail = true;

    await engine.processQueue();

    expect(target.pushes.length).toBe(0);

    // verify incrementRetry was called
    const updateQuery = db.queries.find(q =>
      q.query.includes("UPDATE offline_queue") &&
      q.query.includes("retry_count = retry_count + 1") &&
      q.query.includes("next_retry_at = ?")
    );
    expect(updateQuery).toBeDefined();
    const updateParams = updateQuery?.params as any[];
    expect(updateParams[2]).toBe(2); // queueId

    // Delay should be ~ 10 seconds (10000 ms) because backoffMinutes[0] = 0.166 => ~9960ms
    const nextRetryAt = updateParams[0] as number;
    expect(nextRetryAt).toBeGreaterThan(Date.now() + 9000);
    expect(nextRetryAt).toBeLessThan(Date.now() + 11000);
  });

  it("a failing file does not block pushes of other files (P1.3)", async () => {
    // Per-file FIFO is preserved by SyncQueue itself (it only ever returns the
    // earliest pending op per path), so skipping a poisoned file is safe.
    db.mockedResults.push([
      { id: 1, file_path: "poisoned.md", operation: "write", content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 1 },
      { id: 2, file_path: "healthy.md", operation: "write", content: new Uint8Array([2]), retry_count: 0, next_retry_at: 0, queued_at: 2 }
    ]);
    target.failPaths.add("poisoned.md");

    await engine.processQueue();

    expect(target.pushes.map(p => p.file_path)).toEqual(["healthy.md"]);
    const retryUpdates = db.queries.filter(q => q.query.includes("retry_count = retry_count + 1"));
    expect(retryUpdates.length).toBe(1);
    expect((retryUpdates[0].params as any[]).at(-1)).toBe(1);
  });

  it("stops the cycle after three consecutive failures (outage heuristic)", async () => {
    db.mockedResults.push([
      { id: 1, file_path: "a.md", operation: "write", content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 1 },
      { id: 2, file_path: "b.md", operation: "write", content: new Uint8Array([2]), retry_count: 0, next_retry_at: 0, queued_at: 2 },
      { id: 3, file_path: "c.md", operation: "write", content: new Uint8Array([3]), retry_count: 0, next_retry_at: 0, queued_at: 3 },
      { id: 4, file_path: "d.md", operation: "write", content: new Uint8Array([4]), retry_count: 0, next_retry_at: 0, queued_at: 4 }
    ]);
    target.shouldFail = true; // provider down: everything fails

    await engine.processQueue();

    expect(target.pushes.length).toBe(0);
    // Ops 1-3 burn a retry each, then the cycle stops — op 4's budget is untouched.
    const retryUpdates = db.queries.filter(q => q.query.includes("retry_count = retry_count + 1"));
    expect(retryUpdates.map(q => (q.params as any[]).at(-1))).toEqual([1, 2, 3]);
  });

  it("uploads at the new path when the rename source is missing remotely (P1.2)", async () => {
    db.mockedResults.push([
      { id: 7, file_path: "old.md", operation: "rename", new_path: "new.md", retry_count: 0, next_retry_at: 0, queued_at: 1 }
    ]);
    target.renameSourceMissingPaths.add("old.md");
    vault.files.set("new.md", new Uint8Array([42]));

    await engine.processQueue();

    // The engine fell back to a write push at the NEW path instead of
    // reporting silent success (which would leave the file under no remote path).
    expect(target.pushes.length).toBe(1);
    expect(target.pushes[0].operation).toBe("write");
    expect(target.pushes[0].file_path).toBe("new.md");
    expect(Array.from(target.pushes[0].content ?? [])).toEqual([42]);

    const deleteQuery = db.queries.find(q => q.query.includes("DELETE FROM offline_queue"));
    expect((deleteQuery?.params as any[])[0]).toBe(7); // op marked synced
  });

  it("marks the rename synced when source is missing remotely AND locally", async () => {
    db.mockedResults.push([
      { id: 8, file_path: "old.md", operation: "rename", new_path: "new.md", retry_count: 0, next_retry_at: 0, queued_at: 1 }
    ]);
    target.renameSourceMissingPaths.add("old.md");
    const notFound = new Error("not found");
    notFound.name = "VaultFileNotFoundError";
    vault.failWith = notFound; // local file gone too (a delete op follows in the queue)

    await engine.processQueue();

    expect(target.pushes.length).toBe(0);
    const deleteQuery = db.queries.find(q => q.query.includes("DELETE FROM offline_queue"));
    expect((deleteQuery?.params as any[])[0]).toBe(8);
  });

  it("marks an operation for manual intervention after the fifth failure", async () => {
    db.mockedResults.push([
      { id: 5, file_path: "stuck.md", operation: "write", content: new Uint8Array([1]), retry_count: 4, next_retry_at: 0, queued_at: 0 }
    ]);
    target.shouldFail = true;

    await engine.processQueue();

    const manualUpdate = db.queries.find(q => q.query.includes("requires_manual_intervention = 1"));
    expect(manualUpdate).toBeDefined();
    expect((manualUpdate?.params as any[]).at(-1)).toBe(5);
  });

  it("persists the push remoteId for id-based providers (Drive)", async () => {
    // Drive-like target returning a remote id alongside the etag.
    const driveTarget: ISyncTarget = {
      async push() { return { etag: "md5-xyz", remoteId: "drive-file-1" }; },
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
    };
    const repo = new SyncStateRepository(db);
    const engineWithState = new SyncEngine(queue, driveTarget, vault as any, repo);

    db.mockedResults.push([
      { id: 1, file_path: "d.md", operation: "write", content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);
    db.mockedResults.push([]); // getSyncState -> null (skip the base-sha shortcut)

    await engineWithState.processQueue();

    // updateRemoteState upserts: params [path, remoteEtag, remoteId, syncTs].
    const upsert = db.queries.find(q =>
      q.query.includes("INSERT INTO sync_state") && q.query.includes("remote_id = excluded.remote_id")
    );
    expect(upsert).toBeDefined();
    expect((upsert!.params as any[])[2]).toBe("drive-file-1");
  });

  it("advances the merge base after a write push even without an ETag", async () => {
    // Many WebDAV servers omit the ETag header on PUT. The base must still advance to
    // the pushed content; otherwise a later pull reconciles the next local edit against
    // a stale base and produces spurious .CONFLICT files.
    const noEtagTarget: ISyncTarget = {
      async push() { return {}; }, // no etag returned
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
    };
    const repo = new SyncStateRepository(db);
    const vaultWithContent = { async readBinaryFile() { return new Uint8Array([1, 2, 3]); } };
    const engineWithState = new SyncEngine(queue, noEtagTarget, vaultWithContent as any, repo);

    db.mockedResults.push([
      { id: 1, file_path: "notes/db.base", operation: "write", content: new Uint8Array([1, 2, 3]), retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);
    db.mockedResults.push([]); // getSyncState -> null (skip the base-sha shortcut)

    await engineWithState.processQueue();

    const baseUpsert = db.queries.find(q =>
      q.query.includes("INSERT INTO sync_state") && q.query.includes("base_sha256 = excluded.base_sha256")
    );
    expect(baseUpsert).toBeDefined();
    // .base is a text file -> base_text is recorded for 3-way merge.
    const baseTextUpsert = db.queries.find(q =>
      q.query.includes("INSERT INTO sync_state") && q.query.includes("base_text = excluded.base_text")
    );
    expect(baseTextUpsert).toBeDefined();
  });

  it("defers a write push when the remote moved since our base (3b optimistic-concurrency)", async () => {
    // Between our last sync and this push, another writer changed the remote. Overwriting
    // now would clobber that change with no .CONFLICT (the reported data loss). The engine
    // probes the current remote marker; when it no longer matches base_etag it defers the
    // push (leaving the next cycle's reconcile to merge) instead of overwriting.
    const pushes: SyncOperation[] = [];
    const probed: string[] = [];
    const guardTarget: ISyncTarget = {
      async push(op) { pushes.push(op); return { etag: "x" }; },
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
      async remoteEtag(p) { probed.push(p); return "remote-moved-on"; },
    };
    const repo = new SyncStateRepository(db);
    const vaultWithContent = { async readBinaryFile() { return new Uint8Array([9, 9, 9]); } };
    const engineWithState = new SyncEngine(queue, guardTarget, vaultWithContent as any, repo);

    db.mockedResults.push([
      { id: 1, file_path: "note.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 0 },
    ]); // getPendingOperations
    db.mockedResults.push([
      { path: "note.md", local_sha256: "l", base_sha256: "base-sha", base_etag: "base-etag", remote_etag: "base-etag" },
    ]); // getSyncState: base_sha differs from the content sha -> a real local edit

    await engineWithState.processQueue();

    expect(probed).toEqual(["note.md"]); // the remote was probed
    expect(pushes.length).toBe(0);       // ...and the push was deferred, not sent
    const retry = db.queries.find(q =>
      q.query.includes("retry_count = retry_count + 1") && q.query.includes("next_retry_at = ?")
    );
    expect(retry).toBeDefined();
  });

  it("pushes normally when the remote etag still matches our base (3b: no false defer)", async () => {
    const pushes: SyncOperation[] = [];
    const guardTarget: ISyncTarget = {
      async push(op) { pushes.push(op); return { etag: "same-etag" }; },
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
      async remoteEtag() { return "base-etag"; }, // == base_etag -> remote did not move
    };
    const repo = new SyncStateRepository(db);
    const vaultWithContent = { async readBinaryFile() { return new Uint8Array([9, 9, 9]); } };
    const engineWithState = new SyncEngine(queue, guardTarget, vaultWithContent as any, repo);

    db.mockedResults.push([
      { id: 1, file_path: "note.md", operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 0 },
    ]);
    db.mockedResults.push([
      { path: "note.md", local_sha256: "l", base_sha256: "base-sha", base_etag: "base-etag", remote_etag: "base-etag" },
    ]);
    db.mockedOneResults.push(null); // markSynced: no other pending op -> mark file synced

    await engineWithState.processQueue();

    expect(pushes.length).toBe(1);
    expect(pushes[0].file_path).toBe("note.md");
  });

  it("marks renamed files synced by their new path", async () => {
    db.mockedResults.push([
      { id: 9, file_path: "old.md", operation: "rename", new_path: "new.md", retry_count: 0, next_retry_at: 0, queued_at: 0 }
    ]);
    db.mockedOneResults.push(null);

    await engine.processQueue();

    const updateQuery = db.queries.find(q => q.query.includes("UPDATE files SET sync_state = 'synced'"));
    expect(updateQuery?.params).toEqual(["new.md"]);
  });
});
