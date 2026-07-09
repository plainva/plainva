import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.ts";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("QueueingVaultAdapter", () => {
  let tmpDir: string;
  let db: MockDatabaseAdapter;
  let syncQueue: SyncQueue;
  let adapter: QueueingVaultAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-queueing-"));
    const localAdapter = new LocalVaultAdapter(tmpDir);
    await localAdapter.initialize();
    
    db = new MockDatabaseAdapter();
    syncQueue = new SyncQueue(db);
    adapter = new QueueingVaultAdapter(localAdapter, syncQueue);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("queues writeTextFile", async () => {
    await adapter.writeTextFile("test.md", "hello");
    
    const diskContent = await fs.readFile(path.join(tmpDir, "test.md"), "utf-8");
    expect(diskContent).toBe("hello");

    const insertQueries = db.queries.filter(q => q.query.includes("INSERT INTO offline_queue"));
    expect(insertQueries.length).toBe(1);
    const params = insertQueries[0].params as any[];
    expect(params[0]).toBe("test.md");
    expect(params[1]).toBe("write");
  });

  it("queues writeBinaryFile", async () => {
    const data = new Uint8Array([1, 2, 3]);
    await adapter.writeBinaryFile("test.bin", data);

    const insertQueries = db.queries.filter(q => q.query.includes("INSERT INTO offline_queue"));
    expect(insertQueries.length).toBe(1);
    const params = insertQueries[0].params as any[];
    expect(params[0]).toBe("test.bin");
    expect(params[1]).toBe("write");
  });

  it("queues deleteItem", async () => {
    await adapter.writeTextFile("test.md", "hello");
    await adapter.deleteItem("test.md");

    const deleteQueries = db.queries.filter(q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[])[1] === "delete");
    expect(deleteQueries.length).toBe(1);
    const params = deleteQueries[0].params as any[];
    expect(params[0]).toBe("test.md");
  });

  it("deleting a folder enqueues the folder AND each contained file (deterministic cloud deletion)", async () => {
    await adapter.createDir("proj/sub");
    await adapter.writeTextFile("proj/a.md", "a");
    await adapter.writeTextFile("proj/sub/b.md", "b");
    db.clear(); // only inspect the deletion's queue traffic

    await adapter.deleteItem("proj", true);

    const deletes = db.queries
      .filter((q) => q.query.includes("INSERT INTO offline_queue") && (q.params as any[])[1] === "delete")
      .map((q) => (q.params as any[])[0]);
    // Folder op first (natively recursive on every provider), then one op per
    // FILE as the deterministic fallback; subfolders are not enqueued (their
    // remote deletion rides on the folder op's recursion).
    expect(deletes[0]).toBe("proj");
    expect(deletes).toContain("proj/a.md");
    expect(deletes).toContain("proj/sub/b.md");
    expect(deletes.length).toBe(3);
    await expect(fs.access(path.join(tmpDir, "proj"))).rejects.toThrow();
  });

  it("queues renameItem", async () => {
    await adapter.writeTextFile("old.md", "hello");
    await adapter.renameItem("old.md", "new.md");

    const renameQueries = db.queries.filter(q => q.query.includes("INSERT INTO offline_queue") && (q.params as any[])[1] === "rename");
    expect(renameQueries.length).toBe(1);
    const params = renameQueries[0].params as any[];
    expect(params[0]).toBe("old.md");
    expect(params[2]).toBe("new.md"); // new_path
  });

  it("ignores files in .plainva", async () => {
    await adapter.createDir(".plainva/backups");
    await adapter.writeTextFile(".plainva/backups/test.md.bak", "hello");
    
    const insertQueries = db.queries.filter(q => q.query.includes("INSERT INTO offline_queue"));
    expect(insertQueries.length).toBe(0); // Should not queue
  });
});
