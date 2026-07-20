export interface SyncOperation {
  id: number;
  file_path: string;
  operation: "write" | "delete" | "rename" | "mkdir";
  content?: Uint8Array;
  new_path?: string;
  retry_count: number;
  next_retry_at: number;
  queued_at: number;
}

export interface PushResult {
  etag?: string;
  /**
   * Optional: the remote provider id assigned to the pushed file (e.g. Google Drive
   * file id). Id-based providers return it so the worker can persist it as
   * `remote_id`; path-based providers (WebDAV) leave it undefined.
   */
  remoteId?: string;
  /**
   * Optional, rename pushes only: the remote source file no longer exists
   * (deleted or moved by another device). Reporting this instead of silent
   * success lets the engine fall back to uploading the local content at the
   * new path — otherwise the file would end up under NO remote path at all.
   */
  renameSourceMissing?: boolean;
}

export interface PullResult {
  /** Path -> ETag of the remote files. The path-based reconciliation path (WebDAV). */
  etagMap: Map<string, string>;
  /**
   * Optional: paths the remote reports as deleted since `cursor`. Only the
   * cursor/token-based path (Drive `changes.list`) sets this; the WebDAV
   * full-listing path leaves it undefined (the worker derives deletions from the
   * difference between known paths and `etagMap`).
   */
  deleted?: string[];
  /**
   * Optional: opaque follow-up cursor (e.g. Drive `startPageToken`) to pass to the
   * next `pull(cursor)`. Undefined for adapters that don't support incremental
   * change tokens (WebDAV).
   */
  nextCursor?: string;
  /**
   * Optional: the cursor pull saw changes it could NOT resolve to vault paths
   * (a brand-new file under a folder the id caches don't know, a remote folder
   * rename/move/trash whose children get no individual change entries). The
   * worker reacts by dropping the cursor and following up with a full listing
   * immediately instead of leaving the change invisible until the periodic
   * safety-net listing.
   */
  needsFullListing?: boolean;
  /**
   * Optional: vault-relative FOLDER paths seen in a FULL listing (2026-07-17,
   * empty-folder sync). The worker creates locally missing ones so empty
   * remote folders appear without waiting for their first file. Cursor pulls
   * leave this undefined — the periodic full listing is the safety net.
   * Purely additive: the worker never derives folder deletions from it.
   */
  folders?: string[];
  /**
   * Optional: path -> remote modified time (epoch ms) for a FULL listing. Lets
   * the worker reconcile (and prefetch) the most-recently-modified files first.
   * Only providers that surface a modified time set this (Drive); others leave
   * it undefined and the worker keeps the remote listing order.
   */
  mtimeMap?: Map<string, number>;
}

export interface ISyncTarget {
  push(op: SyncOperation): Promise<PushResult | void>;
  /**
   * Pull the remote change set. `cursor` is an optional opaque token for adapters
   * that support incremental change detection (Drive); adapters without it (WebDAV)
   * ignore the argument and always return a full listing.
   */
  pull(cursor?: string): Promise<PullResult>;
  download(filePath: string): Promise<Uint8Array | null>;
  /**
   * Optional: the CURRENT remote change marker (etag/hash) for a single path, or null if
   * the file does not exist remotely. Used by the engine's optimistic-concurrency guard
   * to detect that the remote moved since our merge base right before a push would
   * overwrite it (3b). Adapters that cannot cheaply probe a single file leave this
   * undefined; the worker's reconcile-before-push (3a) is the fallback guarantee.
   */
  remoteEtag?(filePath: string): Promise<string | null>;
  /**
   * Optional: a fresh change token representing "now", for change-token providers (Drive
   * `changes.getStartPageToken`). The worker fetches one right before a full listing and
   * then passes it to `pull(cursor)` on subsequent cycles to fetch only what changed —
   * turning a full-tree walk every cycle into a single incremental call. Adapters without
   * incremental change detection (WebDAV/S3/OneDrive/Dropbox) leave this undefined and the
   * worker always does a full listing.
   */
  getStartCursor?(): Promise<string>;
  /**
   * Optional folder browsing for the settings' remote-folder picker (2026-07-06):
   * child folder NAMES one level below `path` ("" = the account/bucket root).
   * Deliberately independent of the configured vault folder/prefix — the picker's
   * job is to CHOOSE that setting. Adapters whose folder setting is a single
   * root-level name (Google Drive) only ever get called with "".
   */
  listFolders?(path: string): Promise<string[]>;
  /**
   * Optional folder creation for the pickers' "new folder" row (2026-07-13):
   * creates the folder chain for `path` in the SAME coordinate system as
   * `listFolders` (account/bucket root, NOT the configured vault folder).
   * Idempotent — an already existing folder is success. S3 writes a zero-byte
   * folder-marker object so the new prefix shows up in listings.
   */
  createFolder?(path: string): Promise<void>;
}
