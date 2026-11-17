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
import { live, MemoryVault, queued, synced, teamEditor } from "./helpers/workspaceReconcile.ts";
import { createWorkspacePolicySuccessor } from "../src/workspace/policy.js";
import { WORKSPACE_ROLE_CAPABILITIES } from "../src/workspace/authorization.js";

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

/** The owner makes the member a Reader of the folder, as from another device while the member is away. */
async function narrowMember(team: Awaited<ReturnType<typeof teamEditor>>) {
  const owner = team.owner.runtime;
  const policy = createWorkspacePolicySuccessor({
    current: owner.policy,
    signer: { signer: { algorithm: "Ed25519", signerId: owner.device.publicIdentity.deviceId, signerKind: "device" }, privateKey: owner.device.secrets.signing.privateKey },
    mutate: (draft) => {
      // An invitation assigns the role to the member's personal group.
      const personal = new Set(draft.groups.filter((group) => group.memberIds?.includes(team.runtime.memberId)).map((group) => group.groupId));
      for (const assignment of draft.assignments) {
        if (assignment.subjectId !== team.runtime.memberId && !personal.has(assignment.subjectId)) continue;
        assignment.role = "Reader";
        assignment.capabilities = [...WORKSPACE_ROLE_CAPABILITIES.Reader];
      }
    },
  });
  await publishWorkspaceGovernanceUpdate(team.store, { policy, grants: [] });
  owner.policy = policy;
}

const forksOf = async (team: Awaited<ReturnType<typeof teamEditor>>) => (await team.state.listLocalForks()).map((fork) => fork.originalPath).sort();

/**
 * A refused change never turns into one the person did not make (review of
 * release 0.9.0). Refused at the upload, the entry left the queue while the
 * original was missing here; the next start found it gone and queued its
 * deletion — one entry, no question, the note gone from every device. Now
 * the original comes back from the workspace, what the person made stays a
 * local fork, and a start derives nothing from it: for every kind of change,
 * over more than one start.
 */
describe("a change refused at the upload, then the app started again", () => {
  const restartTwice = async (team: Awaited<ReturnType<typeof teamEditor>>) => {
    for (let start = 0; start < 2; start += 1) {
      await team.restart();
      expect(await queued(team.state)).toEqual([]);
    }
  };

  it("a note moved out of the member's folder: the original comes back, stays for everyone, the moved copy is a fork", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md", "Team/z.md"]);
    await team.vault.renameItem("Team/y.md", "Private/y.md");
    await team.state.enqueue("rename", "Team/y.md", "Private/y.md");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/y.md")).toBe("# Team/y.md\n");
    expect(await forksOf(team)).toEqual(["Private/y.md"]);

    await restartTwice(team);
    // The folder the move made is a refused new folder of its own.
    expect(await forksOf(team)).toEqual(["Private", "Private/y.md"]);
    await team.owner.worker.runCycle();
    expect(await live(team.owner.state, "Team/y.md")).toBe(true);
    expect(team.owner.vault.files.has("Team/y.md")).toBe(true);
  });

  it("a folder moved out: its files come back, nothing is deleted", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/Sub/s.md", "Team/z.md"]);
    await team.vault.renameItem("Team/Sub/s.md", "Private/Sub/s.md");
    team.vault.directories.delete("Team/Sub");
    await team.state.enqueue("rename", "Team/Sub", "Private/Sub");
    await team.state.enqueue("rename", "Team/Sub/s.md", "Private/Sub/s.md");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/Sub/s.md")).toBe("# Team/Sub/s.md\n");
    await restartTwice(team);
    await team.owner.worker.runCycle();
    expect(team.owner.vault.files.has("Team/Sub/s.md")).toBe(true);
  });

  it("a deletion the member may no longer make: the note comes back", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md", "Team/z.md"]);
    await narrowMember(team);
    await team.vault.deleteItem("Team/y.md");
    await team.state.enqueue("delete", "Team/y.md");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/y.md")).toBe("# Team/y.md\n");
    expect(await forksOf(team)).toEqual(["Team/y.md"]);
    await restartTwice(team);
    expect(await live(team.state, "Team/y.md")).toBe(true);
  });

  it("a folder deletion the member may no longer make: folder and file come back", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/Sub/s.md", "Team/z.md"]);
    await narrowMember(team);
    await team.vault.deleteItem("Team/Sub", true);
    await team.state.enqueue("delete", "Team/Sub/s.md");
    await team.state.enqueue("delete", "Team/Sub");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/Sub/s.md")).toBe("# Team/Sub/s.md\n");
    await restartTwice(team);
  });

  it("an edit the member may no longer make: kept as a fork, the edit stays on the disk, nothing goes out", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md"]);
    await narrowMember(team);
    await team.vault.writeTextFile("Team/y.md", "# edited\n");
    await team.state.enqueue("write", "Team/y.md");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await forksOf(team)).toEqual(["Team/y.md"]);
    await restartTwice(team);
    expect(await forksOf(team)).toEqual(["Team/y.md"]);
    expect(await team.vault.readTextFile("Team/y.md")).toBe("# edited\n");
  });

  it("a new note and a new folder outside the member's folder: forks, recorded once", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md"]);
    await team.vault.createDir("Private");
    await team.state.enqueue("mkdir", "Private");
    await team.vault.writeTextFile("Private/x.md", "# x\n");
    await team.state.enqueue("write", "Private/x.md");
    await team.worker.runCycle();
    expect(await queued(team.state)).toEqual([]);
    expect(await forksOf(team)).toEqual(["Private", "Private/x.md"]);
    await restartTwice(team);
    expect(await forksOf(team)).toEqual(["Private", "Private/x.md"]);
  });

  it("is said once, by path, and not again at the next cycle", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md"]);
    const said: string[][] = [];
    team.worker.onChangesRefused = (paths) => said.push(paths);
    await team.vault.writeTextFile("Private/x.md", "# x\n");
    await team.state.enqueue("write", "Private/x.md");
    await team.worker.runCycle();
    await team.worker.runCycle();
    expect(said).toEqual([["Private/x.md"]]);
  });
});

/**
 * The same move made while the app was closed: the start sees a new file and
 * a missing object. The new place is refused; its original is no deletion the
 * person made, and comes back instead of going out as one.
 */
describe("a note moved out of the member's folder while the app was closed", () => {
  it("comes back at the start; nothing is deleted, the moved copy is a fork", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/y.md", "Team/z.md"]);
    await team.vault.renameItem("Team/y.md", "Private/y.md");
    await team.reconcile();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/y.md")).toBe("# Team/y.md\n");
    expect(await forksOf(team)).toEqual(["Private", "Private/y.md"]);
    await team.restart();
    expect(await queued(team.state)).toEqual([]);
    await team.owner.worker.runCycle();
    expect(team.owner.vault.files.has("Team/y.md")).toBe(true);
  });

  it("a folder moved out comes back with its files", { timeout: 30_000 }, async () => {
    const team = await teamEditor(["Team/Sub/s.md", "Team/z.md"]);
    await team.vault.renameItem("Team/Sub/s.md", "Private/Sub/s.md");
    team.vault.directories.delete("Team/Sub");
    await team.reconcile();
    expect(await queued(team.state)).toEqual([]);
    expect(await team.vault.readTextFile("Team/Sub/s.md")).toBe("# Team/Sub/s.md\n");
  });
});

/**
 * A queued file that cannot be read when the worker prepares it (locked by
 * another program): the push stopped there, every cycle, with everything
 * behind it (review of release 0.9.0). It waits now; the rest goes on.
 */
describe("a queued file that cannot be read at the upload", () => {
  it("waits for the next cycle; the rest of the queue goes on", { timeout: 30_000 }, async () => {
    const { state, vault, worker } = await synced(["a.md"]);
    await vault.writeTextFile("locked.docx", "x");
    await state.enqueue("write", "locked.docx");
    await vault.writeTextFile("b.md", "# behind it\n");
    await state.enqueue("write", "b.md");
    const read = vault.readBinaryFile.bind(vault);
    vault.readBinaryFile = async (path: string) => {
      if (path === "locked.docx") throw new Error("EBUSY: resource busy or locked");
      return read(path);
    };
    await worker.runCycle();
    expect(await live(state, "b.md")).toBe(true);
    expect(await queued(state)).toEqual(["write locked.docx"]);
    expect((await state.listQueue())[0].lastError).toMatch(/EBUSY/);
    vault.readBinaryFile = read;
    await worker.runCycle();
    expect(await live(state, "locked.docx")).toBe(true);
    expect(await queued(state)).toEqual([]);
  });
});
