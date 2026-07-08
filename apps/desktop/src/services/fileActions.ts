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
  | { ok: true; newPath: string; renamedLinks: number; changedFiles: number; linkUpdateFailed: boolean }
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
    return { ok: true, newPath, renamedLinks: result.renamedLinks, changedFiles: result.changedFiles, linkUpdateFailed: result.linkUpdateFailed };
  }
  await adapter.renameItem(oldPath, newPath);
  return { ok: true, newPath, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false };
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
