import { IVaultAdapter, VaultFileInfo } from "./IVaultAdapter.js";
import { SyncStateRepository } from "./SyncStateRepository.js";
import { mergeText } from "../conflict-resolver.js";
import { parseBackupFileName } from "./backupNaming.js";

export class ConflictError extends Error {
  public conflictPath?: string;
  constructor(message: string, conflictPath?: string) {
    super(message);
    this.name = "ConflictError";
    this.conflictPath = conflictPath;
  }
}

async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ConflictAwareVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncRepo: SyncStateRepository,
    private readonly onAutoMerge?: (path: string, mergedText: string) => void
  ) {}

  /**
   * Per-path serialization of operations that read the file and then update the stored
   * `local_sha256`/base. The check-then-write in `writeTextFile` is not atomic, so two
   * overlapping writes to the same path could observe `local_sha256` out of step with the
   * disk and mistake the app's own in-flight write for an external modification —
   * producing spurious `.CONFLICT` files (the `.base` viewer issues many rapid writes).
   * Chaining per path makes each op atomic w.r.t. other ops on the same path. A failed op
   * (a genuine conflict) rejects to its own caller but never blocks the next queued op.
   */
  private writeChains = new Map<string, Promise<unknown>>();

  private runExclusive<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeChains.get(path) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.writeChains.set(path, run);
    // Once this op is the tail of the chain, drop the map entry to avoid unbounded growth.
    run.catch(() => {}).finally(() => {
      if (this.writeChains.get(path) === run) this.writeChains.delete(path);
    });
    return run;
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async dispose(): Promise<void> {
    return this.inner.dispose();
  }

  async readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  async acknowledgeExternalUpdate(path: string): Promise<void> {
    // Mark the content the editor currently knows about WITHOUT advancing the merge
    // base. This runs on every file open; if the file has unsynced local edits,
    // promoting them to the base would destroy the common ancestor and the next
    // pull would silently overwrite those edits. The base only advances on sync.
    // Serialized with writes to the same path so it never interleaves with an
    // in-flight write's check-then-update.
    return this.runExclusive(path, async () => {
      const content = await this.inner.readTextFile(path);
      await this.syncRepo.updateLocalHash(path, await sha256Hash(content));
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  async writeTextFile(path: string, localContent: string): Promise<void> {
    return this.runExclusive(path, () => this.writeTextFileLocked(path, localContent));
  }

  private async writeTextFileLocked(path: string, localContent: string): Promise<void> {
    const isNew = !(await this.inner.exists(path));
    if (isNew) {
      await this.inner.writeTextFile(path, localContent);
      return;
    }

    const currentDiskContent = await this.inner.readTextFile(path);
    const diskSha256 = await sha256Hash(currentDiskContent);
    const syncState = await this.syncRepo.getSyncState(path);

    if (syncState && syncState.local_sha256 && syncState.local_sha256 !== diskSha256) {
      // Self-heal a legacy byte-hash. The indexer used to hash non-.md text files (e.g.
      // `.base`) as raw bytes (sha256 of readBinaryFile), which can differ from the text
      // hash used here even when the file is byte-for-byte unchanged. If the stored hash
      // equals the byte hash of the *current* disk content, the file did NOT change
      // externally — adopt it and record a proper text hash + base instead of falsely
      // flagging a conflict on every save.
      try {
        const diskBytes = await this.inner.readBinaryFile(path);
        if ((await sha256BytesHex(diskBytes)) === syncState.local_sha256) {
          await this.inner.writeTextFile(path, localContent);
          await this.syncRepo.updateLocalHashAndBaseText(path, await sha256Hash(localContent), localContent);
          return;
        }
      } catch {
        // readBinaryFile failed — fall through to the normal conflict handling below.
      }

      // External modification detected! Attempt 3-way merge.
      console.warn(`[ConflictAware] disk changed under us for ${path} (diskSha=${diskSha256.slice(0, 8)}, expected local=${syncState.local_sha256.slice(0, 8)}) -> attempting merge`);
      const baseContent = await this.findBaseContent(path, syncState.local_sha256);
      if (baseContent === null) {
        // We cannot merge without the base version. Save the user's edits as a CONFLICT file.
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const extMatch = path.match(/(\.[^.]+)$/);
        const ext = extMatch ? extMatch[1] : "";
        const base = extMatch ? path.substring(0, path.length - ext.length) : path;
        const conflictPath = `${base}.CONFLICT-${timestamp}${ext}`;
        await this.inner.writeTextFile(conflictPath, localContent);
        throw new ConflictError(`Cannot automatically merge ${path}: base version not found. Saved locally as ${conflictPath}.`, conflictPath);
      }

      const mergeResult = mergeText(baseContent, localContent, currentDiskContent);
      if (mergeResult.hasConflicts) {
        // Save the user's local content to a CONFLICT file so no data is lost
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const extMatch = path.match(/(\.[^.]+)$/);
        const ext = extMatch ? extMatch[1] : "";
        const base = extMatch ? path.substring(0, path.length - ext.length) : path;
        const conflictPath = `${base}.CONFLICT-${timestamp}${ext}`;
        await this.inner.writeTextFile(conflictPath, localContent);
        throw new ConflictError(`Cannot automatically merge ${path}: conflicting changes. Saved locally as ${conflictPath}.`, conflictPath);
      }
      
      // Auto-merge successful, save the merged content and update our expected local hash.
      await this.inner.writeTextFile(path, mergeResult.mergedText);
      await this.syncRepo.updateLocalHashAndBaseText(path, await sha256Hash(mergeResult.mergedText), mergeResult.mergedText);
      // Notify listeners (e.g. the editor) so the in-memory view adopts the merged
      // content. Otherwise a subsequent save would overwrite the merge with stale,
      // pre-merge content and silently drop the external changes.
      this.onAutoMerge?.(path, mergeResult.mergedText);
    } else {
      // Normal write (no conflict). Update only the local marker; never advance the
      // merge base here, otherwise an unsynced local edit becomes the base and the
      // next pull would see "local == base" and drop the edit in favour of remote.
      await this.inner.writeTextFile(path, localContent);
      await this.syncRepo.updateLocalHash(path, await sha256Hash(localContent));
    }
  }

  private async findBaseContent(path: string, targetHash: string): Promise<string | null> {
    // 1. Check the reliable base_text from sync_state
    const baseText = await this.syncRepo.getBaseText(path);
    if (baseText !== null) {
      const hash = await sha256Hash(baseText);
      if (hash === targetHash) {
        return baseText;
      }
    }
    
    // 2. Fallback: Search backups in case it's an older state that was backed up
    const lastSlash = path.lastIndexOf("/");
    const dirPrefix = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : "";
    const backupDir = `.plainva/backups/${dirPrefix}`.replace(/\/$/, "");

    try {
      const files = await this.inner.listDir(backupDir, false);
      const originalBasename = path.split(/[/\\]/).pop() || "";

      const backups = files
        .map((f: VaultFileInfo) => ({ file: f, parsed: f.isDirectory ? null : parseBackupFileName(f.name) }))
        .filter((e): e is { file: VaultFileInfo; parsed: { originalName: string; timestamp: number } } =>
          e.parsed !== null && e.parsed.originalName === originalBasename)
        // Sort descending (newest first)
        .sort((a, b) => b.parsed.timestamp - a.parsed.timestamp)
        .map((e) => e.file);

      for (const backup of backups) {
        try {
          const content = await this.inner.readTextFile(backup.path);
          const hash = await sha256Hash(content);
          if (hash === targetHash) {
            return content;
          }
        } catch {
          // ignore read errors on backups
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    // We do not auto-merge binary files
    return this.inner.writeBinaryFile(path, content);
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    return this.inner.deleteItem(path, recursive);
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    return this.inner.renameItem(oldPath, newPath);
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
