import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, initializePersonalWorkspaceMigration,
  EncryptedWorkspaceWorker, FakeWorkspaceObjectStore, MemoryWorkspaceStateStore, SqlWorkspaceStateStore,
  createWorkspaceObjectId, importedCommentFields, commentAuthorKey, commentCreatedAt,
  openWorkspaceComment, parseWorkspaceDocument, fromBase64, publishQueuedWorkspaceComment,
  evaluateWorkspaceAccess, type WorkspaceSignedDocument, type WorkspaceOperationPayload,
  inviteWorkspaceMember, applyWorkspaceGovernanceUpdate, createWorkspacePairingRequest,
  approveWorkspacePairing, acceptWorkspacePairing, workspaceDocumentHash,
  prepareWorkspaceComment, publishWorkspaceComment,
  type LegacyCommentOrigin, type WorkspaceCommentOutboxEntry, type IDatabaseAdapter,
} from "../src/index.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";
import { realSqlite } from "./helpers/realSqlite.js";

let roots: string[], databases: IDatabaseAdapter[];
beforeEach(() => { roots = []; databases = []; });
afterEach(async () => {
  await Promise.all(databases.map(db => db.close()));
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});
async function workspace(kind: "memory" | "sql") {
  const root = await mkdtemp(join(tmpdir(), "plainva-legacy-import-")); roots.push(root);
  const raw = new LocalVaultAdapter(root); await raw.initialize(); await raw.writeTextFile("note.md", "The original note.");
  const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Manager", deviceDisplayName: "Importer", platform: "desktop", minimumClientVersion: "0.8.1", now: "2026-09-09T09:00:00.000Z" }));
  const remote = new FakeWorkspaceObjectStore();
  const db = kind === "sql" ? await realSqlite() : null; if (db) databases.push(db);
  const state = db ? new SqlWorkspaceStateStore(db) : new MemoryWorkspaceStateStore();
  await initializePersonalWorkspaceMigration({ store: remote, state, vault: raw, runtime, recoveryConfirmedAt: "2026-09-09T09:01:00.000Z" });
  const worker = new EncryptedWorkspaceWorker(remote, state, raw, runtime); await worker.runCycle();
  const object = (await state.getObjectByPath("note.md"))!;
  const source = (over: Partial<LegacyCommentOrigin["record"]> = {}): LegacyCommentOrigin => ({
    format: "plainva-comments", version: 1, workspaceId: runtime.workspaceId, authorName: "Original writer",
    record: { commentId: createWorkspaceObjectId(), path: "old-name.md", authorDeviceId: "old-mobile-device",
      body: "A historical remark", createdAt: "2026-08-01T10:00:00.000Z", parentCommentId: null,
      resolvedCommentId: null, suggestionOutcome: null, suggestion: null, anchor: null, ...over },
  });
  const entry = (origin: LegacyCommentOrigin): WorkspaceCommentOutboxEntry => ({
    ...importedCommentFields(origin), legacyOrigin: origin, path: object.path, targetObjectId: object.objectId,
    outboxId: createWorkspaceObjectId(), createdAt: "2026-09-09T10:00:00.000Z", attempts: 0, lastError: null,
  });
  return { runtime, remote, raw, db, state, worker, object, source, entry };
}

describe.each(["memory", "sql"] as const)("legacy import receipts with %s state", kind => {
  it("keeps foreign provenance through the outbox, signed publication and decryption", async () => {
    const w = await workspace(kind), origin = w.source(), pending = w.entry(origin);
    await w.state.enqueueCommentOutbox(pending);
    const reopened = w.db ? new SqlWorkspaceStateStore(w.db) : w.state;
    expect((await reopened.listCommentOutbox())[0].legacyOrigin).toEqual(origin);
    await new EncryptedWorkspaceWorker(w.remote, reopened, w.raw, w.runtime).runCycle();
    expect(await reopened.listCommentOutbox()).toEqual([]);
    const saved = (await reopened.getComment(pending.commentId))!;
    expect(saved.authorMemberId).toBe(w.runtime.memberId);
    expect(saved.authorDeviceId).toBe(w.runtime.device.publicIdentity.deviceId);
    expect(saved.legacyOrigin).toEqual(origin);
    expect(commentAuthorKey(saved)).toBe("legacy:old-mobile-device");
    expect(commentCreatedAt(saved)).toBe(origin.record.createdAt);
    const document = parseWorkspaceDocument(fromBase64((await reopened.getOperationDocument(saved.operationHash!))!)) as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
    const objectBytes = (await w.remote.get(`.pvws/objects/${saved.commentId}/${saved.payloadHash}.pvobj`))!;
    const opened = await openWorkspaceComment({ objectBytes, operation: document, readerKeys: w.runtime.groupKeys });
    expect(opened.legacyOrigin).toEqual(origin);
    expect(opened.createdAt).toBe(pending.createdAt);
    expect(await w.raw.readTextFile("note.md")).toBe("The original note.");
  });

  it("deduplicates another valid receipt but rejects changed source content", async () => {
    const w = await workspace(kind), pending = w.entry(w.source());
    await w.state.enqueueCommentOutbox(pending); await w.worker.runCycle();
    const saved = (await w.state.getComment(pending.commentId))!;
    await w.state.saveComment({ ...saved, authorMemberId: "another-manager", operationHash: "a".repeat(64) });
    expect(await w.state.listRawComments(w.object.objectId)).toHaveLength(1);
    await expect(w.state.saveComment({ ...saved, legacyOrigin: { ...saved.legacyOrigin!, record: { ...saved.legacyOrigin!.record, body: "Changed history" } } })).rejects.toThrow("identity conflict");
    expect((await w.state.getComment(pending.commentId))?.body).toBe("A historical remark");
  });

  it("retains malformed import attempts without publishing unrelated content", async () => {
    const w = await workspace(kind), pending = w.entry(w.source()); pending.body = "Unrelated content";
    await w.state.enqueueCommentOutbox(pending); await w.worker.runCycle();
    expect((await w.state.listCommentOutbox())[0]).toMatchObject({ attempts: 1, lastError: "Legacy comment content changed" });
    expect(await w.state.getComment(pending.commentId)).toBeNull();
  });

  it("does not turn a stranger's historical deletion into the importing manager's deletion", async () => {
    const w = await workspace(kind), origin = w.source();
    const root = w.entry(origin), stranger = w.entry(w.source({ body: "", authorDeviceId: "stranger",
      retractsCommentId: origin.record.commentId }));
    await w.state.enqueueCommentOutbox(root); await w.state.enqueueCommentOutbox(stranger); await w.worker.runCycle();
    expect(await w.state.listCommentOutbox()).toEqual([]);
    expect((await w.state.listComments(w.object.objectId)).map(c => c.commentId)).toEqual([root.commentId]);
    const own = w.entry(w.source({ body: "", retractsCommentId: origin.record.commentId }));
    await w.state.enqueueCommentOutbox(own); await w.worker.runCycle();
    expect(await w.state.listComments(w.object.objectId)).toEqual([]);
  });

  it("ordinary comment permission cannot publish a claim about historical authors", async () => {
    const w = await workspace(kind), pending = w.entry(w.source());
    const policy = structuredClone(w.runtime.policy.payload);
    policy.assignments = policy.assignments.map(a => ({ ...a, role: "Commenter", capabilities: ["comment.create", "comment.read", "content.read"] }));
    const who = { memberId: w.runtime.memberId, deviceId: w.runtime.device.publicIdentity.deviceId };
    expect(evaluateWorkspaceAccess(policy, { ...who, capability: "comment.create" }).allowed).toBe(true);
    expect(evaluateWorkspaceAccess(policy, { ...who, capability: "workspace.manage" }).allowed).toBe(false);
    await expect(publishQueuedWorkspaceComment({ runtime: w.runtime, policy, state: w.state, store: w.remote, entry: pending })).rejects.toThrow("only workspace managers");
    expect(await w.state.getComment(pending.commentId)).toBeNull();
  });
});

it("adds provenance columns to existing SQLite tables without losing queued comments", async () => {
  const w = await workspace("sql"), pending = w.entry(w.source());
  const old = { ...w.entry(w.source()), legacyOrigin: undefined };
  await w.state.enqueueCommentOutbox(old);
  await w.db!.execute("ALTER TABLE workspace_comment DROP COLUMN legacy_origin");
  await w.db!.execute("ALTER TABLE workspace_comment_outbox DROP COLUMN legacy_origin");
  await initializeSchema(w.db!); await initializeSchema(w.db!);
  await w.state.enqueueCommentOutbox(pending);
  const reopened = await new SqlWorkspaceStateStore(w.db!).listCommentOutbox();
  expect(reopened).toHaveLength(2);
  expect(reopened.find(entry => entry.commentId === old.commentId)).toMatchObject({ body: old.body, outboxId: old.outboxId });
  const imported = reopened.find(entry => entry.commentId === pending.commentId)!;
  expect({ ...imported, decisionProof: imported.decisionProof ?? null }).toEqual(pending);
  expect((await w.state.getObjectByPath("note.md"))?.objectId).toBe(w.object.objectId);
});

it("only acknowledges the winning source when two SQLite writers race on one import ID", async () => {
  const w = await workspace("sql"), pending = w.entry(w.source());
  await w.state.enqueueCommentOutbox(pending); await w.worker.runCycle();
  const original = (await w.state.getComment(pending.commentId))!;
  await w.db!.execute("DELETE FROM workspace_comment WHERE comment_id = ?", [original.commentId]);
  const competing = { ...original, body: "Competing source", operationHash: "b".repeat(64),
    legacyOrigin: { ...original.legacyOrigin!, record: { ...original.legacyOrigin!.record, body: "Competing source" } } };
  const result = await Promise.allSettled([new SqlWorkspaceStateStore(w.db!).saveComment(original), new SqlWorkspaceStateStore(w.db!).saveComment(competing)]);
  expect(result.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(await w.state.listRawComments(w.object.objectId)).toHaveLength(1);
});

it("the receiving worker rejects a genuinely signed import from an ordinary commenter", async () => {
  const w = await workspace("sql");
  const invitation = await inviteWorkspaceMember({ runtime: w.runtime, displayName: "Commenter", role: "Commenter" });
  applyWorkspaceGovernanceUpdate(w.runtime, invitation);
  const created = await createWorkspacePairingRequest({ workspaceId: w.runtime.workspaceId,
    workspaceFingerprint: workspaceDocumentHash(w.runtime.genesis), memberId: invitation.memberId,
    deviceDisplayName: "Other phone", platform: "android" });
  const previousPolicy = w.runtime.policy;
  const approval = await approveWorkspacePairing({ token: created.token, runtime: w.runtime });
  const paired = await acceptWorkspacePairing({ created, genesis: w.runtime.genesis, previousPolicy, approval });
  const origin = w.source();
  // A client can sign its own bytes. The receiver must enforce the additional
  // import right independently of this app's local publication guard.
  const prepared = await prepareWorkspaceComment({ ...importedCommentFields(origin), legacyOrigin: origin,
    runtime: paired, policyHash: workspaceDocumentHash(paired.policy), sequence: 1, previousDeviceOperationHash: null,
    targetObjectId: w.object.objectId, targetRevisionId: w.object.currentRevisionId!,
    recipients: [{ groupId: w.runtime.ownerGroup.groupId, keyEpoch: w.runtime.ownerGroup.keyEpoch, publicKey: w.runtime.ownerGroup.hpke.publicKey }],
  });
  await publishWorkspaceComment(w.remote, prepared);
  await expect(w.worker["applyIncoming"](prepared.operation, prepared.operationHash, (await w.state.loadMeta())!, paired.policy.payload))
    .rejects.toThrow("only workspace managers");
  expect(await w.state.getComment(prepared.comment.commentId)).toBeNull();
});
