import { expect } from "vitest";
import {
  createPersonalWorkspaceBootstrap,
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

export async function synced(names: string[]) {
  const runtime = await ownerWorkspace();
  const store = new FakeWorkspaceObjectStore();
  const state = new MemoryWorkspaceStateStore();
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

