import { describe, expect, it } from "vitest";
import {
  approveWorkspacePairing,
  acceptWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  createWorkspacePairingRequest,
  EncryptedWorkspaceWorker,
  evaluateWorkspaceAccess,
  initializePersonalWorkspaceMigration,
  MemoryWorkspaceStateStore,
  PermissionedVaultAdapter,
  publishWorkspaceGovernanceUpdate,
  revokeWorkspaceDeviceAndRotate,
  workspaceDocumentHash,
  workspaceDeniedFork,
  workspaceSliceIdsForObject,
  type PersonalWorkspaceRuntime,
  type WorkspaceMutationAuthorizationRequest,
  type WorkspacePolicyPayload,
  type WorkspaceStateStore,
} from "../src/index.js";
import { live, MemoryVault, queued, synced } from "./helpers/workspaceReconcile.ts";

/**
 * The start-up reconcile of an encrypted workspace asks the permission check
 * (release 0.9.0 A3). What changed while the app was closed went into the
 * queue without the check a change from outside gets while the app runs; a
 * change the member may not make failed only at its push, at every cycle,
 * instead of staying a local fork.
 */

/**
 * The vault's chain check for a change from outside, judged in `payload` (the
 * shells' `workspaceWriteAuthorizer`, path-based) — or, without one, in the
 * runtime's policy as it is at the moment of the question.
 */
function permissionsFor(vault: MemoryVault, state: WorkspaceStateStore, runtime: PersonalWorkspaceRuntime, fixed?: WorkspacePolicyPayload) {
  const authorize = async (request: WorkspaceMutationAuthorizationRequest) => {
    const payload = fixed ?? runtime.policy.payload;
    const existing = await state.getObjectByPath(request.path);
    const objectId = existing?.objectId ?? "91".repeat(16);
    return evaluateWorkspaceAccess(payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: request.capability, objectId, sliceIds: workspaceSliceIdsForObject(payload, { objectId, path: request.path }) });
  };
  return new PermissionedVaultAdapter(vault, state, authorize, workspaceDeniedFork(vault, state));
}

function readerPolicy(runtime: PersonalWorkspaceRuntime): WorkspacePolicyPayload {
  const payload: WorkspacePolicyPayload = structuredClone(runtime.policy.payload);
  payload.assignments[0].role = "Reader";
  payload.assignments[0].capabilities = ["comment.read", "content.read", "history.read"];
  return payload;
}

describe("A3: the start-up reconcile asks the permission check", () => {
  it("a Reader's offline edit stays a local fork, once — not a queue entry that fails at every push", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.writeTextFile("Note.md", "# changed while closed\n");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));

    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    const forks = await state.listLocalForks();
    expect(forks.map((fork) => [fork.originalPath, fork.reason])).toEqual([["Note.md", "permission-denied"]]);
    expect(await vault.readTextFile(forks[0].forkPath)).toBe("# changed while closed\n");

    // The next start meets the same refused change: no second copy of it.
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect(await state.listLocalForks()).toHaveLength(1);

    // Changed again: that is a new refusal, with its own copy.
    await vault.writeTextFile("Note.md", "# changed again\n");
    await reconcile(reader);
    expect(await state.listLocalForks()).toHaveLength(2);
  });

  it("a Reader's offline deletion is not queued either, and is recorded once", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.deleteItem("Other.md");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));
    await reconcile(reader);
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect((await state.listLocalForks()).map((fork) => fork.originalPath)).toEqual(["Other.md"]);
    expect(await live(state, "Other.md")).toBe(true);
  });

  it("what the member may do goes into the queue as before", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.writeTextFile("Note.md", "# owner edit\n");
    await vault.writeTextFile("New.md", "# new\n");
    await vault.deleteItem("Other.md");
    await reconcile(permissionsFor(vault, state, runtime, runtime.policy.payload));
    expect((await queued(state)).sort()).toEqual(["delete Other.md", "write New.md", "write Note.md"]);
    expect(await state.listLocalForks()).toEqual([]);
  });

  it("a folder made by a Reader while closed is refused without a copy, and once", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md"]);
    await vault.createDir("Folder");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));
    await reconcile(reader);
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect((await state.listLocalForks()).map((fork) => fork.originalPath)).toEqual(["Folder"]);
  });
});


describe("A3 after review: every start judges anew, in the current policy", () => {
  it("a change refused at one start and allowed since goes into the queue at the next — the edit and the deletion", async () => {
    const { state, vault, reconcile } = await synced(["a.md", "b.md"]);
    let mayChange = false;
    const permissions = new PermissionedVaultAdapter(vault, state, async () => mayChange, workspaceDeniedFork(vault, state));
    await vault.writeTextFile("a.md", "# edited offline\n");
    await vault.deleteItem("b.md");
    await reconcile(permissions);
    expect(await queued(state)).toEqual([]);
    expect(await state.listLocalForks()).toHaveLength(2);

    mayChange = true;
    await reconcile(permissions);
    expect((await queued(state)).sort()).toEqual(["delete b.md", "write a.md"]);
    expect(await state.listLocalForks()).toHaveLength(2);
  });

  it("a Contributor's new file and folder made while closed are creations, queued — as the worker accepts them; and so while the app runs", async () => {
    const { runtime, state, vault, reconcile } = await synced(["a.md"]);
    const contributor: WorkspacePolicyPayload = structuredClone(runtime.policy.payload);
    contributor.assignments[0].role = "Contributor";
    contributor.assignments[0].capabilities = ["content.create"];
    const permissions = permissionsFor(vault, state, runtime, contributor);
    await vault.writeTextFile("new.md", "# made while closed\n");
    await vault.createDir("Folder");
    await reconcile(permissions);
    expect((await queued(state)).sort()).toEqual(["mkdir Folder", "write new.md"]);
    expect(await state.listLocalForks()).toEqual([]);
    // The index reporting a new file while the app runs asks the same.
    await vault.writeTextFile("later.md", "# made by another program\n");
    expect(await permissions.authorizeExternalChange("later.md", true)).toBe(true);
    // An existing file is a write, which a Contributor may not make.
    expect(await permissions.judgeExternalChange("a.md", true)).toBe("held");
    await vault.writeTextFile("a.md", "# changed\n");
    expect(await permissions.judgeExternalChange("a.md", true)).toBe("denied");
  });

  it("a file that cannot be read is left for the next start; the start goes on, the owner's too", async () => {
    const { runtime, state, vault, reconcile } = await synced(["a.md"]);
    await vault.writeTextFile("locked.docx", "x");
    await vault.writeTextFile("b.md", "# new\n");
    await vault.writeTextFile("a.md", "# changed, and locked now\n");
    const read = vault.readBinaryFile.bind(vault);
    vault.readBinaryFile = async (path: string) => {
      if (path === "locked.docx" || path === "a.md") throw new Error("EBUSY: resource busy or locked");
      return read(path);
    };
    await reconcile(permissionsFor(vault, state, runtime));
    // A new file is queued without being read; a changed one waits until it can be read.
    expect((await queued(state)).sort()).toEqual(["write b.md", "write locked.docx"]);
    vault.readBinaryFile = read;
    await reconcile(permissionsFor(vault, state, runtime));
    expect(await queued(state)).toContain("write a.md");
  });

  it("a device whose rights were withdrawn after it was paired is judged by the current policy, not the one of its key bundle", { timeout: 30_000 }, async () => {
    const owner = await synced(["a.md"]);
    // The owner's second device: paired, then synced.
    const created = await createWorkspacePairingRequest({ workspaceId: owner.runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(owner.runtime.genesis), memberId: owner.runtime.memberId, deviceDisplayName: "Phone", platform: "android", now: "2026-11-16T09:00:00.000Z" });
    const previousPolicy = owner.runtime.policy;
    const approval = await approveWorkspacePairing({ token: created.token, runtime: owner.runtime, now: "2026-11-16T09:00:00.000Z" });
    await publishWorkspaceGovernanceUpdate(owner.store, approval);
    owner.runtime.policy = approval.policy;
    owner.runtime.grants = [...owner.runtime.grants, ...approval.grants];
    const phone = await acceptWorkspacePairing({ created, genesis: owner.runtime.genesis, previousPolicy, approval, now: "2026-11-16T09:00:00.000Z" });
    const phoneState = new MemoryWorkspaceStateStore();
    const phoneVault = new MemoryVault();
    await initializePersonalWorkspaceMigration({ store: owner.store, state: phoneState, vault: phoneVault, runtime: phone, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z" });
    await new EncryptedWorkspaceWorker(owner.store, phoneState, phoneVault, phone).runCycle();
    expect(await live(phoneState, "a.md")).toBe(true);

    // The phone is revoked from the desktop while it is switched off; its
    // key bundle still holds the policy of its pairing.
    const revoked = await revokeWorkspaceDeviceAndRotate({ runtime: owner.runtime, deviceId: phone.device.publicIdentity.deviceId, reason: "lost", now: "2026-11-16T09:10:00.000Z" });
    await publishWorkspaceGovernanceUpdate(owner.store, revoked);
    applyWorkspaceGovernanceUpdate(owner.runtime, revoked);

    await phoneVault.writeTextFile("a.md", "# edited on the phone while it was off\n");
    await initializePersonalWorkspaceMigration({ store: owner.store, state: phoneState, vault: phoneVault, runtime: phone, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z", permissions: permissionsFor(phoneVault, phoneState, phone) });
    expect(await queued(phoneState)).toEqual([]);
    expect((await phoneState.listLocalForks()).map((fork) => fork.originalPath)).toEqual(["a.md"]);
    expect(workspaceDocumentHash(phone.policy)).toBe(workspaceDocumentHash(revoked.policy));
  });
});
