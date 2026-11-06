import { IVaultAdapter, DeletionConfirmation, SnapshotBeforeDeleteError, VaultListing, VaultFileInfo, VaultFileNotFoundError, type VaultWalkOptions } from "./IVaultAdapter.js";
import {
  backupDirFor,
  isPlainvaInternalPath,
  makeBackupPath,
  parseBackupFileName,
} from "./backupNaming.js";
import { readLocalFile } from "./localText.js";
import { markAiVersion } from "./versionOrigins.js";

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
   * Called when the snapshot before a WRITE fails (full disk, blocked backup
   * dir, …). Such a failure never blocks the write: the new content is the
   * valuable part, the snapshot is history. A deletion does not report here:
   * where its snapshot fails and no trash takes the item, it is not carried
   * out at all (`SnapshotBeforeDeleteError`), and the person is asked instead.
   */
  onBackupError?: (path: string, error: unknown) => void;
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
   *
   * Answers the snapshot that holds the text — the one taken, or the newest
   * that already held it —, or null where there is no file to keep. `origin:
   * "ai"`: the text is a change an assistant wrote (plan KI direkt schreiben),
   * and the history marks that version so (`versionOrigins.ts`). A mark that
   * cannot be written costs the version nothing: it stays, unmarked.
   */
  async ensureSnapshot(path: string, options: { origin?: "ai" } = {}): Promise<string | null> {
    if (isPlainvaInternalPath(path)) return null;
    let current: string;
    try {
      current = await this.inner.readTextFile(path);
    } catch (err: any) {
      if (err instanceof VaultFileNotFoundError || err.code === "FILE_NOT_FOUND" || err.name === "VaultFileNotFoundError") return null;
      throw err;
    }
    const kept = await this.keptText(path, current);
    if (options.origin === "ai") await markAiVersion(this.inner, kept).catch(() => undefined);
    return kept;
  }

  /** The snapshot of `path` that holds `current`: the newest, where it does, or one taken now. */
  private async keptText(path: string, current: string): Promise<string> {
    const existing = await this.listFileBackups(path);
    const newest = existing[existing.length - 1];
    if (newest) {
      let kept: string | null = null;
      try {
        kept = await this.inner.readTextFile(newest.path);
      } catch {
        // A snapshot that cannot be read keeps nothing: a new one is taken.
      }
      if (kept === current) return newest.path;
    }
    // Never onto the name of the snapshot before it: two in one millisecond are two versions.
    const ts = Math.max(this.now(), (newest?.timestamp ?? 0) + 1);
    const backupPath = makeBackupPath(path, ts);
    await this.inner.writeTextFile(backupPath, current);
    this.lastSnapshotAt.set(path, ts);
    await this.rotate(existing);
    return backupPath;
  }

  /**
   * Keeps `bytes` as a snapshot in the version history of `path`, whatever
   * lies on disk there. For content that is about to go and has no file of
   * its own here: the cloud's copy of a twin spelling, removed as a duplicate
   * of `path` (nameTwins.ts). Taken in full, like a deletion's snapshot.
   */
  async keepSnapshot(path: string, bytes: Uint8Array): Promise<void> {
    if (isPlainvaInternalPath(path)) return;
    const existing = await this.listFileBackups(path);
    const ts = this.now();
    await this.inner.writeBinaryFile(makeBackupPath(path, ts), bytes);
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

  /**
   * A deletion happens only with a net (D1 of the data-safety plan of
   * 2026-11-06). A net is the system's trash, or a snapshot of everything
   * that goes, written before it goes. The rule lives here, once, for every
   * way a file or folder is deleted in either shell; nothing above this
   * adapter deletes past it (`deletionNetGuard.test.ts`).
   *
   * - A storage with a trash (`moveToTrash`, the desktop): a file is
   *   snapshotted first all the same, so its version history goes on, and
   *   the item goes to the trash. Where the trash refuses it — a network
   *   share —, every file that would go is snapshotted, a folder's included,
   *   and only then deleted for good.
   * - A storage without one (the phone): every file that would go — the
   *   file, or each file below the folder — is snapshotted first; "Deleted
   *   files" brings it back from there.
   *
   * Where a snapshot cannot be written (a full disk is enough), the deletion
   * stops before anything is deleted and throws `SnapshotBeforeDeleteError`
   * with the files that would be gone for good — unless the caller says
   * `withoutSnapshot`, after the person's "Delete anyway" or where what goes
   * lies in another file. The deletion used to go on and say, on the phone,
   * that the file "was still saved" (Sammelplan § 3.175 no. 6).
   */
  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    if (isPlainvaInternalPath(path)) return this.inner.deleteItem(path, recursive, confirmation);
    let info: VaultFileInfo | null;
    try {
      info = await this.inner.getFileInfo(path);
    } catch {
      info = null; // Not there: the storage below says what deleting it means.
    }
    // Nothing that goes has content of its own: a missing item, or a folder
    // deleted without `recursive`, which only an empty one survives.
    if (!info || (info.isDirectory && !recursive)) return this.inner.deleteItem(path, recursive, confirmation);
    const folder = info.isDirectory;

    if (this.inner.moveToTrash) {
      // The snapshot of a file is taken before the trash is asked: the trash
      // is the net here, the snapshot keeps the version history going.
      const fileCovered = folder || (await this.snapshotForDelete(path));
      if (await this.inner.moveToTrash(path)) return;
      const cover = folder ? await this.snapshotFolderContents(path) : { uncovered: fileCovered ? [] : [path], total: 1 };
      this.requireNet(path, folder, cover, "trash-unavailable", confirmation);
      return this.inner.deleteItem(path, recursive, confirmation);
    }

    const cover = folder ? await this.snapshotFolderContents(path) : { uncovered: (await this.snapshotForDelete(path)) ? [] : [path], total: 1 };
    this.requireNet(path, folder, cover, "no-trash", confirmation);
    return this.inner.deleteItem(path, recursive, confirmation);
  }

  /** Throws where something that goes has no copy and the caller did not say `withoutSnapshot`. */
  private requireNet(path: string, folder: boolean, cover: { uncovered: string[]; total: number }, net: SnapshotBeforeDeleteError["net"], confirmation?: DeletionConfirmation): void {
    if (cover.uncovered.length === 0) return;
    if (confirmation?.withoutSnapshot) {
      console.warn(`[BackupVaultAdapter] deleting ${path} without a snapshot of ${cover.uncovered.length} file(s), as asked`);
      return;
    }
    throw new SnapshotBeforeDeleteError(path, cover.uncovered, cover.total, net, folder);
  }

  /**
   * The snapshot of one file before it is deleted: whatever the interval
   * says, and in full, byte for byte (`readBinaryFile` reads any file
   * exactly). True where the file is covered: snapshotted, or nothing there.
   */
  private async snapshotForDelete(path: string): Promise<boolean> {
    try {
      await this.performBackup(path, true, true);
      return true;
    } catch (err) {
      console.warn(`[BackupVaultAdapter] snapshot before deleting ${path} failed`, err);
      return false;
    }
  }

  /**
   * Snapshots every file under `folder` that a recursive delete takes: the
   * folder's own, not what a link in it points at — the delete takes the
   * link, not its target —, dot-named files and folders included (`.git`,
   * `.obsidian`: the delete removes them, so the safety copy must hold them;
   * finding 2026-11-02). Only the app's own `.plainva` tree is left out.
   *
   * Answers what it could not cover and how many files go: a file whose
   * snapshot failed, a folder below that could not be listed (issue 125) —
   * or the folder itself, where it could not be listed at all. By the path
   * it is deleted by: for the one of two folders whose names differ only in
   * their Unicode form that keeps its own bytes, a listed `info.path` names
   * the other one (ADR 0016).
   */
  private async snapshotFolderContents(folder: string): Promise<{ uncovered: string[]; total: number }> {
    let listing: VaultListing;
    try {
      listing = this.inner.listDirReport
        ? await this.inner.listDirReport(folder, true, { followLinks: false, dotEntries: true })
        : { files: await this.inner.listDir(folder, true), skipped: [] };
    } catch (error) {
      console.warn(`[BackupVaultAdapter] could not list ${folder} before deleting it`, error);
      return { uncovered: [folder], total: 0 };
    }
    // A folder below that could not be listed holds files nobody copied; a cut loop leaves nothing out.
    const uncovered = listing.skipped.filter((s) => s.reason === "unreadable").map((s) => s.path);
    let total = uncovered.length;
    for (const entry of listing.files) {
      // The app's own tree, wherever it lies below the folder (an imported vault's).
      if (entry.isDirectory || isPlainvaInternalPath(entry.path) || entry.path.split("/").includes(".plainva")) continue;
      total++;
      if (!(await this.snapshotForDelete(entry.path))) uncovered.push(entry.path);
    }
    return { uncovered, total };
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
