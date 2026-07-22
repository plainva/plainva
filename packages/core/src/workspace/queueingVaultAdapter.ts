import { IVaultAdapter, VaultFileInfo, WatchEvent } from "../vault/IVaultAdapter.js";
import { normalizeVaultPath } from "./path.js";
import { WorkspaceStateStore } from "./state.js";

export function isWorkspaceLocalOnlyPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === ".plainva" || normalized.startsWith(".plainva/") ||
    normalized === ".pvws" || normalized.startsWith(".pvws/") || normalized.includes(".CONFLICT-");
}

function notifyQueued(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
}

/**
 * Local plaintext adapter for an active encrypted workspace. It delegates all
 * filesystem work, but queues signed-workspace mutations instead of feeding the
 * legacy path-shaped sync queue. Pull materialisation uses the raw adapter and
 * therefore cannot echo remote changes back into the queue.
 */
export class WorkspaceQueueingVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly raw: IVaultAdapter,
    private readonly state: WorkspaceStateStore
  ) {}

  initialize(): Promise<void> { return this.raw.initialize(); }
  dispose(): Promise<void> { return this.raw.dispose(); }
  acknowledgeExternalUpdate?(path: string): Promise<void> { return this.raw.acknowledgeExternalUpdate?.(path) ?? Promise.resolve(); }
  readTextFile(path: string): Promise<string> { return this.raw.readTextFile(path); }
  readBinaryFile(path: string): Promise<Uint8Array> { return this.raw.readBinaryFile(path); }
  exists(path: string): Promise<boolean> { return this.raw.exists(path); }
  getFileInfo(path: string): Promise<VaultFileInfo> { return this.raw.getFileInfo(path); }
  listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> { return this.raw.listDir(path, recursive); }
  watch?(callback: (events: WatchEvent[]) => void): Promise<() => void> { return this.raw.watch?.(callback) ?? Promise.resolve(() => {}); }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.raw.writeTextFile(path, content);
    await this.queueWrite(path);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.raw.writeBinaryFile(path, content);
    await this.queueWrite(path);
  }

  async createDir(path: string): Promise<void> {
    await this.raw.createDir(path);
    if (!isWorkspaceLocalOnlyPath(path)) {
      await this.state.enqueue("mkdir", normalizeVaultPath(path));
      notifyQueued();
    }
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    const normalized = normalizeVaultPath(path);
    const info = await this.raw.getFileInfo(path);
    const affected = info.isDirectory && recursive
      ? [info, ...(await this.raw.listDir(path, true))]
      : [info];
    await this.raw.deleteItem(path, recursive);
    for (const item of affected.sort((left, right) => right.path.length - left.path.length)) {
      if (!isWorkspaceLocalOnlyPath(item.path)) await this.state.enqueue("delete", normalizeVaultPath(item.path));
    }
    if (!isWorkspaceLocalOnlyPath(normalized)) notifyQueued();
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const oldNormalized = normalizeVaultPath(oldPath);
    const newNormalized = normalizeVaultPath(newPath);
    const info = await this.raw.getFileInfo(oldPath);
    const affected = info.isDirectory ? [info, ...(await this.raw.listDir(oldPath, true))] : [info];
    await this.raw.renameItem(oldPath, newPath);
    for (const item of affected.sort((left, right) => left.path.length - right.path.length)) {
      if (isWorkspaceLocalOnlyPath(item.path)) continue;
      const source = normalizeVaultPath(item.path);
      const suffix = source === oldNormalized ? "" : source.slice(oldNormalized.length + 1);
      const target = suffix ? `${newNormalized}/${suffix}` : newNormalized;
      await this.state.enqueue("rename", source, target);
    }
    notifyQueued();
  }

  private async queueWrite(path: string): Promise<void> {
    if (isWorkspaceLocalOnlyPath(path)) return;
    await this.state.enqueue("write", normalizeVaultPath(path));
    notifyQueued();
  }
}
