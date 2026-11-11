import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo, type VaultWalkOptions } from "./IVaultAdapter.js";
import { SyncQueue } from "../sync/SyncQueue.js";
import { isSystemJunkPath } from "./systemJunk.js";
import { isWorkspaceNamespacePath } from "../workspace/path.js";
import { OwedQueueEntries, type OwedQueueEntriesOptions, type OwedStructure, type QueueEntryKind } from "./owedQueueEntries.js";

export { formatQueueEntryReport, type QueueEntryKind, type QueueEntryReport } from "./owedQueueEntries.js";

/**
 * Device-local paths that must never be enqueued for push: `.plainva/` (the SQLite index,
 * graph pins, bookmarks) and `.CONFLICT-<ts>` copies (local conflict snapshots the user
 * resolves locally). The push targets already refuse `.CONFLICT`, but keeping them out of
 * the queue entirely avoids no-op queue rows and matches the pull side (`isLocalOnlyPath`).
 * Operating-system bookkeeping (`.DS_Store`, …; issue #110, E10) never travels either —
 * an import may copy it into the vault, and deleting it here deletes nothing remotely.
 */
function isLocalOnly(path: string): boolean {
  // An encrypted workspace's namespace is never part of the plain vault (R8):
  // a `.pvws/` copied in, restored from a backup or pulled before the rule
  // must not go up - its genesis would make the folder a workspace for every
  // device on it.
  return path.startsWith(".plainva") || isWorkspaceNamespacePath(path) || path.includes(".CONFLICT") || isSystemJunkPath(path);
}

function notifyQueued(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
  } catch (error) {
    console.warn("[QueueingVaultAdapter] telling the shell of a new entry failed", error);
  }
}

/** The options of the entries owed for changes on disk (`OwedQueueEntries`). */
export type QueueingVaultAdapterOptions = OwedQueueEntriesOptions;

/**
 * Feeds the sync queue with the changes made through it, after they are on
 * disk. An entry that fails is made up for while the write waits, and only one
 * given up fails the write (`OwedQueueEntries`, finding 2026-10-12). While an
 * entry is owed, the sync queue answers for it (`SyncQueue.consultOwedEntries`,
 * Datensicherheit D4): a deletion or rename that waits here keeps the pull from
 * bringing the file back.
 */
export class QueueingVaultAdapter implements IVaultAdapter {
  private readonly owed: OwedQueueEntries;
  private readonly detach: () => void;

  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncQueue: SyncQueue,
    options: QueueingVaultAdapterOptions = {}
  ) {
    this.owed = new OwedQueueEntries(options);
    // Every shell builds the chain on the queue its sync worker reads: told
    // here, the worker knows what is owed without a shell having to say so.
    this.detach = syncQueue.consultOwedEntries?.(this.owed) ?? (() => {});
  }

  /** What is owed to the sync queue for changes on disk (D4). */
  get owedEntries(): OwedStructure {
    return this.owed;
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.detach();
    return this.inner.dispose();
  }

  /**
   * One last attempt for every entry still owed, while the vault's database
   * is open (finding 2026-10-19): an entry waiting for its next attempt is not
   * a transaction the database could wait for. The phone's vault calls this
   * before it closes its database; the desktop does not close its database
   * when a vault closes. What fails now is given up and its write fails; from
   * now on an entry gets one attempt and no wait. It waits at most ten
   * seconds, and an entry still under way then settles once its attempt does;
   * the phone's `close` then waits up to ten more for the transactions asked
   * for before it.
   */
  async flush(): Promise<void> {
    await this.owed.flush();
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
      await this.enqueue({ kind: "write", paths: [path] }, () => this.syncQueue.queueWrite(path));
    }
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.inner.writeBinaryFile(path, content);
    if (!isLocalOnly(path)) {
      console.log(`[QueueingVaultAdapter] queue write (binary) ${path}`);
      await this.enqueue({ kind: "write", paths: [path] }, () => this.syncQueue.queueWrite(path));
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
      await this.enqueue({ kind: "delete", paths: [path, ...childFiles] }, () => this.syncQueue.queueDeletePaths([path, ...childFiles], confirmation));
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.inner.renameItem(oldPath, newPath);
    if (!isLocalOnly(oldPath) && !isLocalOnly(newPath)) {
      await this.enqueue({ kind: "rename", paths: [oldPath], newPath }, () => this.syncQueue.queueRename(oldPath, newPath));
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

  async listDirReport(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing> {
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
      await this.enqueue({ kind: "mkdir", paths: [path] }, () => this.syncQueue.queueMkdir(path));
    }
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }

  /** The entry in the sync queue for a change that is on disk already: written now, or made up for (`OwedQueueEntries`). */
  private enqueue(scope: { kind: QueueEntryKind; paths: string[]; newPath?: string }, write: () => Promise<void>): Promise<void> {
    return this.owed.enqueue(scope, async () => {
      await write();
      notifyQueued();
    });
  }
}
