import { describe, expect, it, vi, afterEach } from "vitest";
import { SyncQueue } from "../../src/sync/SyncQueue.ts";
import { SyncEngine } from "../../src/sync/SyncEngine.ts";
import { SyncWorker, isLocalOnlyPath } from "../../src/sync/SyncWorker.ts";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.ts";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.ts";
import { realSqlite } from "../helpers/realSqlite.ts";
import { addConflictFixture } from "../helpers/conflictFixture.ts";

/**
 * Issue #110 (E10): operating-system bookkeeping never travels. Nothing of it
 * is uploaded or downloaded — and a copy an older version already uploaded is
 * neither deleted in the cloud nor mirrored as a deletion here.
 */

const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]);

describe("the push side drops bookkeeping", () => {
  it("never uploads or remote-deletes .DS_Store & co., but still uploads a user's `._` note", async () => {
    const db = await realSqlite();
    const queue = new SyncQueue(db);
    const pushed: SyncOperation[] = [];
    const target: ISyncTarget = {
      push: async (op) => { pushed.push({ ...op }); return { etag: "e" }; },
      pull: async () => ({ etagMap: new Map() }),
      download: async () => new Uint8Array(),
    };
    const files = new Map<string, Uint8Array>([
      ["notes/.DS_Store", new Uint8Array([0, 0, 0, 1])],
      ["notes/._x.md", APPLE_DOUBLE],
      ["notes/._mine.md", new TextEncoder().encode("# Mine\n")],
      ["notes/x.md", new TextEncoder().encode("# X\n")],
    ]);
    const vault = {
      readBinaryFile: async (p: string) => files.get(p) ?? new Uint8Array(),
      exists: async (p: string) => files.has(p),
    };
    const engine = new SyncEngine(queue, target, vault as any);

    // Left over from before the rule: exactly what an existing install carries.
    await queue.queueWrite("notes/.DS_Store");
    await queue.queueWrite("Thumbs.db");
    await queue.queueWrite("notes/._x.md");
    await queue.queueWrite("notes/._mine.md");
    await queue.queueDelete("desktop.ini");
    await queue.queueDelete("notes/._gone.md"); // no `gone.md` beside it: a user's file
    await queue.queueMkdir(".Trashes");
    await engine.processQueue();

    expect(pushed.map((op) => `${op.operation} ${op.file_path}`).sort()).toEqual([
      "delete notes/._gone.md",
      "write notes/._mine.md",
    ]);
    const left = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM offline_queue");
    expect(left[0].n).toBe(0);
    await db.close();
  });

  it("drops a remote delete of a vanished sidecar while its note is still here", async () => {
    const db = await realSqlite();
    const queue = new SyncQueue(db);
    const pushed: string[] = [];
    const target: ISyncTarget = {
      push: async (op) => { pushed.push(`${op.operation} ${op.file_path}`); return {}; },
      pull: async () => ({ etagMap: new Map() }),
      download: async () => new Uint8Array(),
    };
    const vault = { readBinaryFile: async () => new Uint8Array(), exists: async (p: string) => p === "x.md" };
    await queue.queueDelete("._x.md");
    await new SyncEngine(queue, target, vault as any).processQueue();
    expect(pushed).toEqual([]);
    await db.close();
  });

  it("does not even queue bookkeeping written through the app", async () => {
    const db = await realSqlite();
    const queue = new SyncQueue(db);
    const inner = { writeBinaryFile: async () => {}, writeTextFile: async () => {} } as any;
    const adapter = new QueueingVaultAdapter(inner, queue);
    await adapter.writeBinaryFile("import/.DS_Store", new Uint8Array([1]));
    await adapter.writeTextFile("import/desktop.ini", "[.ShellClassInfo]");
    await adapter.writeTextFile("import/note.md", "# Note");
    const rows = await db.query<{ file_path: string }>("SELECT file_path FROM offline_queue");
    expect(rows.map((r) => r.file_path)).toEqual(["import/note.md"]);
    await db.close();
  });
});

describe("the pull side leaves bookkeeping where it is", () => {
  let worker: SyncWorker | undefined;
  afterEach(() => worker?.stop());

  it("downloads no .DS_Store and no sidecar beside its note, and mirrors no deletion of one", async () => {
    expect(isLocalOnlyPath("notes/.DS_Store")).toBe(true);

    const states = new Map<string, any>([
      // Uploaded by an older version; the cloud no longer lists it. Its local
      // copy must not be deleted on that evidence.
      [".DS_Store", { path: ".DS_Store", remote_etag: "old", base_sha256: "x", last_sync_ts: 1 }],
      ["notes/._x.md", { path: "notes/._x.md", remote_etag: "old", base_sha256: "x", last_sync_ts: 1 }],
      ["notes/x.md", { path: "notes/x.md", remote_etag: "e-x", base_sha256: "x", last_sync_ts: 1 }],
    ]);
    const target = {
      pull: vi.fn().mockResolvedValue({
        etagMap: new Map([
          ["notes/x.md", "e-x"],
          ["notes/.DS_Store", "e1"],
          ["Thumbs.db", "e2"],
          ["notes/._x.md.bak", "e3"],
          ["media/._clip.mov", "e4"],
          ["media/clip.mov", "e5"],
          ["notes/._solo.md", "e6"],
        ]),
      }),
      download: vi.fn(async (_path: string) => new TextEncoder().encode("# Solo\n")),
      push: vi.fn(),
    };
    const stateRepo: any = {
      getAllStates: vi.fn(async () => new Map(states)),
      getSyncState: vi.fn(async (p: string) => states.get(p) ?? null),
      updateLocalHashAndBaseText: vi.fn(), updateLocalHashAndBaseTextGuarded: vi.fn(),
      updateLocalHash: vi.fn(), updateLocalHashGuarded: vi.fn(), updateRemoteState: vi.fn(),
      updateRemoteId: vi.fn(), updateBaseState: vi.fn(), updateBaseText: vi.fn(),
      clearPendingPushSha: vi.fn(), deleteSyncState: vi.fn(), getBaseText: vi.fn().mockResolvedValue(null),
    };
    const vault: any = {
      exists: vi.fn(async (p: string) => p === ".DS_Store" || p === "notes/._x.md" || p === "notes/x.md"),
      readTextFile: vi.fn().mockResolvedValue(""),
      readBinaryFile: vi.fn().mockResolvedValue(new Uint8Array()),
      writeTextFile: vi.fn(), writeBinaryFile: vi.fn(), deleteItem: vi.fn(), createDir: vi.fn(),
    };
    const queue: any = {
      queueWrite: vi.fn(), resetStuckOperations: vi.fn(), hasPendingOperation: vi.fn().mockResolvedValue(false),
      hasPendingStructuralOp: vi.fn().mockResolvedValue(false), getPendingStructuralPaths: vi.fn().mockResolvedValue([]),
      getPendingDeletePaths: vi.fn().mockResolvedValue([]), getPendingDeleteOperations: vi.fn().mockResolvedValue([]),
      markDeletesJournaled: vi.fn(), discardPendingDeletes: vi.fn().mockResolvedValue([]),
    };
    addConflictFixture(stateRepo, vault);
    const engine: any = { processQueue: vi.fn().mockResolvedValue(undefined) };
    worker = new SyncWorker(engine, target as any, stateRepo, vault, queue, 100, {});
    (worker as any).isRunning = true;

    await worker.runCycle();

    const downloaded = target.download.mock.calls.map((c) => c[0]).sort();
    // `._x.md.bak` has no `x.md.bak` beside it and `._solo.md` no `solo.md`:
    // both are somebody's files. `._clip.mov` sits beside `clip.mov`.
    expect(downloaded).toEqual(["media/clip.mov", "notes/._solo.md", "notes/._x.md.bak"]);
    expect(vault.deleteItem).not.toHaveBeenCalled();
  });
});
