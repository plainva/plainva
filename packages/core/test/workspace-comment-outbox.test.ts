import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  createPersonalWorkspaceBootstrap,
  createWorkspaceObjectId,
  initializePersonalWorkspaceMigration,
  outboxEntryAsCommentRecord,
  personalWorkspaceRuntime,
  type IVaultAdapter,
  type VaultFileInfo,
  type WorkspaceCommentOutboxEntry,
} from "../src/index.js";

/**
 * The comment outbox (K6, finding 2026-09-03).
 *
 * A remark is written locally the moment it is sent and published by the
 * worker afterwards. What has to hold: the ids the cards already carry are the
 * ids that land; a reply queued behind its parent publishes after it; a remark
 * that cannot be published stays with its reason and blocks only what depends
 * on it; the shell is told which notes changed.
 */
class TestVault implements IVaultAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  async initialize() {} async dispose() {} async acknowledgeExternalUpdate() {}
  async readTextFile(path: string) { return new TextDecoder().decode(await this.readBinaryFile(path)); }
  async readBinaryFile(path: string) { const value = this.files.get(path); if (!value) throw new Error(`missing ${path}`); return new Uint8Array(value); }
  async writeTextFile(path: string, value: string) { await this.writeBinaryFile(path, new TextEncoder().encode(value)); }
  async writeBinaryFile(path: string, value: Uint8Array) { this.files.set(path, new Uint8Array(value)); }
  async deleteItem(path: string) { this.files.delete(path); this.directories.delete(path); }
  async renameItem(oldPath: string, newPath: string) { const value = this.files.get(oldPath); if (value) { this.files.delete(oldPath); this.files.set(newPath, value); } }
  async exists(path: string) { return this.files.has(path) || this.directories.has(path); }
  async getFileInfo(path: string): Promise<VaultFileInfo> { return { path, name: path.split("/").pop()!, isDirectory: this.directories.has(path), size: this.files.get(path)?.length ?? 0, mtime: 1, ctime: 1 }; }
  async listDir(path = "", recursive = false): Promise<VaultFileInfo[]> { const prefix = path ? `${path}/` : ""; return Promise.all([...this.directories, ...this.files.keys()].filter((entry) => entry.startsWith(prefix) && (recursive || !entry.slice(prefix.length).includes("/"))).map((entry) => this.getFileInfo(entry))); }
  async createDir(path: string) { if (path) this.directories.add(path); }
}

async function syncedWorkspace() {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0", now: "2026-09-03T08:00:00.000Z" });
  const runtime = personalWorkspaceRuntime(bootstrap);
  const store = new FakeWorkspaceObjectStore();
  const state = new MemoryWorkspaceStateStore();
  const raw = new TestVault();
  await raw.writeTextFile("note.md", "The contract runs until the end of the year.");
  await initializePersonalWorkspaceMigration({ store, state, vault: raw, runtime, recoveryConfirmedAt: "2026-09-03T08:01:00.000Z" });
  const worker = new EncryptedWorkspaceWorker(store, state, raw, runtime);
  const changed: string[][] = [];
  worker.onCommentsChanged = (paths) => changed.push(paths);
  await worker.runCycle();
  const object = (await state.getObjectByPath("note.md"))!;
  return { runtime, store, state, raw, worker, object, changed };
}

function entry(over: Partial<WorkspaceCommentOutboxEntry> & { targetObjectId: string; body: string }): WorkspaceCommentOutboxEntry {
  return {
    outboxId: createWorkspaceObjectId(), commentId: createWorkspaceObjectId(), path: "note.md",
    parentCommentId: null, resolvedCommentId: null, anchor: null, suggestion: null, suggestionOutcome: null,
    createdAt: "2026-09-03T09:00:00.000Z", attempts: 0, lastError: null, ...over,
  };
}

describe("comment outbox", () => {
  it("publishes a queued remark and its queued reply in order, under the ids the cards already carry", async () => {
    const { state, worker, object, changed } = await syncedWorkspace();
    const root = entry({ targetObjectId: object.objectId, body: "Not what the PDF says." });
    const reply = entry({ targetObjectId: object.objectId, body: "I will call them.", parentCommentId: root.commentId, createdAt: "2026-09-03T09:00:01.000Z" });
    await state.enqueueCommentOutbox(root);
    await state.enqueueCommentOutbox(reply);
    // Before the cycle the shell sees both as pending records.
    const pending = outboxEntryAsCommentRecord(reply, "m", "d");
    expect(pending.commentId).toBe(reply.commentId);
    expect(pending.pending).toEqual({ outboxId: reply.outboxId, attempts: 0, lastError: null });

    await worker.runCycle();

    expect(await state.listCommentOutbox()).toEqual([]);
    const stored = await state.listComments(object.objectId);
    expect(stored.map((c) => [c.commentId, c.parentCommentId, c.body, c.createdAt])).toEqual([
      [root.commentId, null, "Not what the PDF says.", "2026-09-03T09:00:00.000Z"],
      [reply.commentId, root.commentId, "I will call them.", "2026-09-03T09:00:01.000Z"],
    ]);
    expect(changed).toEqual([["note.md"]]);
    // The device sequence moved twice, once per operation.
    const meta = (await state.loadMeta())!;
    expect(meta.operationHeads[worker["runtime"].device.publicIdentity.deviceId]?.sequence).toBe(stored.length + 1);
  });

  it("keeps a remark that cannot be published, with its reason, and blocks only what depends on it", async () => {
    const { state, worker, object, changed } = await syncedWorkspace();
    const orphan = entry({ targetObjectId: "77".repeat(16), body: "On a note this device never synced." });
    const replyToOrphan = entry({ targetObjectId: "77".repeat(16), body: "Me too.", parentCommentId: orphan.commentId, createdAt: "2026-09-03T09:00:01.000Z" });
    const fine = entry({ targetObjectId: object.objectId, body: "Independent.", createdAt: "2026-09-03T09:00:02.000Z" });
    await state.enqueueCommentOutbox(orphan);
    await state.enqueueCommentOutbox(replyToOrphan);
    await state.enqueueCommentOutbox(fine);

    await worker.runCycle();

    const left = await state.listCommentOutbox();
    expect(left.map((e) => [e.commentId, e.attempts, e.lastError])).toEqual([
      [orphan.commentId, 1, "workspace-object-not-synced"],
      [replyToOrphan.commentId, 0, null],
    ]);
    expect((await state.listComments(object.objectId)).map((c) => c.body)).toEqual(["Independent."]);
    expect(changed).toEqual([["note.md"]]);
    // Nothing lost: a second cycle tries the failed one again.
    await worker.runCycle();
    expect((await state.listCommentOutbox()).map((e) => e.attempts)).toEqual([2, 0]);
  });

  it("publishes a queued resolve marker and closes the thread it names", async () => {
    const { state, worker, object } = await syncedWorkspace();
    const root = entry({ targetObjectId: object.objectId, body: "Please check." });
    await state.enqueueCommentOutbox(root);
    await worker.runCycle();
    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "", resolvedCommentId: root.commentId, createdAt: "2026-09-03T10:00:00.000Z" }));
    await worker.runCycle();
    const [stored] = await state.listComments(object.objectId);
    expect(stored.commentId).toBe(root.commentId);
    expect(stored.resolvedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(await state.listCommentOutbox()).toEqual([]);
  });
});

describe("publishQueuedComments", () => {
  it("publishes the outbox without a full cycle, and does nothing while stopped", async () => {
    const { state, worker, object, changed } = await syncedWorkspace();
    // `start()` would kick a whole cycle off; the flag alone is what the
    // direct path asks for.
    const flags = worker as unknown as { running: boolean };
    flags.running = true;
    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "Quick." }));
    await worker.publishQueuedComments();
    expect(await state.listCommentOutbox()).toEqual([]);
    expect((await state.listComments(object.objectId)).map((c) => c.body)).toEqual(["Quick."]);
    expect(changed).toEqual([["note.md"]]);
    flags.running = false;
    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "Later." }));
    await worker.publishQueuedComments();
    expect(await state.listCommentOutbox()).toHaveLength(1);
  });
});

describe("a proposal round through the outbox (V1)", () => {
  it("keeps the round id, position and note, and an insertion point, on the published record", async () => {
    const { state, worker, object } = await syncedWorkspace();
    const batch = createWorkspaceObjectId();
    const text = "The contract runs until the end of the year.";
    const point = { markerId: "7f3a", quote: "", before: text.slice(-20), after: "", approximateOffset: text.length };
    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "", anchor: point, suggestion: { replacement: " It renews automatically." }, suggestionBatchId: batch, batchIndex: 0, batchNote: "From the PDF" }));
    await worker.runCycle();
    expect(await state.listCommentOutbox()).toEqual([]);
    const [stored] = await state.listComments(object.objectId);
    expect(stored.suggestionBatchId).toBe(batch);
    expect(stored.batchIndex).toBe(0);
    expect(stored.batchNote).toBe("From the PDF");
    expect(stored.anchor?.quote).toBe("");
    expect(stored.suggestion?.replacement).toBe(" It renews automatically.");
  });
});
