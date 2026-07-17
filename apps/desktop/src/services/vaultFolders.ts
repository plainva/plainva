import type { IVaultAdapter } from "@plainva/core";

/**
 * Child folder names one level below `path` in the OPEN vault, straight from
 * the file system (maintainer 2026-07-17): unlike the index-backed
 * getAllFolders() this also lists folders that do not contain any indexed
 * file yet — a freshly created empty folder is immediately pickable. Dot
 * folders like .plainva/.git stay hidden (never a sensible pick).
 */
export async function listVaultFolders(vaultAdapter: IVaultAdapter, path: string): Promise<string[]> {
  const entries = await vaultAdapter.listDir(path);
  return entries
    .filter((e) => e.isDirectory && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}
