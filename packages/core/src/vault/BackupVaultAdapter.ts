import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo, VaultFileNotFoundError, type VaultWalkOptions } from "./IVaultAdapter.js";
import {
  backupDirFor,
  isPlainvaInternalPath,
  makeBackupPath,
  parseBackupFileName,
} from "./backupNaming.js";
import { trimEndChars } from "../textScan.js";
import { readLocalFile } from "./localText.js";

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
  /**
   * Above this size, a WRITE keeps only the newest snapshot of that file
   * instead of the full history (C21). 0 = no limit.
   *
   * Without it a 90 MB attachment edited every two minutes could hold a
   * hundred snapshots — nine gigabytes for one file. Before the streamed
   * upload work such a file killed the app long before that, so it never
   * showed; now it goes through.
   *
   * The limit deliberately applies to writes only. A write leaves the new
   * version on disk, so the history is a convenience; a DELETION is the case
   * where the snapshot is the only thing that brings the file back, and it is
   * always taken in full.
   */
  maxSnapshotBytes: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicy = {
  minSnapshotIntervalSeconds: 120,
  maxBackupsPerFile: 100,
  maxAgeDays: 90,
  // Comfortably above any note and any ordinary image; below the video and
  // archive sizes where a hundred copies actually hurt.
  maxSnapshotBytes: 5 * 1024 * 1024,
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
  /**
   * Snapshot every file inside a folder before deleting the folder (S4).
   *
   * Off by default, because the desktop deletes into the OS trash and says so
   * in its confirmation — snapshotting a large folder there would cost time
   * and disk for a net that already exists. A phone has no trash: without this
   * a recursively deleted folder is gone, and for every note never edited on
   * that device there is nothing to restore from.
   */
  snapshotRecursiveDeletes?: boolean;
  /**
   * Called the first time a file is too large for a full snapshot history
   * (C21). The shell says this once per vault: silently keeping one version
   * where the user expects a hundred would be the kind of quiet difference
   * that only shows when someone needs an older copy.
   */
  onLargeFileTrimmed?: (path: string, size: number) => void;
}

interface FileBackupEntry {
  path: string;
  timestamp: number;
}

export class BackupVaultAdapter implements IVaultAdapter {
  private policy: BackupRetentionPolicy;
  private readonly now: () => number;
  private readonly onBackupError?: (path: string, error: unknown) => void;
  private readonly snapshotRecursiveDeletes: boolean;
  private readonly onLargeFileTrimmed?: (path: string, size: number) => void;
  /** Timestamp of the most recent snapshot per path this session (WP5 5a): lets
   *  a save within the snapshot interval skip the (unbounded) directory listing. */
  private readonly lastSnapshotAt = new Map<string, number>();
  /** Paths already reported as too large this session (C21), so the hint fires once. */
  private readonly largeReported = new Set<string>();

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
    this.snapshotRecursiveDeletes = options.snapshotRecursiveDeletes ?? false;
    this.onLargeFileTrimmed = options.onLargeFileTrimmed;
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

  /**
   * Makes sure a note, as it lies on disk now, is kept before something
   * replaces it that the editor's undo does not take back — an accepted
   * suggestion. Whatever the snapshot interval says; but not twice: where the
   * newest snapshot already holds exactly this text — a save a moment ago
   * took it — there is nothing to add, and the history does not grow by a
   * copy of its own last entry. No-op if the file does not exist.
   *
   * For a text file, and read and written as text — the way the snapshot of
   * every ordinary save is taken (`writeTextFile`), so it works wherever a
   * save works, and keeps what a save keeps: the text with its line ends and
   * its byte order mark.
   *
   * Unlike a snapshot before an ordinary write, a failure is the caller's to
   * hear: whoever asks for this means not to write without it.
   */
  async ensureSnapshot(path: string): Promise<void> {
    if (isPlainvaInternalPath(path)) return;
    let current: string;
    try {
      current = await this.inner.readTextFile(path);
    } catch (err: any) {
      if (err instanceof VaultFileNotFoundError || err.code === "FILE_NOT_FOUND" || err.name === "VaultFileNotFoundError") return;
      throw err;
    }
    const existing = await this.listFileBackups(path);
    const newest = existing[existing.length - 1];
    if (newest) {
      let kept: string | null = null;
      try {
        kept = await this.inner.readTextFile(newest.path);
      } catch {
        // A snapshot that cannot be read keeps nothing: a new one is taken.
      }
      if (kept === current) return;
    }
    // Never onto the name of the snapshot before it: two in one millisecond are two versions.
    const ts = Math.max(this.now(), (newest?.timestamp ?? 0) + 1);
    await this.inner.writeTextFile(makeBackupPath(path, ts), current);
    this.lastSnapshotAt.set(path, ts);
    await this.rotate(existing);
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

    // Fast path (WP5 5a): the directory listing below ran on EVERY save,
    // sequentially stat-ing every .bak in the file's shared backup folder —
    // a cost that grows without bound as the vault ages, and one that hurts
    // badly on a network drive. When we already recorded a recent snapshot this
    // session, skip the listing entirely; a snapshot is only due every
    // `minSnapshotIntervalSeconds`.
    if (!force && this.policy.minSnapshotIntervalSeconds > 0) {
      const last = this.lastSnapshotAt.get(path);
      if (last !== undefined && this.now() - last < this.policy.minSnapshotIntervalSeconds * 1000) {
        return;
      }
    }

    const existing = await this.listFileBackups(path);

    // C21: how many snapshots this file is allowed to keep. Asked BEFORE the
    // read below, so a 90 MB attachment never enters memory just to be trimmed
    // afterwards. A deletion (force) is exempt: there the snapshot is the only
    // way back, so it is always taken and always kept in full.
    let keep = this.policy.maxBackupsPerFile;
    if (!force && this.policy.maxSnapshotBytes > 0) {
      // No info, no trimming: never fewer snapshots on a guess.
      let size: number;
      try {
        size = (await this.inner.getFileInfo(path)).size;
      } catch {
        size = 0;
      }
      if (size > this.policy.maxSnapshotBytes) {
        keep = 1;
        if (existing.length > 1 || !this.largeReported.has(path)) {
          this.largeReported.add(path);
          this.onLargeFileTrimmed?.(path, size);
        }
      }
    }

    if (!force && this.policy.minSnapshotIntervalSeconds > 0 && existing.length > 0) {
      const newest = existing[existing.length - 1].timestamp;
      if (this.now() - newest < this.policy.minSnapshotIntervalSeconds * 1000) {
        this.lastSnapshotAt.set(path, newest); // remember, so the next save skips the listing
        return; // recent enough snapshot exists
      }
    }

    // We only backup files that exist.
    // If it throws VaultFileNotFoundError, it means it's a new file, so no backup needed.
    //
    // A snapshot is the file as it lay there. Before a text write the old
    // state is read as text — the cheap read, and for a UTF-8 file it IS the
    // file. Where it is not (`readLocalFile`), the bytes are the snapshot: the
    // history held the decoded reading of a `.csv` in Windows-1252, a version
    // that never existed, where the reader replaces what is not UTF-8 — and
    // nothing at all where it refuses, the write going on without its
    // snapshot (finding 2026-10-11).
    let oldContent: string | Uint8Array;
    try {
      if (isBinary) {
        oldContent = await this.inner.readBinaryFile(path);
      } else {
        const old = await readLocalFile(this.inner, path);
        oldContent = old.exact ? old.text : old.bytes ?? await this.inner.readBinaryFile(path);
      }
    } catch (err: any) {
      if (err instanceof VaultFileNotFoundError || err.code === "FILE_NOT_FOUND" || err.name === "VaultFileNotFoundError") {
        return; // New file, no backup needed
      }
      throw err;
    }

    const ts = this.now();
    const backupPath = makeBackupPath(path, ts);
    if (typeof oldContent === "string") {
      await this.inner.writeTextFile(backupPath, oldContent);
    } else {
      await this.inner.writeBinaryFile(backupPath, oldContent);
    }
    this.lastSnapshotAt.set(path, ts); // WP5 5a: skip the listing until the next interval

    await this.rotate(existing, keep);
  }

  /** Deletes over-count and over-age snapshots. `existing` excludes the just-written one. */
  private async rotate(existing: FileBackupEntry[], keep = this.policy.maxBackupsPerFile): Promise<void> {
    const toDelete = new Set<string>();

    const total = existing.length + 1; // + the snapshot we just wrote
    const overCount = total - keep;
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

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    try {
      const info = await this.inner.getFileInfo(path);
      if (!info.isDirectory) {
        // A deletion is the last chance to snapshot the content, so the
        // snapshot interval never applies here. readBinaryFile works
        // universally for byte-exact copies. The delete itself proceeds even
        // if the snapshot fails (the OS trash is the remaining net, and the
        // user explicitly confirmed) — but the failure is reported.
        await this.safeBackup(path, true, true);
      } else if (recursive && this.snapshotRecursiveDeletes) {
        // S4: on a platform without a trash, the folder's children are the
        // last chance too. Snapshot each FILE below it; failures are reported
        // per file and never hold up the deletion the user confirmed. By the
        // path it is deleted by: for the one of two folders whose names differ
        // only in their Unicode form that keeps its own bytes, `info.path`
        // names the other one (ADR 0016).
        await this.snapshotFolderContents(path);
      }
    } catch {
      // Ignore if file doesn't exist
    }
    return this.inner.deleteItem(path, recursive, confirmation);
  }

  /**
   * Snapshots the files under `folder` a recursive delete takes that the
   * tree shows: the folder's own, not what a link in it points at — the
   * delete takes the link, not its target —, and nothing under a dot-named
   * entry (`.git`, `.obsidian`, an imported vault's own `.plainva`), which is
   * another program's bookkeeping. One rule for every adapter, asked of the
   * walk (it does not go into such a folder) and held here as well.
   */
  private async snapshotFolderContents(folder: string): Promise<void> {
    let listing: VaultListing;
    try {
      // The walk that says what it could not list (issue 125): a folder below
      // that cannot be listed is no folder whose files were covered.
      listing = this.inner.listDirReport
        ? await this.inner.listDirReport(folder, true, { followLinks: false, dotEntries: false })
        : { files: await this.inner.listDir(folder, true), skipped: [] };
    } catch (error) {
      // Cannot enumerate — report once against the folder rather than
      // pretending the children were covered.
      this.reportBackupError(folder, error);
      return;
    }
    // Said first, so that it is the notice the person sees; a report that
    // fails costs no file its snapshot.
    const uncovered = listing.skipped.filter((s) => s.reason === "unreadable");
    if (uncovered.length > 0) this.reportBackupError(folder, new Error(`${uncovered.length} entr(ies) below could not be listed: ${uncovered.map((s) => s.path).join(", ")}`));
    // What lies below the folder, however the caller spelled it (a trailing
    // slash); where the walk names its files in another spelling, the whole
    // path is held to the rule, and a folder the tree shows has no dot in it.
    const root = trimEndChars(folder, "/");
    const below = (path: string) => (root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
    for (const entry of listing.files) {
      if (entry.isDirectory || isPlainvaInternalPath(entry.path)) continue;
      if (below(entry.path).split("/").some((segment) => segment.startsWith("."))) continue;
      await this.safeBackup(entry.path, true, true);
    }
  }

  /** `onBackupError`, which must not break the operation it reports on. */
  private reportBackupError(path: string, error: unknown): void {
    try {
      this.onBackupError?.(path, error);
    } catch {
      // error reporting must not break the delete either
    }
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
    return this.inner.createDir(path);
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }
}
