import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "../helpers/realSqlite.js";
import { MemoryVaultAdapter } from "../helpers/memoryVault.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../../src/vault/BackupVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";

/**
 * A refused file's stray copy is removed only while it still holds what was
 * read (third review 2026-10-27): an editor save that lands between the read
 * and the delete is never deleted - it gets a copy of its own. Over the chain
 * both shells build, with its own lock.
 */

let files: MemoryVaultAdapter, db: IDatabaseAdapter, repo: SyncStateRepository, top: ConflictAwareVaultAdapter, queue: SyncQueue;

beforeEach(async () => {
  files = new MemoryVaultAdapter();
  db = await realSqlite();
  const versions = new BackupVaultAdapter(files, { policy: DEFAULT_BACKUP_RETENTION, now: () => Date.now() });
  repo = new SyncStateRepository(db, versions, "device-a");
  queue = new SyncQueue(db);
  top = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(versions, queue), repo, () => {}, repo, "external-folder");
  await repo.markUnsyncable("flagged.md", "cannotDownloadAbusiveFile", "e2", 1_000);
});
afterEach(async () => {
  vi.useRealTimers();
  await top.endOwnFileConflicts();
  await db.close();
});

/** Passes until the queue is empty - a structural operation holds the writes behind it for the next. */
async function drain(engine: SyncEngine): Promise<void> {
  for (let pass = 0; pass < 5 && (await queue.getPendingOperations()).length > 0; pass++) await engine.processQueue();
}

const copiesOf = async () => (await files.listDir("")).map((entry) => entry.path).filter((path) => path.includes("(conflict "));

describe("the stray file at a refused path", () => {
  it("goes only while it holds what the copy holds: a save landing between the read and the delete gets a copy of its own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    // Reads of the refused path, counted - the engine's second look at it is where the save lands.
    let reads = 0;
    let injected = false;
    const vault = new Proxy(top, {
      get(target, key, receiver) {
        if (key === "readBinaryFile") {
          return async (path: string) => {
            const bytes = await target.readBinaryFile(path);
            if (path === "flagged.md" && ++reads === 2 && !injected) {
              injected = true;
              await target.writeTextFile("flagged.md", "a newer line, saved meanwhile\n");
            }
            return bytes;
          };
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const pushed: string[] = [];
    const engine = new SyncEngine(queue, { push: async (op: { file_path: string }) => { pushed.push(op.file_path); return { etag: "x" }; } } as never, vault as never, repo);

    await top.writeTextFile("flagged.md", "my text\n");
    await drain(engine);
    const [first] = await copiesOf();
    expect(first).toBeDefined();
    // The same text again at the old place - and while the engine looks, a newer save lands.
    vi.setSystemTime(new Date("2026-10-27T15:00:01.000Z"));
    await top.writeTextFile("flagged.md", "my text\n");
    await drain(engine);

    expect(injected).toBe(true);
    const copies = await copiesOf();
    expect(copies).toHaveLength(2);
    const texts = await Promise.all(copies.map((path) => files.readTextFile(path)));
    expect(texts).toContain("a newer line, saved meanwhile\n");
    expect(pushed).not.toContain("flagged.md");
  });

  it("goes when it holds exactly what the copy holds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    const engine = new SyncEngine(queue, { push: async () => ({ etag: "x" }) } as never, top, repo);
    await top.writeTextFile("flagged.md", "my text\n");
    await drain(engine);
    vi.setSystemTime(new Date("2026-10-27T15:00:01.000Z"));
    await top.writeTextFile("flagged.md", "my text\n");
    await drain(engine);

    expect(await copiesOf()).toHaveLength(1);
    expect(await files.exists("flagged.md")).toBe(false);
  });
});
