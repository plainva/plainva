import { isTextFile, type VaultQueryService } from "@plainva/core";
import { retargetTemplateForInFolder, sweepPinboardRefs } from "@plainva/ui";
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
  listDir(path: string): Promise<Array<{ path: string; isDirectory: boolean }>>;
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
 * Rewrites a note's first heading when it MIRRORS the old file name — the state
 * a database entry starts in (`buildNewItemContent` writes `# <file name>`).
 * Returns null when nothing should change: no heading, a heading the user
 * wrote, or a heading that is not the document's first content line.
 * Frontmatter is skipped, never rewritten.
 */
export function carryMirroredHeading(content: string, oldName: string, newName: string): string | null {
  const fm = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
  const bodyStart = fm >= 0 ? content.indexOf("\n", fm + 1) + 1 : 0;
  const body = content.slice(bodyStart);
  // The heading must be the first non-empty body line — a "# Task_1" buried in
  // the middle of a note is prose, not a title.
  const match = body.match(/^(\s*)(#{1,6}[ \t]+)(.+?)([ \t]*)$/m);
  if (!match || match.index === undefined) return null;
  if (body.slice(0, match.index).trim() !== "") return null;
  if (match[3].trim() !== oldName.trim()) return null;
  const start = bodyStart + match.index;
  const end = start + match[0].length;
  return content.slice(0, start) + match[1] + match[2] + newName + match[4] + content.slice(end);
}

/**
 * Renames `oldPath` (vault-relative) to `newName` within its folder. Notes AND
 * `.base` databases get the vault-wide link retargeting (W5; bases since plan
 * Vorlagen-Datenbank-Zuordnung P5 — body links/embeds like `![[Tasks.base]]`
 * silently broke before); folders and other attachments keep the plain rename.
 * `.md` is re-appended only when the ORIGINAL file was a note — typing
 * "photo2.png" over an attachment must not produce "photo2.png.md" (the old
 * tree-local logic appended unconditionally). A `.base` rename additionally
 * sweeps `plainva.templateFor` assignments in `templateFolder` (plan P4) —
 * that namespace is deliberately absent from the link index, so the backlink
 * chain cannot carry it.
 */
export async function renameToName(opts: {
  adapter: FileActionAdapter;
  queryService: VaultQueryService | null;
  oldPath: string;
  newName: string;
  isFolder: boolean;
  /** Vault-relative template folder for the `.base` templateFor sweep; omit to skip it. */
  templateFolder?: string;
  /**
   * Carry a mirrored H1 along (issue #34). A note created from a database gets
   * `# <file name>`, so renaming the file alone would leave the note titled
   * "Task_1" in the text while the tree shows the new name. The heading only
   * moves when it EXACTLY matches the old file name — a heading the user wrote
   * themselves is never touched.
   */
  carryHeading?: boolean;
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

  // Before the move, while the old name is still the truth.
  if (opts.carryHeading && wasNote) {
    try {
      const before = await adapter.readTextFile(oldPath);
      const carried = carryMirroredHeading(before, renameInitialName(oldPath, false), name);
      if (carried !== null) await adapter.writeTextFile(oldPath, carried);
    } catch (e) {
      console.warn("[fileActions] heading carry before rename failed", e);
    }
  }

  const isBaseRename =
    !isFolder && oldPath.toLowerCase().endsWith(".base") && newPath.toLowerCase().endsWith(".base");
  if (queryService && ((wasNote && newPath.toLowerCase().endsWith(".md")) || isBaseRename)) {
    const result = await renameFileWithLinkUpdates({ adapter, queryService, oldPath, newPath });
    let { renamedLinks, changedFiles, linkUpdateFailed } = result;
    const changedPaths = [...result.changedPaths];
    if (isBaseRename && opts.templateFolder) {
      try {
        const rows = await queryService.db.query<{ path: string }>(`SELECT path FROM files`);
        const sweep = await retargetTemplateForInFolder({
          adapter,
          folder: opts.templateFolder,
          oldBasePath: oldPath,
          newBasePath: newPath,
          allFilePaths: rows.map((r) => r.path),
        });
        renamedLinks += sweep.renamed;
        changedFiles += sweep.changedPaths.length;
        for (const p of sweep.changedPaths) if (!changedPaths.includes(p)) changedPaths.push(p);
      } catch (e) {
        console.warn("[fileActions] templateFor sweep after .base rename failed", e);
        linkUpdateFailed = true;
      }
    }
    return { ok: true, newPath, renamedLinks, changedFiles, linkUpdateFailed, changedPaths };
  }
  await adapter.renameItem(oldPath, newPath);
  // Folder renames change every descendant path: retarget pinboard
  // arrangements (they store vault-relative paths, plan Pinboard P5).
  // Attachments sweep as an exact move — a no-op unless a board lists them.
  let changedPaths: string[] = [];
  try {
    changedPaths = await sweepPinboardRefs(
      { adapter, queryService },
      isFolder ? [] : [{ from: oldPath, to: newPath }],
      isFolder ? [{ from: oldPath, to: newPath }] : [],
    );
  } catch (e) {
    console.warn("[fileActions] pinboard sweep after rename failed", e);
  }
  return { ok: true, newPath, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths };
}

/** Minimal indexer surface the incremental-reindex helpers need (VaultIndexer satisfies it). */
export interface RenameReindexer {
  indexVaultFull(): Promise<unknown>;
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

/** Minimal translator surface (react-i18next's `t` satisfies it). */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

export interface PromptRenameContext {
  adapter: FileActionAdapter;
  queryService: VaultQueryService | null;
  indexer: RenameReindexer | null;
  t: Translate;
  /** Ask for the new name; returning null cancels. */
  prompt: (opts: { title: string; initial: string }) => Promise<string | null>;
  toast: { error: (m: string) => void; warning: (m: string) => void; success: (m: string) => void };
  /** Flush a pending debounced save first — after the rename it would resurrect the old path. */
  flush?: (path: string) => Promise<void>;
  /** Vault-relative template folder, resolved lazily (only `.base` renames need it). */
  templateFolder?: () => Promise<string | undefined>;
  onRenamed?: (oldPath: string, newPath: string) => void;
  /** Refresh the sidebar (triggerFileTreeUpdate). */
  refresh?: () => void;
  notify?: (ops: { type: "move"; from: string; to: string }[]) => void;
}

/**
 * Rename a FILE through a prompt dialog — the flow the editor's ⋮ menu and the
 * pinned sidebar lists share (plan P4). The file tree keeps its own path: there
 * the new name is typed into the row itself, which is a different interaction,
 * not a different rename.
 */
export async function promptRenameFile(path: string, ctx: PromptRenameContext): Promise<void> {
  const next = await ctx.prompt({
    title: ctx.t("common.rename", { defaultValue: "Umbenennen" }),
    initial: renameInitialName(path, false),
  });
  if (next == null) return;
  try {
    await ctx.flush?.(path);
    const result = await renameToName({
      adapter: ctx.adapter,
      queryService: ctx.queryService,
      oldPath: path,
      newName: next,
      isFolder: false,
      templateFolder: path.toLowerCase().endsWith(".base") ? await ctx.templateFolder?.() : undefined,
    });
    if (!result.ok) {
      if (result.reason === "already-exists") ctx.toast.error(ctx.t("dialogs.alreadyExistsMsg"));
      else if (result.reason === "invalid-name") ctx.toast.error(ctx.t("dialogs.invalidNameMsg"));
      return;
    }
    ctx.onRenamed?.(path, result.newPath);
    if (ctx.indexer) {
      await reindexAfterRename(ctx.indexer, { oldPath: path, newPath: result.newPath, isFolder: false, changedPaths: result.changedPaths });
    }
    ctx.refresh?.();
    if (result.linkUpdateFailed) {
      ctx.toast.warning(ctx.t("dialogs.renameLinksFailed"));
    } else if (result.changedFiles > 0) {
      ctx.toast.success(ctx.t("dialogs.renameLinksUpdated", { links: result.renamedLinks, files: result.changedFiles }));
    }
    ctx.notify?.([{ type: "move", from: path, to: result.newPath }]);
  } catch (err) {
    console.error("[fileActions] rename failed", err);
    ctx.toast.error(ctx.t("dialogs.renameErrorMsg", { error: (err as Error).message }));
  }
}
