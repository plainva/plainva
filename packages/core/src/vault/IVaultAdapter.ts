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

export interface IVaultAdapter {
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
   * Deletes a file or directory. If a directory, typically fails unless recursive=true.
   * @throws VaultFileNotFoundError
   */
  deleteItem(path: string, recursive?: boolean): Promise<void>;

  /**
   * Renames/moves a file or directory.
   * @throws VaultFileNotFoundError if oldPath does not exist
   * @throws VaultFileExistsError if newPath already exists
   */
  renameItem(oldPath: string, newPath: string): Promise<void>;

  /**
   * Checks if a file or directory exists.
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
  listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]>;
  
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
