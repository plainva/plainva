import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  PermissionedVaultAdapter,
  WorkspaceRevisionHistoryService,
  acceptWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  approveWorkspacePairing,
  createPersonalWorkspaceBootstrap,
  createWorkspacePairingRequest,
  createWorkspacePolicySuccessor,
  createWorkspaceRecoveryPackage,
  evaluateWorkspaceAccess,
  initializePersonalWorkspaceMigration,
  inviteWorkspaceMember,
  openWorkspaceComment,
  personalWorkspaceRuntime,
  prepareWorkspaceComment,
  previewWorkspaceSlice,
  resolveWorkspacePolicyChain,
  restoreWorkspaceFromRecoveryPackage,
  rotateWorkspaceRecoveryPackage,
  publishWorkspaceRecoveryRotation,
  revokeWorkspaceDeviceAndRotate,
  workspaceCommentRecord,
  workspaceDocumentHash,
  workspaceRecipientGroupIds,
  workspaceRecoveryContentInvariant,
  workspaceSliceIdsForObject,
  toBase64,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type VaultFileInfo,
  type WorkspacePolicyPayload,
} from "../src/index.js";

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

async function workspace() {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0", now: "2026-07-22T08:00:00.000Z" });
  return { bootstrap, runtime: personalWorkspaceRuntime(bootstrap) };
}

function accessAuthorizer(runtime: PersonalWorkspaceRuntime, objects = new Map<string, string>()) {
  return async (request: { path: string; newPath?: string; capability: "content.create" | "content.write" | "content.rename" | "content.delete" }) => {
    const objectId = objects.get(request.path) ?? "91".repeat(16);
    return evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: request.capability, objectId, sliceIds: workspaceSliceIdsForObject(runtime.policy.payload, { objectId, path: request.newPath ?? request.path }) });
  };
}

describe("workspace governance P4-P7 contracts", () => {
  it("pairs an invited member, validates fingerprints/grants, and makes revocation effective", async () => {
    const { runtime } = await workspace();
    const invitation = await inviteWorkspaceMember({ runtime, displayName: "Editor", role: "Editor" });
    applyWorkspaceGovernanceUpdate(runtime, invitation);
    const created = await createWorkspacePairingRequest({ workspaceId: runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(runtime.genesis), memberId: invitation.memberId, deviceDisplayName: "Phone", platform: "android", now: "2026-07-22T08:05:00.000Z" });
    const previousPolicy = runtime.policy;
    const approval = await approveWorkspacePairing({ token: created.token, runtime, now: "2026-07-22T08:06:00.000Z" });
    const paired = await acceptWorkspacePairing({ created, genesis: runtime.genesis, previousPolicy, approval, now: "2026-07-22T08:07:00.000Z" });
    expect(paired.groupKeys).toHaveLength(1);
    expect(evaluateWorkspaceAccess(paired.policy.payload, { memberId: paired.memberId, deviceId: paired.device.publicIdentity.deviceId, capability: "content.write" }).allowed).toBe(true);
    const memberGroup = approval.policy.payload.groups.find((group) => group.memberIds?.includes(paired.memberId))!;
    const revoked = await revokeWorkspaceDeviceAndRotate({ runtime: { ...runtime, policy: approval.policy }, deviceId: paired.device.publicIdentity.deviceId, reason: "lost", now: "2026-07-22T08:08:00.000Z" });
    expect(evaluateWorkspaceAccess(revoked.policy.payload, { memberId: paired.memberId, deviceId: paired.device.publicIdentity.deviceId, capability: "content.read" }).reason).toBe("device-inactive");
    expect(revoked.policy.payload.groups.find((group) => group.groupId === memberGroup.groupId)?.keyEpoch).toBe(memberGroup.keyEpoch + 1);
  });

  it("restores after all devices are lost without changing content coordinates", async () => {
    const { bootstrap } = await workspace();
    const recovery = createWorkspaceRecoveryPackage(bootstrap, { now: "2026-07-22T08:01:00.000Z" });
    const refs = [{ objectId: "11".repeat(16), revisionId: "22".repeat(16), payloadHash: "33".repeat(32) }];
    const before = workspaceRecoveryContentInvariant(refs);
    const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: recovery.bytes, recoveryCode: recovery.recoveryCode, deviceDisplayName: "Replacement", platform: "desktop", now: "2026-07-22T09:00:00.000Z", revokeOtherDevices: true });
    expect(restored.runtime.device.publicIdentity.deviceId).not.toBe(bootstrap.device.publicIdentity.deviceId);
    expect(restored.policy.payload.devices.find((device) => device.deviceId === bootstrap.device.publicIdentity.deviceId)?.state).toBe("revoked");
    expect(workspaceRecoveryContentInvariant(refs)).toBe(before);
  });

  it("rotates and reanchors recovery before restoring from the renewed package", async () => {
    const { bootstrap, runtime } = await workspace();
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const vault = new TestVault();
    const original = createWorkspaceRecoveryPackage(bootstrap, { now: "2026-07-22T08:01:00.000Z" });
    await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-07-22T08:01:00.000Z" });
    const renewed = await rotateWorkspaceRecoveryPackage({ bytes: original.bytes, recoveryCode: original.recoveryCode, runtime, store, now: "2026-07-22T08:30:00.000Z" });
    expect(renewed.payload.recoveryId).not.toBe(original.payload.recoveryId);
    await publishWorkspaceRecoveryRotation({ store, runtime, anchor: renewed.anchor });
    expect((await store.list(".pvws/recovery/")).items).toHaveLength(1);
    const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: renewed.bytes, recoveryCode: renewed.recoveryCode, deviceDisplayName: "Replacement", platform: "desktop", store, now: "2026-07-22T09:00:00.000Z" });
    expect(restored.policy.signatures[0].signerId).toBe(renewed.payload.recoveryId);
    await expect(rotateWorkspaceRecoveryPackage({ bytes: original.bytes, recoveryCode: original.recoveryCode, runtime, store })).rejects.toThrow(/no longer the active/i);
  });

  it("rejects concurrent valid policy successors instead of guessing", async () => {
    const { runtime } = await workspace();
    const signer = { signer: { algorithm: "Ed25519" as const, signerId: runtime.device.publicIdentity.deviceId, signerKind: "device" as const }, privateKey: runtime.device.secrets.signing.privateKey };
    const left = createWorkspacePolicySuccessor({ current: runtime.policy, signer, mutate: (draft) => { draft.minimumClientVersion = "0.5.1"; } });
    const right = createWorkspacePolicySuccessor({ current: runtime.policy, signer, mutate: (draft) => { draft.minimumClientVersion = "0.5.2"; } });
    expect(() => resolveWorkspacePolicyChain({ initial: runtime.policy, candidates: [left, right] })).toThrow(/concurrent/i);
  });

  it("enforces Reader and Contributor at the pre-disk adapter boundary", async () => {
    const { runtime } = await workspace();
    const raw = new TestVault(); await raw.writeTextFile("existing.md", "before");
    const readerPolicy: WorkspacePolicyPayload = structuredClone(runtime.policy.payload);
    readerPolicy.assignments[0].role = "Reader"; readerPolicy.assignments[0].capabilities = ["comment.read", "content.read", "history.read"];
    const reader = new PermissionedVaultAdapter(raw, accessAuthorizer({ ...runtime, policy: { ...runtime.policy, payload: readerPolicy } }));
    await expect(reader.writeTextFile("existing.md", "after")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(reader.writeTextFile("new.md", "new")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(reader.renameItem("existing.md", "renamed.md")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(reader.deleteItem("existing.md")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await reader.authorizeExternalChange("existing.md", true)).toBe(false);
    expect(await raw.readTextFile("existing.md")).toBe("before");

    const contributorPolicy: WorkspacePolicyPayload = structuredClone(runtime.policy.payload);
    contributorPolicy.assignments[0].role = "Contributor"; contributorPolicy.assignments[0].capabilities = ["content.create"];
    const contributor = new PermissionedVaultAdapter(raw, accessAuthorizer({ ...runtime, policy: { ...runtime.policy, payload: contributorPolicy } }));
    await contributor.writeTextFile("new.md", "allowed");
    await expect(contributor.writeTextFile("new.md", "overwrite")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("materializes folder, selection and dynamic slices and derives exact group recipients", async () => {
    const objectA = { objectId: "a1".repeat(16), path: "Projects/A.md", tags: ["shared"], contentKind: "text" as const };
    const objectB = { objectId: "b2".repeat(16), path: "Private/B.md", tags: ["private"], contentKind: "text" as const };
    const slices = [
      { sliceId: "01".repeat(16), name: "Projects", kind: "folder" as const, definition: "Projects", materializedObjectIds: [] },
      { sliceId: "02".repeat(16), name: "Chosen", kind: "selection" as const, definition: JSON.stringify([objectB.objectId]), materializedObjectIds: [] },
      { sliceId: "03".repeat(16), name: "Shared", kind: "dynamic" as const, definition: JSON.stringify({ all: [{ field: "tag", operator: "equals", value: "shared" }] }), materializedObjectIds: [] },
    ];
    expect(previewWorkspaceSlice(slices[0], [objectA, objectB]).matchedObjectIds).toEqual([objectA.objectId]);
    expect(previewWorkspaceSlice(slices[1], [objectA, objectB]).matchedObjectIds).toEqual([objectB.objectId]);
    expect(previewWorkspaceSlice(slices[2], [objectA, objectB]).matchedObjectIds).toEqual([objectA.objectId]);
    const policy = { policyVersion: 1, previousPolicyHash: null, minimumClientVersion: "0.5.0", algorithmSuites: [1], members: [{ memberId: "10".repeat(16), displayName: "C", state: "active" as const }], devices: [], groups: [{ groupId: "20".repeat(16), name: "C", memberIds: ["10".repeat(16)], keyEpoch: 1, hpkePublicKey: toBase64(new Uint8Array(32)) }], assignments: [{ assignmentId: "30".repeat(16), subjectKind: "group" as const, subjectId: "20".repeat(16), role: "Reader", capabilities: ["content.read" as const], scopeKind: "slice" as const, scopeId: slices[2].sliceId }], slices: slices.map((slice) => ({ ...slice, materializedObjectIds: previewWorkspaceSlice(slice, [objectA, objectB]).matchedObjectIds })), objectOverrides: [], revocations: [] } satisfies WorkspacePolicyPayload;
    expect(workspaceRecipientGroupIds(policy, objectA)).toEqual(["20".repeat(16)]);
    expect(workspaceRecipientGroupIds(policy, objectB)).toEqual([]);
  });

  it("creates encrypted signed comments that a Commenter can author but cannot edit content", async () => {
    const { runtime } = await workspace();
    const policy = structuredClone(runtime.policy.payload);
    policy.assignments[0].role = "Commenter"; policy.assignments[0].capabilities = ["comment.create", "comment.read", "content.read", "history.read"];
    runtime.policy = { ...runtime.policy, payload: policy };
    expect(evaluateWorkspaceAccess(policy, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "comment.create" }).allowed).toBe(true);
    expect(evaluateWorkspaceAccess(policy, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "content.write" }).allowed).toBe(false);
    const prepared = await prepareWorkspaceComment({ runtime, policyHash: workspaceDocumentHash(runtime.policy), sequence: 1, previousDeviceOperationHash: null, targetObjectId: "41".repeat(16), targetRevisionId: "42".repeat(16), body: "Please clarify", recipients: [{ groupId: runtime.ownerGroup.groupId, keyEpoch: runtime.ownerGroup.keyEpoch, publicKey: runtime.ownerGroup.hpke.publicKey }], now: "2026-07-22T10:00:00.000Z" });
    const opened = await openWorkspaceComment({ objectBytes: prepared.objectBytes, operation: prepared.operation, readerKeys: runtime.groupKeys });
    const state = new MemoryWorkspaceStateStore();
    const original = workspaceCommentRecord(opened, prepared.operation, prepared.operationHash);
    await state.saveComment(original);
    const resolution = await prepareWorkspaceComment({ runtime, policyHash: workspaceDocumentHash(runtime.policy), sequence: 2, previousDeviceOperationHash: prepared.operationHash, targetObjectId: original.targetObjectId, targetRevisionId: original.targetRevisionId, body: "Resolved", resolvedCommentId: original.commentId, recipients: [{ groupId: runtime.ownerGroup.groupId, keyEpoch: runtime.ownerGroup.keyEpoch, publicKey: runtime.ownerGroup.hpke.publicKey }], now: "2026-07-22T10:05:00.000Z" });
    const resolvedBody = await openWorkspaceComment({ objectBytes: resolution.objectBytes, operation: resolution.operation, readerKeys: runtime.groupKeys });
    await state.saveComment(workspaceCommentRecord(resolvedBody, resolution.operation, resolution.operationHash));
    expect(await state.listComments(original.targetObjectId)).toEqual([expect.objectContaining({ body: "Please clarify", resolvedAt: "2026-07-22T10:05:00.000Z" })]);
  });

  it("keeps syncing valid work when one remote operation is malformed and records ciphertext quarantine", async () => {
    const { runtime } = await workspace();
    const store = new FakeWorkspaceObjectStore(); const state = new MemoryWorkspaceStateStore(); const raw = new TestVault();
    await raw.writeTextFile("first.md", "one");
    await initializePersonalWorkspaceMigration({ store, state, vault: raw, runtime, recoveryConfirmedAt: "2026-07-22T08:01:00.000Z" });
    await new EncryptedWorkspaceWorker(store, state, raw, runtime).runCycle();
    const badKey = `.pvws/operations/${"ff".repeat(16)}/1-${"ee".repeat(32)}.pvop`;
    store.tamper(badKey, new Uint8Array([1, 2, 3, 4]));
    await raw.writeTextFile("second.md", "two"); await state.enqueue("write", "second.md");
    await new EncryptedWorkspaceWorker(store, state, raw, runtime).runCycle();
    expect(await state.getObjectByPath("second.md")).not.toBeNull();
    const quarantined = await state.listQuarantine("pending");
    expect(quarantined.some((entry) => entry.remoteKey === badKey && entry.artifactBase64.length > 0)).toBe(true);
  });

  it("preserves revision history and restores old encrypted bytes", async () => {
    const { runtime } = await workspace(); const store = new FakeWorkspaceObjectStore(); const state = new MemoryWorkspaceStateStore(); const raw = new TestVault();
    await raw.writeTextFile("note.md", "v1"); await initializePersonalWorkspaceMigration({ store, state, vault: raw, runtime, recoveryConfirmedAt: "2026-07-22T08:01:00.000Z" });
    const worker = new EncryptedWorkspaceWorker(store, state, raw, runtime); await worker.runCycle();
    await raw.writeTextFile("note.md", "v2"); await state.enqueue("write", "note.md"); await worker.runCycle();
    const object = await state.getObjectByPath("note.md"); const history = new WorkspaceRevisionHistoryService(store, state, runtime.groupKeys);
    const revisions = await history.list(object!.objectId); expect(revisions).toHaveLength(2);
    expect(new TextDecoder().decode(await history.read(revisions[1].revisionId))).toBe("v1");
  });
});
