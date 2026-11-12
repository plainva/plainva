import { isAppleDoubleName, isHiddenPath, isInternalPath, type VaultFileInfo } from "@plainva/core";

/**
 * What the file tree takes from a walk of the vault folder: its folders always
 * (the index has no folder rows), and its files while the first index is built
 * behind the open app (performance plan L3) — the tree draws them until the
 * index has them, as the index will name them (a note by its file name until
 * its title is read).
 *
 * The same files the index takes, and the tree shows: never an internal path
 * in any spelling (`isInternalPath`), never a dot file or dot folder (hidden,
 * E8), never an AppleDouble sidecar (`._Note.md`, judged here by its name —
 * the index reads its header; a person's own `._notes.md` waits for the index).
 */
export function treeDiskEntries(listing: readonly VaultFileInfo[]): {
  folders: { path: string; title: string; isDir: true }[];
  files: { path: string; title: string }[];
} {
  const folders: { path: string; title: string; isDir: true }[] = [];
  const files: { path: string; title: string }[] = [];
  for (const f of listing) {
    if (isInternalPath(f.path) || isHiddenPath(f.path)) continue;
    if (f.isDirectory) folders.push({ path: f.path, title: f.name, isDir: true });
    else if (!isAppleDoubleName(f.name)) files.push({ path: f.path, title: f.name.endsWith(".md") ? f.name.slice(0, -3) : f.name });
  }
  return { folders, files };
}
