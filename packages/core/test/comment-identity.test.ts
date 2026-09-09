import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BundleCommentStore, WorkspaceCommentStore, CommentIdentityConflictError, createWorkspaceObjectId,
  commentsDevicePath, parseCommentsBundle, MemoryWorkspaceStateStore, SqlWorkspaceStateStore,
  createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, initializePersonalWorkspaceMigration,
  EncryptedWorkspaceWorker, FakeWorkspaceObjectStore, type IDatabaseAdapter, type CommentPostInput,
} from "../src/index.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";

let roots: string[], databases: IDatabaseAdapter[];
beforeEach(() => { roots = []; databases = []; });
afterEach(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function vault() {
  const root = await mkdtemp(join(tmpdir(), "plainva-comment-identity-")); roots.push(root);
  const raw = new LocalVaultAdapter(root); await raw.initialize();
  await raw.writeTextFile("note.md", "The original sentence.");
  return { root, raw };
}
const identity = () => ({ commentId: createWorkspaceObjectId(), createdAt: "2026-09-09T10:00:00.000Z" });

describe("durable comment identities in plain bundles", () => {
  it("concurrent retries and a new store instance keep one immutable record", async () => {
    const { root, raw } = await vault();
    const store = () => new BundleCommentStore({ vault: raw, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
    const input = { identity: identity(), path: "note.md", body: "Keep this sentence." };
    await Promise.all(Array.from({ length: 8 }, () => store().post(input)));
    const first = await raw.readTextFile(commentsDevicePath("desktop", false));
    await store().post(input);
    expect(await raw.readTextFile(commentsDevicePath("desktop", false))).toBe(first);
    const bundle = parseCommentsBundle(first);
    if (!bundle) throw new Error("Expected the persisted comment bundle");
    expect(Object.keys(bundle.comments)).toEqual([input.identity.commentId]);
    expect(bundle.comments[input.identity.commentId].createdAt).toBe(input.identity.createdAt);
  });
  it("rejects ID reuse with different content without altering the saved record", async () => {
    const { root, raw } = await vault();
    const store = new BundleCommentStore({ vault: raw, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
    const input = { identity: identity(), path: "note.md", body: "Original" };
    await store.post(input);
    const before = await raw.readTextFile(commentsDevicePath("desktop", false));
    await expect(store.post({ ...input, body: "Replacement" })).rejects.toBeInstanceOf(CommentIdentityConflictError);
    expect(await raw.readTextFile(commentsDevicePath("desktop", false))).toBe(before);
  });
  it("refuses malformed durable identities before creating a bundle", async () => {
    const { raw } = await vault();
    const store = new BundleCommentStore({ vault: raw, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
    await expect(store.post({ identity: { commentId: "../bad", createdAt: "yesterday" }, path: "note.md", body: "Text" })).rejects.toThrow("identity");
    expect(await raw.exists(commentsDevicePath("desktop", false))).toBe(false);
  });
});

async function workspace(kind: "memory" | "sql") {
  const { raw } = await vault();
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0", now: "2026-09-09T09:00:00.000Z" });
  const runtime = personalWorkspaceRuntime(bootstrap);
  const remote = new FakeWorkspaceObjectStore();
  let state: MemoryWorkspaceStateStore | SqlWorkspaceStateStore;
  if (kind === "sql") { const db = await realSqlite(); databases.push(db); state = new SqlWorkspaceStateStore(db); }
  else state = new MemoryWorkspaceStateStore();
  await initializePersonalWorkspaceMigration({ store: remote, state, vault: raw, runtime, recoveryConfirmedAt: "2026-09-09T09:01:00.000Z" });
  const worker = new EncryptedWorkspaceWorker(remote, state, raw, runtime);
  await worker.runCycle();
  // Publishing is deliberately manual in this test so both outbox and
  // completed-publication retries can be exercised deterministically.
  const store = () => new WorkspaceCommentStore({ plane: () => ({ runtime, workspaceState: state }), worker: () => null, changed: () => {} });
  return { runtime, state, worker, store };
}
describe.each(["memory", "sql"] as const)("durable workspace identities with %s state", (kind) => {
  it("does not enqueue another record before or after actual signed publication", async () => {
    const { state, worker, store } = await workspace(kind);
    const input: CommentPostInput = { identity: identity(), path: "note.md", body: "A durable remark" };
    await Promise.all([store().post(input), store().post(input)]);
    expect(await state.listCommentOutbox()).toHaveLength(1);
    await worker.runCycle();
    expect(await state.listCommentOutbox()).toHaveLength(0);
    expect(await state.getComment(input.identity!.commentId)).toMatchObject({ body: input.body, createdAt: input.identity!.createdAt });
    await store().post(input);
    expect(await state.listCommentOutbox()).toHaveLength(0);
  });
  it("rejects changed payloads both while queued and after publication", async () => {
    const { state, worker, store } = await workspace(kind);
    const input: CommentPostInput = { identity: identity(), path: "note.md", body: "Original" };
    await store().post(input);
    await expect(store().post({ ...input, body: "Changed" })).rejects.toBeInstanceOf(CommentIdentityConflictError);
    await worker.runCycle();
    await expect(store().post({ ...input, body: "Changed again" })).rejects.toBeInstanceOf(CommentIdentityConflictError);
    expect((await state.getComment(input.identity!.commentId))?.body).toBe("Original");
  });
  it("keeps a resolution marker's own outcome after publication and reload", async () => {
    const { state, worker, store } = await workspace(kind);
    const root: CommentPostInput = { identity: identity(), path: "note.md", body: "Review" };
    await store().post(root); await worker.runCycle();
    const marker: CommentPostInput = { identity: identity(), path: "note.md", body: "", resolvedCommentId: root.identity!.commentId, suggestionOutcome: "declined" };
    await store().post(marker); await worker.runCycle();
    expect(await state.listCommentOutbox()).toHaveLength(0);
    expect(await state.getComment(marker.identity!.commentId)).toMatchObject({ suggestionOutcome: "declined", resolvedCommentId: root.identity!.commentId });
    await store().post(marker);
    expect(await state.listCommentOutbox()).toHaveLength(0);
  });
});
