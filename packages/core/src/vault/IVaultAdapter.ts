import type { ConflictBytesResolution, ConflictDiagnostic, ConflictEditSession, ConflictResolution, ConflictWriter, EditorWriteResult } from "./conflictSession.js";

export class VaultError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "VaultError";
  }
}

export class VaultFileNotFoundError extends VaultError {
  constructor(path: string) {
    super(`File or directory not found: ${path}`, "FILE_NOT_FOUND");
    this.name = "VaultFileNotFoundError";
  }
}

export class VaultPermissionDeniedError extends VaultError {
  constructor(path: string) {
    super(`Permission denied: ${path}`, "PERMISSION_DENIED");
    this.name = "VaultPermissionDeniedError";
  }
}

export class VaultFileExistsError extends VaultError {
  constructor(path: string) {
    super(`File or directory already exists: ${path}`, "FILE_EXISTS");
    this.name = "VaultFileExistsError";
  }
}

export interface VaultFileInfo {
  /** Relative path within the vault (e.g., "folder/note.md") */
  path: string;
  /** Basename of the file or directory (e.g., "note.md") */
  name: string;
  /** True if it's a directory, false if it's a file */
  isDirectory: boolean;
  /** Size in bytes. 0 for directories. */
  size: number;
  /** Last modification time in milliseconds since Unix Epoch */
  mtime: number;
  /** Creation time (birthtime) in ms where the platform/adapter provides it. */
  ctime?: number;
  /** Cloud-specific versioning token (e.g., Google Drive revision ID, WebDAV ETag) */
  etag?: string;
  /** Cloud-specific unique identifier (e.g., Google Drive File ID) */
  id?: string;
}

/** Applies only to the successful delete call carrying it, never to a path's future contents. */
export interface DeletionConfirmation {
  confirmed: true;
}

/**
 * A change of a text file that starts from the file as it lies there: its
 * text in, the new text out — or `null` to leave the file alone.
 *
 * Pure and synchronous. It runs inside the gate the vault's chain holds for
 * the path, so whatever takes time (a query, another file, a question to the
 * user) is done before. And it is called more than once: where the file has
 * an open conflict a second time, with the user's own version of the file
 * (see `ConflictAwareVaultAdapter.updateTextFile`), and again for a window
 * whose attempt lost against another writer. So a change keeps nothing on the
 * way — what its caller wants to know about it (how many links, which entry),
 * the caller reads from the result's `before`.
 */
export type TextChange = (text: string) => string | null;

/**
 * A change that was not made because the file did not hold still: a window
 * that reaches the chain over a bus read it, and every time it came back with
 * the changed text another writer had been there (`updateTextFile`).
 */
export class TextFileChangedError extends Error {
  constructor(public readonly path: string) {
    super(`The file kept changing while it was being updated: ${path}`);
    this.name = "TextFileChangedError";
  }
}

/** What a read-change-write did (`updateTextFile`). */
export interface TextFileUpdate {
  /** The text of the file named, before the call … */
  before: string;
  /** … and after it. */
  text: string;
  /** Whether the file named was written. */
  changed: boolean;
  /**
   * The open conflict of the file named, where it has one: where the user's
   * own version lies, and whether the same change was made there as well.
   */
  conflict: { workingCopyPath: string; changed: boolean } | null;
}

/** What a read-change-write starts from, for a window that cannot run its change inside the gate (`readTextFileState`). */
export interface TextFileState {
  /** The text of the file named. */
  text: string;
  /** The user's own version of it while its conflict is open; `null` where it has none, or where the file named IS that version. */
  workingCopy: string | null;
}

/** The texts a change made of a `TextFileState`; `null` leaves that one alone. */
export interface TextFileChange {
  text: string | null;
  workingCopy: string | null;
}

export interface IVaultAdapter {
  /** Owned by the conflict-aware pipeline (or forwarded to that owner by another window). */
  getConflictSession?(path: string): Promise<ConflictEditSession | null>;
  listConflictSessions?(): Promise<ConflictEditSession[]>;
  listConflictDiagnostics?(): Promise<ConflictDiagnostic[]>;
  preserveConflict?(path: string, text: string, writer: ConflictWriter): Promise<ConflictEditSession>;
  writeEditorText?(path: string, text: string, baseText: string | null): Promise<EditorWriteResult>;
  resolveConflict?(path: string, resolution: ConflictResolution): Promise<void>;
  /** The way out of an open conflict whose file is no text any more: byte for byte, by the hashes the comparison saw. */
  resolveConflictBytes?(path: string, resolution: ConflictBytesResolution): Promise<void>;
  /**
   * Reads a text file, changes it and writes it back as ONE step — the way in
   * for whoever changes a place of a file that exists: a property, a task's
   * box, a link, a line appended. Owned by the conflict-aware pipeline like
   * the methods above; callers go through `updateVaultText`, which also
   * serves a storage that has no chain.
   * @throws VaultFileNotFoundError
   */
  updateTextFile?(path: string, change: TextChange): Promise<TextFileUpdate>;
  /** The two halves of `updateTextFile` for a window that reaches the chain over a bus: read … */
  readTextFileState?(path: string): Promise<TextFileState>;
  /** … and write, if the file still is as it was read. `null` says it is not: read again. */
  writeTextFileChange?(path: string, expected: TextFileState, next: TextFileChange): Promise<TextFileUpdate | null>;
  /**
   * Initializes the vault adapter (e.g., connects to DB, authenticates).
   */
  initialize(): Promise<void>;

  /**
   * Disconnects or cleans up resources.
   */
  dispose(): Promise<void>;

  /**
   * Called by the application when it has successfully loaded a file into the UI,
   * so that the adapter can acknowledge this as the new base text for future merges.
   */
  acknowledgeExternalUpdate?(path: string): Promise<void>;

  /**
   * Reads a file as text.
   * @throws VaultFileNotFoundError
   */
  readTextFile(path: string): Promise<string>;

  /**
   * Reads a file as binary data.
   * @throws VaultFileNotFoundError
   */
  readBinaryFile(path: string): Promise<Uint8Array>;

  /**
   * Writes text to a file. Overwrites if exists, creates if it doesn't.
   * Also creates missing parent directories.
   */
  writeTextFile(path: string, content: string): Promise<void>;

  /**
   * Writes binary data to a file. Overwrites if exists, creates if it doesn't.
   * Also creates missing parent directories.
   */
  writeBinaryFile(path: string, content: Uint8Array): Promise<void>;

  /**
   * Stamps an existing file with timestamps that came from somewhere else.
   *
   * Optional: only the import path needs it so far, and only a platform that
   * can reach file metadata can offer it. Creation time is not settable on
   * every system — implementations apply what they can and ignore the rest.
   */
  setFileTimes?(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void>;

  /**
   * Deletes a file or directory. If a directory, typically fails unless recursive=true.
   * @throws VaultFileNotFoundError
   */
  deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void>;

  /**
   * Renames/moves a file or directory.
   * @throws VaultFileNotFoundError if oldPath does not exist
   * @throws VaultFileExistsError if newPath already exists
   */
  renameItem(oldPath: string, newPath: string): Promise<void>;

  /**
   * Checks if a file or directory exists.
   *
   * `false` means the platform said "nothing is there". A check that failed
   * for any other reason — permission, a device or provider that is away —
   * rejects: callers conclude deletions from a `false`.
   *
   * `""` asks for the vault's own folder. The index asks it before it takes a
   * path's absence for a deletion (`VaultIndexer.vaultIsThere`), so it must
   * answer `true` for a vault that is there, and never for one that is not.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Gets metadata for a specific file or directory.
   * @throws VaultFileNotFoundError
   */
  getFileInfo(path: string): Promise<VaultFileInfo>;

  /**
   * Lists the contents of a directory.
   * @param path The directory path (use "" or "/" for root)
   * @param recursive If true, returns all items in subdirectories as well
   */
  listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]>;

  /**
   * Same walk as `listDir`, but additionally reports the entries the walk
   * deliberately left out (symlink cycles, unreadable directories). Optional:
   * adapters that cannot skip anything (flat cloud listings, in-memory fakes)
   * simply omit it and callers fall back to `listDir` with an empty skip list.
   *
   * Exists so the full re-index can answer "did the scan even see my file?" —
   * a folder silently missing from the walk used to be indistinguishable from
   * a folder that is genuinely empty.
   *
   * `followLinks: false` lists what lies in the folder itself and leaves out
   * what its links point at — what a recursive delete of it removes (the
   * snapshot before one on the phone, `BackupVaultAdapter`); a folder that is
   * itself a link holds nothing of its own. A walk that never
   * follows a link has nothing to leave out; one that follows links and
   * cannot leave them out throws rather than answer with more than was asked
   * for. For an adapter without this method the wrappers answer with
   * `listDir` and read no option: the app adapters all have it, and
   * `LocalVaultAdapter` (Node), whose `listDir` follows links to folders and
   * lists dot-named entries, leaves its callers to hold their own rules.
   */
  listDirReport?(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing>;

  /** Complete backup inventory, including hidden files. Excluded DIRECTORY
   * names are pruned at every depth; symbolic links are not followed.
   * Any unreadable selected entry rejects instead of returning a partial list.
   * Kept separate from the filtered tree/index view returned by listDir. */
  listDirForBackup?(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]>;

  /**
   * The spelling `path` is stored under (ADR 0016). Callers name files by
   * their NFC identity; the base adapters resolve it themselves before every
   * operation. Only a native call that bypasses the adapter (a streamed
   * upload reads the file by path) needs to ask. Optional: wrappers and test
   * doubles address files by identity only.
   */
  realPath?(path: string): Promise<string>;

  /**
   * Creates a directory and any necessary parent directories.
   * Does not throw if directory already exists.
   */
  createDir(path: string): Promise<void>;

  /**
   * Watches the vault for external file changes.
   * @param callback Function called with an array of events
   * @returns A function to stop watching
   */
  watch?(callback: (events: WatchEvent[]) => void): Promise<() => void>;
}

export interface WatchEvent {
  path: string;
  type?: "create" | "modify" | "remove" | "rename" | "any";
}

/** An entry the directory walk left out, with the reason it was left out. */
export interface VaultWalkSkip {
  /** Vault-relative path of the skipped entry. */
  path: string;
  /**
   * `cycle` — a link target already visited in this walk (following it would loop).
   * `unreadable` — listing the entry failed (permissions, offline network share).
   */
  reason: "cycle" | "unreadable";
}

/** How a reporting directory walk goes (see `IVaultAdapter.listDirReport`). */
export interface VaultWalkOptions {
  signal?: AbortSignal;
  /** False: what lies in the folder itself, without what its links point at. */
  followLinks?: boolean;
  /**
   * False: no entry whose name starts with a dot, and no walk into such a
   * folder — the folder as the tree shows it. Same rule as `followLinks`: a
   * walk that lists no such entry has nothing to leave out, one that cannot
   * leave them out throws.
   */
  dotEntries?: boolean;
}

/** Result of a reporting directory walk (see `IVaultAdapter.listDirReport`). */
export interface VaultListing {
  files: VaultFileInfo[];
  skipped: VaultWalkSkip[];
}
