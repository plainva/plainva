import { IVaultAdapter, VaultFileInfo, VaultFileNotFoundError } from "./IVaultAdapter.js";
import {
  backupDirFor,
  isPlainvaInternalPath,
  makeBackupPath,
  parseBackupFileName,
} from "./backupNaming.js";

export interface BackupRetentionPolicy {
  /**
   * Skip creating a new snapshot if the newest one for the file is younger
   * than this. 0 = snapshot on every write. Deletions and forced backups
   * always snapshot regardless of the interval.
   */
  minSnapshotIntervalSeconds: number;
  maxBackupsPerFile: number;
  /** Snapshots older than this are deleted during rotation. 0 = unlimited. */
  maxAgeDays: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicy = {
  minSnapshotIntervalSeconds: 120,
  maxBackupsPerFile: 100,
  maxAgeDays: 90,
};

export interface BackupVaultAdapterOptions {
  policy?: Partial<BackupRetentionPolicy>;
  /** Legacy shorthand for policy.maxBackupsPerFile. */
  maxBackupsPerFile?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /**
   * Called when creating a snapshot fails (full disk, blocked backup dir, …).
   * Snapshot failures never block the user-facing operation itself.
   */
  onBackupError?: (path: string, error: unknown) => void;
}

interface FileBackupEntry {
  path: string;
  timestamp: number;
}

export class BackupVaultAdapter implements IVaultAdapter {
  private policy: BackupRetentionPolicy;
  private readonly now: () => number;
  private readonly onBackupError?: (path: string, error: unknown) => void;

  constructor(
    private readonly inner: IVaultAdapter,
    options: BackupVaultAdapterOptions = {}
  ) {
    this.policy = {
      ...DEFAULT_BACKUP_RETENTION,
      ...(options.maxBackupsPerFile !== undefined ? { maxBackupsPerFile: options.maxBackupsPerFile } : {}),
      ...options.policy,
    };
    this.now = options.now ?? (() => Date.now());
    this.onBackupError = options.onBackupError;
  }

  updatePolicy(patch: Partial<BackupRetentionPolicy>): void {
    this.policy = { ...this.policy, ...patch };
  }

  getPolicy(): BackupRetentionPolicy {
    return { ...this.policy };
  }

  async initialize(): Promise<void> {
    await this.inner.initialize();
  }

  async dispose(): Promise<void> {
    await this.inner.dispose();
  }

  async readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  /**
   * Snapshots the current on-disk state of the file regardless of the
   * snapshot interval (used before a version restore). No-op if the file
   * does not exist.
   */
  async forceBackup(path: string): Promise<void> {
    await this.performBackup(path, true, true);
  }

  /** Lists existing snapshots of exactly this file, sorted oldest first. */
  private async listFileBackups(path: string): Promise<FileBackupEntry[]> {
    let files: VaultFileInfo[];
    try {
      files = await this.inner.listDir(backupDirFor(path), false);
    } catch {
      return []; // backup dir does not exist yet
    }
    const basename = path.split(/[/\\]/).pop() || "";
    const entries: FileBackupEntry[] = [];
    for (const f of files) {
      if (f.isDirectory) continue;
      const parsed = parseBackupFileName(f.name);
      if (parsed && parsed.originalName === basename) {
        entries.push({ path: f.path, timestamp: parsed.timestamp });
      }
    }
    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }

  private async performBackup(path: string, isBinary: boolean, force = false): Promise<void> {
    // Internal housekeeping files are never themselves versioned.
    if (isPlainvaInternalPath(path)) return;

    const existing = await this.listFileBackups(path);

    if (!force && this.policy.minSnapshotIntervalSeconds > 0 && existing.length > 0) {
      const newest = existing[existing.length - 1].timestamp;
      if (this.now() - newest < this.policy.minSnapshotIntervalSeconds * 1000) {
        return; // recent enough snapshot exists
      }
    }

    // We only backup files that exist.
    // If it throws VaultFileNotFoundError, it means it's a new file, so no backup needed.
    let oldContent: string | Uint8Array;
    try {
      if (isBinary) {
        oldContent = await this.inner.readBinaryFile(path);
      } else {
        oldContent = await this.inner.readTextFile(path);
      }
    } catch (err: any) {
      if (err instanceof VaultFileNotFoundError || err.code === "FILE_NOT_FOUND" || err.name === "VaultFileNotFoundError") {
        return; // New file, no backup needed
      }
      throw err;
    }

    const backupPath = makeBackupPath(path, this.now());
    if (isBinary) {
      await this.inner.writeBinaryFile(backupPath, oldContent as Uint8Array);
    } else {
      await this.inner.writeTextFile(backupPath, oldContent as string);
    }

    await this.rotate(existing);
  }

  /** Deletes over-count and over-age snapshots. `existing` excludes the just-written one. */
  private async rotate(existing: FileBackupEntry[]): Promise<void> {
    const toDelete = new Set<string>();

    const total = existing.length + 1; // + the snapshot we just wrote
    const overCount = total - this.policy.maxBackupsPerFile;
    for (let i = 0; i < overCount && i < existing.length; i++) {
      toDelete.add(existing[i].path); // oldest first
    }

    if (this.policy.maxAgeDays > 0) {
      const cutoff = this.now() - this.policy.maxAgeDays * 86_400_000;
      for (const entry of existing) {
        if (entry.timestamp < cutoff) toDelete.add(entry.path);
      }
    }

    for (const path of toDelete) {
      try {
        await this.inner.deleteItem(path);
      } catch {
        // Ignore rotation failures; the next write retries.
      }
    }
  }

  /**
   * A failing snapshot must never block the primary user operation (the new
   * content is the valuable part; the snapshot is history). Mirrors the
   * "Ignore rotation failures" stance in rotate(), but surfaces the error.
   */
  private async safeBackup(path: string, isBinary: boolean, force = false): Promise<void> {
    try {
      await this.performBackup(path, isBinary, force);
    } catch (err) {
      console.warn(`[BackupVaultAdapter] snapshot for ${path} failed; continuing with the write`, err);
      try {
        this.onBackupError?.(path, err);
      } catch {
        // error reporting must not break the write path either
      }
    }
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.safeBackup(path, false);
    await this.inner.writeTextFile(path, content);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.safeBackup(path, true);
    await this.inner.writeBinaryFile(path, content);
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    try {
      const info = await this.inner.getFileInfo(path);
      if (!info.isDirectory) {
        // A deletion is the last chance to snapshot the content, so the
        // snapshot interval never applies here. readBinaryFile works
        // universally for byte-exact copies. The delete itself proceeds even
        // if the snapshot fails (the OS trash is the remaining net, and the
        // user explicitly confirmed) — but the failure is reported.
        await this.safeBackup(path, true, true);
      }
    } catch {
      // Ignore if file doesn't exist
    }
    return this.inner.deleteItem(path, recursive);
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    let wasDirectory: boolean | null = null;
    if (!isPlainvaInternalPath(oldPath) && !isPlainvaInternalPath(newPath)) {
      try {
        wasDirectory = (await this.inner.getFileInfo(oldPath)).isDirectory;
      } catch {
        wasDirectory = null;
      }
    }
    await this.inner.renameItem(oldPath, newPath);
    if (wasDirectory !== null) {
      try {
        await this.carryBackupHistory(oldPath, newPath, wasDirectory);
      } catch (err) {
        // History carry is best-effort; the user-visible rename already succeeded.
        console.warn(`[BackupVaultAdapter] carrying backup history ${oldPath} -> ${newPath} failed`, err);
      }
    }
  }

  /** Moves existing snapshots along with a renamed file/folder so history stays reachable. */
  private async carryBackupHistory(oldPath: string, newPath: string, isDirectory: boolean): Promise<void> {
    if (isDirectory) {
      const oldDir = `.plainva/backups/${oldPath}`;
      if (!(await this.inner.exists(oldDir))) return;
      const newDir = `.plainva/backups/${newPath}`;
      const newParent = newDir.substring(0, newDir.lastIndexOf("/"));
      await this.inner.createDir(newParent);
      if (!(await this.inner.exists(newDir))) {
        await this.inner.renameItem(oldDir, newDir);
        return;
      }
      // Target backup dir already exists (e.g. A -> B -> A round trip): merge file by file.
      const files = await this.inner.listDir(oldDir, true);
      for (const f of files) {
        if (f.isDirectory) continue;
        const rel = f.path.substring(oldDir.length + 1);
        const target = `${newDir}/${rel}`;
        try {
          const parent = target.substring(0, target.lastIndexOf("/"));
          await this.inner.createDir(parent);
          if (!(await this.inner.exists(target))) {
            await this.inner.renameItem(f.path, target);
          }
        } catch {
          // per-file carry failures are non-fatal
        }
      }
      try {
        await this.inner.deleteItem(oldDir, true);
      } catch {
        // leftover empty dirs are harmless
      }
      return;
    }

    const entries = await this.listFileBackups(oldPath);
    if (entries.length === 0) return;
    await this.inner.createDir(backupDirFor(newPath));
    for (const entry of entries) {
      try {
        const target = makeBackupPath(newPath, entry.timestamp);
        if (!(await this.inner.exists(target))) {
          await this.inner.renameItem(entry.path, target);
        }
      } catch {
        // per-file carry failures are non-fatal
      }
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
