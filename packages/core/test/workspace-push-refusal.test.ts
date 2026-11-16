import { describe, expect, it } from "vitest";
import {
  acceptWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  approveWorkspacePairing,
  createWorkspacePairingRequest,
  createWorkspaceSlice,
  EncryptedWorkspaceWorker,
  initializePersonalWorkspaceMigration,
  inviteWorkspaceMember,
  MemoryWorkspaceStateStore,
  publishWorkspaceGovernanceUpdate,
  workspaceDocumentHash,
} from "../src/index.js";
import { live, MemoryVault, queued, synced } from "./helpers/workspaceReconcile.ts";

/**
 * A queued change the workspace's policy refuses before it is signed
 * (release 0.9.0, review of A3). The push stopped at the entry and failed at
 * every cycle — and with it the rest of the queue, the checkpoint, the
 * publications and the settings. The app checks before the disk is touched,
 * but not always with what the worker sees (a policy changed elsewhere, a
 * slice that matches by tags or properties, an object no group could read).
 * Refused, the change now stays on this device as a local fork, as a refused
 * change from outside does, and the queue goes on.
 */
describe("a change the worker refuses", () => {
  it("is kept as a local fork, and the queue behind it goes on", { timeout: 30_000 }, async () => {
    const owner = await synced(["a.md"]);
    // A member who may edit the folder Team, nothing else.
    const slice = createWorkspaceSlice({ runtime: owner.runtime, name: "Team", definition: { kind: "folder", folder: "Team" }, materializedObjectIds: [] });
    await publishWorkspaceGovernanceUpdate(owner.store, { policy: slice.policy, grants: [] });
    owner.runtime.policy = slice.policy;
    const invitation = await inviteWorkspaceMember({ runtime: owner.runtime, displayName: "Member", role: "Editor", scopeKind: "slice", scopeId: slice.sliceId });
    await publishWorkspaceGovernanceUpdate(owner.store, invitation);
    applyWorkspaceGovernanceUpdate(owner.runtime, invitation);
    const created = await createWorkspacePairingRequest({ workspaceId: owner.runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(owner.runtime.genesis), memberId: invitation.memberId, deviceDisplayName: "Member's laptop", platform: "desktop", now: "2026-11-16T09:00:00.000Z" });
    const previousPolicy = owner.runtime.policy;
    const approval = await approveWorkspacePairing({ token: created.token, runtime: owner.runtime, now: "2026-11-16T09:00:00.000Z" });
    await publishWorkspaceGovernanceUpdate(owner.store, approval);
    owner.runtime.policy = approval.policy;
    owner.runtime.grants = [...owner.runtime.grants, ...approval.grants];
    const member = await acceptWorkspacePairing({ created, genesis: owner.runtime.genesis, previousPolicy, approval, now: "2026-11-16T09:00:00.000Z" });

    const state = new MemoryWorkspaceStateStore();
    const vault = new MemoryVault();
    await initializePersonalWorkspaceMigration({ store: owner.store, state, vault, runtime: member, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z" });
    const worker = new EncryptedWorkspaceWorker(owner.store, state, vault, member);
    await worker.runCycle();

    // Two changes the app let through: one outside the member's folder, one in it.
    await vault.writeTextFile("Private/x.md", "# not mine to share\n");
    await state.enqueue("write", "Private/x.md");
    await vault.writeTextFile("Team/ok.md", "# for the team\n");
    await state.enqueue("write", "Team/ok.md");

    await worker.runCycle();
    expect(await live(state, "Team/ok.md")).toBe(true);
    expect(await live(state, "Private/x.md")).toBe(false);
    expect(await queued(state)).toEqual([]);
    const forks = await state.listLocalForks();
    expect(forks.map((fork) => [fork.originalPath, fork.reason])).toEqual([["Private/x.md", "permission-denied"]]);
    expect(await vault.readTextFile(forks[0].forkPath)).toBe("# not mine to share\n");
    // The file itself stays where the member put it.
    expect(await vault.readTextFile("Private/x.md")).toBe("# not mine to share\n");
  });
});
