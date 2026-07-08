import { IVaultAdapter, VaultFileInfo } from "./IVaultAdapter.js";
import { SyncQueue } from "../sync/SyncQueue.js";

export class QueueingVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncQueue: SyncQueue
  ) {}

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async dispose(): Promise<void> {
    return this.inner.dispose();
  }

  async readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.inner.writeTextFile(path, content);
    if (!path.startsWith(".plainva")) {
      console.log(`[QueueingVaultAdapter] queue write ${path}`);
      await this.syncQueue.queueWrite(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.inner.writeBinaryFile(path, content);
    if (!path.startsWith(".plainva")) {
      console.log(`[QueueingVaultAdapter] queue write (binary) ${path}`);
      await this.syncQueue.queueWrite(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    await this.inner.deleteItem(path, recursive);
    if (!path.startsWith(".plainva")) {
      await this.syncQueue.queueDelete(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.inner.renameItem(oldPath, newPath);
    if (!oldPath.startsWith(".plainva") && !newPath.startsWith(".plainva")) {
      await this.syncQueue.queueRename(oldPath, newPath);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.inner.getFileInfo(path);
  }

  async listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> {
    return this.inner.listDir(path, recursive);
  }

  async createDir(path: string): Promise<void> {
    return this.inner.createDir(path);
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }
}
