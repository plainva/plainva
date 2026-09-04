import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  acceptWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  approveWorkspacePairing,
  createPersonalWorkspaceBootstrap,
  createWorkspacePairingRequest,
  createWorkspaceGroup,
  initializePersonalWorkspaceMigration,
  inviteWorkspaceMember,
  personalWorkspaceRuntime,
  publishWorkspaceGovernanceUpdate,
  revokeWorkspaceDeviceAndRotate,
  workspaceDocumentHash,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type VaultFileInfo,
} from "../src/index.js";

/**
 * An operation is judged in the policy it REFERENCES (finding 2026-09-04).
 *
 * The worker compared against the newest policy version instead, so every
 * operation written before the last policy change was refused - and a policy
 * changes whenever somebody adds a device, a member, a group or a slice. On
 * the maintainer's vault that was 176 of 181 operations, all of them the
 * device's own. The consequence nobody saw in the list: objects are only
 * materialized while applying an operation, so a device joining later would
 * have rebuilt the vault EMPTY.
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

async function workspace(): Promise<{ runtime: PersonalWorkspaceRuntime }> {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "ASUS-Windows", platform: "desktop", minimumClientVersion: "0.5.0", now: "2026-09-01T08:00:00.000Z" });
  return { runtime: personalWorkspaceRuntime(bootstrap) };
}

/** Advances the policy the way ordinary use does: a new member, a new group. */
async function advancePolicy(runtime: PersonalWorkspaceRuntime, store: FakeWorkspaceObjectStore, label: string): Promise<void> {
  const invitation = await inviteWorkspaceMember({ runtime, displayName: label, role: "Editor" });
  await publishWorkspaceGovernanceUpdate(store, invitation);
  applyWorkspaceGovernanceUpdate(runtime, invitation);
  const group = await createWorkspaceGroup({ runtime, name: `${label}-group`, memberIds: [invitation.memberId] });
  await publishWorkspaceGovernanceUpdate(store, group);
  applyWorkspaceGovernanceUpdate(runtime, group);
}

/**
 * A SECOND DEVICE OF THE SAME MEMBER joins - "my phone on my vault", which is
 * the case this is about. It reads and writes what its member may; an invited
 * stranger would first need a slice, which is a different story.
 */
async function pairPhone(runtime: PersonalWorkspaceRuntime, store: FakeWorkspaceObjectStore, at: string): Promise<PersonalWorkspaceRuntime> {
  const created = await createWorkspacePairingRequest({ workspaceId: runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(runtime.genesis), memberId: runtime.memberId, deviceDisplayName: "Phone", platform: "android", now: at });
  const previousPolicy = runtime.policy;
  const approval = await approveWorkspacePairing({ token: created.token, runtime, now: at });
  await publishWorkspaceGovernanceUpdate(store, approval);
  // The approval carries policy and grants, not group keys: the owner keeps
  // the keys it already holds.
  runtime.policy = approval.policy;
  runtime.grants = [...runtime.grants, ...approval.grants];
  return await acceptWorkspacePairing({ created, genesis: runtime.genesis, previousPolicy, approval, now: at }) as PersonalWorkspaceRuntime;
}

describe("operations survive the policy changes that happen around them", () => {
  it("keeps every operation valid across three policy successors, and quarantines nothing", async () => {
    const { runtime } = await workspace();
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const vault = new TestVault();
    await vault.writeTextFile("first.md", "one");
    await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-09-01T08:01:00.000Z" });
    const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);
    await worker.runCycle();

    for (const label of ["Ada", "Bo", "Cy"]) {
      await advancePolicy(runtime, store, label);
      await vault.writeTextFile(`${label}.md`, label);
      await state.enqueue("write", `${label}.md`);
      await worker.runCycle();
    }
    // One more pull with nothing to write: every operation in the remote is
    // now older than the current policy version.
    await worker.runCycle();

    expect(await state.listQuarantine("pending")).toEqual([]);
    for (const path of ["first.md", "Ada.md", "Bo.md", "Cy.md"]) {
      expect(await state.getObjectByPath(path), path).not.toBeNull();
    }
  });

  it("rebuilds the whole vault on a device that joined after the policy changed", async () => {
    const { runtime } = await workspace();
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const vault = new TestVault();
    await vault.writeTextFile("first.md", "one");
    await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-09-01T08:01:00.000Z" });
    const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);
    await worker.runCycle();
    await advancePolicy(runtime, store, "Ada");
    await vault.writeTextFile("second.md", "two");
    await state.enqueue("write", "second.md");
    await worker.runCycle();

    // The joining device knows only the newest policy. Every operation in the
    // remote is older than it - which used to mean it materialized NOTHING.
    const phone = await pairPhone(runtime, store, "2026-09-01T09:00:00.000Z");
    const phoneState = new MemoryWorkspaceStateStore();
    const phoneVault = new TestVault();
    await initializePersonalWorkspaceMigration({ store, state: phoneState, vault: phoneVault, runtime: phone, recoveryConfirmedAt: "2026-09-01T09:01:00.000Z" });
    await new EncryptedWorkspaceWorker(store, phoneState, phoneVault, phone).runCycle();

    expect(await phoneState.getObjectByPath("first.md")).not.toBeNull();
    expect(await phoneState.getObjectByPath("second.md")).not.toBeNull();
    expect(await phoneState.listQuarantine("pending")).toEqual([]);
  });

  it("hears a revoked device only as far as an active one witnessed it", async () => {
    const { runtime } = await workspace();
    const store = new FakeWorkspaceObjectStore();
    const ownerState = new MemoryWorkspaceStateStore();
    const ownerVault = new TestVault();
    await ownerVault.writeTextFile("first.md", "one");
    await initializePersonalWorkspaceMigration({ store, state: ownerState, vault: ownerVault, runtime, recoveryConfirmedAt: "2026-09-01T08:01:00.000Z" });
    const owner = new EncryptedWorkspaceWorker(store, ownerState, ownerVault, runtime);
    await owner.runCycle();

    // The second device joins, writes, and is seen: the owner's next checkpoint
    // witnesses how far that device had come.
    const phone = await pairPhone(runtime, store, "2026-09-01T09:00:00.000Z");
    const phoneState = new MemoryWorkspaceStateStore();
    const phoneVault = new TestVault();
    await initializePersonalWorkspaceMigration({ store, state: phoneState, vault: phoneVault, runtime: phone, recoveryConfirmedAt: "2026-09-01T09:01:00.000Z" });
    const phoneWorker = new EncryptedWorkspaceWorker(store, phoneState, phoneVault, phone);
    await phoneVault.writeTextFile("phone.md", "before");
    await phoneState.enqueue("write", "phone.md");
    await phoneWorker.runCycle();
    await owner.runCycle();
    expect(await ownerState.getObjectByPath("phone.md")).not.toBeNull();

    // It writes once more and uploads - but the owner has not seen this one
    // when it takes the device out.
    await phoneVault.writeTextFile("after.md", "written on the way out");
    await phoneState.enqueue("write", "after.md");
    await phoneWorker.runCycle();

    const revoked = await revokeWorkspaceDeviceAndRotate({ runtime, deviceId: phone.device.publicIdentity.deviceId, reason: "lost", now: "2026-09-01T10:00:00.000Z" });
    await publishWorkspaceGovernanceUpdate(store, revoked);
    applyWorkspaceGovernanceUpdate(runtime, revoked);
    await owner.runCycle();

    // Beyond the witnessed line, so it stays out - conservative on purpose:
    // accepting it would mean accepting anything a revoked device signs under
    // a policy version in which it was still active.
    expect(await ownerState.getObjectByPath("after.md")).toBeNull();
    const pending = await ownerState.listQuarantine("pending");
    expect(pending.some((entry) => entry.reasonCode === "operation.postRevocation")).toBe(true);
    // What it wrote while it belonged stays: a revocation is not a rewrite of
    // the past.
    expect(await ownerState.getObjectByPath("phone.md")).not.toBeNull();
    expect(await ownerState.getObjectByPath("first.md")).not.toBeNull();
  });
});
