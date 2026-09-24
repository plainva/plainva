import { invoke } from "@tauri-apps/api/core";

export interface CheckedDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  /** Older native readers omit this; their caller falls back to a file stat. */
  metadata?: { size: number; mtime: number | null; ctime: number | null } | null;
  /**
   * Set when THIS entry could not be inspected (issue 110, E8): the native
   * side names it instead of failing the whole folder, and the walker protects
   * exactly this entry. Also set here for a name the vault's path scheme cannot
   * address (a backslash is a legal character on macOS and Linux) or an entry
   * that is neither file, folder nor link (a socket, a FIFO).
   */
  unreadable?: string;
}

/** Only the native NotFound result is absence; unknown responses also reject. */
export async function checkedPathExists(rootId: string, relPath: string): Promise<boolean> {
  const value = await invoke<unknown>("checked_path_exists", { rootId, relPath });
  if (typeof value !== "boolean") throw new Error("The filesystem existence check could not be confirmed");
  return value;
}

export async function checkedReadTextFile(rootId: string, relPath: string): Promise<string | null> {
  const value = await invoke<unknown>("checked_read_text_file", { rootId, relPath });
  if (value !== null && typeof value !== "string") throw new Error("The text file read could not be confirmed");
  return value;
}

const isSafeTime = (value: unknown) => value === null || Number.isSafeInteger(value);

/**
 * Validates one entry of a native listing. A malformed RESPONSE (no name, a
 * slash in a name, broken metadata) still rejects the whole listing — that is
 * the bridge failing, not the disk. An entry the walker merely cannot use is
 * marked `unreadable` and travels on.
 */
function checkEntry(entry: unknown): CheckedDirEntry {
  const e = entry as Partial<CheckedDirEntry> | null;
  if (!e || typeof e.name !== "string" || !e.name) throw new Error("The directory listing could not be confirmed");
  if (e.unreadable !== undefined) {
    if (typeof e.unreadable !== "string") throw new Error("The directory listing could not be confirmed");
    return { name: e.name, isFile: false, isDirectory: false, isSymlink: false, metadata: null, unreadable: e.unreadable };
  }
  if (e.name.includes("/") || typeof e.isFile !== "boolean" || typeof e.isDirectory !== "boolean" || typeof e.isSymlink !== "boolean"
    || (e.metadata != null && (!Number.isSafeInteger(e.metadata.size) || e.metadata.size < 0
      || !isSafeTime(e.metadata.mtime) || !isSafeTime(e.metadata.ctime)))) {
    throw new Error("The directory listing could not be confirmed");
  }
  if (e.name.includes("\\")) return { ...(e as CheckedDirEntry), unreadable: "name contains a backslash" };
  if (!e.isFile && !e.isDirectory && !e.isSymlink) return { ...(e as CheckedDirEntry), unreadable: "not a file, folder or link" };
  return e as CheckedDirEntry;
}

export async function checkedReadDirectory(rootId: string, relPath: string): Promise<CheckedDirEntry[] | null> {
  const value = await invoke<unknown>("checked_read_dir", { rootId, relPath });
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("The directory listing could not be confirmed");
  return value.map(checkEntry);
}
