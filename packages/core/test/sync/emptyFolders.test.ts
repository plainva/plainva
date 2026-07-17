import { describe, expect, it, beforeEach } from "vitest";
import { MockDatabaseAdapter } from "../mocks/MockDatabaseAdapter.ts";
import { SyncQueue } from "../../src/sync/SyncQueue.ts";
import { SyncEngine } from "../../src/sync/SyncEngine.ts";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.ts";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.ts";

// Empty-folder sync (maintainer request 2026-07-17): folders created in the
// app reach the cloud right away (mkdir queue op -> ISyncTarget.createFolder),
// and empty remote folders appear locally (PullResult.folders -> worker
// createDir). Purely additive — folder deletions are never derived from the
// folders list.

describe("SyncQueue.queueMkdir", () => {
  let db: MockDatabaseAdapter;
  let queue: SyncQueue;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    queue = new SyncQueue(db);
  });

  it("inserts an mkdir row without touching file sync state", async () => {
    await queue.queueMkdir("Neu/Leer");
    const insertQ = db.queries.find((q) => q.query.includes("INSERT INTO offline_queue") && q.params.includes("mkdir"));
    expect(insertQ).toBeDefined();
    expect(insertQ?.params).toContain("Neu/Leer");
    const filesUpdate = db.queries.find((q) => q.query.includes("UPDATE files"));
    expect(filesUpdate).toBeUndefined();
  });

  it("is idempotent: a second pending mkdir for the same path is skipped", async () => {
    db.mockedOneResults.push({ id: 7 }); // the existing-row probe finds one
    await queue.queueMkdir("Neu/Leer");
    const insertQ = db.queries.find((q) => q.query.includes("INSERT INTO offline_queue") && q.params.includes("mkdir"));
    expect(insertQ).toBeUndefined();
  });
});

describe("QueueingVaultAdapter.createDir", () => {
  it("queues an mkdir for vault folders and skips device-local paths", async () => {
    const db = new MockDatabaseAdapter();
    const queue = new SyncQueue(db);
    const inner = {
      createDir: async (_p: string) => {},
    } as any;
    const adapter = new QueueingVaultAdapter(inner, queue);

    await adapter.createDir("Projekte/Neu");
    expect(
      db.queries.find((q) => q.query.includes("INSERT INTO offline_queue") && q.params.includes("mkdir") && q.params.includes("Projekte/Neu")),
    ).toBeDefined();

    db.queries.length = 0;
    await adapter.createDir(".plainva/backups");
    expect(db.queries.find((q) => q.query.includes("INSERT INTO offline_queue"))).toBeUndefined();
  });
});

describe("SyncEngine mkdir push", () => {
  const mkdirOp: SyncOperation = { id: 1, file_path: "Neu/Leer", operation: "mkdir", retry_count: 0, next_retry_at: 0, queued_at: 0 };

  it("creates the folder remotely via createFolder and completes the op", async () => {
    const db = new MockDatabaseAdapter();
    const queue = new SyncQueue(db);
    const created: string[] = [];
    const target: ISyncTarget = {
      push: async () => { throw new Error("push must not run for mkdir"); },
      pull: async () => ({ etagMap: new Map() }),
      download: async () => new Uint8Array(),
      createFolder: async (p: string) => { created.push(p); },
    };
    const engine = new SyncEngine(queue, target, { readBinaryFile: async () => new Uint8Array() } as any);
    db.mockedResults.push([mkdirOp]);
    db.mockedResults.push([]); // markSynced
    await engine.processQueue();
    expect(created).toEqual(["Neu/Leer"]);
    expect(db.queries.find((q) => q.query.includes("DELETE FROM offline_queue") || q.query.includes("UPDATE offline_queue"))).toBeDefined();
  });

  it("a provider without createFolder completes the op as a no-op", async () => {
    const db = new MockDatabaseAdapter();
    const queue = new SyncQueue(db);
    const target: ISyncTarget = {
      push: async () => { throw new Error("push must not run for mkdir"); },
      pull: async () => ({ etagMap: new Map() }),
      download: async () => new Uint8Array(),
    };
    const engine = new SyncEngine(queue, target, { readBinaryFile: async () => new Uint8Array() } as any);
    db.mockedResults.push([mkdirOp]);
    db.mockedResults.push([]);
    await expect(engine.processQueue()).resolves.toBeUndefined();
  });

  it("a failing remote createFolder goes through the normal retry path", async () => {
    const db = new MockDatabaseAdapter();
    const queue = new SyncQueue(db);
    const target: ISyncTarget = {
      push: async () => ({}),
      pull: async () => ({ etagMap: new Map() }),
      download: async () => new Uint8Array(),
      createFolder: async () => { throw new Error("503"); },
    };
    const engine = new SyncEngine(queue, target, { readBinaryFile: async () => new Uint8Array() } as any);
    db.mockedResults.push([mkdirOp]);
    await engine.processQueue();
    const retryQ = db.queries.find((q) => q.query.includes("retry_count"));
    expect(retryQ).toBeDefined();
  });
});

