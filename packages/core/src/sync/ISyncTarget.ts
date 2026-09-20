/**
 * A file the shell can stream from disk without the bytes crossing into the
 * renderer (issue #48 — a 90 MB attachment froze the app on its way through the
 * IPC boundary). The provider gets a handle instead of a buffer and decides how
 * to send it; `size` and `sha256` come from the same native pass, so nothing has
 * to read the file a second time just to hash it.
 */
export interface SyncContentRef {
  /** Opaque handle of the registered vault root (never an absolute path). */
  rootId: string;
  /** Vault-relative path inside that root. */
  relPath: string;
  size: number;
  sha256: string;
}

/**
 * Streams a byte range of a vault file to a URL. Injected like `fetch`, so the
 * core stays free of shell APIs and the existing fake-fetch tests keep their
 * shape. Providers reach for it only when an operation carries a `contentRef`.
 */
export type SyncUploader = (req: {
  ref: SyncContentRef;
  url: string;
  method: string;
  headers?: Record<string, string>;
  /** Byte range of the file; defaults to the whole file. */
  offset?: number;
  length?: number;
}) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export interface SyncOperation {
  id: number;
  file_path: string;
  operation: "write" | "delete" | "rename" | "mkdir";
  content?: Uint8Array;
  /**
   * Set INSTEAD of `content` for large writes: the bytes stay on disk and the
   * target streams them. A target without a `SyncUploader` still finds `content`
   * — the engine only omits it when the shell can stream.
   */
  contentRef?: SyncContentRef;
  new_path?: string;
  retry_count: number;
  next_retry_at: number;
  queued_at: number;
  /**
   * Content-E2E migration/rotation sweep (settings-sync plan §3.5): when set the
   * engine pushes this write UNCONDITIONALLY — it bypasses the "already in sync,
   * skip" shortcut and the optimistic-concurrency deferral so the file is
   * re-uploaded (as ciphertext through the wrapping target) even though its
   * plaintext content is unchanged. The post-push base hashes stay plaintext.
   */
  force?: number;
  /** Durable confirmation of this exact local DELETE, not a reusable path grant. */
  delete_confirmed_at?: number | null;
  /** Its intent has been saved in the local deletion journal. */
  delete_journaled?: number;
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
  /**
   * Optional: path -> provider object id for id-based providers (Drive). The
   * worker persists it as `remote_id`, so a later existence probe can ask for
   * the OBJECT instead of trusting a listing or a name search (finding
   * 2026-09-20). Before this only pushed files carried an id; a vault that was
   * mostly pulled had none, and nothing could be verified.
   */
  idMap?: Map<string, string>;
  /**
   * Optional: what the listing cost and delivered — counters only, never a
   * name. The worker adds its own view (known files, missing files) and hands
   * the line to the host's diagnostics, so an incomplete listing that answers
   * with HTTP 200 leaves numbers behind (finding 2026-09-20).
   */
  listing?: ListingMetrics;
}

/** Counters of one full listing (see `PullResult.listing`). */
export interface ListingMetrics {
  /** Folders walked, the root included. 0 for flat stores. */
  folders: number;
  /** List requests answered, i.e. result pages. */
  pages: number;
  /** Files the listing returned BEFORE the worker's own filters. */
  files: number;
  /** Wall-clock duration of the listing. */
  ms: number;
  /** Shortened id of the listed root, for id-based providers. */
  rootId?: string;
}

/**
 * Answer of a direct existence probe (`ISyncTarget.probeExists`).
 *
 * `unknown` is a real answer, not an error: an id-based provider asked by PATH
 * can only search, and a search that finds nothing proves nothing when the
 * listing that raised the doubt came from the same search. Errors still throw.
 */
export type RemotePresence = "present" | "absent" | "unknown";

export interface RemoteProbe {
  path: string;
  /** Provider object id recorded for the path, when one is known. */
  remoteId?: string | null;
}

/**
 * Metadata of ONE remote path, answered without downloading it (C31).
 * `etag` uses exactly the change-marker semantics of `pull()` for the same
 * adapter (S3 ETag, WebDAV getetag, Drive md5, Graph cTag, Dropbox content
 * hash) so a value from `stat` compares against one from a listing; an empty
 * string means "the store has no marker" and callers hash the bytes instead.
 */
export interface RemoteStat {
  etag: string;
  /** Size in bytes of the remote object as stored. */
  size: number;
  /** Remote modification time (epoch ms) where the provider reports one. */
  modifiedAt?: number;
}

export interface ISyncTarget {
  push(op: SyncOperation): Promise<PushResult | void>;
  /**
   * Does this target know how to stream a `contentRef`? Only then does the
   * engine hand one over instead of a buffer.
   *
   * The content-encryption wrapper deliberately leaves it unset: it has to seal
   * the bytes before they go anywhere, so streaming past it is not possible
   * without a chunked AEAD format.
   */
  acceptsContentRef?: boolean;
  /**
   * Pull the remote change set. `cursor` is an optional opaque token for adapters
   * that support incremental change detection (Drive); adapters without it (WebDAV)
   * ignore the argument and always return a full listing.
   */
  pull(cursor?: string): Promise<PullResult>;
  download(filePath: string): Promise<Uint8Array | null>;
  /** Atomic HTTP validator and content, for bounded sideband caches. */
  downloadConditional?(filePath: string, etag?: string): Promise<
    { notModified: true; etag: string } | { notModified: false; bytes: Uint8Array | null; etag?: string }
  >;
  /**
   * Optional: the CURRENT remote change marker (etag/hash) for a single path, or null if
   * the file does not exist remotely. Used by the engine's optimistic-concurrency guard
   * to detect that the remote moved since our merge base right before a push would
   * overwrite it (3b). Adapters that cannot cheaply probe a single file leave this
   * undefined; the worker's reconcile-before-push (3a) is the fallback guarantee.
   */
  remoteEtag?(filePath: string): Promise<string | null>;
  /**
   * Optional: metadata of a single path without its bytes — S3 HEAD, WebDAV
   * PROPFIND Depth 0, a Drive/Graph/Dropbox metadata call. Null when the path
   * does not exist remotely. The workspace object store answers `head()`
   * through this; without it, "does this key exist and what does it carry"
   * costs a full listing plus a download — per immutable object, twice per
   * comment (C31, 2026-09-04). The verification itself is unchanged: the
   * store still re-reads what it wrote; only the existence probe got cheaper.
   */
  stat?(filePath: string): Promise<RemoteStat | null>;
  /**
   * Optional: does this ONE file still exist remotely — answered without the
   * listing that raised the doubt (finding 2026-09-20: a Drive listing came
   * back with HTTP 200 and 168 of 1142 files; the worker offered to delete the
   * other 974 locally). Path-addressed stores answer through their metadata
   * call; an id-based provider asks for the object by `remoteId` and answers
   * `unknown` when all it could do is search by name. The worker never deletes
   * a local file on a listing alone when the target can be asked.
   */
  probeExists?(probe: RemoteProbe): Promise<RemotePresence>;
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
