import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "../helpers/realSqlite.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { unsyncableCopyPath } from "../../src/sync/unsyncablePaths.js";

/**
 * A file the provider never hands out here (review 2026-10-27): Google Drive
 * refuses the bytes of a file it flagged, and updates a file by its NAME. The
 * sync skipped it on the pull, but nothing remembered that - the desktop's
 * late local-only sweep, a queued write or a rename onto the name uploaded
 * this device's content over the only copy there was.
 */

function localVault(files: Map<string, string>) {
  return {
    exists: vi.fn(async (p: string) => files.has(p)),
    readBinaryFile: vi.fn(async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw Object.assign(new Error("missing"), { name: "VaultFileNotFoundError" });
      return new TextEncoder().encode(text);
    }),
    renameItem: vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    getFileInfo: vi.fn(async () => ({ isDirectory: false })),
    listDir: vi.fn(async () => []),
  };
}

function remote() {
  return { push: vi.fn(async () => ({ etag: "pushed" })), pull: vi.fn(), download: vi.fn() };
}

async function setup(files: Map<string, string>) {
  const db = await realSqlite();
  const repo = new SyncStateRepository(db);
  const queue = new SyncQueue(db);
  const vault = localVault(files);
  const target = remote();
  const engine = new SyncEngine(queue, target as never, vault as never, repo);
  await repo.markUnsyncable("flagged.md", "cannotDownloadAbusiveFile", "e2", 1_000);
  return { db, repo, queue, vault, target, engine };
}

const pushedPaths = (target: ReturnType<typeof remote>) =>
  target.push.mock.calls.map((call) => {
    const op = (call as unknown[])[0] as { operation: string; file_path: string; new_path?: string };
    return op.new_path ? `${op.operation} ${op.file_path} -> ${op.new_path}` : `${op.operation} ${op.file_path}`;
  });

describe("files refused for good: stored next to the sync state", () => {
  it("survive a restart, count their attempts with a growing pause, and go with the sync state of another folder", async () => {
    const db = await realSqlite();
    const first = new SyncStateRepository(db);
    await first.markUnsyncable("a/flagged.md", "fileNotDownloadable", "e1", 1_000);
    const again = await first.markUnsyncable("a/flagged.md", "fileNotDownloadable", "e1", 2_000);

    // A new repository on the same database: what the app finds after a restart.
    const afterRestart = new SyncStateRepository(db);
    expect(await afterRestart.listUnsyncable()).toEqual([{ path: "a/flagged.md", reason: "fileNotDownloadable", etag: "e1", attempts: 2, retryAt: again.retryAt }]);
    expect(again.retryAt - 2_000).toBe(120_000);

    await afterRestart.clearUnsyncable("a/flagged.md");
    expect(await afterRestart.listUnsyncable()).toEqual([]);
    await afterRestart.markUnsyncable("b.md", "fileNotDownloadable", "e1", 1_000);
    await afterRestart.clearAll();
    expect(await afterRestart.listUnsyncable()).toEqual([]);
  });

  it("name the copy as a conflicting copy that syncs, never a device-local .CONFLICT", () => {
    const copy = unsyncableCopyPath("Notes/Plan.md", new Date("2026-10-27T15:04:05.000Z"));
    expect(copy).toBe("Notes/Plan (conflict 2026-10-27 15-04-05).md");
    expect(copy).not.toContain(".CONFLICT");
  });
});

describe("nothing goes up over a file refused for good", () => {
  it("a queued write - the local-only sweep's too - moves the local content to a copy instead of pushing it over the remote file", async () => {
    const files = new Map([["flagged.md", "this device's text"]]);
    const { queue, vault, target, engine } = await setup(files);
    await queue.queueWrite("flagged.md");

    await engine.processQueue();

    expect(pushedPaths(target)).toEqual([]);
    expect(vault.renameItem).toHaveBeenCalledTimes(1);
    const [from, to] = vault.renameItem.mock.calls[0] as [string, string];
    expect(from).toBe("flagged.md");
    expect(to).toMatch(/^flagged \(conflict \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.md$/);
    expect(files.get(to)).toBe("this device's text");
    expect(await queue.getPendingOperations()).toEqual([]);
  });

  it("a rename from it goes up as a new file, and the remote file stays where it is", async () => {
    const files = new Map([["moved.md", "this device's text"]]);
    const { queue, target, engine } = await setup(files);
    await queue.queueRename("flagged.md", "moved.md");

    await engine.processQueue();

    expect(pushedPaths(target)).toEqual(["write moved.md"]);
  });

  it("a rename onto it goes to the copy's name, here and on the remote", async () => {
    const files = new Map([["flagged.md", "renamed onto the name"]]);
    const { repo, queue, vault, target, engine } = await setup(files);
    await repo.updateRemoteState("mine.md", "e-mine", "id-mine", 1);
    await queue.queueRename("mine.md", "flagged.md");

    await engine.processQueue();

    const pushed = pushedPaths(target);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatch(/^rename mine\.md -> flagged \(conflict .+\)\.md$/);
    expect(vault.renameItem).toHaveBeenCalledWith("flagged.md", expect.stringMatching(/^flagged \(conflict .+\)\.md$/));
  });

  it("a queued delete of it is not pushed", async () => {
    const { queue, target, engine } = await setup(new Map());
    await queue.queueDelete("flagged.md", { confirmed: true });

    await engine.processQueue();

    expect(pushedPaths(target)).toEqual([]);
    expect(await queue.getPendingOperations()).toEqual([]);
  });

  it("every other file goes up as before", async () => {
    const files = new Map([["other.md", "text"]]);
    const { queue, target, engine } = await setup(files);
    await queue.queueWrite("other.md");

    await engine.processQueue();

    expect(pushedPaths(target)).toEqual(["write other.md"]);
  });
});
