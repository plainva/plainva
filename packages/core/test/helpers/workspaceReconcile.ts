import { expect } from "vitest";
import {
  acceptWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  approveWorkspacePairing,
  createPersonalWorkspaceBootstrap,
  createWorkspacePairingRequest,
  createWorkspaceSlice,
  evaluateWorkspaceAccess,
  inviteWorkspaceMember,
  PermissionedVaultAdapter,
  publishWorkspaceGovernanceUpdate,
  workspaceDeniedFork,
  workspaceDocumentHash,
  workspaceSliceIdsForObject,
  type PersonalWorkspaceRuntime,
  type WorkspaceMutationAuthorizationRequest,
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  initializePersonalWorkspaceMigration,
  MemoryWorkspaceStateStore,
  personalWorkspaceRuntime,
  type IVaultAdapter,
  type VaultFileInfo,
  type WorkspaceExternalChangeCheck,
  type WorkspaceStateStore,
} from "../../src/index.js";

/** A vault, an owner's encrypted workspace and its worker, with every file synced — for the start-up reconcile's tests. */
export class MemoryVault implements IVaultAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  async initialize() {}
  async dispose() {}
  async acknowledgeExternalUpdate() {}
  async readTextFile(path: string) { return new TextDecoder().decode(await this.readBinaryFile(path)); }
  async readBinaryFile(path: string) {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing file: ${path}`);
    return new Uint8Array(value);
  }
  async writeTextFile(path: string, content: string) { await this.writeBinaryFile(path, new TextEncoder().encode(content)); }
  async writeBinaryFile(path: string, content: Uint8Array) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) this.directories.add(parts.slice(0, index).join("/"));
    this.files.set(path, new Uint8Array(content));
  }
  async deleteItem(path: string, recursive = false) {
    if (this.files.delete(path)) return;
    if (!this.directories.has(path)) throw new Error(`missing item: ${path}`);
    const prefix = `${path}/`;
    if (!recursive && [...this.files.keys()].some((file) => file.startsWith(prefix))) throw new Error("directory is not empty");
    for (const file of [...this.files.keys()]) if (file.startsWith(prefix)) this.files.delete(file);
    for (const directory of [...this.directories]) if (directory === path || directory.startsWith(prefix)) this.directories.delete(directory);
  }
  async renameItem(oldPath: string, newPath: string) {
    const bytes = this.files.get(oldPath);
    if (!bytes) throw new Error(`missing item: ${oldPath}`);
    this.files.delete(oldPath);
    await this.writeBinaryFile(newPath, bytes);
  }
  async exists(path: string) { return this.files.has(path) || this.directories.has(path); }
  async getFileInfo(path: string): Promise<VaultFileInfo> {
    if (this.files.has(path)) return { path, name: path.split("/").pop()!, isDirectory: false, size: this.files.get(path)!.length, mtime: 1, ctime: 1 };
    if (this.directories.has(path)) return { path, name: path.split("/").pop()!, isDirectory: true, size: 0, mtime: 1, ctime: 1 };
    throw new Error(`missing item: ${path}`);
  }
  async listDir(path = "", recursive = false): Promise<VaultFileInfo[]> {
    const prefix = path ? `${path}/` : "";
    const direct = (candidate: string) => recursive || !candidate.slice(prefix.length).includes("/");
    const result: VaultFileInfo[] = [];
    for (const directory of this.directories) if (directory.startsWith(prefix) && directory !== path && direct(directory)) result.push(await this.getFileInfo(directory));
    for (const file of this.files.keys()) if (file.startsWith(prefix) && direct(file)) result.push(await this.getFileInfo(file));
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }
  async createDir(path: string) { if (path) this.directories.add(path); }
}

export async function ownerWorkspace() {
  const bootstrap = await createPersonalWorkspaceBootstrap({
    workspaceId: "01".repeat(16),
    ownerMemberId: "11".repeat(16),
    ownerGroupId: "33".repeat(16),
    assignmentId: "44".repeat(16),
    ownerDisplayName: "Owner",
    deviceDisplayName: "Desktop",
    platform: "desktop",
    minimumClientVersion: "0.5.0",
    now: "2026-11-16T08:00:00.000Z",
  });
  return personalWorkspaceRuntime(bootstrap);
}

export async function synced(names: string[], makeState: () => WorkspaceStateStore | Promise<WorkspaceStateStore> = () => new MemoryWorkspaceStateStore()) {
  const runtime = await ownerWorkspace();
  const store = new FakeWorkspaceObjectStore();
  const state = await makeState();
  const vault = new MemoryVault();
  for (const name of names) await vault.writeTextFile(name, `# ${name}\n`);
  const reconcile = (permissions: WorkspaceExternalChangeCheck | null = null) =>
    initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-11-16T08:01:00.000Z", permissions });
  await reconcile();
  const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);
  await worker.runCycle();
  expect(await state.listQueue()).toEqual([]);
  return { runtime, store, state, vault, worker, reconcile };
}

export const queued = async (state: WorkspaceStateStore) => (await state.listQueue()).map((entry) => `${entry.operation} ${entry.path}`);
export const live = async (state: WorkspaceStateStore, path: string) => {
  const object = await state.getObjectByPath(path);
  return !!object && !object.deleted;
};


/** The chain's permission link for `runtime`, judging by its current policy, as the shells build it. */
export function chainPermissions(vault: IVaultAdapter, state: WorkspaceStateStore, runtime: PersonalWorkspaceRuntime) {
  const authorize = async (request: WorkspaceMutationAuthorizationRequest) => {
    const payload = runtime.policy.payload;
    const existing = await state.getObjectByPath(request.path);
    const objectId = existing && !existing.deleted ? existing.objectId : "91".repeat(16);
    return evaluateWorkspaceAccess(payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: request.capability, objectId, sliceIds: workspaceSliceIdsForObject(payload, { objectId, path: request.path }) });
  };
  return new PermissionedVaultAdapter(vault, state, authorize, workspaceDeniedFork(vault, state));
}

/** A second device of the owner, paired and synced. */
export async function ownerSecondDevice(owner: Awaited<ReturnType<typeof synced>>, makeState: () => WorkspaceStateStore | Promise<WorkspaceStateStore> = () => new MemoryWorkspaceStateStore()) {
  const created = await createWorkspacePairingRequest({ workspaceId: owner.runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(owner.runtime.genesis), memberId: owner.runtime.memberId, deviceDisplayName: "Phone", platform: "android", now: "2026-11-16T09:00:00.000Z" });
  const previousPolicy = owner.runtime.policy;
  const approval = await approveWorkspacePairing({ token: created.token, runtime: owner.runtime, now: "2026-11-16T09:00:00.000Z" });
  await publishWorkspaceGovernanceUpdate(owner.store, approval);
  owner.runtime.policy = approval.policy;
  owner.runtime.grants = [...owner.runtime.grants, ...approval.grants];
  const runtime = await acceptWorkspacePairing({ created, genesis: owner.runtime.genesis, previousPolicy, approval, now: "2026-11-16T09:00:00.000Z" });
  const state = await makeState();
  const vault = new MemoryVault();
  await initializePersonalWorkspaceMigration({ store: owner.store, state, vault, runtime, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z" });
  const worker = new EncryptedWorkspaceWorker(owner.store, state, vault, runtime);
  await worker.runCycle();
  return { runtime, state, vault, worker, store: owner.store };
}

/**
 * A member who may edit the folder Team and nothing else, on a laptop of
 * their own, with `teamFiles` synced; `reconcile` is the start with the
 * chain's permission link, `restart` a new worker after it.
 */
export async function teamEditor(teamFiles: string[]) {
  const owner = await synced([]);
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
  const runtime = await acceptWorkspacePairing({ created, genesis: owner.runtime.genesis, previousPolicy, approval, now: "2026-11-16T09:00:00.000Z" });
  // The folders as objects of their own, as the app makes them.
  const folders = [...new Set(teamFiles.flatMap((name) => name.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))))].sort();
  for (const folder of folders) {
    await owner.vault.createDir(folder);
    await owner.state.enqueue("mkdir", folder);
  }
  for (const name of teamFiles) {
    await owner.vault.writeTextFile(name, `# ${name}\n`);
    await owner.state.enqueue("write", name);
  }
  await owner.worker.runCycle();
  const state = new MemoryWorkspaceStateStore();
  const vault = new MemoryVault();
  const store = owner.store;
  const permissions = chainPermissions(vault, state, runtime);
  const reconcile = (withPermissions = true) => initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z", permissions: withPermissions ? permissions : null });
  await reconcile(false);
  const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);
  await worker.runCycle();
  const restart = async () => {
    await reconcile();
    const next = new EncryptedWorkspaceWorker(store, state, vault, runtime);
    await next.runCycle();
    return next;
  };
  return { owner, runtime, state, vault, store, worker, permissions, reconcile, restart };
}

/**
 * A member with `role` over the whole workspace, on a device of their own;
 * the owner writes `names` after the member joined, so they are sealed for
 * the member too.
 */
export async function workspaceMember(names: string[], role: "Reader" | "Contributor" | "Editor") {
  const owner = await synced([]);
  const invitation = await inviteWorkspaceMember({ runtime: owner.runtime, displayName: "Member", role, scopeKind: "workspace" });
  await publishWorkspaceGovernanceUpdate(owner.store, invitation);
  applyWorkspaceGovernanceUpdate(owner.runtime, invitation);
  const created = await createWorkspacePairingRequest({ workspaceId: owner.runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(owner.runtime.genesis), memberId: invitation.memberId, deviceDisplayName: "Member's laptop", platform: "desktop", now: "2026-11-16T09:00:00.000Z" });
  const previousPolicy = owner.runtime.policy;
  const approval = await approveWorkspacePairing({ token: created.token, runtime: owner.runtime, now: "2026-11-16T09:00:00.000Z" });
  await publishWorkspaceGovernanceUpdate(owner.store, approval);
  owner.runtime.policy = approval.policy;
  owner.runtime.grants = [...owner.runtime.grants, ...approval.grants];
  const runtime = await acceptWorkspacePairing({ created, genesis: owner.runtime.genesis, previousPolicy, approval, now: "2026-11-16T09:00:00.000Z" });
  for (const name of names) {
    await owner.vault.writeTextFile(name, `# ${name}\n`);
    await owner.state.enqueue("write", name);
  }
  await owner.worker.runCycle();
  const state = new MemoryWorkspaceStateStore();
  const vault = new MemoryVault();
  const store = owner.store;
  await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z" });
  const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);
  await worker.runCycle();
  for (const name of names) expect(vault.files.has(name)).toBe(true);
  return { owner, runtime, state, vault, store, worker };
}

/** What a device shows: every file outside the app's own folder, with its text. */
export function filesOf(vault: MemoryVault): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const [path, bytes] of [...vault.files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!path.startsWith(".plainva/")) shown[path] = new TextDecoder().decode(bytes);
  }
  return shown;
}
