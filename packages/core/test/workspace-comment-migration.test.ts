import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BundleCommentStore, MigratingWorkspaceCommentStore, WorkspaceCommentStore, CommentStoreLockedError,
  createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, initializePersonalWorkspaceMigration,
  EncryptedWorkspaceWorker, FakeWorkspaceObjectStore, SqlWorkspaceStateStore, createWorkspaceObjectId,
  commentsDevicePath, legacyCommentId, commentAuthorKey, commentCreatedAt, createWorkspacePairingRequest,
  workspaceDocumentHash, approveWorkspacePairing, publishWorkspaceGovernanceUpdate, acceptWorkspacePairing,
  FileCommentOperationJournal, createCommentOperationService, commentOperationStore, prepareCommentOperation,
  type IDatabaseAdapter, type BundleCommentsMode, type CommentOperation,
} from "../src/index.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";

let roots: string[], databases: IDatabaseAdapter[];
beforeEach(() => { roots = []; databases = []; });
afterEach(async () => {
  await Promise.all(databases.map(db => db.close()));
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});
async function files() {
  const root = await mkdtemp(join(tmpdir(), "plainva-migrating-comments-")); roots.push(root);
  const raw = new LocalVaultAdapter(root); await raw.initialize();
  const db = await realSqlite(); databases.push(db);
  return { root, raw, db, state: new SqlWorkspaceStateStore(db) };
}
async function setup() {
  const w = await files(); await w.raw.writeTextFile("note.md", "Original sentence.");
  const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Manager", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.8.1" }));
  const remote = new FakeWorkspaceObjectStore();
  await initializePersonalWorkspaceMigration({ store: remote, state: w.state, vault: w.raw, runtime, recoveryConfirmedAt: new Date().toISOString() });
  const worker = new EncryptedWorkspaceWorker(remote, w.state, w.raw, runtime); await worker.runCycle();
  let locked = false, mode: BundleCommentsMode = { kind: "plain" };
  const legacy = new BundleCommentStore({ vault: w.raw, vaultKey: w.root, deviceId: async () => "old-phone", mode: async () => mode, authorName: async () => "Original writer" });
  const deps = { plane: () => { if (locked) throw new CommentStoreLockedError(); return { runtime, workspaceState: w.state }; }, worker: () => null, changed: vi.fn() };
  const store = () => new MigratingWorkspaceCommentStore(deps, legacy);
  const postOld = async (body = "Historical remark", path = "note.md") => {
    const identity = { commentId: createWorkspaceObjectId(), createdAt: "2026-09-01T09:00:00.000Z" };
    await legacy.post({ path, body, identity }); return identity;
  };
  return { ...w, runtime, remote, worker, legacy, deps, store, postOld,
    lock: () => { locked = true; }, legacyLock: () => { mode = { kind: "locked" }; } };
}

describe("signed migration of existing comment history", () => {
  it("imports once across concurrent readers and a store restart, preserving the original file", async () => {
    const w = await setup(), id = await w.postOld();
    const source = await w.raw.readTextFile(commentsDevicePath("old-phone", false));
    const store = w.store();
    const [first, all, names] = await Promise.all([store.list("note.md"), store.listAll(), store.authors()]);
    expect(first).toHaveLength(1); expect(all.get("note.md")).toHaveLength(1);
    expect(first[0]).toMatchObject({ commentId: legacyCommentId(w.runtime.workspaceId, id.commentId), authorMemberId: w.runtime.memberId });
    expect(names.get(commentAuthorKey(first[0]))).toBe("Original writer");
    expect(commentCreatedAt(first[0])).toBe(id.createdAt);
    expect(await w.state.listCommentOutbox()).toHaveLength(1);
    await w.worker.runCycle();
    expect((await w.store().list("note.md"))[0].pending).toBeUndefined();
    expect(await w.state.listRawComments()).toHaveLength(1);
    expect(await w.state.listCommentOutbox()).toHaveLength(0);
    expect(await w.raw.readTextFile(commentsDevicePath("old-phone", false))).toBe(source);
    expect(await w.raw.readTextFile("note.md")).toBe("Original sentence.");
  });

  it("keeps unsynced and permission-limited sources visible without forging membership or queuing imports", async () => {
    const w = await setup(); await w.postOld(); await w.postOld("Not indexed yet", "unsynced.md");
    w.runtime.policy.payload.assignments = w.runtime.policy.payload.assignments.map(a => ({ ...a, role: "Commenter", capabilities: ["comment.read", "comment.create", "content.read"] }));
    const all = await w.store().listAll();
    expect(all.get("note.md")?.[0]).toMatchObject({ legacyPending: true, authorMemberId: "legacy:old-phone" });
    expect(all.get("unsynced.md")?.[0]).toMatchObject({ legacyPending: true, body: "Not indexed yet" });
    expect(all.get("note.md")?.[0].operationHash).toBeUndefined();
    expect(await w.state.listCommentOutbox()).toEqual([]);
    w.runtime.policy.payload.assignments = w.runtime.policy.payload.assignments.map(a => ({ ...a, role: "Custom", capabilities: ["content.read"] }));
    expect(await w.store().listAll()).toEqual(new Map());
  });

  it("retains a source on a failed queue write and retries after reopening", async () => {
    const w = await setup(); await w.postOld();
    vi.spyOn(w.state, "enqueueCommentOutbox").mockRejectedValueOnce(new Error("disk full"));
    expect((await w.store().list("note.md"))[0]).toMatchObject({ legacyPending: true });
    expect(await w.state.listCommentOutbox()).toEqual([]);
    expect((await w.store().list("note.md"))[0].pending).toBeDefined();
    expect(await w.state.listCommentOutbox()).toHaveLength(1);
  });

  it("preserves names accepted by the old format instead of hiding their entire history", async () => {
    const w = await setup(); await w.postOld();
    const path = commentsDevicePath("old-phone", false), bundle = JSON.parse(await w.raw.readTextFile(path));
    bundle.authors["old-phone"].name = "Long historical name ".repeat(80);
    await w.raw.writeTextFile(path, JSON.stringify(bundle));
    expect((await w.store().list("note.md"))[0].legacyOrigin?.authorName).toBe(bundle.authors["old-phone"].name);
  });

  it("a published receipt stays with its object after a move and old-path reuse", async () => {
    const w = await setup(); await w.postOld(); await w.store().listAll(); await w.worker.runCycle();
    const original = (await w.state.getObjectByPath("note.md"))!;
    await w.raw.renameItem("note.md", "renamed.md");
    await w.state.enqueue("rename", "note.md", "renamed.md"); await w.worker.runCycle();
    expect((await w.state.getObjectByPath("renamed.md"))?.objectId).toBe(original.objectId);
    await w.raw.writeTextFile("note.md", "Another note.");
    await w.state.enqueue("write", "note.md"); await w.worker.runCycle();
    expect(await w.store().list("note.md")).toEqual([]);
    expect(await w.store().list("renamed.md")).toHaveLength(1);
    await w.raw.deleteItem("renamed.md"); await w.state.enqueue("delete", "renamed.md"); await w.worker.runCycle();
    expect(await w.store().listAll()).toEqual(new Map());
  });

  it("retains conflicting local history beside the acknowledged fact without overwriting it", async () => {
    const w = await setup(), id = await w.postOld(); await w.store().listAll(); await w.worker.runCycle();
    const path = commentsDevicePath("old-phone", false), bundle = JSON.parse(await w.raw.readTextFile(path));
    bundle.comments[id.commentId].body = "Different local source";
    await w.raw.writeTextFile(path, JSON.stringify(bundle));
    const comments = await w.store().list("note.md");
    expect(comments).toHaveLength(2);
    expect(comments.find(c => c.legacyPending)?.body).toBe("Different local source");
    expect((await w.state.listRawComments())[0].body).toBe("Historical remark");
  });

  it("projects imported replies and decision markers together with the original timestamps", async () => {
    const w = await setup(), id = await w.postOld();
    await w.legacy.post({ path: "note.md", body: "Reply", parentCommentId: id.commentId });
    await w.legacy.post({ path: "note.md", body: "", resolvedCommentId: id.commentId,
      identity: { commentId: createWorkspaceObjectId(), createdAt: "2026-09-02T10:00:00.000Z" } });
    const comments = await w.store().list("note.md");
    expect(comments).toHaveLength(2);
    expect(comments.find(c => c.body === "Historical remark")?.resolvedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(comments.find(c => c.body === "Reply")?.parentCommentId).toBe(legacyCommentId(w.runtime.workspaceId, id.commentId));
  });

  it("keeps locked workspaces on the workspace route and distinguishes a separately locked old history", async () => {
    const w = await setup(); await w.postOld(); w.legacyLock();
    expect(await w.store().state()).toMatchObject({ mode: "workspace", legacyLocked: true });
    await w.store().post({ path: "note.md", body: "Signed new comment" });
    expect((await w.state.listCommentOutbox())[0].legacyOrigin).toBeUndefined();
    w.lock();
    expect(await w.store().state()).toEqual({ mode: "locked", hasOutbox: true });
    expect(await w.store().listAll()).toEqual(new Map());
    expect(await w.store().selfId()).toBeNull();
    await expect(w.store().post({ path: "note.md", body: "Must not become plaintext" })).rejects.toBeInstanceOf(CommentStoreLockedError);
  });

  it("two independently paired SQLite devices exchange imported history and new signed replies", async () => {
    const w = await setup(), id = await w.postOld();
    const p = await files();
    const created = await createWorkspacePairingRequest({ workspaceId: w.runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(w.runtime.genesis), memberId: w.runtime.memberId, deviceDisplayName: "Phone", platform: "android" });
    const previousPolicy = w.runtime.policy;
    const approval = await approveWorkspacePairing({ token: created.token, runtime: w.runtime });
    await publishWorkspaceGovernanceUpdate(w.remote, approval);
    w.runtime.policy = approval.policy; w.runtime.grants = [...w.runtime.grants, ...approval.grants];
    const phone = await acceptWorkspacePairing({ created, genesis: w.runtime.genesis, previousPolicy, approval });
    await initializePersonalWorkspaceMigration({ store: w.remote, state: p.state, vault: p.raw, runtime: phone, recoveryConfirmedAt: new Date().toISOString() });
    const phoneWorker = new EncryptedWorkspaceWorker(w.remote, p.state, p.raw, phone);
    await phoneWorker.runCycle();
    const oldBytes = await w.raw.readBinaryFile(commentsDevicePath("old-phone", false));
    await p.raw.writeBinaryFile(commentsDevicePath("old-phone", false), oldBytes);
    const phoneLegacy = new BundleCommentStore({ vault: p.raw, vaultKey: p.root, deviceId: async () => "phone-current", mode: async () => ({ kind: "plain" }) });
    const phoneStore = new MigratingWorkspaceCommentStore({ plane: () => ({ runtime: phone, workspaceState: p.state }), worker: () => null, changed: vi.fn() }, phoneLegacy);
    // Both managers discover the same history before either publication.
    await Promise.all([w.store().listAll(), phoneStore.listAll()]);
    await w.worker.runCycle(); await phoneWorker.runCycle(); await w.worker.runCycle();
    const imported = legacyCommentId(w.runtime.workspaceId, id.commentId);
    expect((await w.state.listRawComments()).map(c => c.commentId)).toEqual([imported]);
    expect((await p.state.listRawComments()).map(c => c.commentId)).toEqual([imported]);
    await phoneStore.post({ path: "note.md", body: "New phone reply", parentCommentId: imported });
    await phoneWorker.runCycle(); await w.worker.runCycle();
    const reply = (await w.store().list("note.md")).find(c => c.body === "New phone reply")!;
    expect(reply.authorDeviceId).toBe(phone.device.publicIdentity.deviceId);
    expect(reply.operationHash).toMatch(/^[a-f0-9]{64}$/); expect(reply.legacyOrigin).toBeUndefined();
    expect(await w.state.listQuarantine("pending")).toEqual([]); expect(await p.state.listQuarantine("pending")).toEqual([]);
    expect(await p.raw.readTextFile("note.md")).toBe("Original sentence.");
  });
});

it.each(["list", "listAll"] as const)("%s cannot lose a comment during the queue-to-record handover", async method => {
  const w = await setup(), store = new WorkspaceCommentStore(w.deps);
  await store.post({ path: "note.md", body: "Handover" });
  const read = w.state.listCommentOutbox.bind(w.state);
  vi.spyOn(w.state, "listCommentOutbox").mockImplementationOnce(async () => {
    const queued = await read(); await w.worker.runCycle(); return queued;
  });
  const result = method === "list" ? await store.list("note.md") : (await store.listAll()).get("note.md");
  expect(result).toHaveLength(1); expect(result?.[0].body).toBe("Handover");
});

async function operationHarness(w: Awaited<ReturnType<typeof setup>>) {
  const dir = join(w.root, ".local-journal"); await mkdir(dir);
  const journal = () => new FileCommentOperationJournal({
    read: async file => { try { return await readFile(join(dir, file), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } },
    writeAtomic: async (file, text) => { const part = join(dir, `${file}.part`); await writeFile(part, text); await rename(part, join(dir, file)); },
    list: () => readdir(dir),
  });
  const store = w.store(), disk = journal();
  const route = (operation?: CommentOperation) => commentOperationStore(store, disk, operation);
  const deps = { contextKey: w.root, journal: disk,
    authorKey: async operation => (await route(operation)).writerKey(),
    resolvePath: async operation => (await route(operation)).resolvePath(operation.notePath, operation.createdAt, operation.markers[0].targetObjectId),
    withNoteLock: async (_path, work) => work(), readText: path => w.raw.readTextFile(path), writeText: (path, text) => w.raw.writeTextFile(path, text),
    post: async (marker, operation) => (await route(operation)).post(marker),
  } satisfies Parameters<typeof createCommentOperationService>[0];
  return { store, disk, deps, service: createCommentOperationService(deps) };
}

it("resumes only an already saved bundle operation through its original writer after upgrade", async () => {
  const w = await setup(), { store, disk, service } = await operationHarness(w);
  const op = prepareCommentOperation({ contextKey: w.root, authorKey: await w.legacy.writerKey(), notePath: "note.md", kind: "post", markers: [{ path: "note.md", body: "Started before upgrade" }] });
  await disk.write(op);
  expect((await service.run(op)).phase).toBe("completed");
  expect((await w.legacy.list("note.md"))[0].commentId).toBe(op.markers[0].identity.commentId);
  await service.run(op); expect(await w.legacy.list("note.md")).toHaveLength(1);
  expect((await service.prepare({ notePath: "note.md", kind: "post", markers: [{ path: "note.md", body: "New action" }] })).authorKey).toBe(await store.writerKey());
  const forged = { ...op, operationId: createWorkspaceObjectId(), phase: "prepared" as const, postedIds: [] };
  await expect(service.run(forged)).rejects.toThrow(); expect(await disk.read(forged.operationId)).toBeNull();
  const changed = structuredClone(op); changed.markers[0].body = "Changed old plan";
  await expect(service.run(changed)).rejects.toThrow();
  expect((await store.list("note.md"))[0].legacyOrigin?.record.commentId).toBe(op.markers[0].identity.commentId);
});

it.each(["legacy", "workspace"] as const)("an unfinished %s operation obeys current comment and content rights", async kind => {
  const w = await setup(), { store, disk, service } = await operationHarness(w);
  const op = prepareCommentOperation({ contextKey: w.root, authorKey: await (kind === "legacy" ? w.legacy : store).writerKey(), notePath: "note.md", kind: "apply",
    text: { before: "Original sentence.", intended: "Changed sentence." }, markers: [{ path: "note.md", body: "Decision" }] });
  await disk.write(op);
  const original = structuredClone(w.runtime.policy.payload.assignments);
  w.runtime.policy.payload.assignments = original.map(a => ({ ...a, role: "Commenter", capabilities: ["comment.read", "content.read", "content.write"] }));
  await expect(service.run(op)).rejects.toThrow();
  expect(await w.raw.readTextFile("note.md")).toBe("Original sentence.");
  w.runtime.policy.payload.assignments = original.map(a => ({ ...a, role: "Commenter", capabilities: ["comment.read", "comment.create", "content.read"] }));
  await expect(service.run(op)).rejects.toThrow();
  expect(await w.raw.readTextFile("note.md")).toBe("Original sentence.");
  expect((await disk.read(op.operationId))?.phase).toBe("prepared");
  w.runtime.policy.payload.assignments = original;
  expect((await service.run(op)).phase).toBe("completed");
  expect(await w.raw.readTextFile("note.md")).toBe("Changed sentence.");
});

it("an old saved text receipt resumes after upgrade without replaying its text over later edits", async () => {
  const w = await setup(), { disk, deps, service } = await operationHarness(w);
  const op = prepareCommentOperation({ contextKey: w.root, authorKey: await w.legacy.writerKey(), notePath: "note.md", kind: "apply",
    text: { before: "Original sentence.", intended: "Accepted sentence." }, markers: [{ path: "note.md", body: "Old decision" }] });
  const beforeUpgrade = createCommentOperationService({ ...deps, authorKey: () => w.legacy.writerKey(),
    resolvePath: operation => w.legacy.resolvePath(operation.notePath, operation.createdAt), post: async () => { throw new Error("Interrupted marker write"); } });
  await expect(beforeUpgrade.run(op)).rejects.toThrow();
  const saved = (await disk.read(op.operationId))!;
  expect(saved.phase).toBe("markers-pending"); expect(saved.receipt?.confirmedText).toBe("Accepted sentence.");
  await w.raw.writeTextFile("note.md", "My later edit.");
  const completed = await service.run(op);
  expect(completed.phase).toBe("completed"); expect(completed.receipt).toEqual(saved.receipt);
  expect(await w.raw.readTextFile("note.md")).toBe("My later edit.");
  expect((await w.legacy.list("note.md"))[0].commentId).toBe(op.markers[0].identity.commentId);
});
