import { IVaultAdapter, VaultFileInfo } from "./IVaultAdapter.js";
import {
  BACKUPS_ROOT,
  backupDirFor,
  isBatchBackupFolderName,
  parseBackupFileName,
  parseBackupPath,
  parseBatchFolderStamp,
} from "./backupNaming.js";

export interface FileVersion {
  backupPath: string;
  timestamp: number;
  size: number;
}

export interface OrphanedBackupGroup {
  originalPath: string;
  /** Sorted newest first. */
  versions: FileVersion[];
}

const TEXT_EXTENSIONS = new Set(["md", "base", "txt", "json", "canvas", "csv", "yml", "yaml"]);

/** Restores of these go through the text pipeline so sync-state hashes stay maintained. */
export function isTextLikePath(path: string): boolean {
  const name = path.split(/[/\\]/).pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function abortError(): Error {
  return typeof DOMException !== "undefined"
    ? new DOMException("Aborted", "AbortError")
    : Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/**
 * Read/restore API over the `.plainva/backups` snapshot store. Reads go
 * against the raw adapter; restores are written through the FULL adapter
 * chain passed by the caller, so the pre-restore state is itself backed up
 * and the write is sync-enqueued.
 */
export class VersionHistoryService {
  constructor(private readonly adapter: IVaultAdapter) {}

  /** Snapshots of exactly this file, newest first. */
  async listVersions(originalPath: string): Promise<FileVersion[]> {
    let files: VaultFileInfo[];
    try {
      files = await this.adapter.listDir(backupDirFor(originalPath), false);
    } catch {
      return [];
    }
    const basename = originalPath.split(/[/\\]/).pop() || "";
    const versions: FileVersion[] = [];
    for (const f of files) {
      if (f.isDirectory) continue;
      const parsed = parseBackupFileName(f.name);
      if (parsed && parsed.originalName === basename) {
        versions.push({ backupPath: f.path, timestamp: parsed.timestamp, size: f.size });
      }
    }
    versions.sort((a, b) => b.timestamp - a.timestamp);
    return versions;
  }

  async readVersionText(backupPath: string): Promise<string> {
    return this.adapter.readTextFile(backupPath);
  }

  async readVersionBinary(backupPath: string): Promise<Uint8Array> {
    return this.adapter.readBinaryFile(backupPath);
  }

  /**
   * Writes the snapshot content to `targetPath`. Text-like targets go through
   * `writeTextFile` (keeps ConflictAware's sha256 bookkeeping intact),
   * everything else byte-exact through `writeBinaryFile`. Parent directories
   * are created implicitly by the adapters.
   *
   * `beforeWrite` runs AFTER the snapshot content is read but BEFORE the
   * target is written — the caller's forced pre-restore backup goes here.
   * Running it earlier would be a data-loss trap: the forced backup's
   * age/count rotation may prune the very snapshot that is being restored.
   */
  async restoreVersion(opts: {
    backupPath: string;
    targetPath: string;
    writeAdapter: IVaultAdapter;
    beforeWrite?: () => Promise<void>;
  }): Promise<void> {
    const { backupPath, targetPath, writeAdapter, beforeWrite } = opts;
    if (isTextLikePath(targetPath)) {
      const text = await this.adapter.readTextFile(backupPath);
      await beforeWrite?.();
      await writeAdapter.writeTextFile(targetPath, text);
    } else {
      const bytes = await this.adapter.readBinaryFile(backupPath);
      await beforeWrite?.();
      await writeAdapter.writeBinaryFile(targetPath, bytes);
    }
  }

  /**
   * Vault-wide scan for snapshots whose original file no longer exists.
   * Authority is `adapter.exists()` per distinct original path (filesystem
   * truth, no index lag). Batch folders are ignored — they are operation
   * copies, not per-file history. Potentially slow on big stores, hence
   * progress + abort support; call on demand only.
   */
  async listOrphans(opts?: { signal?: AbortSignal; onProgress?: (scanned: number) => void }): Promise<OrphanedBackupGroup[]> {
    let all: VaultFileInfo[];
    try {
      all = await this.adapter.listDir(BACKUPS_ROOT, true);
    } catch {
      return [];
    }

    const groups = new Map<string, FileVersion[]>();
    let scanned = 0;
    const tick = () => {
      scanned++;
      if (scanned % 100 === 0) opts?.onProgress?.(scanned);
    };

    for (const f of all) {
      if (opts?.signal?.aborted) throw abortError();
      tick();
      if (f.isDirectory) continue;
      const norm = f.path.replace(/\\/g, "/");
      if (!norm.startsWith(`${BACKUPS_ROOT}/`)) continue;
      const firstSegment = norm.slice(BACKUPS_ROOT.length + 1).split("/")[0];
      if (isBatchBackupFolderName(firstSegment)) continue;
      const parsed = parseBackupPath(norm);
      if (!parsed) continue;
      const list = groups.get(parsed.originalPath) ?? [];
      list.push({ backupPath: f.path, timestamp: parsed.timestamp, size: f.size });
      groups.set(parsed.originalPath, list);
    }

    const orphans: OrphanedBackupGroup[] = [];
    for (const [originalPath, versions] of groups) {
      if (opts?.signal?.aborted) throw abortError();
      tick();
      if (await this.adapter.exists(originalPath)) continue;
      versions.sort((a, b) => b.timestamp - a.timestamp);
      orphans.push({ originalPath, versions });
    }
    opts?.onProgress?.(scanned);
    orphans.sort((a, b) => b.versions[0].timestamp - a.versions[0].timestamp);
    return orphans;
  }

  /**
   * Deletes snapshots older than `maxAgeDays` and whole batch folders whose
   * name stamp is older. Names that do not match the grammar are never
   * touched. `deleteFn` lets the desktop inject a hard delete (bypassing the
   * OS trash for internal housekeeping).
   */
  async pruneOldBackups(opts: {
    maxAgeDays: number;
    now?: number;
    deleteFn?: (path: string, recursive?: boolean) => Promise<void>;
  }): Promise<{ deletedFiles: number; deletedBatchFolders: number }> {
    const result = { deletedFiles: 0, deletedBatchFolders: 0 };
    if (!opts.maxAgeDays || opts.maxAgeDays <= 0) return result;
    const now = opts.now ?? Date.now();
    const cutoff = now - opts.maxAgeDays * 86_400_000;
    const del = opts.deleteFn ?? ((path: string, recursive?: boolean) => this.adapter.deleteItem(path, recursive));

    let top: VaultFileInfo[];
    try {
      top = await this.adapter.listDir(BACKUPS_ROOT, false);
    } catch {
      return result;
    }
    for (const f of top) {
      if (!f.isDirectory || !isBatchBackupFolderName(f.name)) continue;
      const stamp = parseBatchFolderStamp(f.name);
      if (stamp !== null && stamp < cutoff) {
        try {
          await del(f.path, true);
          result.deletedBatchFolders++;
        } catch {
          // retried on the next sweep
        }
      }
    }

    let all: VaultFileInfo[];
    try {
      all = await this.adapter.listDir(BACKUPS_ROOT, true);
    } catch {
      return result;
    }
    for (const f of all) {
      if (f.isDirectory) continue;
      const norm = f.path.replace(/\\/g, "/");
      if (!norm.startsWith(`${BACKUPS_ROOT}/`)) continue;
      const firstSegment = norm.slice(BACKUPS_ROOT.length + 1).split("/")[0];
      if (isBatchBackupFolderName(firstSegment)) continue; // batch content is pruned folder-wise only
      const parsed = parseBackupFileName(f.name);
      if (!parsed) continue; // never guess at foreign files
      if (parsed.timestamp < cutoff) {
        try {
          await del(f.path);
          result.deletedFiles++;
        } catch {
          // retried on the next sweep
        }
      }
    }
    return result;
  }
}
