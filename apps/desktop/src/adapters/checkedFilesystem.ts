import { invoke } from "@tauri-apps/api/core";

export interface CheckedDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
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

export async function checkedReadDirectory(rootId: string, relPath: string): Promise<CheckedDirEntry[] | null> {
  const value = await invoke<unknown>("checked_read_dir", { rootId, relPath });
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry.name !== "string"
    || !entry.name || entry.name.includes("/") || entry.name.includes("\\")
    || typeof entry.isFile !== "boolean" || typeof entry.isDirectory !== "boolean" || typeof entry.isSymlink !== "boolean"
    || (!entry.isFile && !entry.isDirectory && !entry.isSymlink))) throw new Error("The directory listing could not be confirmed");
  return value as CheckedDirEntry[];
}
