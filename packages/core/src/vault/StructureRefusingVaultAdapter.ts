import { DeletionConfirmation, IVaultAdapter, VaultError, VaultFileInfo, VaultListing, type VaultWalkOptions } from "./IVaultAdapter.js";
import { isQueueLocalOnlyPath } from "./QueueingVaultAdapter.js";

/** A deletion, rename or move refused because the vault's index database is closed (`StructureRefusingVaultAdapter`). */
export class StructureNeedsIndexError extends VaultError {
  constructor(
    /** What was asked: `delete` or `rename` (a move is a rename). */
    public readonly operation: "delete" | "rename" | "mkdir",
    public readonly path: string,
  ) {
    super(`${operation} of ${path} refused: the vault's index database is closed, and the sync could not learn of it`, "STRUCTURE_NEEDS_INDEX");
    this.name = "StructureNeedsIndexError";
  }
}

export function isStructureNeedsIndexError(error: unknown): error is StructureNeedsIndexError {
  return error instanceof StructureNeedsIndexError || (error instanceof Error && error.name === "StructureNeedsIndexError");
}

/**
 * The link of a vault's chain for the time its index database is closed
 * (stability plan R5, finding S6).
 *
 * The phone opens a vault whose index database does not open — without
 * search, tags, databases and the sync — so the notes stay at hand. The sync
 * queue lives in that database. What only the queue can carry to the other
 * devices therefore cannot happen meanwhile: a deletion or a rename made now
 * would be on this disk and nowhere in the sync, and the remote would keep
 * the file and its old name for good. This link refuses them before anything
 * touches the disk, with an error both shells show as one sentence.
 *
 * What it lets through, and why the sync still gets it later:
 *  - writing a file, an existing one or a new one: the next start with a
 *    database finds an edited file by its hash (`local_ahead`) and a new one
 *    as a file the remote does not have (`SyncQueue.enqueueLocalOnlyFiles`),
 *    and its folders go up with it;
 *  - creating a folder: the step before a file is written into it (a daily
 *    note, a template, an import). An empty folder made now stays on this
 *    device until a file is put in it; the shells do not offer "New folder"
 *    in this state (`MobileVault.indexClosed`), so none is made by hand;
 *  - anything on a device-local path (`.plainva/`, conflict copies, system
 *    files): the queue never carries those either.
 */
export class StructureRefusingVaultAdapter implements IVaultAdapter {
  constructor(private readonly inner: IVaultAdapter) {}

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }

  readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  writeTextFile(path: string, content: string): Promise<void> {
    return this.inner.writeTextFile(path, content);
  }

  writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    return this.inner.writeBinaryFile(path, content);
  }

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    if (!isQueueLocalOnlyPath(path)) throw new StructureNeedsIndexError("delete", path);
    return this.inner.deleteItem(path, recursive, confirmation);
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    if (!isQueueLocalOnlyPath(oldPath) || !isQueueLocalOnlyPath(newPath)) throw new StructureNeedsIndexError("rename", oldPath);
    return this.inner.renameItem(oldPath, newPath);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  async realPath(path: string): Promise<string> {
    return this.inner.realPath ? this.inner.realPath(path) : path;
  }

  getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.inner.getFileInfo(path);
  }

  async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void> {
    await this.inner.setFileTimes?.(path, times);
  }

  async listDirReport(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing> {
    return this.inner.listDirReport
      ? this.inner.listDirReport(path, recursive, options)
      : { files: await this.inner.listDir(path, recursive, options), skipped: [] };
  }

  listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return this.inner.listDir(path, recursive, options);
  }

  createDir(path: string): Promise<void> {
    return this.inner.createDir(path);
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    return this.inner.watch ? this.inner.watch(callback) : () => {};
  }
}
