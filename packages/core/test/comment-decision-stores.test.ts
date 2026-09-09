import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BundleCommentStore, WorkspaceCommentStore, MemoryWorkspaceStateStore, SqlWorkspaceStateStore,
  createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, initializePersonalWorkspaceMigration,
  EncryptedWorkspaceWorker, FakeWorkspaceObjectStore, type IDatabaseAdapter, type CommentPostInput,
  type CommentStore, type CommentDecisionProof, type WorkspaceCommentRecord,
} from "../src/index.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";
import { recoverWorkspaceCommentDecisions } from "../src/workspace/commentDecisionRecovery.js";

let roots: string[], databases: IDatabaseAdapter[];
beforeEach(() => { roots = []; databases = []; });
afterEach(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
const id = (n: number) => n.toString(16).padStart(32, "0");
const at = (n: number) => `2026-09-09T10:00:${String(n).padStart(2, "0")}.000Z`;
const proof = (supersedes: string[]): CommentDecisionProof => ({ operationId: id(999), supersedes,
  text: { beforeHash: "a".repeat(64), intendedHash: "b".repeat(64), confirmedHash: "b".repeat(64), confirmedAt: at(30) } });
function proposal(): CommentPostInput {
  return { path: "note.md", body: "Review", identity: { commentId: id(1), createdAt: at(0) },
    anchor: { markerId: "abcd", quote: "original", before: "The ", after: " sentence.", approximateOffset: 4 }, suggestion: { replacement: "new" } };
}
function marker(n: number, outcome: "applied" | "declined", supersedes?: string[]): CommentPostInput {
  return { path: "note.md", body: "", identity: { commentId: id(n), createdAt: at(n) }, resolvedCommentId: id(1),
    suggestionOutcome: outcome, ...(supersedes ? { decisionProof: proof(supersedes) } : {}) };
}
async function fileVault() {
  const root = await mkdtemp(join(tmpdir(), "plainva-comment-decisions-")); roots.push(root);
  const raw = new LocalVaultAdapter(root); await raw.initialize();
  await raw.writeTextFile("note.md", "The original sentence.");
  return { root, raw };
}
async function workspace(kind: "memory" | "sql") {
  const { raw } = await fileVault();
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0", now: at(0) });
  const runtime = personalWorkspaceRuntime(bootstrap);
  const remote = new FakeWorkspaceObjectStore();
  const db = kind === "sql" ? await realSqlite() : null;
  if (db) databases.push(db);
  const state = db ? new SqlWorkspaceStateStore(db) : new MemoryWorkspaceStateStore();
  await initializePersonalWorkspaceMigration({ store: remote, state, vault: raw, runtime, recoveryConfirmedAt: at(1) });
  const newWorker = () => new EncryptedWorkspaceWorker(remote, state, raw, runtime);
  const worker = newWorker(); await worker.runCycle();
  const newStore = () => new WorkspaceCommentStore({ plane: () => ({ runtime, workspaceState: state }), worker: () => null, changed: () => {} });
  return { raw, db: db!, runtime, remote, state, worker, newWorker, newStore };
}
async function storage(kind: "bundle" | "memory" | "sql") {
  if (kind !== "bundle") {
    const ctx = await workspace(kind);
    return { store: ctx.newStore() as CommentStore, reload: ctx.newStore, publish: async () => {
      await ctx.worker.runCycle(); expect(await ctx.state.listCommentOutbox()).toEqual([]);
    } };
  }
  const { root, raw } = await fileVault();
  const reload = () => new BundleCommentStore({ vault: raw, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
  return { store: reload() as CommentStore, reload, publish: async () => {} };
}
function decision(records: WorkspaceCommentRecord[]) {
  expect(records).toHaveLength(1);
  return { status: records[0].suggestionDecision?.status, ids: records[0].suggestionDecision?.decisions.map((fact) => fact.id),
    appliedAt: records[0].suggestion?.appliedAt, declinedAt: records[0].suggestion?.declinedAt, resolvedAt: records[0].resolvedAt };
}

describe.each(["bundle", "memory", "sql"] as const)("comment decisions through %s storage", (kind) => {
  it("keeps contradictory decisions in either arrival order, including markers arriving first", async () => {
    for (const order of [[proposal(), marker(2, "applied"), marker(3, "declined")], [marker(3, "declined"), marker(2, "applied"), proposal()]]) {
      const ctx = await storage(kind);
      for (const record of order) await ctx.store.post(record);
      const expected = { status: "conflict", ids: [id(2), id(3)], appliedAt: null, declinedAt: null, resolvedAt: null };
      expect(decision(await ctx.store.list("note.md"))).toEqual(expected);
      await ctx.publish();
      expect(decision(await ctx.reload().list("note.md"))).toEqual(expected);
      expect(decision((await ctx.reload().listAll()).get("note.md")!)).toEqual(expected);
    }
  });
  it("persists a reviewed resolution and still recognizes a later unknown counterdecision", async () => {
    const ctx = await storage(kind);
    for (const input of [proposal(), marker(2, "applied"), marker(3, "declined")]) await ctx.store.post(input);
    await ctx.publish();
    const known = (await ctx.store.list("note.md"))[0].suggestionDecision!.knownIds;
    const resolved = marker(4, "applied", known);
    await ctx.store.post(resolved);
    expect(decision(await ctx.store.list("note.md")).status).toBe("applied");
    await ctx.publish();
    await ctx.reload().post(resolved); // Confirmed ID must keep its exact proof.
    expect(decision(await ctx.reload().list("note.md")).ids).toEqual([id(4)]);
    await ctx.store.post({ ...marker(5, "declined"), identity: { commentId: id(5), createdAt: at(1) } });
    await ctx.publish();
    expect(decision(await ctx.reload().list("note.md")).status).toBe("conflict");
    expect(decision(await ctx.reload().list("note.md")).ids).toEqual([id(4), id(5)]);
  });
  it("does not create a conflict for two equal independent decisions", async () => {
    const ctx = await storage(kind);
    for (const input of [proposal(), marker(3, "declined"), marker(2, "declined")]) await ctx.store.post(input);
    await ctx.publish();
    expect(decision(await ctx.reload().list("note.md"))).toMatchObject({ status: "declined", ids: [id(2), id(3)], declinedAt: at(2), appliedAt: null });
  });
});

describe("verified recovery of old SQL decision markers", () => {
  async function oldState() {
    const ctx = await workspace("sql");
    const store = ctx.newStore();
    for (const input of [proposal(), marker(2, "applied"), marker(3, "declined")]) await store.post(input);
    await ctx.worker.runCycle();
    expect(await ctx.state.listCommentOutbox()).toEqual([]);
    // Reproduce exactly the old schema's missing raw outcomes and its derived
    // proposal columns, while retaining the original signed objects/operations.
    await ctx.db.execute("UPDATE workspace_comment SET suggestion_outcome = NULL, decision_proof = NULL, decision_format = 0 WHERE resolved_comment_id IS NOT NULL");
    await ctx.db.execute("UPDATE workspace_comment SET suggestion_applied_at = ?, suggestion_applied_by = ?, suggestion_declined_at = ?, resolved_at = ? WHERE comment_id = ?", [at(2), ctx.runtime.memberId, at(3), at(3), id(1)]);
    return { ...ctx, store };
  }
  it("a restarted real worker recovers original facts without uploading new objects", async () => {
    const ctx = await oldState();
    const writes = vi.spyOn(ctx.remote, "putImmutable");
    expect((await ctx.store.list("note.md"))[0].suggestionDecision!.decisions.every((fact) => fact.legacy)).toBe(true);
    await ctx.newWorker().runCycle();
    expect(await ctx.state.listCommentsNeedingDecisionRecovery()).toEqual([]);
    expect(decision(await ctx.newStore().list("note.md"))).toMatchObject({ status: "conflict", ids: [id(2), id(3)] });
    expect(writes.mock.calls.filter(([key]) => key.startsWith(".pvws/objects/"))).toHaveLength(0);
    const get = vi.spyOn(ctx.remote, "get");
    await recoverWorkspaceCommentDecisions({ state: ctx.state, store: ctx.remote, runtime: ctx.runtime });
    expect(get).not.toHaveBeenCalled();
  });
  it("preserves legacy evidence on unreadable objects and completes after retry", async () => {
    const ctx = await oldState();
    const before = await ctx.state.listRawComments();
    const get = vi.spyOn(ctx.remote, "get").mockRejectedValue(new Error("offline"));
    const outcome = await recoverWorkspaceCommentDecisions({ state: ctx.state, store: ctx.remote, runtime: ctx.runtime });
    expect(outcome.pendingIds).toEqual([id(2), id(3)]);
    expect(await ctx.state.listRawComments()).toEqual(before);
    get.mockRestore();
    await ctx.newWorker().runCycle();
    expect(decision(await ctx.store.list("note.md")).ids).toEqual([id(2), id(3)]);
  });
  it("does not undo an explicit review when a known old marker is recovered later", async () => {
    const ctx = await oldState();
    const known = (await ctx.store.list("note.md"))[0].suggestionDecision!.knownIds;
    expect(known).toEqual(expect.arrayContaining([id(2), id(3)]));
    await ctx.store.post(marker(4, "applied", known));
    expect(decision(await ctx.store.list("note.md")).status).toBe("applied");
    await ctx.newWorker().runCycle();
    expect(decision(await ctx.newStore().list("note.md")).ids).toEqual([id(4)]);
    await ctx.store.post(marker(5, "declined")); await ctx.worker.runCycle();
    expect(decision(await ctx.newStore().list("note.md")).status).toBe("conflict");
  });
  it("refuses swapped signed documents and damaged objects without erasing the old row", async () => {
    const ctx = await oldState();
    const a = (await ctx.state.getComment(id(2)))!;
    const b = (await ctx.state.getComment(id(3)))!;
    const original = (await ctx.state.getOperationDocument(a.operationHash!))!;
    await ctx.db.execute("UPDATE workspace_operation SET document_json = ? WHERE operation_hash = ?", [await ctx.state.getOperationDocument(b.operationHash!), a.operationHash]);
    const get = vi.spyOn(ctx.remote, "get").mockResolvedValue(new Uint8Array([1, 2, 3]));
    expect((await recoverWorkspaceCommentDecisions({ state: ctx.state, store: ctx.remote, runtime: ctx.runtime })).pendingIds).toEqual([id(2), id(3)]);
    expect(await ctx.state.getComment(id(2))).toEqual(a);
    get.mockRestore();
    await ctx.db.execute("UPDATE workspace_operation SET document_json = ? WHERE operation_hash = ?", [original, a.operationHash]);
    await ctx.newWorker().runCycle();
    expect(await ctx.state.listCommentsNeedingDecisionRecovery()).toEqual([]);
  });
  it("keeps the outbox on the captured object after a rename, including overview and signed publication", async () => {
    const ctx = await workspace("sql");
    const object = (await ctx.state.getObjectByPath("note.md"))!;
    await ctx.newStore().post(proposal());
    await ctx.raw.renameItem("note.md", "renamed.md");
    await ctx.state.enqueue("rename", "note.md", "renamed.md"); await ctx.worker.runCycle();
    await ctx.newStore().post({ ...marker(2, "applied"), targetObjectId: object.objectId });
    expect(decision((await ctx.newStore().listAll()).get("renamed.md")!).status).toBe("applied");
    expect((await ctx.newStore().listAll()).has("note.md")).toBe(false);
    await ctx.worker.runCycle();
    expect(decision(await ctx.newStore().list("renamed.md")).status).toBe("applied");
  });
});
