import { afterEach, describe, expect, it, vi } from "vitest";
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

async function hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
    deleteItem: vi.fn(async (p: string) => { files.delete(p); }),
    // The chain's compare-and-delete: only while the file holds what was read.
    deleteItemIfUnchanged: vi.fn(async (p: string, sha: string) => {
      const text = files.get(p);
      if (text === undefined || (await hex(text)) !== sha) return false;
      files.delete(p);
      return true;
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
  afterEach(() => { vi.useRealTimers(); });

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

  it("an open note on it: three saves make one copy, and the editor ends on the copy (second review 2026-10-27)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    const files = new Map<string, string>();
    const { queue, target, engine } = await setup(files);
    // The editor: saves where its file is, and follows a move it is told about.
    const editor = { path: "flagged.md", save: async (text: string) => { files.set(editor.path, text); await queue.queueWrite(editor.path); } };
    const told: Array<[string, string]> = [];
    engine.onLocalMove = (from, to) => { told.push([from, to]); };

    await editor.save("my text");
    await engine.processQueue();
    // A second later the editor saves the old path once more - before it heard of the move.
    vi.setSystemTime(new Date("2026-10-27T15:00:01.000Z"));
    await editor.save("my text");
    await engine.processQueue();
    // Now it follows, and its third save lands on the copy.
    expect(told.length).toBeGreaterThan(0);
    editor.path = told[told.length - 1][1];
    vi.setSystemTime(new Date("2026-10-27T15:00:02.000Z"));
    await editor.save("my text, more");
    await engine.processQueue();

    const copies = [...files.keys()].filter((p) => p.includes("(conflict "));
    expect(copies).toHaveLength(1);
    expect(editor.path).toBe(copies[0]);
    expect(files.has("flagged.md")).toBe(false);
    expect(files.get(copies[0])).toBe("my text, more");
    expect(new Set(told.map(([, to]) => to))).toEqual(new Set([copies[0]]));
    expect(pushedPaths(target)).not.toContain("write flagged.md");
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
