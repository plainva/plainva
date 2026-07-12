import { isTextFile, type VaultQueryService } from "@plainva/core";
import { copyCandidate } from "../components/fileTreeModel";
import { renameFileWithLinkUpdates, type RenameAdapter } from "./renameNote";

/**
 * Shared file actions behind the file-tree context menu AND the editor's ⋮
 * menu (plan UI-Menüs 2026-07-05, P4): one implementation for "rename by new
 * name" and "duplicate", so the two menus can never drift apart. The callers
 * own their UI (inline tree errors vs. prompt+toast) — this module only maps
 * a requested name to the vault operation.
 */

export interface FileActionAdapter extends RenameAdapter {
  exists(path: string): Promise<boolean>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
}

export type RenameToNameResult =
  | { ok: true; newPath: string; renamedLinks: number; changedFiles: number; linkUpdateFailed: boolean; changedPaths: string[] }
  | { ok: false; reason: "unchanged" | "invalid-name" | "already-exists" };

/** File name (no folder) the rename UIs prefill: `.md` is hidden for notes,
 *  every other extension stays visible and editable. */
export function renameInitialName(path: string, isFolder: boolean): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  if (!isFolder && name.toLowerCase().endsWith(".md")) return name.replace(/\.md$/i, "");
  return name;
}

/**
 * Renames `oldPath` (vault-relative) to `newName` within its folder. Notes get
 * the vault-wide link retargeting (W5); folders and attachments keep the plain
 * rename. `.md` is re-appended only when the ORIGINAL file was a note — typing
 * "photo2.png" over an attachment must not produce "photo2.png.md" (the old
 * tree-local logic appended unconditionally).
 */
export async function renameToName(opts: {
  adapter: FileActionAdapter;
  queryService: VaultQueryService | null;
  oldPath: string;
  newName: string;
  isFolder: boolean;
}): Promise<RenameToNameResult> {
  const { adapter, queryService, oldPath, isFolder } = opts;
  const name = opts.newName.trim();
  if (!name) return { ok: false, reason: "invalid-name" };
  if (name === renameInitialName(oldPath, isFolder)) return { ok: false, reason: "unchanged" };
  if (name.includes("/") || name.includes("\\")) return { ok: false, reason: "invalid-name" };

  const wasNote = !isFolder && oldPath.toLowerCase().endsWith(".md");
  const extension = wasNote && !name.toLowerCase().endsWith(".md") ? ".md" : "";
  const finalName = name + extension;
  const parts = oldPath.split(/[/\\]/);
  parts.pop();
  const parentPath = parts.join("/");
  const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;

  if (await adapter.exists(newPath)) return { ok: false, reason: "already-exists" };

  if (wasNote && newPath.toLowerCase().endsWith(".md") && queryService) {
    const result = await renameFileWithLinkUpdates({ adapter, queryService, oldPath, newPath });
    return { ok: true, newPath, renamedLinks: result.renamedLinks, changedFiles: result.changedFiles, linkUpdateFailed: result.linkUpdateFailed, changedPaths: result.changedPaths };
  }
  await adapter.renameItem(oldPath, newPath);
  return { ok: true, newPath, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths: [] };
}

/** Minimal indexer surface the incremental-reindex helpers need (VaultIndexer satisfies it). */
export interface RenameReindexer {
  indexVaultFull(): Promise<void>;
  indexPath(path: string): Promise<unknown>;
  removePathFromIndex(path: string): Promise<void>;
}

/**
 * Apply the smallest index update for a structural change so the sidebar
 * refreshes without a full-vault reindex — a full scan on every create/delete/
 * move/rename was the visible lag (Issue #9). `needsFullScan` (e.g. a folder
 * delete/move that changes many descendant paths at once) falls back to the
 * full scan; otherwise the removed paths are de-indexed and the added ones
 * indexed individually. An empty change with `needsFullScan: false` is a no-op
 * (e.g. creating an empty folder needs no index work — the tree refresh alone
 * lists it). Sync semantics are identical to the full scan: removePathFromIndex
 * fires onLocalFileDeleted, a freshly indexed path fires onNewLocalFile.
 */
export async function applyIndexChanges(
  indexer: RenameReindexer,
  changes: { removed?: string[]; added?: string[]; needsFullScan?: boolean }
): Promise<void> {
  if (changes.needsFullScan) {
    await indexer.indexVaultFull();
    return;
  }
  for (const path of changes.removed ?? []) await indexer.removePathFromIndex(path);
  for (const path of new Set(changes.added ?? [])) await indexer.indexPath(path);
}

/**
 * Refresh the index after a rename with the least work (Issue #9). A FILE
 * rename removes the old path, indexes the new one and re-indexes the handful
 * of files whose links were rewritten. A FOLDER rename changes many descendant
 * paths at once, so it falls back to the full scan.
 */
export async function reindexAfterRename(
  indexer: RenameReindexer,
  opts: { oldPath: string; newPath: string; isFolder: boolean; changedPaths: string[] }
): Promise<void> {
  await applyIndexChanges(indexer, {
    needsFullScan: opts.isFolder,
    removed: opts.isFolder ? [] : [opts.oldPath],
    added: opts.isFolder ? [] : [opts.newPath, ...opts.changedPaths],
  });
}

/** "Datei duplizieren" (P8): text files copy as text, attachments byte-wise;
 *  the copy gets the next free "(Kopie)" name next to the original. */
export async function duplicateFile(adapter: FileActionAdapter, path: string, copySuffix: string): Promise<string> {
  let candidate = copyCandidate(path, copySuffix, 1);
  for (let n = 2; await adapter.exists(candidate); n++) {
    candidate = copyCandidate(path, copySuffix, n);
  }
  if (isTextFile(path)) {
    await adapter.writeTextFile(candidate, await adapter.readTextFile(path));
  } else {
    await adapter.writeBinaryFile(candidate, await adapter.readBinaryFile(path));
  }
  return candidate;
}
