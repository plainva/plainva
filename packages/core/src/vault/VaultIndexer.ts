import { IVaultAdapter, VaultFileInfo, VaultListing, VaultWalkSkip } from "./IVaultAdapter.js";
import { BatchStatement, IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { hasAppleDoubleHeader, isAppleDoubleCompanion, isAppleDoubleName } from "./systemJunk.js";
import { isInternalPath, isInternalSegment, INTERNAL_PATH_RULES, type InternalPathRules } from "./internalPath.js";
import { createYielder } from "./yielder.js";
import { trimChars } from "../textScan.js";
import { runStatementsAtomic } from "../db/batch.js";
import { escapeLikePrefix } from "../db/likeEscape.js";
import { SyncStateRepository, SyncState } from "./SyncStateRepository.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractFrontmatterLinks, extractLinksAndTags } from "../ast-scanner.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { isTextFile } from "../sync/fileType.js";
import { isMarkerTakenWithoutMark, readLocalText, type LocalText } from "./localText.js";
import { encodeIndexedProperty } from "./indexedProperty.js";
import { indexedRowStamp, type IndexedRowStamp } from "./indexedRowStamp.js";
import { segmentedIndexText } from "./spacelessText.js";

/** U+0000, built here so that no source line has to carry the character. */
const NUL = String.fromCharCode(0);

/**
 * Minimal write sink. The cold full-scan (indexVaultFull) records its pure-write
 * statements into a buffer and flushes them as ONE atomic batch instead of issuing
 * one IPC execute() per row; every other path passes no writer and keeps writing
 * directly to the adapter. A stray execute during the scan's event-loop yields is
 * NOT captured — only the bulk helpers that receive the sink are redirected.
 */
type SqlWriter = { execute(query: string, params?: unknown[]): Promise<void> };
async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The internal-path rules live in internalPath.ts (as data, shared with the
// native vault walk); re-exported so the many existing importers keep their path.
export { isInternalPath, isInternalSegment, INTERNAL_PATH_RULES, type InternalPathRules };

/** Re-exported so the many existing importers keep their path. */
export { escapeLikePrefix };

/**
 * What a full re-index actually did. Returned by `indexVaultFull` so the host can
 * tell the user whether the scan saw their file at all — previously the pass was
 * silent and a failed/blind scan was indistinguishable from "nothing changed".
 */
export interface IndexScanReport {
  /** Files indexed that had no row before. */
  added: number;
  /** Files re-indexed because their mtime differed from the indexed one. */
  changed: number;
  /** Indexed files that are gone from disk and were de-indexed. */
  removed: number;
  /**
   * Entries the directory walk left out, with reasons (empty when the adapter
   * cannot report them), and the files the scan could not read and left out
   * (reason `unreadable`, issue #125).
   */
  skipped: VaultWalkSkip[];
  /** Wall-clock duration of the pass in milliseconds. */
  durationMs: number;
  /** Files the walk saw on disk (after the internal-path filter). */
  walked: number;
  /**
   * The set of folders on disk differs from what the previous full scan of
   * this indexer saw — the one thing the tree draws from the disk rather than
   * from the index. True on the first scan: with nothing to compare against,
   * unknown counts as changed.
   * Together with the three counts this tells a host whether anything needs
   * reloading at all (issue #122: an unchanged scan must reload nothing).
   */
  foldersChanged: boolean;
}

/** True when a full scan left the index and the folder list exactly as they were. */
export function scanChangedNothing(report: IndexScanReport): boolean {
  return report.added === 0 && report.changed === 0 && report.removed === 0 && !report.foldersChanged;
}

/**
 * What a host learns about every full scan (issue #122). A full scan is the
 * expensive path, and until this existed it left no trace: a user whose typing
 * stalled could not show us that a scan ran, let alone why. `trigger` is a
 * short token chosen by the caller of `indexVaultFull` — never a path.
 */
export interface FullScanInfo extends IndexScanReport {
  trigger: string;
}

/**
 * One diagnostics line for a full scan — counts and a duration only, no file
 * names, no paths, no vault name. Shared so both shells write the same line.
 */
export function formatFullScan(info: FullScanInfo): string {
  const outcome = scanChangedNothing(info)
    ? "nothing changed"
    : `${info.added} added, ${info.changed} changed, ${info.removed} removed, folders ${info.foldersChanged ? "changed" : "unchanged"}`;
  const skipped = info.skipped.length > 0 ? `, ${info.skipped.length} skipped` : "";
  return `full scan (${info.trigger}): ${info.walked} files walked in ${Math.round(info.durationMs)} ms — ${outcome}${skipped}`;
}

/**
 * A full scan that did not get through (issue #125): what set it off and what
 * stopped it. The index keeps what the scan wrote before it stopped; until the
 * host was told, nobody learned of it — on the phone, the whole index went
 * with a scan that threw at the start of the app.
 */
export interface FullScanFailure {
  trigger: string;
  error: unknown;
}

/** The diagnostics line for a failed full scan — the kind of error only, never its message (it may name a file). */
export function formatFullScanFailure(info: FullScanFailure): string {
  const error = info.error as { code?: unknown; name?: unknown } | null | undefined;
  const kind = typeof error?.code === "string" && error.code
    ? error.code
    : typeof error?.name === "string" && error.name ? error.name : typeof info.error;
  return `full scan (${info.trigger}) failed: ${kind}`;
}

/** What `reconcileFolder` did (issue #110, E8). */
export interface FolderReconcileReport {
  /** Files (re)indexed because they were new or their mtime moved. */
  indexed: string[];
  /** Indexed files that are gone from disk (or became excluded) and left the index. */
  removed: string[];
  /** Entries the walk left out, and files the re-read could not read (issue #125); nothing under them was removed. */
  skipped: VaultWalkSkip[];
  /**
   * A subfolder that held indexed files is gone. The folder list the tree
   * draws from the disk changed, which a file-only refresh does not redraw.
   */
  foldersRemoved: boolean;
  /**
   * The folders found here differ from what the last full scan knew at this
   * place: a subfolder appeared or went, indexed files or not. An EMPTY folder
   * deleted outside the app leaves no file event behind — this is how its
   * disappearance reaches the tree (issue #122). False while no full scan has
   * run yet: there is nothing to compare with, and the scan itself reports.
   */
  foldersChanged?: boolean;
}

export interface VaultIndexerOptions {
  /** Cancels read-only reconciliation before any index mutation starts. */
  scanSignal?: AbortSignal;
  onExternalModification?: (path: string, oldHash: string | null, newHash: string) => void;
  /**
   * Answers whether `sha256` is content the app's own adapter wrote to `path`
   * (feedback Build 91, P1). The adapter records its hash AFTER the bytes hit
   * the disk, and a pass reading the file in that window used to report the
   * app's own save as a foreign change. Own content is never external.
   */
  isOwnWrite?: (path: string, sha256: string) => boolean;
  /**
   * Fired when indexing discovers a file with no prior sync state, i.e. one created
   * outside Plainva's own write path (another editor, the OS). The desktop uses this to
   * enqueue a push, since such files are indexed (and thus visible) but were never
   * queued for sync and would otherwise never reach the cloud.
   */
  onNewLocalFile?: (path: string) => void;
  /**
   * Fired when a full re-index finds a previously-indexed file gone from disk (deleted
   * or renamed externally). The desktop enqueues a remote delete so the deletion
   * propagates instead of the file being resurrected on the next pull. The indexer no
   * longer purges `sync_state` for such files itself — that is cleaned up only after the
   * remote delete succeeds.
   *
   * `row` is the index row that went, where a pass found the file gone; absent
   * where the app removed the file itself and said so (`removePathFromIndex`).
   */
  onLocalFileDeleted?: (path: string, row?: IndexedRowStamp) => void;
  onProgress?: (current: number, total: number, path: string) => void;
  /** Called after every completed full scan, changed or not (diagnostics, issue #122). */
  onFullScan?: (info: FullScanInfo) => void;
  /** Called once for a full scan that failed, not for one that was cancelled (issue #125). */
  onFullScanFailed?: (info: FullScanFailure) => void;
}

/**
 * Prefetched lookups for a bulk pass (P2.4): the per-file variants issued
 * THREE SELECT round-trips per file (existing file state, pending queue op,
 * sync state) — 30k round-trips for a 10k-file full index over the Tauri IPC
 * bridge. A bulk pass loads each table once and reads from these maps.
 */
interface BulkIndexLookups {
  /**
   * The row at each path, as the index held it BEFORE this pass wrote — what
   * decides whether a file is known, and with it whether its sync_state row
   * is orphaned. By PATH: that is where a row is. Its id is the hash of the
   * path it was last indexed under, and a row the app moved keeps it until a
   * pass has read the file again (`SyncQueue.queueRename`,
   * `relocatePathInIndex`). Asked by the id of the path it now has, a moved
   * row was not found: the scan a folder move ends in then replaced every
   * file's stored creation time by the file system's and dropped the mark
   * that an upload waits (finding 2026-10-12).
   */
  fileStateByPath: Map<string, { sync_state: string | null; ctime: number | null }>;
  /** Where each row sits now, by SQLite's rowid — how a scan tells a row that moved from a file that vanished (`movedAway`). */
  pathByRow: Map<number, string>;
  /** Where the row with each id sits — whether a path's own id is still another row's (`rowIdFor`). */
  pathById: Map<string, string>;
  queuedPaths: Set<string>;
  syncStateByPath: Map<string, SyncState>;
}

/**
 * A file's content as a pass read it, ahead of indexing it: a note or a file
 * that is text by its name (`readLocalText`), or the hash of a binary file's
 * bytes. A pass over many files reads first and indexes after, so that a file
 * that cannot be read is left out instead of ending the pass (`readOrLeaveOut`).
 */
type FileReading =
  | { kind: "text"; read: LocalText }
  | { kind: "bytes"; sha256: string };

/**
 * What ONE pass over the index has to say, and where it stood when it began.
 *
 * It belongs to the pass, not to the indexer (finding 2026-10-12). The lists
 * used to be fields of the indexer, emptied by every pass on its way in — and
 * passes overlap: a full scan runs for seconds and lets go in between, and a
 * single path a save, a pull or the watcher follows comes in meanwhile. That
 * pass emptied what the scan had found so far, even when its own transaction
 * was refused a moment later: files the scan had discovered were not
 * announced, so not queued for upload — a new file until the sweep of the
 * next sync start found it, a foreign change of a known file not at all.
 */
interface IndexPass {
  /**
   * Files without an earlier sync state, announced (`onNewLocalFile`) AFTER
   * the transaction committed: the host's handler does database work of its
   * own (enqueueing), which must not run inside the indexer's transaction.
   */
  newLocalFiles: string[];
  /** Foreign changes of known files (`onExternalModification`), announced after the transaction as well. */
  externalMods: { path: string; oldHash: string; newHash: string }[];
  /**
   * Single-file route: did anything the file tree / tag tree / doc icons
   * render change (title, mode, tags, plainva namespace)? `indexFile` hands it
   * back so the UI can skip its app-wide refresh on pure prose edits. True
   * until a comparison says otherwise.
   */
  metadataChanged: boolean;
  /** `touchClock` when the pass began — what `stillMine` measures against. */
  since: number;
}

/**
 * The `meta` key that says this index is owed a full scan (`VaultIndexer.indexComplete`):
 * set with the first rows a scan writes into an empty index, or once a scan
 * that began on it empty failed, and taken away with the last rows of a scan
 * that goes through.
 */
const INDEX_OWED_KEY = "index_scan_owed";

/** A row of the index as a full scan finds it when it begins. */
interface IndexedAtScanStart {
  rowid?: number | null;
  path: string;
  mtime_local: number;
}

export class VaultIndexer {
  private readonly syncRepo: SyncStateRepository;
  /**
   * Ticks whenever a pass sees a file at a path it was asked about, writes a
   * row for a path or reports a path gone; `touchedAt` holds the tick of a
   * path's last such moment. See `stillMine`.
   */
  private touchClock = 0;
  private readonly touchedAt = new Map<string, number>();
  private openPasses = 0;

  constructor(
    private readonly vaultAdapter: IVaultAdapter,
    private readonly dbAdapter: IDatabaseAdapter,
    private readonly options?: VaultIndexerOptions
  ) {
    this.syncRepo = new SyncStateRepository(dbAdapter);
  }

  /** Runs one pass: what it finds is its own, and so is the moment it began. */
  private async inPass<T>(work: (pass: IndexPass) => Promise<T>): Promise<T> {
    this.openPasses++;
    try {
      return await work({ newLocalFiles: [], externalMods: [], metadataChanged: true, since: this.touchClock });
    } finally {
      // Nobody is left who read the index before one of these moments.
      if (--this.openPasses === 0) this.touchedAt.clear();
    }
  }

  /** A single path was asked about `path` and found a file there, a row was written for it, or it was reported gone. */
  private touch(path: string): void {
    // Remembered only while a pass is under way: nobody else can hold an older reading.
    if (this.openPasses > 0) this.touchedAt.set(path, ++this.touchClock);
  }

  /**
   * The paths of `paths` that are still this pass's to remove and to report
   * gone (finding 2026-10-12).
   *
   * A pass decides from what it read when it began, and removes and reports
   * when it is through; a full scan can be seconds away from its own reading.
   * Two things may have happened to a path in between, and each takes it out
   * of this pass's hands:
   *  - Another pass removed its row and said so — the single path a pull or
   *    the watcher followed, a folder that was reconciled, the app deleting
   *    the file itself. Told a second time, the host queued a remote deletion
   *    for a file the sync worker had removed itself: its "that deletion was
   *    mine" (`OwnDeletionRegister`) answers one question and no more.
   *  - Another pass saw a file there, or wrote a row for it. That is newer
   *    than this pass's reading: a file that came back after the scan had
   *    listed its folder had its fresh row removed and was reported gone
   *    while it lay on disk.
   * A row that is stale after all is found by the next pass, with a reading
   * of its own.
   */
  private stillMine(paths: readonly string[], pass: IndexPass): string[] {
    return paths.filter((path) => (this.touchedAt.get(path) ?? 0) <= pass.since);
  }

  /**
   * The paths of `paths` whose row the app MOVED since the scan read the
   * index (finding 2026-10-12): nothing sits at the path any more, and the row
   * that was indexed under it sits at another.
   *
   * The scan lists the disk after it read the index. A file the app moved in
   * between is missing at its old path — and was reported gone: a remote
   * DELETE queued behind the MOVE that was already queued, and for a folder
   * of some size the question whether that many files should be deleted.
   * Nobody had touched the old path in the sense of `stillMine`: the rows
   * move in the queue's own transaction (`SyncQueue.queueRename`), and the
   * index hears of the move only when the shell calls `relocatePathInIndex`
   * — on the desktop after the scan has decided, whose turn at the database
   * comes right behind the queue's. So the scan asks the index as it is now.
   * A move rewrites a row's path in place; the row stays the row it was, and
   * SQLite's rowid says so. (Its `id` would not do: it is the hash of the path
   * the row was last indexed under, and a row that moves a second time before
   * a pass has read it still carries the id of its first path.) A row that is
   * read again is deleted and inserted: under a new rowid, at the same path.
   * Where a moved row is now, this scan or the next one reads the file.
   *
   * `known` is the scan's first reading: the row each path had when it began.
   */
  private movedAway(
    paths: readonly string[],
    known: ReadonlyMap<string, { rowid?: number | null }>,
    lookups: BulkIndexLookups,
  ): Set<string> {
    const moved = new Set<string>();
    for (const path of paths) {
      const row = known.get(path)?.rowid;
      if (row === undefined || row === null) continue;
      const now = lookups.pathByRow.get(Number(row));
      if (now !== undefined && now !== path) moved.add(path);
    }
    return moved;
  }

  /**
   * Tells the host that files left the vault (`onLocalFileDeleted`), once
   * their rows are gone. `since` is the moment the caller's knowledge is from:
   * a path somebody touched after it is left out, as in `stillMine`. `rowOf`
   * names the row that was removed for a path (`IndexedRowStamp`).
   */
  private reportRemoved(paths: readonly string[], since: number, rowOf?: (path: string) => IndexedRowStamp | undefined): void {
    for (const path of paths) {
      if ((this.touchedAt.get(path) ?? 0) > since) continue;
      this.touch(path);
      this.options?.onLocalFileDeleted?.(path, rowOf?.(path));
    }
  }

  /**
   * Generates a stable unique ID for a file based on its relative path.
   */
  private async generateFileId(path: string): Promise<string> {
    return await sha256Hash(path);
  }

  /**
   * The id the row for `path` is written under: the hash of the path — unless
   * a row the app moved away from `path` still carries it (a move keeps a
   * row's id: `SyncQueue.queueRename`, `relocatePathInIndex`). Then a new file
   * under the old name gets an id of its own. Written under the hash, its row
   * took the moved file's with it, because a write first deletes the id it
   * inserts: out of the index went the moved note, its creation time and its
   * sync label, until a full scan announced it as new (finding 2026-10-12).
   * An id is a key and nothing more — everything that refers to a row joins
   * through it.
   */
  private async rowIdFor(path: string, lookups?: BulkIndexLookups): Promise<string> {
    const id = await this.generateFileId(path);
    const holder = lookups
      ? lookups.pathById.get(id)
      : (await this.dbAdapter.queryOne<{ path: string }>(`SELECT path FROM files WHERE id = ?`, [id]))?.path;
    if (holder === undefined || holder === path) return id;
    return this.generateFileId(`${path}\u0000${holder}`);
  }

  /**
   * Loads the three per-pass lookup tables with one query each (P2.4).
   *
   * Called by the scan INSIDE its transaction, before its first write: one
   * reading of index, queue and sync rows that belongs together and is as old
   * as the scan's writes, not as its beginning. The scan used to judge a file
   * by the paths it had read before it listed the disk — seconds earlier on a
   * large vault — and a file the app had moved in between was unknown to that
   * list: announced as new, for an upload nobody needed (finding 2026-10-12).
   */
  private async loadBulkLookups(): Promise<BulkIndexLookups> {
    const fileRows = await this.dbAdapter.query<{ rowid?: number | null; id?: string | null; path: string; sync_state: string | null; ctime?: number | null }>(
      `SELECT rowid, id, path, sync_state, ctime FROM files`
    );
    const fileStateByPath = new Map<string, { sync_state: string | null; ctime: number | null }>();
    const pathByRow = new Map<number, string>();
    const pathById = new Map<string, string>();
    for (const r of fileRows) {
      fileStateByPath.set(r.path, { sync_state: r.sync_state ?? null, ctime: r.ctime ?? null });
      if (r.rowid !== undefined && r.rowid !== null) pathByRow.set(Number(r.rowid), r.path);
      if (r.id) pathById.set(r.id, r.path);
    }

    const queueRows = await this.dbAdapter.query<{ file_path: string; new_path: string | null }>(
      `SELECT file_path, new_path FROM offline_queue`
    );
    const queuedPaths = new Set<string>();
    for (const r of queueRows) {
      queuedPaths.add(r.file_path);
      if (r.new_path) queuedPaths.add(r.new_path);
    }

    const syncStateByPath = await this.syncRepo.getAllStates();
    return { fileStateByPath, pathByRow, pathById, queuedPaths, syncStateByPath };
  }

  /**
   * How a file's sync_state row counts for this pass (feedback Build 91, P1).
   *
   * A row for a path the index does NOT know is ORPHANED: the file it belonged
   * to was deleted (the row stays behind on purpose, so a remote delete can
   * still be pushed) and a new file now reuses the name — "Notiz 1" after
   * "Notiz 1" was removed. Measured against the old row, the new file looked
   * like a foreign change of a note nobody but the app had touched, and
   * because a row existed its baseline was never written; the first save then
   * merged against the deleted note's text and produced a `.CONFLICT` copy.
   * An orphaned row counts as no row: the file is new, gets its baseline and
   * is announced as a new local file.
   *
   * With one exception, and it is a matter of data safety (finding
   * 2026-10-09): the merge base a SYNC recorded stays. A row is also without
   * an index entry while the file it describes is alive and well — a file
   * pulled a moment ago that no pass has looked at yet (on the phone a file
   * that is no note waited for the next full scan), and every file of the
   * vault once the index was dropped to be rebuilt. Writing the file's
   * current text over that base made a local change that had not gone up yet
   * look as if the remote already contained it: the next change from another
   * device replaced it, without a conflict copy. `base_sha256` is written by
   * a sync and by nothing else, so a row that carries one keeps the base text
   * the sync stored (`keepsSyncedBase`), whatever became of the index; only
   * the local marker is renewed. For the note that reuses a deleted note's
   * name this is the right base too: until the deletion has reached the
   * remote, the remote still holds the old note, and a change made to it
   * elsewhere has to meet the new note as a conflict, not replace it.
   *
   * `isOwnWrite` closes the other window: the app's own write reaching the
   * disk before the adapter recorded its hash — on an external folder a pass
   * runs on every note open and every return to the foreground.
   *
   * `markerNamesThisFile` closes a third: a marker a reader took of this very
   * file without its byte order mark, where the base the sync recorded is the
   * file as it lies there (`isMarkerTakenWithoutMark`, asked by the callers,
   * which hold the text). The file is the one on record. The marker itself is
   * left to whoever writes or opens the file next.
   */
  private judgeSyncState(
    path: string,
    sha256: string,
    oldSyncState: SyncState | null,
    knownToIndex: boolean,
    pass: IndexPass,
    markerNamesThisFile = false,
  ): { isNewLocalFile: boolean; keepsSyncedBase: boolean } {
    const orphaned = !!oldSyncState && !knownToIndex;
    const differs = !!oldSyncState?.local_sha256 && oldSyncState.local_sha256 !== sha256;
    if (differs && !orphaned && !markerNamesThisFile && !this.options?.isOwnWrite?.(path, sha256)) {
      pass.externalMods.push({ path, oldHash: oldSyncState!.local_sha256!, newHash: sha256 });
    }
    return { isNewLocalFile: !oldSyncState || orphaned, keepsSyncedBase: orphaned && !!oldSyncState?.base_sha256 };
  }

  /**
   * Multi-row INSERT in chunks. 150 rows × up to 6 params stays safely under
   * SQLite's conservative 999-host-parameter floor.
   */
  private async executeBatch(
    prefix: string,
    rowPlaceholders: string,
    rows: unknown[][],
    writer: SqlWriter = this.dbAdapter
  ): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK = 150;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await writer.execute(
        prefix + slice.map(() => rowPlaceholders).join(", "),
        slice.flat() as unknown[]
      );
    }
  }

  /**
   * Indexes ONE file the caller knows was just written — a save, a restore, a
   * pull — without asking its timestamp first (`indexPath` asks, and is the
   * door for "something may have happened at this path").
   * Note: This method opens its own transaction.
   *
   * Every kind of file: a note as a note, anything else as an attachment —
   * the split `inspectPath`, `reconcileFolder` and the full scan make. It
   * used to take notes only and do nothing for the rest, without a word
   * (finding 2026-10-09). The desktop's watcher passed by a moment later and
   * covered for it; the phone has no watcher, and handed this method its
   * databases, its tables and every file a pull or a restore wrote, none of
   * which the index heard of before the next full scan. A path the index
   * never holds (internalPath.ts, an AppleDouble sidecar) and a directory are
   * left alone, as on every other route.
   *
   * Returns whether view-relevant data (title, mode, tags, plainva namespace,
   * frontmatter properties, or the file's links) changed, so the caller can
   * skip the app-wide UI refresh on pure prose edits. Links count: the
   * backlinks panel and the graph cache key off the index version. A file
   * that is no note has none of these: it counts as changed exactly when the
   * index did not know it yet. Nothing indexed returns false.
   */
  async indexFile(fileInfo: VaultFileInfo): Promise<boolean> {
    if (fileInfo.isDirectory || isInternalPath(fileInfo.path)) return false;
    if (await this.isAppleDoubleOnDisk(fileInfo)) return false;
    return this.inPass(async (pass) => {
      // The caller holds a file. A pass that misses it in an older listing
      // does not report it gone, and where it has not decided yet it leaves
      // the row too (stillMine) — also when this pass fails.
      this.touch(fileInfo.path);
      await this.dbAdapter.transaction(async () => {
        if (fileInfo.name.endsWith(".md")) await this._indexFileInternal(fileInfo, pass);
        else await this._indexAttachmentInternal(fileInfo, pass);
      });
      this.flushCallbacks(pass);
      return pass.metadataChanged;
    });
  }

  /**
   * Internal method that indexes a file without starting a new transaction.
   * Useful for bulk indexing. Always re-reads the file from disk so the index
   * matches exactly what is on disk (incl. content the adapter may have merged).
   */
  private async _indexFileInternal(
    fileInfo: VaultFileInfo,
    pass: IndexPass,
    lookups?: BulkIndexLookups,
    writer: SqlWriter = this.dbAdapter,
    reading?: FileReading
  ): Promise<void> {
    // The hash is the one of the note's BYTES, and its text is a merge base
    // only where it IS the note (`readLocalText`). A note in another encoding
    // — Windows-1252 from an old tool, UTF-16 — is indexed from a reading with
    // replacement characters, which is good enough to find it; kept as the
    // merge base, that reading would be written back by the next merge (see
    // the end of this method). A pass over many files reads first
    // (`readOrLeaveOut`) and hands the reading in.
    const read = reading?.kind === "text" ? reading.read : await readLocalText(this.vaultAdapter, fileInfo.path);
    // UTF-16 read as UTF-8 carries a NUL after every character; without them
    // the reading has the note's headings and links again.
    const content = read.exact ? read.text : read.text.split(NUL).join("");
    const sha256 = read.sha256;
    const existingFileState = lookups
      ? lookups.fileStateByPath.get(fileInfo.path) ?? null
      : // The row at this PATH, whatever id it carries. An in-app move or
        // rename keeps the row's id (SyncQueue.queueRename rewrites only
        // `path`, and relocatePathInIndex does the same), so a row sitting
        // here with an older id IS this file. Looked up by id alone it read
        // as "no row" — the move then counted as a brand-new file: its merge
        // base was overwritten with the current text and a spurious write
        // queued (issue 113). And a row that carries THIS path's id while it
        // sits elsewhere is not this file: it is one the app moved away from
        // here and no pass has read since. A new file under the old name used
        // to take that row for its own — the moved file's creation time, and
        // its title and tags to compare against (finding 2026-10-12).
        await this.dbAdapter.queryOne<{ sync_state: string | null; ctime?: number | null; title?: string | null; mode?: string | null }>(
          `SELECT sync_state, ctime, title, mode FROM files WHERE path = ? COLLATE BINARY`,
          [fileInfo.path]
        );
    const hasPendingQueueOp = lookups
      ? lookups.queuedPaths.has(fileInfo.path)
      : !!(await this.dbAdapter.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? OR new_path = ? LIMIT 1`,
          [fileInfo.path, fileInfo.path]
        ));
    const indexedSyncState = hasPendingQueueOp
      ? "local_ahead"
      : existingFileState?.sync_state || "synced";
    // Creation time must stay STABLE across re-indexing: the stored value wins
    // so a mere save never changes the ctime sort key (the pinboard orders
    // un-arranged cards by ctime — a jumping ctime made it behave like mtime,
    // esp. on cloud-synced/network folders where FS birthtime is unreliable).
    // The adapter's birthtime seeds it on FIRST index, else the file's mtime as
    // a first-seen lower bound (graph time axis, format v3).
    const ctime = existingFileState?.ctime ?? fileInfo.ctime ?? fileInfo.mtime;

    // Detect external modifications before updating state. Buffered and fired AFTER the
    // transaction (the host handler enqueues, which must not nest inside our transaction).
    const oldSyncState = lookups
      ? lookups.syncStateByPath.get(fileInfo.path) ?? null
      : await this.syncRepo.getSyncState(fileInfo.path);
    const knownToIndex = existingFileState !== null;
    const markerNamesThisFile = read.exact && await isMarkerTakenWithoutMark({ text: read.text, sha256 }, oldSyncState);
    const { isNewLocalFile, keepsSyncedBase } = this.judgeSyncState(fileInfo.path, sha256, oldSyncState, knownToIndex, pass, markerNamesThisFile);
    // A row is written for the path: a pass that read the index earlier leaves it alone (stillMine).
    this.touch(fileInfo.path);
    // The id the row is written under (rowIdFor), asked after the lookups above.
    const fileId = await this.rowIdFor(fileInfo.path, lookups);

    try {
      const hasExtremelyLongLines = content.split('\n').some(line => line.length > 10000);
      
      let links: any[] = [];
      let tags: any[] = [];
      let fmResult: any = { success: false, data: null };

      if (!hasExtremelyLongLines) {
        const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });
        const extracted = extractLinksAndTags(ast);
        links = extracted.links;
        tags = extracted.tags;
        fmResult = extractFrontmatter(ast);
      }
      
      let title = fileInfo.name.replace(/\.md$/, "");
      let mode = "obsidian";

      if (fmResult.success && fmResult.data) {
        if (fmResult.data.title) title = fmResult.data.title;
        if (fmResult.data.type) mode = "okf";
      }

      // Link rows exactly as they are inserted below: body links (property_key
      // NULL) plus frontmatter relation links. Built up front so the change
      // detection compares the very same values that hit the DB.
      // The seventh column is the line (Build-91 feedback, P7): it existed in
      // the schema and was read by the graph and the backlinks, but never
      // written — every backlink came back without a place. Frontmatter links
      // carry none; they belong to the property, not to a line of prose.
      const linkRows: unknown[][] = links.map((link) => [
        fileId, link.target, link.rawTarget, link.type, link.anchor || null, null, link.line ?? null,
      ]);
      if (fmResult.success && fmResult.data) {
        for (const fmLink of extractFrontmatterLinks(fmResult.data)) {
          linkRows.push([fileId, fmLink.target, fmLink.rawTarget, "wikilink", fmLink.anchor || null, fmLink.propertyKey, null]);
        }
      }

      // Detect whether anything view-relevant changed: title, mode, tags, ANY
      // frontmatter property — or the file's LINKS. Views derive from exactly
      // these — the file tree (title/mode), tag tree (tags), doc icons
      // (plainva.*), `.base` tables/boards (arbitrary frontmatter columns like
      // `status`), and the backlinks panel / graph cache (links: loadGraphCached
      // keys off fileTreeVersion, so a hand-typed [[link]] must bump it or it
      // stays invisible until an app restart). Pure prose typing leaves every
      // signature unchanged and the editor can skip the app-wide
      // fileTreeVersion bump — that fan-out is what made typing lag. FTS is
      // rewritten to the DB regardless (search queries live, no bump needed).
      // Frontmatter is serialized exactly as it is stored below (same strValue
      // rule, sorted), so the comparison against the DB rows is
      // apples-to-apples. Only computed on the single-file path (bulk
      // full-index ignores it).
      if (!lookups) {
        const newTagSig = [...new Set((tags as { name: string }[]).map((tg) => tg.name))].sort().join("\n");
        const newPropPairs: string[] = [];
        if (fmResult.success && fmResult.data) {
          for (const [key, value] of Object.entries(fmResult.data)) {
            const encoded = encodeIndexedProperty(value);
            newPropPairs.push(`${key}\t${encoded.type}\t${encoded.value}`);
          }
        }
        const newPropSig = newPropPairs.sort().join("\n");
        const oldTagRows = await this.dbAdapter.query<{ tag: string }>(
          `SELECT tag FROM tags WHERE file_id = ?`,
          [fileId]
        );
        const oldTagSig = [...new Set(oldTagRows.map((r) => r.tag))].sort().join("\n");
        const oldPropRows = await this.dbAdapter.query<{ key: string; value: string; type: string }>(
          `SELECT key, value, type FROM properties WHERE file_id = ?`,
          [fileId]
        );
        const oldPropSig = oldPropRows.map((r) => `${r.key}\t${r.type ?? "string"}\t${r.value}`).sort().join("\n");
        // In the !lookups branch existingFileState comes from the extended
        // queryOne (has title/mode); the bulk union type does not, hence the cast.
        const efs = existingFileState as { title?: string | null; mode?: string | null } | null;
        let changed =
          !efs ||
          (efs.title ?? null) !== title ||
          (efs.mode ?? null) !== mode ||
          oldTagSig !== newTagSig ||
          oldPropSig !== newPropSig;
        if (!changed) {
          // Multiset compare (duplicates kept — backlinks count them) of the
          // full insert tuple, read BEFORE the cascading DELETE below.
          const linkSig = (target: unknown, raw: unknown, type: unknown, anchor: unknown, propKey: unknown) =>
            [target, raw, type, anchor, propKey].map((v) => String(v ?? "")).join("\t");
          const newLinkSig = linkRows.map((r) => linkSig(r[1], r[2], r[3], r[4], r[5])).sort().join("\n");
          const oldLinkRows = await this.dbAdapter.query<{
            target_path: string; target_raw: string; link_type: string; anchor: string | null; property_key: string | null;
          }>(
            `SELECT target_path, target_raw, link_type, anchor, property_key FROM links WHERE source_id = ?`,
            [fileId]
          );
          const oldLinkSig = oldLinkRows
            .map((r) => linkSig(r.target_path, r.target_raw, r.link_type, r.anchor, r.property_key))
            .sort()
            .join("\n");
          changed = oldLinkSig !== newLinkSig;
        }
        pass.metadataChanged = changed;
      }

      // Delete existing data for this file. The `OR path = ?` is not redundant:
      // `id` is sha256(path), but a row can carry an id derived from a DIFFERENT
      // path — `SyncQueue.queueRename` rewrites `path` in place and leaves `id`
      // alone (it must: `id` is the cascade parent of links/tags/properties).
      // Without this clause the DELETE misses that row and the INSERT below
      // collides on the UNIQUE path, which rolls back the whole atomic batch and
      // leaves the index permanently poisoned (issue #34).
      await writer.execute(`DELETE FROM files WHERE id = ? OR path = ?`, [fileId, fileInfo.path]);
      await writer.execute(`DELETE FROM fts_notes WHERE path = ?`, [fileInfo.path]);

      // Insert into files
      await writer.execute(
        `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [fileId, fileInfo.path, title, sha256, fileInfo.mtime, ctime, fileInfo.size, mode, indexedSyncState]
      );

      // Insert into fts_notes — with the character-pair form of text written
      // without spaces (empty for other scripts), see spacelessText.ts.
      await writer.execute(
        `INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, ?, ?)`,
        [content, title, fileInfo.path, segmentedIndexText(content), segmentedIndexText(String(title ?? ""))]
      );

      // Update sync state ONLY if this is a newly discovered file (an orphaned
      // row counts as none, see judgeSyncState). We must not overwrite
      // local_sha256 for existing files during index, as it would destroy the
      // knowledge of the "base text" for 3-way merges. A base the sync
      // recorded is never ours to write: only the local marker is renewed.
      if (isNewLocalFile) {
        if (keepsSyncedBase) await this.syncRepo.updateLocalHash(fileInfo.path, sha256, writer);
        else await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, content, writer);
      }

      // Insert links (rows built above): ONE multi-row batch — inserting row
      // by row was 10-30 additional IPC round-trips per file (P2.4).
      await this.executeBatch(
        `INSERT INTO links (source_id, target_path, target_raw, link_type, anchor, property_key, line_number) VALUES `,
        `(?, ?, ?, ?, ?, ?, ?)`,
        linkRows,
        writer
      );

      // Insert tags
      await this.executeBatch(
        `INSERT OR IGNORE INTO tags (file_id, tag) VALUES `,
        `(?, ?)`,
        tags.map((tag) => [fileId, tag.name]),
        writer
      );

      // Insert properties
      if (fmResult.success && fmResult.data) {
        const propRows: unknown[][] = [];
        for (const [key, value] of Object.entries(fmResult.data)) {
          const encoded = encodeIndexedProperty(value);
          propRows.push([fileId, key, encoded.value, encoded.type]);
        }
        await this.executeBatch(
          `INSERT INTO properties (file_id, key, value, type) VALUES `,
          `(?, ?, ?, ?)`,
          propRows,
          writer
        );
      }
    } catch (e) {
      console.warn(`Failed to parse and index ${fileInfo.path}:`, e);
      await writer.execute(
        `INSERT OR REPLACE INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'obsidian', ?)`,
        [fileId, fileInfo.path, fileInfo.name, sha256, fileInfo.mtime, ctime, fileInfo.size, indexedSyncState]
      );
      if (!oldSyncState) {
        await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, content, writer);
      }
    }

    // What was indexed for a note in another encoding is a READING of it, not
    // the note. Where this pass just recorded that reading as the merge base —
    // or found one in a row an earlier file left under this name — the base
    // text goes: such a note has the hash of its bytes and nothing to merge
    // against (`mergeableText`).
    if (!read.exact && (isNewLocalFile || !oldSyncState)) {
      await this.syncRepo.clearBaseText(fileInfo.path, writer);
    }

    // A brand-new local file is indexed (and visible) but was never enqueued for sync.
    // Buffer it; the host is notified after the transaction commits (see flush below).
    if (isNewLocalFile) {
      pass.newLocalFiles.push(fileInfo.path);
    }
  }

  /**
   * Lightweight indexing for non-markdown attachments (images, PDFs, …). Registers them
   * in the `files` table (mode='attachment') with a byte hash so they show in the tree,
   * get change-detected and — via the new/external callbacks — enqueued for sync. No
   * FTS/links/tags/properties parsing and no base_text (binary has no 3-way merge).
   */
  private async _indexAttachmentInternal(
    fileInfo: VaultFileInfo,
    pass: IndexPass,
    lookups?: BulkIndexLookups,
    writer: SqlWriter = this.dbAdapter,
    reading?: FileReading
  ): Promise<void> {
    // Text-like non-.md files (e.g. `.base`, `.canvas`) must be hashed the SAME way the
    // conflict-aware adapter and sync worker hash them, and need a base_text for 3-way
    // merges. Hashing them as raw bytes here, next to a write path that hashed the text
    // it had read, once produced a permanent hash mismatch, which made every save of a
    // `.base` file create a spurious .CONFLICT. The two agree for UTF-8 text — the hash
    // of the text IS the hash of the bytes — and `readLocalText` gives that one hash.
    // A file that is text by its name and not by its bytes (a `.csv` in Windows-1252,
    // a `.txt` in UTF-16) has the hash of its bytes and no base_text, like the truly
    // binary files (images, PDFs, …).
    const textLike = isTextFile(fileInfo.path);
    const { sha256, textContent } = await this.attachmentContent(fileInfo, textLike, reading);

    const existingFileState = lookups
      ? lookups.fileStateByPath.get(fileInfo.path) ?? null
      : // The row at this PATH, exactly as for a note (issue 113): a file
        // moved or renamed in the app keeps the id of its old path. Asked by
        // id alone, a database or a table that had just been moved read as
        // unknown to the index — its sync row (which travels with the move)
        // as orphaned, the file as brand-new: announced for an upload nobody
        // needed, its creation time reset, and its merge base replaced by
        // the current text (finding 2026-10-09; the fix for notes had left
        // this route behind).
        await this.dbAdapter.queryOne<{ sync_state: string | null; ctime?: number | null }>(
          `SELECT sync_state, ctime FROM files WHERE path = ? COLLATE BINARY`,
          [fileInfo.path]
        );
    const hasPendingQueueOp = lookups
      ? lookups.queuedPaths.has(fileInfo.path)
      : !!(await this.dbAdapter.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? OR new_path = ? LIMIT 1`,
          [fileInfo.path, fileInfo.path]
        ));
    const indexedSyncState = hasPendingQueueOp
      ? "local_ahead"
      : existingFileState?.sync_state || "synced";
    // Creation time must stay STABLE across re-indexing: the stored value wins
    // so a mere save never changes the ctime sort key (the pinboard orders
    // un-arranged cards by ctime — a jumping ctime made it behave like mtime,
    // esp. on cloud-synced/network folders where FS birthtime is unreliable).
    // The adapter's birthtime seeds it on FIRST index, else the file's mtime as
    // a first-seen lower bound (graph time axis, format v3).
    const ctime = existingFileState?.ctime ?? fileInfo.ctime ?? fileInfo.mtime;

    const oldSyncState = lookups
      ? lookups.syncStateByPath.get(fileInfo.path) ?? null
      : await this.syncRepo.getSyncState(fileInfo.path);
    const knownToIndex = existingFileState !== null;
    const markerNamesThisFile = textContent !== null && await isMarkerTakenWithoutMark({ text: textContent, sha256 }, oldSyncState);
    const { isNewLocalFile, keepsSyncedBase } = this.judgeSyncState(fileInfo.path, sha256, oldSyncState, knownToIndex, pass, markerNamesThisFile);
    this.touch(fileInfo.path);
    // The id the row is written under (rowIdFor), asked after the lookups above.
    const fileId = await this.rowIdFor(fileInfo.path, lookups);
    // What `indexFile` hands back: nothing a view draws from changes for a
    // file the index already held. Only the single-file route is asked.
    if (!lookups) pass.metadataChanged = existingFileState === null;

    // `OR path = ?` for the same reason as in _indexFileInternal: a renamed row
    // keeps its old id, so deleting by id alone would leave it and the INSERT
    // would collide on the UNIQUE path (issue #34).
    await writer.execute(`DELETE FROM files WHERE id = ? OR path = ?`, [fileId, fileInfo.path]);
    await writer.execute(
      `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [fileId, fileInfo.path, fileInfo.name, sha256, fileInfo.mtime, ctime, fileInfo.size, "attachment", indexedSyncState]
    );

    if (isNewLocalFile) {
      if (textLike && textContent !== null && !keepsSyncedBase) {
        // Text-like file: store a base_text so it is mergeable, matching the write path.
        await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, textContent, writer);
      } else {
        // Hash only — true binary files have no base_text, and a text file the
        // sync knows keeps the base the sync recorded (see judgeSyncState).
        await this.syncRepo.updateLocalHash(fileInfo.path, sha256, writer);
      }
      pass.newLocalFiles.push(fileInfo.path);
    }

    // Text by its name and not by its bytes: no base_text either — not even
    // the one an earlier file under this name left in its row.
    if (isNewLocalFile && textLike && textContent === null) {
      await this.syncRepo.clearBaseText(fileInfo.path, writer);
    }
  }

  /**
   * Watcher-driven single-path refresh (P2.5): index, refresh or de-index
   * exactly ONE path instead of running a full-vault scan per event batch (the
   * former behavior — a recursive IPC listing of the whole vault after every
   * save echo). Returns "needs-full-scan" for directories (renames/creates of
   * folders change many paths at once; the caller falls back to the full scan).
   */
  async indexPath(path: string): Promise<"indexed" | "removed" | "unchanged" | "needs-full-scan"> {
    const outcome = await this.inspectPath(path);
    return outcome === "directory" || outcome === "folder-gone" ? "needs-full-scan" : outcome;
  }

  /**
   * `indexPath`, but saying WHICH folder case it met instead of folding both
   * into "needs-full-scan" (issue #122). The two are not the same thing:
   *  - `directory` — the path is a folder that exists. Whether that needs a
   *    full scan depends on what happened to it: created, renamed or moved in,
   *    many paths changed at once; merely reported as modified — which Windows
   *    does for the parent of every file written, the app's own saves
   *    included — nothing below it moved, and a flat look at the folder is
   *    enough. Only the caller knows the event, so it decides.
   *  - `folder-gone` — nothing is on disk, but indexed files still live under
   *    the path: a folder deleted or moved away outside Plainva. That always
   *    needs the full scan, which purges the rows and reports every deletion
   *    to the sync layer.
   */
  async inspectPath(path: string): Promise<"indexed" | "removed" | "unchanged" | "directory" | "folder-gone"> {
    if (isInternalPath(path)) return "unchanged";
    return this.inPass((pass) => this.inspectPathIn(path, pass));
  }

  private async inspectPathIn(path: string, pass: IndexPass): Promise<"indexed" | "removed" | "unchanged" | "directory" | "folder-gone"> {
    // A look that fails throws (`lookAt`): nothing is known about the path,
    // its row stays and nobody is told. The caller sees a pass that could not
    // be made, as for any other failure in here; the two that follow files
    // on their own — the desktop's watcher queue, the phone's door — come again.
    const info = await this.lookAt(path);

    if (!info) {
      // Gone from disk. Asked and answered in ONE transaction of this pass's
      // own, and reported once that is through (finding 2026-10-12). On a
      // database with a single connection — the phone's — a statement outside
      // a transaction rides in whichever one is open. There the row's removal
      // was reported, the sync worker's "that deletion was mine" spent — and
      // the row back in the index when that transaction (a full scan's) was
      // rolled back, for the next scan to report to a register that had
      // answered already. And the question itself could be answered wrongly:
      // a scan's own removal of the row, not committed yet, read as "nothing
      // here", and nobody came back when that scan failed. A second
      // transaction waits for the first in both shells (the phone's since
      // 2026-10-12, when its adapter stopped passing the plugin's refusal on),
      // so this pass waits its turn.
      // The row that goes, for whoever asks whose deletion this was.
      let gone: IndexedRowStamp | undefined;
      const outcome = await this.dbAdapter.transaction(async (): Promise<"reported" | "removed" | "unchanged" | "folder-gone"> => {
        // Only fire the deletion flow if it was actually indexed.
        const known = await this.dbAdapter.queryOne<{ mtime_local: number | null }>(
          `SELECT mtime_local FROM files WHERE path = ?`,
          [path]
        );
        if (known && (await this.isVanishedAppleDouble(path))) {
          // An AppleDouble sidecar an older version indexed: the header can no
          // longer be read, so the path-only rule decides (systemJunk.ts). It
          // leaves the index without a word to the sync layer — the copy in the
          // cloud stays where it is (E10).
          await this.deleteIndexRows([path]);
          return "removed";
        }
        if (!known) {
          // No exact row: this may have been a FOLDER — folders never get files rows,
          // only their contained files do. If any indexed file still lives under the
          // vanished path, the folder was deleted externally: hand off to the full
          // scan, which purges the stale child rows and fires onLocalFileDeleted for
          // each (so remote deletes propagate). The trailing "/" keeps a deleted FILE
          // named "a" from matching a sibling "a.md" or a folder "ab/".
          const child = await this.dbAdapter.queryOne<{ id: string }>(
            `SELECT id FROM files WHERE path LIKE ? ESCAPE '\\' LIMIT 1`,
            [escapeLikePrefix(path) + "/%"]
          );
          return child ? "folder-gone" : "unchanged";
        }
        // Somebody indexed the path, or reported it, since this pass began: not this pass's any more.
        if (this.stillMine([path], pass).length === 0) return "unchanged";
        // The look at the disk may be seconds old by now — where a second
        // transaction waits, this pass stood behind a full scan. A file that
        // is back is left alone; its own event, or the next pass, indexes it.
        // And only a file that is PROVEN gone leaves: a look that fails now
        // throws, and "not found" proves nothing in a vault whose own folder
        // is away. That folder is asked before AND after the look: a share
        // that comes back or drops once in between answers one of the two
        // (one that drops and returns between the two questions does not).
        if (!(await this.vaultIsThere()) || (await this.lookAt(path)) || !(await this.vaultIsThere())) return "unchanged";
        await this.deleteIndexRows([path]);
        gone = indexedRowStamp(known.mtime_local);
        return "reported";
      });
      if (outcome !== "reported") return outcome;
      this.reportRemoved([path], pass.since, () => gone);
      return "removed";
    }
    if (info.isDirectory) return "directory";

    if (await this.isAppleDoubleOnDisk(info)) {
      // macOS metadata, not a note (E10). A row an older version wrote goes,
      // silently: nothing was deleted, the file only stopped counting.
      const had = await this.dbAdapter.queryOne<{ id: string }>(`SELECT id FROM files WHERE path = ?`, [path]);
      if (!had) return "unchanged";
      await this.deleteIndexRows([path]);
      return "removed";
    }

    // The file is there. Whoever read the index before this moment and misses
    // the file in an older listing does not report it gone, and where it has
    // not decided yet it leaves the row too (stillMine) — also when this pass
    // does not get to write.
    this.touch(path);

    // Same mtime as indexed -> the event is an echo (our own save already
    // re-indexed the file, or a no-op touch): skip the re-parse.
    const knownRow = await this.dbAdapter.queryOne<{ mtime_local: number }>(
      `SELECT mtime_local FROM files WHERE path = ?`,
      [path]
    );
    if (knownRow && Number(knownRow.mtime_local) === info.mtime) return "unchanged";

    await this.dbAdapter.transaction(async () => {
      if (info!.name.endsWith(".md")) {
        await this._indexFileInternal(info!, pass);
      } else if (!isInternalPath(info!.path)) {
        await this._indexAttachmentInternal(info!, pass);
      }
    });
    this.flushCallbacks(pass);
    return "indexed";
  }

  /**
   * One look at a path: the file or folder that is there, or null when the
   * adapter says nothing is there. A look that failed throws what the adapter
   * threw (finding 2026-10-13).
   *
   * Every failure used to count as "missing". The row left the index, the host
   * was told the file had been deleted and queued its deletion on the remote:
   * a file that was locked for a moment, sat on a share that had dropped or
   * behind a provider that did not answer was deleted on every other device.
   *
   * Absent is what the adapter SAYS is absent — its not-found error, or,
   * where the metadata call failed with something else, its existence check
   * (the desktop adapter asks "is it there" and then reads the metadata; a
   * file removed between the two fails with the platform's own message, and
   * that deletion must not stay in the index for good). Where the existence
   * check fails as well, or says the path is there, the answer is open, and
   * the pass fails with the metadata call's error: the desktop's watcher
   * queue and the phone's `pathReindex` try such a path again and then leave
   * it to the full scan; a caller that indexes a path it just wrote sees the
   * error, as it does when the file cannot be read.
   */
  private async lookAt(path: string): Promise<VaultFileInfo | null> {
    try {
      return await this.vaultAdapter.getFileInfo(path);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "FILE_NOT_FOUND") return null;
      const there = await this.vaultAdapter.exists(path).catch(() => true);
      if (there) throw error;
      return null;
    }
  }

  /** Reads a file the way its kind is indexed: as text where its name says so, else as bytes. */
  private async readForIndex(fileInfo: VaultFileInfo): Promise<FileReading> {
    if (fileInfo.name.endsWith(".md") || isTextFile(fileInfo.path)) {
      return { kind: "text", read: await readLocalText(this.vaultAdapter, fileInfo.path) };
    }
    return { kind: "bytes", sha256: await sha256Bytes(await this.vaultAdapter.readBinaryFile(fileInfo.path)) };
  }

  /** What an attachment is indexed with: the hash of its bytes, and its text where it is one. */
  private async attachmentContent(
    fileInfo: VaultFileInfo,
    textLike: boolean,
    reading?: FileReading,
  ): Promise<{ sha256: string; textContent: string | null }> {
    const read = reading ?? (await this.readForIndex(fileInfo));
    if (read.kind === "bytes") return { sha256: read.sha256, textContent: null };
    return { sha256: read.read.sha256, textContent: textLike && read.read.exact ? read.read.text : null };
  }

  /**
   * Reads one file for a pass over many — the full scan, a folder re-read —
   * or leaves it out of that pass (issue #125).
   *
   * Such a pass used to end at the first file whose read failed, and with it
   * everything it had found. On an iPhone one link in an iCloud vault that
   * pointed at a folder on the user's Mac did that to every scan: the folder
   * plugin listed the link as a file, its read failed, and the first scan of
   * the vault never completed — the phone ran the vault without an index.
   *
   * A file that is there and cannot be read is now named in `unreadable` and
   * left out; whatever the index held for it stays as it was, and the next
   * pass tries again. A file whose read fails because it is not there any
   * more — gone between the listing and the read, which the adapter's own
   * existence check confirms — is left out without a word: the next pass sees
   * it missing and says so then. Answers nobody can give count as "there".
   * A single path is one question and keeps its answer: a read that fails
   * fails it, and its caller comes again.
   */
  private async readOrLeaveOut(fileInfo: VaultFileInfo, unreadable: VaultWalkSkip[]): Promise<FileReading | null> {
    try {
      return await this.readForIndex(fileInfo);
    } catch (error) {
      const missing = (error as { code?: unknown } | null)?.code === "FILE_NOT_FOUND";
      if (missing && !(await this.vaultAdapter.exists(fileInfo.path).catch(() => true))) return null;
      unreadable.push({ path: fileInfo.path, reason: "unreadable" });
      return null;
    }
  }

  /**
   * Whether the vault's own folder is there (`exists("")`), asked before a
   * path's absence is taken for a deletion.
   *
   * Where it is not — a network drive that dropped, a removable disk, a picked
   * folder whose provider is away — every path in it honestly answers "not
   * found", and none of that is a deletion. Unknown counts as away. The full
   * scan needs no such question: it judges from a listing of that folder,
   * which fails or reports the folder unreadable.
   *
   * This knows the vault's own folder and nothing below it: a folder mounted
   * or linked INTO the vault whose target dropped, or a vault that is a mount
   * point left behind empty, still answers "not found" in a folder that is
   * there. Nothing here can tell that from a deletion.
   */
  private vaultIsThere(): Promise<boolean> {
    return this.vaultAdapter.exists("").catch(() => false);
  }

  /**
   * De-indexes one path (files row cascades to links/tags/properties, plus FTS)
   * and tells the host: the door for a file the app itself removed. It always
   * reports — the caller knows the file went, row or no row. A pass that FINDS
   * a file gone is `inspectPathIn`, which asks first whether the path is still
   * its to judge.
   */
  async removePathFromIndex(path: string): Promise<void> {
    // Keyed on the PATH, not on sha256(path). `path` is UNIQUE, so this hits
    // exactly the row being de-indexed — including one whose id went stale when
    // its folder was renamed (issue #34, which hardened only the insert side:
    // a delete keyed on the id matched nothing and orphaned the row, leaving a
    // file that is gone from disk in the tree and in search). Deleting by id
    // also reached too far in the other direction: after a rename, sha256 of the
    // OLD path is the id a row now sitting at the NEW path still carries, so
    // de-indexing the old path deleted a note that exists.
    await this.deleteIndexRows([path]);
    // Same contract as the full scan: sync_state stays (the remote delete must
    // be pushed first); the host reacts via onLocalFileDeleted. Measured from
    // now: the caller knows the file went, whatever a pass under way has read.
    this.reportRemoved([path], this.touchClock);
  }

  /**
   * Follows a move or rename the app made itself (issue 113): the index rows
   * of `from` — and, for a folder, of everything under it — now describe
   * `to`. Nothing is reported to the sync layer: the rename already queued
   * its MOVE, and treating the old path as vanished (removePathFromIndex)
   * queued a DELETE for it besides. Idempotent: rows a queued rename already
   * re-keyed (SyncQueue.queueRename moves `files`, not the search index) are
   * left where they are. A row that happens to sit at a destination path is
   * the stale record of an earlier file there and gives way. The caller
   * re-indexes the destination afterwards (indexPath or the full scan), which
   * finds the row by its path and treats it as the known file it is.
   *
   * Both ends of every row's way count as touched (`stillMine`): a pass that
   * read the index before the move leaves the row at the destination alone,
   * and does not report the source gone — the file is not gone, it moved
   * (finding 2026-10-12). For the rows a queued rename has brought over
   * already, the source is counted back from where they are.
   */
  async relocatePathInIndex(from: string, to: string): Promise<void> {
    if (!from || !to || from === to) return;
    const fromPrefix = from + "/";
    const toPrefix = to + "/";
    const move = (p: string): string => (p === from ? to : to + p.substring(from.length));
    const back = (p: string): string => (p === to ? from : from + p.substring(to.length));
    await this.dbAdapter.transaction(async () => {
      // Literal, case-sensitive prefix match — the same rule as queueRename.
      const rows = await this.dbAdapter.query<{ path: string }>(
        `SELECT path FROM files WHERE path = ? COLLATE BINARY OR substr(path, 1, length(?)) = ? COLLATE BINARY`,
        [from, fromPrefix, fromPrefix]
      );
      const moving = new Set(rows.map((r) => r.path));
      const stale = rows.map((r) => move(r.path)).filter((p) => !moving.has(p));
      if (stale.length > 0) await this.deleteIndexRows(stale);
      for (const { path } of rows) {
        await this.dbAdapter.execute(`UPDATE files SET path = ?, mtime_local = 0 WHERE path = ?`, [move(path), path]);
      }
      // Asked only while a pass is under way: nobody else holds an older reading.
      if (this.openPasses > 0) {
        const arrived = await this.dbAdapter.query<{ path: string }>(
          `SELECT path FROM files WHERE path = ? COLLATE BINARY OR substr(path, 1, length(?)) = ? COLLATE BINARY`,
          [to, toPrefix, toPrefix]
        );
        for (const { path } of arrived) {
          this.touch(back(path));
          this.touch(path);
        }
      }
      const ftsRows = await this.dbAdapter.query<{ path: string }>(
        `SELECT path FROM fts_notes WHERE path = ? OR substr(path, 1, length(?)) = ?`,
        [from, fromPrefix, fromPrefix]
      );
      for (const { path } of ftsRows) {
        await this.dbAdapter.execute(`DELETE FROM fts_notes WHERE path = ?`, [move(path)]);
        await this.dbAdapter.execute(`UPDATE fts_notes SET path = ? WHERE path = ?`, [move(path), path]);
      }
    });
  }

  /**
   * Removes index rows by PATH (never by id — see removePathFromIndex) without
   * telling the sync layer anything. Callers decide whether the removal is a
   * deletion the remote must learn about; this only forgets.
   */
  private async deleteIndexRows(paths: string[], writer: SqlWriter = this.dbAdapter): Promise<void> {
    const CHUNK = 400;
    for (let k = 0; k < paths.length; k += CHUNK) {
      const slice = paths.slice(k, k + CHUNK);
      const marks = slice.map(() => "?").join(", ");
      // Cascades to links, tags, properties.
      await writer.execute(`DELETE FROM files WHERE path IN (${marks})`, slice);
      await writer.execute(`DELETE FROM fts_notes WHERE path IN (${marks})`, slice);
    }
  }

  /**
   * Header verdicts per path, valid while mtime and size stand still. A share
   * where macOS left a sidecar beside every note would otherwise cost one read
   * per sidecar on every full scan — and the focus refresh runs one every 30 s.
   */
  private readonly appleDoubleVerdicts = new Map<string, { mtime: number; size: number; junk: boolean }>();

  /** An existing file whose name has the AppleDouble shape AND whose bytes carry the header. */
  private async isAppleDoubleOnDisk(info: VaultFileInfo): Promise<boolean> {
    if (info.isDirectory || !isAppleDoubleName(info.name)) return false;
    const cached = this.appleDoubleVerdicts.get(info.path);
    if (cached && cached.mtime === info.mtime && cached.size === info.size) return cached.junk;
    let junk: boolean;
    try {
      junk = hasAppleDoubleHeader(await this.vaultAdapter.readBinaryFile(info.path));
    } catch {
      // Unreadable is not evidence: the file keeps counting as the user's.
      return false;
    }
    this.appleDoubleVerdicts.set(info.path, { mtime: info.mtime, size: info.size, junk });
    return junk;
  }

  /**
   * A VANISHED AppleDouble-shaped path, where the header can no longer be
   * read: junk when its companion (`._x` → `x`) is known to the index or still
   * on disk — exactly when macOS writes one (systemJunk.ts, path-only rule).
   */
  private async isVanishedAppleDouble(path: string, known?: (p: string) => boolean): Promise<boolean> {
    const slash = path.lastIndexOf("/");
    if (!isAppleDoubleName(path.slice(slash + 1))) return false;
    const companion = `${path.slice(0, slash + 1)}${path.slice(slash + 3)}`;
    if (known) return isAppleDoubleCompanion(path, known);
    const row = await this.dbAdapter.queryOne<{ id: string }>(`SELECT id FROM files WHERE path = ?`, [companion]);
    if (row) return true;
    return this.vaultAdapter.exists(companion).catch(() => false);
  }

  /**
   * Reconciles ONE folder against the disk (issue #110, E8): new and changed
   * files are indexed, and — unlike walking the folder and calling indexPath
   * per entry, which only ever sees what IS there — rows whose file vanished
   * leave the index. Serves the folder refresh (desktop), the watcher's parent
   * check after a rename or removal, and the pull-to-refresh (phone).
   *
   * `recursive: false` looks at the folder's own files, plus the rows under
   * any subfolder that is no longer on disk (a folder moved away outside
   * Plainva); subfolders that still exist are left to their own events.
   *
   * The same safety rules as the full scan hold: an entry the walk could not
   * read protects everything under it, an excluded path (internal, OS junk,
   * AppleDouble) is forgotten without being reported, and only a genuinely
   * vanished file reaches `onLocalFileDeleted`. A folder that is itself gone
   * counts as empty only when the adapter says so (`exists` is false) and the
   * vault's own folder is there (`vaultIsThere`).
   */
  async reconcileFolder(folder: string, opts: { recursive?: boolean } = {}): Promise<FolderReconcileReport> {
    return this.inPass((pass) => this.reconcileFolderIn(folder, opts, pass));
  }

  private async reconcileFolderIn(folder: string, opts: { recursive?: boolean }, pass: IndexPass): Promise<FolderReconcileReport> {
    const recursive = opts.recursive ?? true;
    const root = trimChars(folder.replace(/\\/g, "/"), "/");
    const report: FolderReconcileReport = { indexed: [], removed: [], skipped: [], foldersRemoved: false, foldersChanged: false };
    if (root && isInternalPath(root)) return report;

    let listing: VaultListing;
    try {
      listing = this.vaultAdapter.listDirReport
        ? await this.vaultAdapter.listDirReport(root, recursive)
        : { files: await this.vaultAdapter.listDir(root, recursive), skipped: [] };
    } catch {
      listing = { files: [], skipped: [{ path: root, reason: "unreadable" }] };
    }
    let skipped = listing.skipped;
    // The folder itself could not be listed. Proven absent → it is empty (its
    // rows go); anything else → nothing here can be judged.
    if (skipped.some((s) => s.path === root || (!s.path && !root))) {
      const gone = root !== "" && (await this.vaultAdapter.exists(root).then((e) => !e, () => false)) && (await this.vaultIsThere());
      if (!gone) {
        report.skipped = skipped;
        return report;
      }
      listing = { files: [], skipped: [] };
      skipped = [];
      // The folder itself is gone, and so is its place in the folder list.
      if (this.lastScanFolders?.delete(root)) report.foldersChanged = true;
    }
    report.skipped = skipped;

    const inFolder = root ? `${root}/` : "";
    const diskDirs = new Set(listing.files.filter((f) => f.isDirectory).map((f) => f.path));
    if (this.syncScanFolders(inFolder, recursive, diskDirs, skipped)) report.foldersChanged = true;
    const diskFiles = listing.files.filter((f) => !f.isDirectory && !isInternalPath(f.path));
    const appleDouble = new Set<string>();
    for (const f of diskFiles) {
      if (await this.isAppleDoubleOnDisk(f)) appleDouble.add(f.path);
    }
    const onDisk = new Map(diskFiles.filter((f) => !appleDouble.has(f.path)).map((f) => [f.path, f]));

    // The rows this pass answers for. Prefix matching is literal and
    // case-sensitive (substr … COLLATE BINARY, as SyncQueue does): LIKE folds
    // ASCII case, and on a case-sensitive disk "Notes" and "notes" are two
    // folders — a sibling's rows must never look vanished here.
    const underRoot = (extra = "") => root
      ? { where: `substr(path, 1, length(?)) = ? COLLATE BINARY${extra}`, params: [inFolder, inFolder] as unknown[] }
      : { where: `1 = 1${extra}`, params: [] as unknown[] };
    const scoped = new Map<string, number>();
    if (recursive) {
      const q = underRoot();
      for (const r of await this.dbAdapter.query<{ path: string; mtime_local: number }>(
        `SELECT path, mtime_local FROM files WHERE ${q.where}`, q.params)) scoped.set(r.path, Number(r.mtime_local));
    } else {
      // Own files: nothing after the folder's slash contains another slash.
      const own = underRoot(` AND instr(substr(path, length(?) + 1), '/') = 0`);
      for (const r of await this.dbAdapter.query<{ path: string; mtime_local: number }>(
        `SELECT path, mtime_local FROM files WHERE ${own.where}`, [...own.params, inFolder])) scoped.set(r.path, Number(r.mtime_local));
      // Subfolders the index knows, by their first segment below the folder.
      const deep = underRoot(` AND instr(substr(path, length(?) + 1), '/') > 0`);
      const segments = await this.dbAdapter.query<{ seg: string }>(
        `SELECT DISTINCT substr(substr(path, length(?) + 1), 1, instr(substr(path, length(?) + 1), '/') - 1) AS seg
           FROM files WHERE ${deep.where}`,
        [inFolder, inFolder, ...deep.params, inFolder]
      );
      for (const { seg } of segments) {
        const sub = `${inFolder}${seg}`;
        if (!seg || diskDirs.has(sub) || isInternalPath(sub)) continue;
        if (skipped.some((s) => !s.path || s.path === sub || sub.startsWith(`${s.path}/`))) continue;
        const prefix = `${sub}/`;
        for (const r of await this.dbAdapter.query<{ path: string; mtime_local: number }>(
          `SELECT path, mtime_local FROM files WHERE substr(path, 1, length(?)) = ? COLLATE BINARY`, [prefix, prefix]))
          scoped.set(r.path, Number(r.mtime_local));
        report.foldersRemoved = true;
      }
    }

    const vanished: string[] = [];
    const silent: string[] = [];
    for (const [path, indexedAt] of scoped) {
      if (onDisk.has(path)) continue;
      if (skipped.some((s) => !s.path || s.path === path || path.startsWith(`${s.path}/`))) continue;
      // A row the app moved here and no pass has read since — a move leaves
      // the timestamp at 0 for exactly that — can be younger than the listing
      // above: this pass lists the disk first and reads the index after. Such
      // files were taken for vanished, removed from the index and reported
      // gone under their NEW path while they lay there (finding 2026-10-12).
      // The file itself is asked for; an answer that fails proves nothing.
      if (indexedAt === 0 && (await this.vaultAdapter.exists(path).catch(() => true))) continue;
      const excluded = isInternalPath(path) || appleDouble.has(path)
        || (await this.isVanishedAppleDouble(path, (p) => scoped.has(p) || onDisk.has(p)));
      (excluded ? silent : vanished).push(path);
    }
    const toIndex = [...onDisk.values()].filter((f) => scoped.get(f.path) !== f.mtime);

    if (vanished.length === 0 && silent.length === 0 && toIndex.length === 0) return report;
    // The files this re-read indexed, and the ones that are there and could not be read (readOrLeaveOut).
    const indexed: string[] = [];
    const unreadable: VaultWalkSkip[] = [];
    const mine = await this.dbAdapter.transaction(async () => {
      // Asked as late as it can be: what another pass indexed or reported
      // since this one began is not this one's to remove (stillMine).
      const mine = new Set(this.stillMine([...vanished, ...silent], pass));
      for (const f of toIndex) {
        const reading = await this.readOrLeaveOut(f, unreadable);
        if (!reading) continue;
        if (f.name.endsWith(".md")) await this._indexFileInternal(f, pass, undefined, undefined, reading);
        else await this._indexAttachmentInternal(f, pass, undefined, undefined, reading);
        indexed.push(f.path);
      }
      // The rows of what went leave last, as in the full scan: a re-read that
      // fails on a file has not removed what it never gets to report.
      await this.deleteIndexRows([...mine]);
      return mine;
    }).catch((error: unknown) => {
      // No batches here: whatever ran is in.
      this.announceWhatStays(pass, { news: pass.newLocalFiles.length, mods: pass.externalMods.length });
      throw error;
    });
    this.flushCallbacks(pass);
    this.reportRemoved(vanished.filter((path) => mine.has(path)), pass.since, (path) => indexedRowStamp(scoped.get(path)));
    report.indexed = indexed;
    report.removed = [...vanished, ...silent].filter((path) => mine.has(path));
    if (unreadable.length > 0) report.skipped = [...report.skipped, ...unreadable];
    return report;
  }

  /**
   * Brings the folder list of the last full scan up to date with what a
   * folder reconcile just saw below `inFolder` ("" for the root, else with a
   * trailing slash), and says whether it differed. Flat: the folder's direct
   * subfolders are compared, and a subfolder that is gone takes everything the
   * list held below it along. Recursive: every folder below is compared.
   * A folder under an entry the walk could not read is left as it is.
   */
  private syncScanFolders(inFolder: string, recursive: boolean, diskDirs: Set<string>, skipped: VaultWalkSkip[]): boolean {
    const known = this.lastScanFolders;
    if (!known) return false;
    const unjudged = (p: string) => skipped.some((s) => !s.path || s.path === p || p.startsWith(`${s.path}/`));
    let changed = false;
    const gone: string[] = [];
    for (const folder of known) {
      if (!folder.startsWith(inFolder) || diskDirs.has(folder) || unjudged(folder)) continue;
      const rest = folder.slice(inFolder.length);
      if (!rest) continue;
      if (recursive) {
        gone.push(folder);
        continue;
      }
      const slash = rest.indexOf("/");
      const child = slash < 0 ? folder : folder.slice(0, inFolder.length + slash);
      // Flat: a deeper folder goes only together with the direct subfolder it sits in.
      if (!diskDirs.has(child) && !unjudged(child)) gone.push(folder);
    }
    for (const folder of gone) {
      known.delete(folder);
      changed = true;
    }
    for (const folder of diskDirs) {
      if (isInternalPath(folder) || known.has(folder)) continue;
      known.add(folder);
      changed = true;
    }
    return changed;
  }

  /**
   * What a pass that FAILED still has to say (finding 2026-10-12).
   *
   * Where its transaction took everything back, nothing: it wrote nothing,
   * and the next pass finds every file as this one did. The desktop's database
   * keeps what a failed transaction wrote
   * (`IDatabaseAdapter.keepsWhatAFailedTransactionWrote`): the files this pass
   * had indexed stay indexed, the next pass finds them as it left them and
   * has nothing to say about them — a new file was not queued for upload
   * before the sweep of the next sync start, a change another program made
   * to a known file not at all. So what the pass found about the files it
   * wrote is said now. `written` is how far its finds had been handed to the
   * database when it failed; the rows of files that went are removed last by
   * every pass and are never part of it.
   */
  private announceWhatStays(pass: IndexPass, written: { news: number; mods: number }): void {
    if (!this.dbAdapter.keepsWhatAFailedTransactionWrote) return;
    pass.newLocalFiles.length = Math.min(pass.newLocalFiles.length, written.news);
    pass.externalMods.length = Math.min(pass.externalMods.length, written.mods);
    this.flushCallbacks(pass);
  }

  /** Fires the new-file and external-modification callbacks of one pass (post-transaction). */
  private flushCallbacks(pass: IndexPass): void {
    if (this.options?.onExternalModification) {
      for (const m of pass.externalMods) this.options.onExternalModification(m.path, m.oldHash, m.newHash);
    }
    if (this.options?.onNewLocalFile) {
      for (const path of pass.newLocalFiles) this.options.onNewLocalFile(path);
    }
    pass.externalMods = [];
    pass.newLocalFiles = [];
  }

  /**
   * Scans the entire vault and updates the database index.
   * Performance Optimized: Only processes modified or new files, removes deleted ones,
   * and wraps everything in a single bulk transaction.
   */
  private fullScan: Promise<IndexScanReport> | null = null;

  /**
   * The folders the previous full scan saw on disk; null before the first one.
   * What `IndexScanReport.foldersChanged` is measured against.
   */
  private lastScanFolders: Set<string> | null = null;

  /**
   * `trigger` names why the scan runs, for the diagnostics line (`onFullScan`):
   * a short token such as "open", "manual refresh" or "watcher: folder
   * created or renamed" — never a path. A caller that joins a scan already
   * under way gets that scan's report; its own trigger is not recorded.
   */
  indexVaultFull(trigger = "unspecified"): Promise<IndexScanReport> {
    if (this.fullScan) return this.fullScan;
    const run = this.inPass((pass) => this.indexVaultFullInternal(pass))
      .then((report) => {
        // Like a failure, not said for a vault that is being closed: a scan
        // past its last look at the signal still gets through, and its
        // notice — or the sweep it lifts — belongs to no open vault.
        if (this.options?.scanSignal?.aborted) return report;
        try {
          this.options?.onFullScan?.({ ...report, trigger });
        } catch (e) {
          console.warn("[VaultIndexer] onFullScan failed", e);
        }
        return report;
      }, (error: unknown) => {
        if (!this.options?.scanSignal?.aborted) {
          try {
            this.options?.onFullScanFailed?.({ trigger, error });
          } catch (e) {
            console.warn("[VaultIndexer] onFullScanFailed failed", e);
          }
        }
        throw error;
      })
      .finally(() => { if (this.fullScan === run) this.fullScan = null; });
    this.fullScan = run;
    return run;
  }

  /** The owner closes the shared database only after an already-started commit. */
  async whenIdle(): Promise<void> { await this.fullScan?.catch(() => {}); }

  /**
   * Whether a full scan has gone through on this index since it was empty
   * (issue 125). The number of rows cannot tell: on the desktop a first scan
   * that fails keeps the rows it had written, after any failed first scan
   * saves and the watcher write rows of their own, and the next start took
   * that index for a whole one — the files the failed scan never reached were
   * then announced as new before the first pull, which is what the deferral
   * of a cold index exists to prevent. A scan that went through counts even
   * where it left out a folder it could not read: an index owed a scan until
   * that folder can be read would hold the task notes of a vault with one
   * dead link back for good.
   */
  async indexComplete(): Promise<boolean> {
    return !(await this.indexOwed());
  }

  /** Whether the mark that this index is owed a full scan stands (read with `query`, not a write). */
  private async indexOwed(): Promise<boolean> {
    const rows = await this.dbAdapter.query<{ value?: string | null }>(`SELECT value FROM meta WHERE key = ?`, [INDEX_OWED_KEY]);
    return rows.some((row) => row.value === "1");
  }

  /**
   * "Rebuild the index" (Maintenance, the palette) — one way for both shells
   * (finding 2026-10-12).
   *
   * Every file is read again: the timestamp each row was last read at is
   * forgotten (a move in the app leaves 0 for the same purpose), so the full
   * scan that follows reads every file there is. What cannot be read again
   * stays — a row's creation time (the pinboard orders the cards nobody
   * arranged by it), its sync label, the merge base in its sync row — and a
   * file the sync knows is no new file to announce. A row whose file is gone
   * is removed and reported like in every scan. What belongs to no file goes:
   * search entries, links, tags and properties of rows that are gone.
   *
   * The phone used to run the ordinary scan, which reads only what changed
   * by its timestamp — a note changed under an unchanged timestamp, or
   * indexed wrongly, stayed as it was. The desktop dropped every row first:
   * every file came back as a new one, announced for an upload nobody
   * needed, its creation time and sync label lost, and a row whose file had
   * gone was forgotten without being reported.
   *
   * A scan under way has read the index already and is let finish first; the
   * scan this answers with begins after the reset.
   */
  async rebuildIndex(trigger = "index rebuild"): Promise<IndexScanReport> {
    await this.whenIdle();
    await this.dbAdapter.transaction(async () => {
      await this.dbAdapter.execute(`UPDATE files SET mtime_local = 0`);
      await this.dbAdapter.execute(`DELETE FROM fts_notes WHERE path NOT IN (SELECT path FROM files)`);
      await this.dbAdapter.execute(`DELETE FROM links WHERE source_id IS NULL OR source_id NOT IN (SELECT id FROM files)`);
      await this.dbAdapter.execute(`DELETE FROM tags WHERE file_id IS NULL OR file_id NOT IN (SELECT id FROM files)`);
      await this.dbAdapter.execute(`DELETE FROM properties WHERE file_id IS NULL OR file_id NOT IN (SELECT id FROM files)`);
    });
    // A scan that began before the reset read the old timestamps and would
    // read only what changed by them; the rebuild waits it out and runs its
    // own. One that begins after the reset reads everything.
    await this.whenIdle();
    return this.indexVaultFull(trigger);
  }

  private async indexVaultFullInternal(pass: IndexPass): Promise<IndexScanReport> {
    const signal = this.options?.scanSignal;
    signal?.throwIfAborted();
    const startedAt = Date.now();
    // The row each path has as the scan begins: its timestamp decides what is
    // read again, its rowid tells a row the app moves meanwhile (movedAway).
    const dbFiles = await this.dbAdapter.query<IndexedAtScanStart>(
      `SELECT rowid, path, mtime_local FROM files`
    );
    // An index is owed a full scan from the moment one begins on it empty
    // until one goes through (indexComplete). A scan that gets to write says
    // so with its first batch and takes it back with its last; one that does
    // not go through says so here at the latest.
    const startsEmpty = dbFiles.length === 0;
    try {
      return await this.scanFrom(pass, dbFiles, startsEmpty, startedAt);
    } catch (error) {
      // However far a first scan got — its walk, its lookups, a tail that was
      // its only batch —, the rows that saves and the watcher write after it
      // are no whole index, and the next start must not take them for one.
      // Not when it was called off: the vault is being closed.
      if (startsEmpty && !signal?.aborted) {
        await this.dbAdapter.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`, [INDEX_OWED_KEY])
          .catch((e: unknown) => console.warn("[VaultIndexer] could not note that the index is owed a full scan", e));
      }
      throw error;
    }
  }

  /** The full scan, against the rows the index held as it began (indexVaultFullInternal). */
  private async scanFrom(pass: IndexPass, dbFiles: readonly IndexedAtScanStart[], startsEmpty: boolean, startedAt: number): Promise<IndexScanReport> {
    const signal = this.options?.scanSignal;
    const dbFileMap = new Map(dbFiles.map(f => [f.path, f]));

    // Prefer the reporting walk so skipped entries (link cycles, unreadable
    // folders) reach the report instead of vanishing silently.
    let skipped: VaultWalkSkip[] = [];
    let diskFiles: VaultFileInfo[];
    if (this.vaultAdapter.listDirReport) {
      const listing = await this.vaultAdapter.listDirReport("", true, { signal });
      diskFiles = listing.files;
      skipped = listing.skipped;
    } else {
      diskFiles = await this.vaultAdapter.listDir("", true, { signal });
    }
    signal?.throwIfAborted();
    // The exclusion has to hold HERE, in the shared core, not only in an adapter:
    // only TauriVaultAdapter skips internal folders during the walk, so on mobile
    // (and any host whose adapter lists everything) a `node_modules/pkg/README.md`
    // used to reach the index — markdown was filtered nowhere, attachments were.
    // The adapter-side skip stays as what it is: an optimisation that avoids
    // descending into the folder at all.
    // Everything from here to the report is plain synchronous work over every
    // file of the vault. It shares its thread with the user's typing, so each
    // loop lets go once it has run for a frame's worth of time (issue #122).
    const pause = createYielder();
    const candidates: VaultFileInfo[] = [];
    // The folders on disk: the ones the walk listed, plus every folder a
    // listed file sits in (for an adapter whose listing names files only).
    const folders = new Set<string>();
    for (const f of diskFiles) {
      const p = pause();
      if (p) await p;
      if (isInternalPath(f.path)) continue;
      if (f.isDirectory) {
        folders.add(f.path);
        continue;
      }
      candidates.push(f);
      for (let cut = f.path.lastIndexOf("/"); cut > 0; cut = f.path.lastIndexOf("/", cut - 1)) {
        const parent = f.path.slice(0, cut);
        if (folders.has(parent)) break;
        folders.add(parent);
      }
    }
    // AppleDouble sidecars (`._Note.md` on SMB/exFAT, E10): the header decides,
    // read once per `._*` file — a user's own `._notes.md` stays a note. Only a
    // name of that shape is looked at; every other file costs nothing here.
    const appleDouble = new Set<string>();
    for (const f of candidates) {
      if (!isAppleDoubleName(f.name)) continue;
      if (await this.isAppleDoubleOnDisk(f)) appleDouble.add(f.path);
    }
    signal?.throwIfAborted();
    // Markdown and non-markdown attachments (images, PDFs, …) are both tracked
    // for sync, except internal/VCS data. Conflict copies ARE indexed (kept
    // visible); push targets skip them.
    const diskFilePaths = new Set<string>();
    const mdToIndex: VaultFileInfo[] = [];
    const attachmentsToIndex: VaultFileInfo[] = [];
    let addedCount = 0;
    for (const file of candidates) {
      const p = pause();
      if (p) await p;
      if (appleDouble.has(file.path)) continue;
      diskFilePaths.add(file.path);
      const dbMtime = dbFileMap.get(file.path)?.mtime_local;
      // `!==` instead of `>`: restoring an OLDER file version (Explorer copy,
      // backup restore, sync rollback) keeps the old mtime — a strictly-greater
      // check would never re-index it and the stale content would stick around.
      if (dbMtime !== undefined && file.mtime === dbMtime) continue;
      (file.name.endsWith(".md") ? mdToIndex : attachmentsToIndex).push(file);
    }
    const knownOrPresent = (p: string) => dbFileMap.has(p) || diskFilePaths.has(p);
    const filesToDelete: string[] = [];

    // Paths that are indexed but no longer on the disk listing. Two very
    // different reasons land here, and telling them apart is a data-safety
    // matter: a file the user deleted must be mirrored to the remote, while a
    // file that merely became INTERNAL (because a name was added to the
    // exclusion list — issue #70 brought `.venv` and `.rumdl_cache`) must not.
    // Reporting the latter as a deletion would queue thousands of remote
    // deletes for a venv and trip the mass-deletion guard on an existing vault.
    const vanishedFromDisk: string[] = [];
    for (const dbPath of dbFileMap.keys()) {
      const p = pause();
      if (p) await p;
      if (!diskFilePaths.has(dbPath)) {
        // An incomplete walk cannot prove a deletion. Keep the known index and
        // remote contents until this path's subtree can actually be inspected.
        if (skipped.some(entry => !entry.path || dbPath === entry.path || dbPath.startsWith(`${entry.path}/`))) continue;
        filesToDelete.push(dbPath);
        // An excluded path (internal, OS junk, an AppleDouble sidecar — present
        // or vanished beside its companion) is forgotten, never reported.
        if (isInternalPath(dbPath) || appleDouble.has(dbPath)) continue;
        if (await this.isVanishedAppleDouble(dbPath, knownOrPresent)) continue;
        vanishedFromDisk.push(dbPath);
      }
    }
    signal?.throwIfAborted();

    const previousFolders = this.lastScanFolders;
    let foldersChanged = previousFolders === null || previousFolders.size !== folders.size;
    if (!foldersChanged) {
      for (const folder of folders) {
        if (!previousFolders!.has(folder)) {
          foldersChanged = true;
          break;
        }
      }
    }

    // The files this scan indexed: the ones it read (readOrLeaveOut).
    let scannedCount = 0;
    // Files that are there and could not be read: left out and named (issue #125).
    const unreadable: VaultWalkSkip[] = [];
    // The rows this scan removes: decided in its transaction (stillMine).
    let removedRows = new Set<string>();
    const report = (): IndexScanReport => {
      // Remembered only by a scan that ran to its end: an aborted or failed
      // one must not become the baseline the next scan is compared with.
      this.lastScanFolders = folders;
      return {
        added: addedCount,
        changed: scannedCount - addedCount,
        removed: removedRows.size,
        skipped: unreadable.length > 0 ? [...skipped, ...unreadable] : skipped,
        durationMs: Date.now() - startedAt,
        walked: candidates.length,
        foldersChanged,
      };
    };

    if (mdToIndex.length === 0 && attachmentsToIndex.length === 0 && filesToDelete.length === 0) {
      // Nothing to do — but the walk still reports what it skipped, and an
      // index that was owed a scan has had one now.
      if (!startsEmpty && (await this.indexOwed())) await this.dbAdapter.execute(`DELETE FROM meta WHERE key = ?`, [INDEX_OWED_KEY]);
      return report();
    }

    // How far this scan's finds have been handed to the database (announceWhatStays).
    const written = { news: 0, mods: 0 };
    await this.dbAdapter.transaction(async () => {
      // One-query-per-table lookups for the whole pass (P2.4) instead of three
      // SELECT round-trips per file — read here, so that they are as old as
      // the writes below and no older (loadBulkLookups).
      const lookups = await this.loadBulkLookups();
      // Whether an earlier scan left the index owed one (indexComplete).
      const owedBefore = !startsEmpty && (await this.indexOwed());
      signal?.throwIfAborted();
      // Added vs. changed: a file with no row was created outside Plainva, one
      // with a row just moved on. Against the index as it is now — a file
      // whose row the app moved here since the scan began is no new file.
      const counted = (file: VaultFileInfo) => {
        scannedCount += 1;
        if (!lookups.fileStateByPath.has(file.path)) addedCount += 1;
      };
      // The cold full-scan's writes (file/fts/links/tags/properties rows + the
      // sync_state upsert for new files) are recorded into a buffer and flushed as
      // ONE atomic batch instead of one execute() — one IPC hop, one pooled
      // connection checkout, one auto-commit — per row, which dominated the 20k
      // cold-index budget (Performance_Notes). Reads are pre-loaded in `lookups`,
      // so the batch needs no interleaved reads. Flushed in bounded chunks so a
      // huge vault does not hold every statement in memory or in one giant IPC
      // payload. When the adapter has no runBatch (tests, non-Tauri), the buffer
      // is replayed statement-by-statement in the exact same order — behavior is
      // unchanged, only the delivery differs.
      const batch: BatchStatement[] = [];
      const sink: SqlWriter = {
        execute: (query: string, params: unknown[] = []) => {
          batch.push({ sql: query, params });
          return Promise.resolve();
        },
      };
      // Owed with the first rows, not only once the scan failed: on the
      // desktop a batch that went through stays when the scan ends there —
      // the app was closed, the process ended — and no failure is ever said.
      if (startsEmpty) batch.push({ sql: `INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`, params: [INDEX_OWED_KEY] });
      const FLUSH_AT = 4000;
      // The flushes run inside this very transaction, and say so: where a
      // batch is a transaction of its own (the phone's single connection), one
      // that did not would wait for the scan it belongs to.
      const INSIDE_THIS_SCAN = { inOpenTransaction: true } as const;
      const flushIfLarge = async () => {
        if (batch.length >= FLUSH_AT) {
          await runStatementsAtomic(this.dbAdapter, batch, INSIDE_THIS_SCAN);
          batch.length = 0;
          // Each file's finds are noted after its statements: all of them so far are in.
          written.news = pass.newLocalFiles.length;
          written.mods = pass.externalMods.length;
        }
      };

      // Process markdown indexing
      let i = 0;
      for (const file of mdToIndex) {
        if (this.options?.onProgress) {
          this.options.onProgress(i + 1, mdToIndex.length, file.path);
        }
        if (i % 10 === 0) {
          // Yield to event loop to allow UI updates
          await new Promise(r => setTimeout(r, 0));
        }
        i++;
        const reading = await this.readOrLeaveOut(file, unreadable);
        if (!reading) continue;
        await this._indexFileInternal(file, pass, lookups, sink, reading);
        counted(file);
        await flushIfLarge();
      }

      // Process attachment registration (lightweight, no parsing/FTS)
      let j = 0;
      for (const file of attachmentsToIndex) {
        if (j % 20 === 0) await new Promise(r => setTimeout(r, 0));
        j++;
        const reading = await this.readOrLeaveOut(file, unreadable);
        if (!reading) continue;
        await this._indexAttachmentInternal(file, pass, lookups, sink, reading);
        counted(file);
        await flushIfLarge();
      }

      // Process deletions — LAST, with the batch that ends the scan (finding
      // 2026-10-12). They used to lead the first batch. Where batches are
      // committed one by one (the desktop), a scan that failed on a later
      // file had removed the rows by then and never got to report them: the
      // sync rows stayed, no remote deletion was queued, and the next scan
      // no longer knew the paths. Nothing that reads a file comes after this
      // point; a scan that fails before it leaves the rows for the next one.
      //
      // We deliberately do NOT delete sync_state here: a file gone from disk
      // may need a remote delete pushed first (otherwise the next pull would
      // resurrect it). sync_state is cleaned only after the remote delete
      // succeeds; the deletion is surfaced via onLocalFileDeleted after this
      // transaction commits.
      //
      // Keyed on the PATH (issue #110, E8). It used to delete by sha256(path),
      // but a row moved inside Plainva keeps the id of its OLD path
      // (SyncQueue.queueRename rewrites `path` in place) — once such a file was
      // moved again outside Plainva, the delete matched nothing and the stale
      // row survived every full scan: a file that no longer exists stayed in
      // the tree for good. removePathFromIndex was moved to the path for the
      // same reason (issue #34); the full scan had been left behind.
      // The rows this scan removes, asked right before it removes them: a
      // path another pass indexed or reported since this scan read the index
      // — while it read every changed file — is not this scan's to remove
      // (stillMine); nor is a path whose row the app has moved away meanwhile
      // a file that vanished (movedAway).
      const moved = this.movedAway(filesToDelete, dbFileMap, lookups);
      removedRows = new Set(this.stillMine(filesToDelete.filter((path) => !moved.has(path)), pass));
      if (removedRows.size > 0) await this.deleteIndexRows([...removedRows], sink);

      // The scan has gone through once its last rows are in: the index owes no more.
      if (startsEmpty || owedBefore) batch.push({ sql: `DELETE FROM meta WHERE key = ?`, params: [INDEX_OWED_KEY] });

      // Flush the tail (all writes when runBatch is unavailable).
      await runStatementsAtomic(this.dbAdapter, batch, INSIDE_THIS_SCAN);
    }).catch((error: unknown) => {
      this.announceWhatStays(pass, written);
      throw error;
    });

    // Fire host callbacks AFTER the transaction so their DB work (enqueue) does not nest
    // inside it.
    this.flushCallbacks(pass);
    // Only genuinely vanished files — a newly excluded path is de-indexed
    // silently (see the split above) — and only the ones whose rows this
    // scan removed.
    this.reportRemoved(
      vanishedFromDisk.filter((path) => removedRows.has(path)),
      pass.since,
      (path) => indexedRowStamp(dbFileMap.get(path)?.mtime_local),
    );
    return report();
  }
}
