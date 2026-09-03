import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  createPersonalWorkspaceBootstrap,
  createWorkspaceObjectId,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  type IVaultAdapter,
  type VaultFileInfo,
  type WorkspaceCommentOutboxEntry,
  type WorkspaceCommentRecord,
} from "../src/index.js";

/**
 * Deleting a remark (K7, finding 2026-09-03) is an appended retraction marker:
 * the ledger keeps the sealed record, every device stops listing it. What has
 * to hold: the author's own marker takes the remark and its replies off the
 * list in either arrival order; a stranger's marker does nothing by itself;
 * the worker's verified moderator path applies through `retractComment`.
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
  await worker.runCycle();
  const object = (await state.getObjectByPath("note.md"))!;
  return { runtime, state, worker, object };
}

function entry(over: Partial<WorkspaceCommentOutboxEntry> & { targetObjectId: string; body: string }): WorkspaceCommentOutboxEntry {
  return {
    outboxId: createWorkspaceObjectId(), commentId: createWorkspaceObjectId(), path: "note.md",
    parentCommentId: null, resolvedCommentId: null, anchor: null, suggestion: null, suggestionOutcome: null,
    createdAt: "2026-09-03T09:00:00.000Z", attempts: 0, lastError: null, ...over,
  };
}

function stored(over: Partial<WorkspaceCommentRecord> & { commentId: string; authorMemberId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "41".repeat(16), targetRevisionId: "42".repeat(16), parentCommentId: null,
    authorDeviceId: "de".repeat(16), operationHash: over.commentId + "op", payloadHash: "ee".repeat(32), body: "-", anchor: null,
    createdAt: "2026-09-03T09:00:00.000Z", suggestion: null, resolvedCommentId: null, resolvedAt: null, ...over,
  };
}

describe("comment retraction", () => {
  it("takes the author's own remark and its replies off the list once the marker is published", async () => {
    const { state, worker, object } = await syncedWorkspace();
    const root = entry({ targetObjectId: object.objectId, body: "Not what the PDF says." });
    const reply = entry({ targetObjectId: object.objectId, body: "Will check.", parentCommentId: root.commentId, createdAt: "2026-09-03T09:00:01.000Z" });
    const other = entry({ targetObjectId: object.objectId, body: "Unrelated.", createdAt: "2026-09-03T09:00:02.000Z" });
    for (const e of [root, reply, other]) await state.enqueueCommentOutbox(e);
    await worker.runCycle();
    expect((await state.listComments(object.objectId)).map((c) => c.body)).toEqual(["Not what the PDF says.", "Will check.", "Unrelated."]);

    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "", retractsCommentId: root.commentId, createdAt: "2026-09-03T10:00:00.000Z" }));
    await worker.runCycle();

    expect(await state.listCommentOutbox()).toEqual([]);
    expect((await state.listComments(object.objectId)).map((c) => c.body)).toEqual(["Unrelated."]);
    expect((await state.listAllComments()).map((c) => c.body)).toEqual(["Unrelated."]);
  });

  it("refuses a retraction that carries anything else", async () => {
    const { state, worker, object } = await syncedWorkspace();
    const root = entry({ targetObjectId: object.objectId, body: "Root" });
    await state.enqueueCommentOutbox(root);
    await worker.runCycle();
    await state.enqueueCommentOutbox(entry({ targetObjectId: object.objectId, body: "", retractsCommentId: root.commentId, resolvedCommentId: root.commentId, createdAt: "2026-09-03T10:00:00.000Z" }));
    await worker.runCycle();
    const left = await state.listCommentOutbox();
    expect(left).toHaveLength(1);
    expect(left[0].lastError).toContain("a retraction carries nothing else");
    expect((await state.listComments(object.objectId)).map((c) => c.body)).toEqual(["Root"]);
  });

  it("applies a stranger's marker only through the verified moderator path, in either arrival order", async () => {
    const state = new MemoryWorkspaceStateStore();
    const target = "41".repeat(16);
    const root = stored({ commentId: "a1".repeat(16), authorMemberId: "author-a", targetObjectId: target, body: "By A" });
    const strangerMarker = stored({ commentId: "b1".repeat(16), authorMemberId: "member-b", targetObjectId: target, body: "", retractsCommentId: root.commentId, createdAt: "2026-09-03T10:00:00.000Z" });
    await state.saveComment(root);
    await state.saveComment(strangerMarker);
    // The store cannot read the policy, so a stranger's marker is inert here.
    expect((await state.listComments(target)).map((c) => c.body)).toEqual(["By A"]);
    // The worker, having checked `workspace.manage`, applies it explicitly.
    await state.retractComment(root.commentId, strangerMarker.createdAt);
    expect(await state.listComments(target)).toEqual([]);

    // Marker first, comment second - the author's own retraction still lands.
    const late = new MemoryWorkspaceStateStore();
    const ownMarker = stored({ commentId: "c1".repeat(16), authorMemberId: "author-a", targetObjectId: target, body: "", retractsCommentId: "d1".repeat(16), createdAt: "2026-09-03T10:00:00.000Z" });
    await late.saveComment(ownMarker);
    await late.saveComment(stored({ commentId: "d1".repeat(16), authorMemberId: "author-a", targetObjectId: target, body: "Arrived late" }));
    expect(await late.listComments(target)).toEqual([]);
  });
});
