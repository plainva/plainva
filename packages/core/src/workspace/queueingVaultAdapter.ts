import { IVaultAdapter, indexReadsOf, DeletionConfirmation, VaultListing, VaultFileInfo, WatchEvent, type VaultWalkOptions } from "../vault/IVaultAdapter.js";
import { OwedQueueEntries, type OwedQueueEntriesOptions, type OwedStructure, type QueueEntryKind } from "../vault/owedQueueEntries.js";
import { normalizeVaultPath } from "./path.js";
import { WorkspaceStateStore } from "./state.js";

export function isWorkspaceLocalOnlyPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === ".plainva" || normalized.startsWith(".plainva/") ||
    normalized === ".pvws" || normalized.startsWith(".pvws/") || normalized.includes(".CONFLICT-");
}

function notifyQueued(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
  } catch (error) {
    console.warn("[WorkspaceQueueingVaultAdapter] telling the shell of a new entry failed", error);
  }
}

/**
 * Local plaintext adapter for an active encrypted workspace. It delegates all
 * filesystem work, but queues signed-workspace mutations instead of feeding the
 * legacy path-shaped sync queue. Pull materialisation uses the raw adapter and
 * therefore cannot echo remote changes back into the queue.
 *
 * An entry of the workspace's queue that fails after its change is on disk is
 * made up for, as the vault's chain does it (`OwedQueueEntries`,
 * Datensicherheit D2): the write waits for it, and only an entry given up
 * fails the write and is reported. Writing it again is safe — the store's
 * `enqueue` takes the same entry twice as one. While it is owed, the
 * workspace's worker knows of it (`WorkspaceStateStore.consultOwedEntries`):
 * a pull does not bring back a file whose deletion waits here.
 */
export class WorkspaceQueueingVaultAdapter implements IVaultAdapter {
  private readonly owed: OwedQueueEntries;
  private readonly detach: () => void;

  constructor(
    private readonly raw: IVaultAdapter,
    private readonly state: WorkspaceStateStore,
    options: OwedQueueEntriesOptions = {}
  ) {
    this.owed = new OwedQueueEntries(options);
    this.detach = state.consultOwedEntries?.(this.owed) ?? (() => {});
  }

  /** What is owed to the workspace's queue (D4): the worker asks it through the state store. */
  get owedEntries(): OwedStructure {
    return this.owed;
  }

  initialize(): Promise<void> { return this.raw.initialize(); }
  async dispose(): Promise<void> {
    await this.flush();
    this.detach();
    return this.raw.dispose();
  }
  /** One last attempt for every entry still owed, while the database is open (`OwedQueueEntries.flush`). */
  flush(): Promise<void> { return this.owed.flush(); }
  acknowledgeExternalUpdate?(path: string): Promise<void> { return this.raw.acknowledgeExternalUpdate?.(path) ?? Promise.resolve(); }
  /** Handed on to the inner adapter where it has it (performance plan L2); read when asked, after the constructor. */
  get readFilesForIndex() { return indexReadsOf(this.raw); }

  readTextFile(path: string): Promise<string> { return this.raw.readTextFile(path); }
  readBinaryFile(path: string): Promise<Uint8Array> { return this.raw.readBinaryFile(path); }
  exists(path: string): Promise<boolean> { return this.raw.exists(path); }
  getFileInfo(path: string): Promise<VaultFileInfo> { return this.raw.getFileInfo(path); }

  /**
   * Optional on the underlying adapter: forwarded when it is there, a no-op
   * when it is not. The import writer stamps a note's source dates through
   * here, and it is only reachable via the wrappers the app actually hands
   * out — a wrapper that swallowed the call would make the whole feature a
   * silent no-op in the real app while every test still passed.
   */
  async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void> {
    await (this.raw as any).setFileTimes?.(path, times);
  }

  async listDirReport(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing> {
    return this.raw.listDirReport
      ? this.raw.listDirReport(path, recursive, options)
      : { files: await this.raw.listDir(path, recursive, options), skipped: [] };
  }

  listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> { return this.raw.listDir(path, recursive, options); }
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
      const normalized = normalizeVaultPath(path);
      await this.enqueue("mkdir", [normalized], null, () => this.state.enqueue("mkdir", normalized));
    }
  }

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    const info = await this.raw.getFileInfo(path);
    const affected = info.isDirectory && recursive
      ? [info, ...(await this.raw.listDir(path, true))]
      : [info];
    await this.raw.deleteItem(path, recursive, confirmation);
    const deleted = affected
      .sort((left, right) => right.path.length - left.path.length)
      .filter((item) => !isWorkspaceLocalOnlyPath(item.path))
      .map((item) => normalizeVaultPath(item.path));
    if (deleted.length === 0) return;
    // One owed entry for the whole deletion. Tried again, it goes on from the
    // path that failed; that one may have landed before its answer was lost,
    // and the store takes it as the same entry (`enqueue`).
    let next = 0;
    await this.enqueue("delete", deleted, null, async () => {
      for (; next < deleted.length; next += 1) await this.state.enqueue("delete", deleted[next]);
    });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const oldNormalized = normalizeVaultPath(oldPath);
    const newNormalized = normalizeVaultPath(newPath);
    const info = await this.raw.getFileInfo(oldPath);
    const affected = info.isDirectory ? [info, ...(await this.raw.listDir(oldPath, true))] : [info];
    await this.raw.renameItem(oldPath, newPath);
    const moves: Array<[string, string]> = [];
    for (const item of affected.sort((left, right) => left.path.length - right.path.length)) {
      if (isWorkspaceLocalOnlyPath(item.path)) continue;
      const source = normalizeVaultPath(item.path);
      const suffix = source === oldNormalized ? "" : source.slice(oldNormalized.length + 1);
      moves.push([source, suffix ? `${newNormalized}/${suffix}` : newNormalized]);
    }
    if (moves.length === 0) return;
    let next = 0;
    await this.enqueue("rename", [oldNormalized], newNormalized, async () => {
      for (; next < moves.length; next += 1) await this.state.enqueue("rename", moves[next][0], moves[next][1]);
    });
  }

  private async queueWrite(path: string): Promise<void> {
    if (isWorkspaceLocalOnlyPath(path)) return;
    const normalized = normalizeVaultPath(path);
    await this.enqueue("write", [normalized], null, () => this.state.enqueue("write", normalized));
  }

  private enqueue(kind: QueueEntryKind, paths: string[], newPath: string | null, write: () => Promise<unknown>): Promise<void> {
    return this.owed.enqueue({ kind, paths, newPath }, async () => {
      await write();
      notifyQueued();
    });
  }
}
