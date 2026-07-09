export interface SyncOperation {
  id: number;
  file_path: string;
  operation: "write" | "delete" | "rename";
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
}
