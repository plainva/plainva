import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo } from "./IVaultAdapter.js";
import { SyncQueue } from "../sync/SyncQueue.js";
import { isSystemJunkPath } from "./systemJunk.js";

/**
 * Device-local paths that must never be enqueued for push: `.plainva/` (the SQLite index,
 * graph pins, bookmarks) and `.CONFLICT-<ts>` copies (local conflict snapshots the user
 * resolves locally). The push targets already refuse `.CONFLICT`, but keeping them out of
 * the queue entirely avoids no-op queue rows and matches the pull side (`isLocalOnlyPath`).
 * Operating-system bookkeeping (`.DS_Store`, …; issue #110, E10) never travels either —
 * an import may copy it into the vault, and deleting it here deletes nothing remotely.
 */
function isLocalOnly(path: string): boolean {
  return path.startsWith(".plainva") || path.includes(".CONFLICT") || isSystemJunkPath(path);
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

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    let childFiles: string[] = [];
    if (!isLocalOnly(path)) {
      // A failed/incomplete walk cannot justify a confirmed folder deletion.
      // The reporting contract survives every adapter in both shell chains.
      const info = await this.inner.getFileInfo(path);
      if (info.isDirectory && recursive) {
        const report = await this.listDirReport(path, true);
        if (report.skipped.length) throw new Error("Cannot delete folder: some entries could not be read");
        childFiles = report.files.filter((e) => !e.isDirectory && !isLocalOnly(e.path)).map((e) => e.path);
      }
    }
    await this.inner.deleteItem(path, recursive, confirmation);
    if (!isLocalOnly(path)) {
      await this.syncQueue.queueDeletePaths([path, ...childFiles], confirmation);
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

  /** The spelling the path is stored under on disk (path identity, ADR 0016). */
  async realPath(path: string): Promise<string> {
    return this.inner.realPath ? this.inner.realPath(path) : path;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.inner.getFileInfo(path);
  }

  /**
   * Optional on the underlying adapter: forwarded when it is there, a no-op
   * when it is not. The import writer stamps a note's source dates through
   * here, and it is only reachable via the wrappers the app actually hands
   * out — a wrapper that swallowed the call would make the whole feature a
   * silent no-op in the real app while every test still passed.
   */
  async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void> {
    await (this.inner as any).setFileTimes?.(path, times);
  }

  async listDirReport(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultListing> {
    return this.inner.listDirReport
      ? this.inner.listDirReport(path, recursive, options)
      : { files: await this.inner.listDir(path, recursive, options), skipped: [] };
  }

  async listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return this.inner.listDir(path, recursive, options);
  }

  async createDir(path: string): Promise<void> {
    await this.inner.createDir(path);
    // Empty folders sync too (2026-07-17): an in-app folder creation reaches
    // the cloud right away instead of materializing with its first file.
    if (!isLocalOnly(path)) {
      await this.syncQueue.queueMkdir(path);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
    }
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }
}
