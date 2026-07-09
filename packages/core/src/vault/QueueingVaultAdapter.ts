import { IVaultAdapter, VaultFileInfo } from "./IVaultAdapter.js";
import { SyncQueue } from "../sync/SyncQueue.js";

/**
 * Device-local paths that must never be enqueued for push: `.plainva/` (the SQLite index,
 * graph pins, bookmarks) and `.CONFLICT-<ts>` copies (local conflict snapshots the user
 * resolves locally). The push targets already refuse `.CONFLICT`, but keeping them out of
 * the queue entirely avoids no-op queue rows and matches the pull side (`isLocalOnlyPath`).
 */
function isLocalOnly(path: string): boolean {
  return path.startsWith(".plainva") || path.includes(".CONFLICT");
}

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
    if (!isLocalOnly(path)) {
      console.log(`[QueueingVaultAdapter] queue write ${path}`);
      await this.syncQueue.queueWrite(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.inner.writeBinaryFile(path, content);
    if (!isLocalOnly(path)) {
      console.log(`[QueueingVaultAdapter] queue write (binary) ${path}`);
      await this.syncQueue.queueWrite(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    // Capture a folder's contained FILES before the deletion removes them: the
    // remote deletion becomes deterministic (folder op first — natively
    // recursive on every provider — then one op per file as a no-op fallback)
    // instead of depending on the follow-up full-scan reconcile to discover the
    // children fire-and-forget. queueDelete is idempotent, so the scan's
    // onLocalFileDeleted fan-out cannot double-enqueue these paths.
    let childFiles: string[] = [];
    if (!isLocalOnly(path)) {
      try {
        const info = await this.inner.getFileInfo(path);
        if (info.isDirectory) {
          const entries = await this.inner.listDir(path, true);
          childFiles = entries
            .filter((e) => !e.isDirectory && !isLocalOnly(e.path))
            .map((e) => e.path);
        }
      } catch {
        // Stat/listing failure (already gone, permissions): plain delete below.
      }
    }
    await this.inner.deleteItem(path, recursive);
    if (!isLocalOnly(path)) {
      await this.syncQueue.queueDelete(path);
      for (const child of childFiles) {
        await this.syncQueue.queueDelete(child);
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.inner.renameItem(oldPath, newPath);
    if (!isLocalOnly(oldPath) && !isLocalOnly(newPath)) {
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
