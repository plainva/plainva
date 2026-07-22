import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  PublishedSliceObjectStore,
  createPersonalWorkspaceBootstrap,
  createWorkspaceSlice,
  encodeWorkspaceDocument,
  evaluateSecurityReleaseGate,
  personalWorkspaceRuntime,
  parseWorkspaceDocument,
  projectPublishedMarkdown,
  publishedSliceAccessCapabilities,
  resumeWorkspaceRekey,
  startWorkspaceRekey,
  transferWorkspaceOwnership,
  inviteWorkspaceMember,
  applyWorkspaceGovernanceUpdate,
  type WorkspaceRuntimeMeta,
} from "../src/index.js";

function meta(workspaceId = "01".repeat(16)): WorkspaceRuntimeMeta {
  return { workspaceId, memberId: "02".repeat(16), deviceId: "03".repeat(16), groupId: "04".repeat(16), keyEpoch: 1, policyHash: "05".repeat(32), phase: "active", recoveryConfirmedAt: "2026-07-22T00:00:00.000Z", sequence: 0, previousOperationHash: null, catalogVersion: 0, previousCatalogHash: null, catalogHeads: {}, checkpointVersion: 0, previousCheckpointHash: null, remoteHeadEtag: null, migrationTotal: 1, migrationCompleted: 1, migrationInventoryComplete: true, lastSyncAt: null, lastError: null, operationHeads: {}, needsPublication: false, pendingPublication: null };
}

describe("encrypted workspace P8-P11 contracts", () => {
  it("maps published read, comment and suggestion modes without source-write authority", () => {
    expect(publishedSliceAccessCapabilities("read")).toEqual(["comment.read", "content.read", "history.read"]);
    expect(publishedSliceAccessCapabilities("comment")).toContain("comment.create");
    expect(publishedSliceAccessCapabilities("suggest")).toContain("content.create");
    expect(publishedSliceAccessCapabilities("suggest")).not.toContain("content.write");
    expect(publishedSliceAccessCapabilities("suggest")).not.toContain("content.delete");
  });

  it("stores publication mode, access, provider and scrub policy in the signed slice policy", async () => {
    const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.4.2" }));
    const created = createWorkspaceSlice({ runtime, name: "Partner", definition: { kind: "folder", folder: "Partner" }, materializedObjectIds: [], publication: { mode: "sanitized", access: "suggest", provider: "nextcloud", privateProperties: ["token", "secret"] } });
    expect(created.policy.payload.slices[0].publication).toEqual({ mode: "sanitized", access: "suggest", provider: "nextcloud", propertyAllowlist: null, privateProperties: ["secret", "token"] });
    expect(parseWorkspaceDocument(encodeWorkspaceDocument(created.policy)).payload).toEqual(created.policy.payload);
  });

  it("persists and idempotently resumes a full-rekey cursor", async () => {
    const state = new MemoryWorkspaceStateStore();
    const initial = meta(); await state.saveMeta(initial);
    await state.recordIncoming({ object: { objectId: "10".repeat(16), path: "Project/Plan.md", currentRevisionId: "11".repeat(16), payloadHash: "12".repeat(32), plaintextSha256: "13".repeat(32), contentKind: "text", deleted: false, createdAt: initial.recoveryConfirmedAt, modifiedAt: initial.recoveryConfirmedAt }, revision: { revisionId: "11".repeat(16), objectId: "10".repeat(16), payloadHash: "12".repeat(32), parentRevisionIds: [], operationHash: "14".repeat(32), deviceId: initial.deviceId, sequence: 1, materializedPath: "Project/Plan.md", plaintextSha256: "13".repeat(32) }, operationHash: "14".repeat(32), operationDocument: "document", deviceId: initial.deviceId, sequence: 1 }, true, initial);
    const started = await startWorkspaceRekey({ state, mode: "full", subjectKind: "member", subjectId: "20".repeat(16) });
    expect(started).toMatchObject({ phase: "rewriting", total: 1, completed: 0 });
    expect(await state.listQueue()).toHaveLength(1);
    await resumeWorkspaceRekey(state);
    expect(await state.listQueue()).toHaveLength(1);
    const current = await state.getObjectById("10".repeat(16));
    await state.recordIncoming({ object: { ...current!, currentRevisionId: "21".repeat(16) }, revision: { revisionId: "21".repeat(16), objectId: current!.objectId, payloadHash: current!.payloadHash, parentRevisionIds: ["11".repeat(16)], operationHash: "22".repeat(32), deviceId: initial.deviceId, sequence: 2, materializedPath: current!.path, plaintextSha256: current!.plaintextSha256 }, operationHash: "22".repeat(32), operationDocument: "document-2", deviceId: initial.deviceId, sequence: 2 }, true, (await state.loadMeta())!);
    expect(await resumeWorkspaceRekey(state)).toMatchObject({ phase: "complete", completed: 1 });
  });

  it("includes encrypted directory metadata in a full rekey", async () => {
    const state = new MemoryWorkspaceStateStore();
    const initial = meta(); await state.saveMeta(initial);
    await state.recordIncoming({ object: { objectId: "30".repeat(16), path: "Project", currentRevisionId: "31".repeat(16), payloadHash: "32".repeat(32), plaintextSha256: "33".repeat(32), contentKind: "directory", deleted: false, createdAt: initial.recoveryConfirmedAt, modifiedAt: initial.recoveryConfirmedAt }, revision: null, operationHash: "34".repeat(32), operationDocument: "directory", deviceId: initial.deviceId, sequence: 1 }, true, initial);
    const job = await startWorkspaceRekey({ state, mode: "full", subjectKind: "member", subjectId: "35".repeat(16) });
    expect(job.total).toBe(1);
    expect(await state.listQueue()).toEqual([expect.objectContaining({ operation: "mkdir", path: "Project" })]);
  });

  it("scrubs properties, excluded links and embeds without touching included links", () => {
    const result = projectPublishedMarkdown({ markdown: "---\ntitle: Demo\nsecret: hidden\nstatus: ready\n---\n[[Shared/Note|kept]] [[Private/Note|private label]] ![[Private/image.png]] [local](Private/x.md) [web](https://plainva.com)", includedPaths: ["Shared/Note.md"], propertyAllowlist: ["title", "status", "secret"], privateProperties: ["secret"] });
    expect(result.markdown).toContain("title: Demo");
    expect(result.markdown).not.toContain("hidden");
    expect(result.markdown).toContain("[[Shared/Note|kept]] private label");
    expect(result.markdown).not.toContain("Private/image.png");
    expect(result.markdown).toContain("[web](https://plainva.com)");
    expect(result.report).toEqual({ removedProperties: ["secret"], neutralizedLinks: ["Private/Note", "Private/x.md"], removedEmbeds: ["Private/image.png"] });
  });

  it("property-checks sanitized projections for excluded metadata leakage", () => {
    for (let index = 0; index < 250; index += 1) {
      const secret = `never-publish-${index.toString(36)}-${(index * 2654435761 >>> 0).toString(16)}`;
      const privateTarget = `Private/${secret}`;
      const result = projectPublishedMarkdown({ markdown: `---\ntitle: Public ${index}\nprivate_token: ${secret}\n---\n[[Shared/Visible]] [[${privateTarget}|redacted]] ![[${privateTarget}.png]]`, includedPaths: ["Shared/Visible.md"], propertyAllowlist: ["title", "private_token"], privateProperties: ["private_token"] });
      expect(result.markdown).not.toContain(secret);
      expect(result.markdown).toContain("[[Shared/Visible]]");
      expect(result.report.removedProperties).toEqual(["private_token"]);
    }
  });

  it("isolates published slice objects in a separate provider namespace", async () => {
    const root = new FakeWorkspaceObjectStore();
    const slice = new PublishedSliceObjectStore(root, "project-red-2026");
    const bytes = new TextEncoder().encode("ciphertext");
    const { sha256Hex } = await import("../src/workspace/encoding.js");
    await slice.putImmutable(".pvws/genesis.pvgen", bytes, sha256Hex(bytes));
    expect(await slice.get(".pvws/genesis.pvgen")).toEqual(bytes);
    expect((await root.list(".pvws/publications/project-red-2026/")).items[0].key).toBe(".pvws/publications/project-red-2026/genesis.pvgen");
    expect((await slice.list(".pvws/")).items[0].key).toBe(".pvws/genesis.pvgen");
  });

  it("transfers the unique owner role and rotates the owner group", async () => {
    const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0" });
    const runtime = personalWorkspaceRuntime(bootstrap);
    const invited = await inviteWorkspaceMember({ runtime, displayName: "Next owner", role: "Admin" });
    applyWorkspaceGovernanceUpdate(runtime, invited);
    const transferred = await transferWorkspaceOwnership({ runtime, targetMemberId: invited.memberId });
    expect(transferred.ownerMemberId).toBe(invited.memberId);
    expect(transferred.ownerGroup.keyEpoch).toBe(bootstrap.ownerGroup.keyEpoch + 1);
    expect(transferred.policy.payload.assignments.filter((entry) => entry.role === "Owner")).toEqual([expect.objectContaining({ subjectId: invited.memberId })]);
  });

  it("keeps the release gate closed until independent and physical evidence exists", () => {
    const local = ["workspace-unit", "workspace-fuzz", "provider-faults", "desktop-e2e", "mobile-background"].map((id) => ({ id, kind: "automated" as const, passed: true }));
    expect(evaluateSecurityReleaseGate(local)).toMatchObject({ automatedReady: true, ready: false });
    expect(evaluateSecurityReleaseGate([...local, ...["independent-crypto-review", "android-two-device", "ios-two-device", "android-internal-build", "ios-testflight-build"].map((id) => ({ id, kind: "independent-review" as const, passed: true }))])).toMatchObject({ ready: true, missing: [] });
  });
});
