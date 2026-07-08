import { IVaultAdapter, VaultFileInfo } from "./IVaultAdapter.js";
import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { SyncStateRepository, SyncState } from "./SyncStateRepository.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractFrontmatterLinks, extractLinksAndTags } from "../ast-scanner.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { isTextFile } from "../sync/fileType.js";
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

/**
 * Vault-relative paths that are internal/VCS data and are never tracked or synced.
 * Matched on whole path SEGMENTS (not substrings), so legitimate user files like
 * `notes.plainva.png` or `node_modules_archive/x.png` are not excluded. `.CONFLICT`
 * copies are deliberately NOT excluded here: they are indexed so they stay visible and
 * resolvable in the tree; the sync targets already keep `.CONFLICT` local-only on push.
 */
export function isInternalPath(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments.some((s) => s === ".plainva" || s === ".git" || s === "node_modules" || s === ".obsidian" || s === ".trash" || s === ".smart-env" || s.startsWith(".stfolder"));
}

export interface VaultIndexerOptions {
  onExternalModification?: (path: string, oldHash: string | null, newHash: string) => void;
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
   */
  onLocalFileDeleted?: (path: string) => void;
  onProgress?: (current: number, total: number, path: string) => void;
}

/**
 * Prefetched lookups for a bulk pass (P2.4): the per-file variants issued
 * THREE SELECT round-trips per file (existing file state, pending queue op,
 * sync state) — 30k round-trips for a 10k-file full index over the Tauri IPC
 * bridge. A bulk pass loads each table once and reads from these maps.
 */
interface BulkIndexLookups {
  fileStateById: Map<string, { sync_state: string | null; ctime: number | null }>;
  queuedPaths: Set<string>;
  syncStateByPath: Map<string, SyncState>;
}

export class VaultIndexer {
  private readonly syncRepo: SyncStateRepository;
  /**
   * New-file paths discovered during the current index pass. Buffered and flushed AFTER
   * the DB transaction commits, so the host callback (which itself does DB work like
   * enqueuing) never runs inside the indexer's transaction (no nested transactions).
   */
  private pendingNewLocalFiles: string[] = [];
  /** External-modification events buffered during the current pass; flushed post-transaction. */
  private pendingExternalMods: { path: string; oldHash: string; newHash: string }[] = [];
  /**
   * Set by the single-file index pass: did anything the file tree / tag tree /
   * doc icons render change (title, mode, tags, plainva namespace)? Read by
   * `indexFile`/`indexPath` so the UI can skip its app-wide refresh on pure
   * prose edits. Defaults to true (a fresh pass with no comparison = assume changed).
   */
  private lastIndexMetadataChanged = true;

  constructor(
    private readonly vaultAdapter: IVaultAdapter,
    private readonly dbAdapter: IDatabaseAdapter,
    private readonly options?: VaultIndexerOptions
  ) {
    this.syncRepo = new SyncStateRepository(dbAdapter);
  }

  /**
   * Generates a stable unique ID for a file based on its relative path.
   */
  private async generateFileId(path: string): Promise<string> {
    return await sha256Hash(path);
  }

  /** Loads the three per-pass lookup tables with one query each (P2.4). */
  private async loadBulkLookups(): Promise<BulkIndexLookups> {
    const fileRows = await this.dbAdapter.query<{ id: string; sync_state: string | null; ctime?: number | null }>(
      `SELECT id, sync_state, ctime FROM files`
    );
    const fileStateById = new Map<string, { sync_state: string | null; ctime: number | null }>();
    for (const r of fileRows) fileStateById.set(r.id, { sync_state: r.sync_state ?? null, ctime: r.ctime ?? null });

    const queueRows = await this.dbAdapter.query<{ file_path: string; new_path: string | null }>(
      `SELECT file_path, new_path FROM offline_queue`
    );
    const queuedPaths = new Set<string>();
    for (const r of queueRows) {
      queuedPaths.add(r.file_path);
      if (r.new_path) queuedPaths.add(r.new_path);
    }

    const syncStateByPath = await this.syncRepo.getAllStates();
    return { fileStateById, queuedPaths, syncStateByPath };
  }

  /**
   * Multi-row INSERT in chunks. 150 rows × up to 6 params stays safely under
   * SQLite's conservative 999-host-parameter floor.
   */
  private async executeBatch(prefix: string, rowPlaceholders: string, rows: unknown[][]): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK = 150;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await this.dbAdapter.execute(
        prefix + slice.map(() => rowPlaceholders).join(", "),
        slice.flat() as unknown[]
      );
    }
  }

  /**
   * Indexes a single markdown file into the database.
   * Note: This method opens its own transaction.
   *
   * Returns whether tree-relevant metadata (title, mode, tags, plainva
   * namespace) changed, so the caller can skip the app-wide UI refresh on pure
   * prose edits. Non-markdown / directories return false (nothing indexed).
   */
  async indexFile(fileInfo: VaultFileInfo): Promise<boolean> {
    if (fileInfo.isDirectory || !fileInfo.name.endsWith(".md")) return false;
    this.pendingNewLocalFiles = [];
    this.pendingExternalMods = [];
    this.lastIndexMetadataChanged = true;
    await this.dbAdapter.transaction(async () => {
      await this._indexFileInternal(fileInfo);
    });
    this.flushCallbacks();
    return this.lastIndexMetadataChanged;
  }

  /**
   * Internal method that indexes a file without starting a new transaction.
   * Useful for bulk indexing. Always re-reads the file from disk so the index
   * matches exactly what is on disk (incl. content the adapter may have merged).
   */
  private async _indexFileInternal(fileInfo: VaultFileInfo, lookups?: BulkIndexLookups): Promise<void> {
    const fileId = await this.generateFileId(fileInfo.path);
    const content = await this.vaultAdapter.readTextFile(fileInfo.path);
    const sha256 = await sha256Hash(content);
    const existingFileState = lookups
      ? lookups.fileStateById.get(fileId) ?? null
      : await this.dbAdapter.queryOne<{ sync_state: string | null; ctime?: number | null; title?: string | null; mode?: string | null }>(
          `SELECT sync_state, ctime, title, mode FROM files WHERE id = ?`,
          [fileId]
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
    // Creation time survives re-indexing: the adapter's real birthtime wins
    // where the platform provides one, else the stored value, else the file's
    // mtime as first-seen lower bound (graph time axis, format v3).
    const ctime = fileInfo.ctime ?? existingFileState?.ctime ?? fileInfo.mtime;

    // Detect external modifications before updating state. Buffered and fired AFTER the
    // transaction (the host handler enqueues, which must not nest inside our transaction).
    const oldSyncState = lookups
      ? lookups.syncStateByPath.get(fileInfo.path) ?? null
      : await this.syncRepo.getSyncState(fileInfo.path);
    const isNewLocalFile = !oldSyncState;
    if (oldSyncState && oldSyncState.local_sha256 && oldSyncState.local_sha256 !== sha256) {
      this.pendingExternalMods.push({ path: fileInfo.path, oldHash: oldSyncState.local_sha256, newHash: sha256 });
    }

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

      // Detect whether anything OUTSIDE the note body changed: title, mode, tags,
      // or ANY frontmatter property. Views derive from exactly these — the file
      // tree (title/mode), tag tree (tags), doc icons (plainva.*) AND `.base`
      // tables/boards (arbitrary frontmatter columns like `status`). The note
      // BODY only feeds FTS + links, which are rewritten to the DB regardless, so
      // pure prose typing leaves this false and the editor can skip the app-wide
      // fileTreeVersion bump — that fan-out is what made typing lag. Frontmatter
      // is serialized exactly as it is stored below (same strValue rule, sorted),
      // so the comparison against the DB rows is apples-to-apples. Only computed
      // on the single-file path (bulk full-index ignores it).
      if (!lookups) {
        const newTagSig = [...new Set((tags as { name: string }[]).map((tg) => tg.name))].sort().join("\n");
        const newPropPairs: string[] = [];
        if (fmResult.success && fmResult.data) {
          for (const [key, value] of Object.entries(fmResult.data)) {
            const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
            newPropPairs.push(`${key}\t${strValue}`);
          }
        }
        const newPropSig = newPropPairs.sort().join("\n");
        const oldTagRows = await this.dbAdapter.query<{ tag: string }>(
          `SELECT tag FROM tags WHERE file_id = ?`,
          [fileId]
        );
        const oldTagSig = [...new Set(oldTagRows.map((r) => r.tag))].sort().join("\n");
        const oldPropRows = await this.dbAdapter.query<{ key: string; value: string }>(
          `SELECT key, value FROM properties WHERE file_id = ?`,
          [fileId]
        );
        const oldPropSig = oldPropRows.map((r) => `${r.key}\t${r.value}`).sort().join("\n");
        // In the !lookups branch existingFileState comes from the extended
        // queryOne (has title/mode); the bulk union type does not, hence the cast.
        const efs = existingFileState as { title?: string | null; mode?: string | null } | null;
        this.lastIndexMetadataChanged =
          !efs ||
          (efs.title ?? null) !== title ||
          (efs.mode ?? null) !== mode ||
          oldTagSig !== newTagSig ||
          oldPropSig !== newPropSig;
      }

      // Delete existing data for this file
      await this.dbAdapter.execute(`DELETE FROM files WHERE id = ?`, [fileId]);
      await this.dbAdapter.execute(`DELETE FROM fts_notes WHERE path = ?`, [fileInfo.path]);

      // Insert into files
      await this.dbAdapter.execute(
        `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [fileId, fileInfo.path, title, sha256, fileInfo.mtime, ctime, fileInfo.size, mode, indexedSyncState]
      );

      // Insert into fts_notes
      await this.dbAdapter.execute(
        `INSERT INTO fts_notes (content, title, path) VALUES (?, ?, ?)`,
        [content, title, fileInfo.path]
      );

      // Update sync state ONLY if this is a newly discovered file.
      // We must not overwrite local_sha256 for existing files during index,
      // as it would destroy the knowledge of the "base text" for 3-way merges.
      if (!oldSyncState) {
        await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, content);
      }

      // Insert links: body links (property_key NULL) and frontmatter relation
      // links share ONE multi-row batch — inserting row by row was 10-30
      // additional IPC round-trips per file (P2.4).
      const linkRows: unknown[][] = links.map((link) => [
        fileId, link.target, link.rawTarget, link.type, link.anchor || null, null,
      ]);
      if (fmResult.success && fmResult.data) {
        for (const fmLink of extractFrontmatterLinks(fmResult.data)) {
          linkRows.push([fileId, fmLink.target, fmLink.rawTarget, "wikilink", fmLink.anchor || null, fmLink.propertyKey]);
        }
      }
      await this.executeBatch(
        `INSERT INTO links (source_id, target_path, target_raw, link_type, anchor, property_key) VALUES `,
        `(?, ?, ?, ?, ?, ?)`,
        linkRows
      );

      // Insert tags
      await this.executeBatch(
        `INSERT OR IGNORE INTO tags (file_id, tag) VALUES `,
        `(?, ?)`,
        tags.map((tag) => [fileId, tag.name])
      );

      // Insert properties
      if (fmResult.success && fmResult.data) {
        const propRows: unknown[][] = [];
        for (const [key, value] of Object.entries(fmResult.data)) {
          let type: string = typeof value;
          if (Array.isArray(value)) type = "list";
          const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
          propRows.push([fileId, key, strValue, type]);
        }
        await this.executeBatch(
          `INSERT INTO properties (file_id, key, value, type) VALUES `,
          `(?, ?, ?, ?)`,
          propRows
        );
      }
    } catch (e) {
      console.warn(`Failed to parse and index ${fileInfo.path}:`, e);
      await this.dbAdapter.execute(
        `INSERT OR REPLACE INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'obsidian', ?)`,
        [fileId, fileInfo.path, fileInfo.name, sha256, fileInfo.mtime, ctime, fileInfo.size, indexedSyncState]
      );
      if (!oldSyncState) {
        await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, content);
      }
    }

    // A brand-new local file is indexed (and visible) but was never enqueued for sync.
    // Buffer it; the host is notified after the transaction commits (see flush below).
    if (isNewLocalFile) {
      this.pendingNewLocalFiles.push(fileInfo.path);
    }
  }

  /**
   * Lightweight indexing for non-markdown attachments (images, PDFs, …). Registers them
   * in the `files` table (mode='attachment') with a byte hash so they show in the tree,
   * get change-detected and — via the new/external callbacks — enqueued for sync. No
   * FTS/links/tags/properties parsing and no base_text (binary has no 3-way merge).
   */
  private async _indexAttachmentInternal(fileInfo: VaultFileInfo, lookups?: BulkIndexLookups): Promise<void> {
    const fileId = await this.generateFileId(fileInfo.path);
    // Text-like non-.md files (e.g. `.base`, `.canvas`) must be hashed the SAME way the
    // conflict-aware adapter and sync worker hash them — a text hash of the decoded
    // content — and need a base_text for 3-way merges. Hashing them as raw bytes here
    // produced a permanent hash mismatch vs. the (text-hashing) write path, which made
    // every save of a `.base` file create a spurious .CONFLICT. Truly binary files
    // (images, PDFs, …) keep the byte hash and have no base_text.
    const textLike = isTextFile(fileInfo.path);
    let sha256: string;
    let textContent: string | null = null;
    if (textLike) {
      textContent = await this.vaultAdapter.readTextFile(fileInfo.path);
      sha256 = await sha256Hash(textContent);
    } else {
      const bytes = await this.vaultAdapter.readBinaryFile(fileInfo.path);
      sha256 = await sha256Bytes(bytes);
    }

    const existingFileState = lookups
      ? lookups.fileStateById.get(fileId) ?? null
      : await this.dbAdapter.queryOne<{ sync_state: string | null; ctime?: number | null }>(
          `SELECT sync_state, ctime FROM files WHERE id = ?`,
          [fileId]
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
    // Creation time survives re-indexing: the adapter's real birthtime wins
    // where the platform provides one, else the stored value, else the file's
    // mtime as first-seen lower bound (graph time axis, format v3).
    const ctime = fileInfo.ctime ?? existingFileState?.ctime ?? fileInfo.mtime;

    const oldSyncState = lookups
      ? lookups.syncStateByPath.get(fileInfo.path) ?? null
      : await this.syncRepo.getSyncState(fileInfo.path);
    const isNewLocalFile = !oldSyncState;
    if (oldSyncState && oldSyncState.local_sha256 && oldSyncState.local_sha256 !== sha256) {
      this.pendingExternalMods.push({ path: fileInfo.path, oldHash: oldSyncState.local_sha256, newHash: sha256 });
    }

    await this.dbAdapter.execute(`DELETE FROM files WHERE id = ?`, [fileId]);
    await this.dbAdapter.execute(
      `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [fileId, fileInfo.path, fileInfo.name, sha256, fileInfo.mtime, ctime, fileInfo.size, "attachment", indexedSyncState]
    );

    if (isNewLocalFile) {
      if (textLike && textContent !== null) {
        // Text-like file: store a base_text so it is mergeable, matching the write path.
        await this.syncRepo.updateLocalHashAndBaseText(fileInfo.path, sha256, textContent);
      } else {
        // Byte hash only — true binary files have no base_text.
        await this.syncRepo.updateLocalHash(fileInfo.path, sha256);
      }
      this.pendingNewLocalFiles.push(fileInfo.path);
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
    if (isInternalPath(path)) return "unchanged";

    let info: VaultFileInfo | null = null;
    try {
      info = await this.vaultAdapter.getFileInfo(path);
    } catch {
      info = null;
    }

    if (!info) {
      // Gone from disk. Only fire the deletion flow if it was actually indexed.
      const known = await this.dbAdapter.queryOne<{ id: string }>(
        `SELECT id FROM files WHERE path = ?`,
        [path]
      );
      if (!known) return "unchanged";
      await this.removePathFromIndex(path);
      return "removed";
    }
    if (info.isDirectory) return "needs-full-scan";

    // Same mtime as indexed -> the event is an echo (our own save already
    // re-indexed the file, or a no-op touch): skip the re-parse.
    const knownRow = await this.dbAdapter.queryOne<{ mtime_local: number }>(
      `SELECT mtime_local FROM files WHERE path = ?`,
      [path]
    );
    if (knownRow && Number(knownRow.mtime_local) === info.mtime) return "unchanged";

    this.pendingNewLocalFiles = [];
    this.pendingExternalMods = [];
    await this.dbAdapter.transaction(async () => {
      if (info!.name.endsWith(".md")) {
        await this._indexFileInternal(info!);
      } else if (!isInternalPath(info!.path)) {
        await this._indexAttachmentInternal(info!);
      }
    });
    this.flushCallbacks();
    return "indexed";
  }

  /** De-indexes one path (files row cascades to links/tags/properties, plus FTS). */
  async removePathFromIndex(path: string): Promise<void> {
    const fileId = await this.generateFileId(path);
    await this.dbAdapter.execute(`DELETE FROM files WHERE id = ?`, [fileId]);
    await this.dbAdapter.execute(`DELETE FROM fts_notes WHERE path = ?`, [path]);
    // Same contract as the full scan: sync_state stays (the remote delete must
    // be pushed first); the host reacts via onLocalFileDeleted.
    this.options?.onLocalFileDeleted?.(path);
  }

  /** Fires buffered new-file and external-modification callbacks (post-transaction). */
  private flushCallbacks(): void {
    if (this.options?.onExternalModification) {
      for (const m of this.pendingExternalMods) this.options.onExternalModification(m.path, m.oldHash, m.newHash);
    }
    if (this.options?.onNewLocalFile) {
      for (const path of this.pendingNewLocalFiles) this.options.onNewLocalFile(path);
    }
    this.pendingExternalMods = [];
    this.pendingNewLocalFiles = [];
  }

  /**
   * Scans the entire vault and updates the database index.
   * Performance Optimized: Only processes modified or new files, removes deleted ones,
   * and wraps everything in a single bulk transaction.
   */
  async indexVaultFull(): Promise<void> {
    this.pendingNewLocalFiles = [];
    this.pendingExternalMods = [];
    const dbFiles = await this.dbAdapter.query<{path: string, mtime_local: number}>(
      `SELECT path, mtime_local FROM files`
    );
    const dbFileMap = new Map(dbFiles.map(f => [f.path, f.mtime_local]));

    const diskFiles = await this.vaultAdapter.listDir("", true);
    const mdFiles = diskFiles.filter(f => !f.isDirectory && f.name.endsWith(".md"));
    // Non-markdown attachments (images, PDFs, …) are tracked for sync too, except
    // internal/VCS data. Conflict copies ARE indexed (kept visible); push targets skip them.
    const attachmentFiles = diskFiles.filter(f => !f.isDirectory && !f.name.endsWith(".md") && !isInternalPath(f.path));
    const diskFilePaths = new Set([...mdFiles, ...attachmentFiles].map(f => f.path));

    const changed = (file: VaultFileInfo) => {
      const dbMtime = dbFileMap.get(file.path);
      // `!==` instead of `>`: restoring an OLDER file version (Explorer copy,
      // backup restore, sync rollback) keeps the old mtime — a strictly-greater
      // check would never re-index it and the stale content would stick around.
      return dbMtime === undefined || file.mtime !== dbMtime;
    };
    const mdToIndex = mdFiles.filter(changed);
    const attachmentsToIndex = attachmentFiles.filter(changed);
    const filesToDelete: string[] = [];

    // Find deleted files (gone from disk but still in the index).
    for (const dbPath of dbFileMap.keys()) {
      if (!diskFilePaths.has(dbPath)) {
        filesToDelete.push(dbPath);
      }
    }

    if (mdToIndex.length === 0 && attachmentsToIndex.length === 0 && filesToDelete.length === 0) {
      return; // Nothing to do
    }

    // One-query-per-table lookups for the whole pass (P2.4) instead of three
    // SELECT round-trips per file.
    const lookups = await this.loadBulkLookups();

    await this.dbAdapter.transaction(async () => {
      // Process deletions. We deliberately do NOT delete sync_state here: a file gone
      // from disk may need a remote delete pushed first (otherwise the next pull would
      // resurrect it). sync_state is cleaned only after the remote delete succeeds; the
      // deletion is surfaced via onLocalFileDeleted after this transaction commits.
      if (filesToDelete.length > 0) {
        const ids: string[] = [];
        for (const path of filesToDelete) ids.push(await this.generateFileId(path));
        const CHUNK = 400;
        for (let k = 0; k < filesToDelete.length; k += CHUNK) {
          const idSlice = ids.slice(k, k + CHUNK);
          const pathSlice = filesToDelete.slice(k, k + CHUNK);
          const marks = idSlice.map(() => "?").join(", ");
          // Cascades to links, tags, properties
          await this.dbAdapter.execute(`DELETE FROM files WHERE id IN (${marks})`, idSlice);
          await this.dbAdapter.execute(`DELETE FROM fts_notes WHERE path IN (${marks})`, pathSlice);
        }
      }

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
        await this._indexFileInternal(file, lookups);
        i++;
      }

      // Process attachment registration (lightweight, no parsing/FTS)
      let j = 0;
      for (const file of attachmentsToIndex) {
        if (j % 20 === 0) await new Promise(r => setTimeout(r, 0));
        await this._indexAttachmentInternal(file, lookups);
        j++;
      }
    });

    // Fire host callbacks AFTER the transaction so their DB work (enqueue) does not nest
    // inside it.
    this.flushCallbacks();
    if (this.options?.onLocalFileDeleted) {
      for (const path of filesToDelete) this.options.onLocalFileDeleted(path);
    }
  }
}
