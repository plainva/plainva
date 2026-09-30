import { retargetDesktopBookmarks } from "./bookmarks";
import { isTextFile, toPathIdentity, type VaultQueryService } from "@plainva/core";
import { errorText, landedAtDestination, moveItemName, retargetTemplateForInFolder, sweepPinboardRefs, type PinboardSweepDeps } from "@plainva/ui";
import { copyCandidate, parentOf } from "../components/fileTreeModel";
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
  | {
      ok: true;
      newPath: string;
      renamedLinks: number;
      changedFiles: number;
      linkUpdateFailed: boolean;
      changedPaths: string[];
      /**
       * The item IS at its new name, but a step after the rename failed
       * (issue 113, V4): the caller reports "renamed, but …" instead of
       * "rename failed", and open tabs follow.
       */
      followUpError?: string;
    }
  | { ok: false; reason: "unchanged" | "invalid-name" | "already-exists" };

/** File name (no folder) the rename UIs prefill: `.md` is hidden for notes,
 *  every other extension stays visible and editable. */
export function renameInitialName(path: string, isFolder: boolean): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  if (!isFolder && name.toLowerCase().endsWith(".md")) return name.replace(/\.md$/i, "");
  return name;
}

const WHITESPACE = /\s/;
const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && WHITESPACE.test(ch);
const isSpaceOrTab = (ch: string | undefined): boolean => ch === " " || ch === "\t";
/** Where `^` and `$` stand under the `m` flag, and what `.` does not match. */
const isLineBreak = (ch: string | undefined): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";

interface HeadingLine {
  /** Where the match starts (a line start) and ends (the line's end). */
  index: number;
  end: number;
  /** The whitespace before the marker — blank lines included. */
  lead: string;
  /** The `#` run and the blanks after it. */
  marker: string;
  text: string;
  /** The blanks after the text. */
  trail: string;
}

/**
 * The first heading line of `body` — what `/^(\s*)(#{1,6}[ \t]+)(.+?)([ \t]*)$/m`
 * matched — found in one pass (plan Befunde 24.09., E6). The pattern retried
 * its leading whitespace from every line start in a run of blank lines, and
 * its text from every blank before a line break: quadratic on a long run.
 *
 * The reading is the old one. The lead runs over blank lines up to the `#`
 * run; the marker takes every blank after one to six `#`, and gives one back
 * when nothing else is left on the line; the text is the rest of the line
 * without its trailing blanks, but at least one character.
 */
function firstHeadingLine(body: string): HeadingLine | null {
  const n = body.length;
  let lineStart = 0;
  while (lineStart <= n) {
    // A line start inside the lead of a failed line leads to the same `#`, so
    // the search resumes after it.
    let hashes = lineStart;
    while (hashes < n && isWhitespace(body[hashes])) hashes++;
    let blanks = hashes;
    while (body[blanks] === "#") blanks++;
    const level = blanks - hashes;
    let resume = blanks;
    if (level >= 1 && level <= 6 && isSpaceOrTab(body[blanks])) {
      let textStart = blanks;
      while (isSpaceOrTab(body[textStart])) textStart++;
      let end = textStart;
      while (end < n && !isLineBreak(body[end])) end++;
      if (textStart === end) textStart--;
      if (textStart > blanks) {
        let textEnd = end;
        while (textEnd > textStart + 1 && isSpaceOrTab(body[textEnd - 1])) textEnd--;
        return {
          index: lineStart,
          end,
          lead: body.slice(lineStart, hashes),
          marker: body.slice(hashes, textStart),
          text: body.slice(textStart, textEnd),
          trail: body.slice(textEnd, end),
        };
      }
      resume = end;
    }
    while (resume < n && !isLineBreak(body[resume])) resume++;
    lineStart = resume + 1;
  }
  return null;
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
  const match = firstHeadingLine(body);
  if (!match) return null;
  if (body.slice(0, match.index).trim() !== "") return null;
  if (match.text.trim() !== oldName.trim()) return null;
  const start = bodyStart + match.index;
  const end = bodyStart + match.end;
  return content.slice(0, start) + match.lead + match.marker + newName + match.trail + content.slice(end);
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
  // A typed name is created in NFC on both shells (ADR 0016, P6e).
  const name = toPathIdentity(opts.newName.trim());
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
    let result: Awaited<ReturnType<typeof renameFileWithLinkUpdates>>;
    try {
      result = await renameFileWithLinkUpdates({ adapter, queryService, oldPath, newPath });
    } catch (e) {
      // Moved on disk, then something failed: the rename happened (V4).
      if (!(await landedAtDestination(adapter, oldPath, newPath))) throw e;
      console.error("[fileActions] rename landed, a later step failed", e);
      return { ok: true, newPath, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true, changedPaths: [], followUpError: errorText(e) };
    }
    const followUpError = await followUp(() => retargetDesktopBookmarks(adapter, oldPath, newPath));
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
    return { ok: true, newPath, renamedLinks, changedFiles, linkUpdateFailed, changedPaths, ...(followUpError ? { followUpError } : {}) };
  }
  let followUpError: string | undefined;
  try {
    await adapter.renameItem(oldPath, newPath);
  } catch (e) {
    if (!(await landedAtDestination(adapter, oldPath, newPath))) throw e;
    console.error("[fileActions] rename landed, a later step failed", e);
    followUpError = errorText(e);
  }
  followUpError ??= await followUp(() => retargetDesktopBookmarks(adapter, oldPath, newPath));
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
  return { ok: true, newPath, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths, ...(followUpError ? { followUpError } : {}) };
}

/** Runs a step that follows a completed move; its failure is reported, not thrown (V4). */
async function followUp(step: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await step();
    return undefined;
  } catch (e) {
    console.error("[fileActions] a step after the move failed", e);
    return errorText(e);
  }
}

/** Minimal indexer surface the incremental-reindex helpers need (VaultIndexer satisfies it). */
export interface RenameReindexer {
  indexVaultFull(): Promise<unknown>;
  indexPath(path: string): Promise<unknown>;
  removePathFromIndex(path: string): Promise<void>;
  /** Re-keys the rows of a path the app moved itself; reports no deletion (issue 113). */
  relocatePathInIndex(from: string, to: string): Promise<void>;
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
 *
 * `moved` is what the app moved or renamed itself: the index follows it as a
 * rename (relocatePathInIndex) and re-reads the destination. Passing the old
 * path as `removed` instead told the sync layer it had been DELETED — a
 * queued remote DELETE for a path whose MOVE was already queued (issue 113).
 * Moves are relocated before a full scan too, so the scan finds every row at
 * its new place and has nothing to report as vanished.
 */
export async function applyIndexChanges(
  indexer: RenameReindexer,
  changes: {
    removed?: string[];
    added?: string[];
    moved?: ReadonlyArray<{ from: string; to: string }>;
    needsFullScan?: boolean;
  }
): Promise<void> {
  for (const { from, to } of changes.moved ?? []) await indexer.relocatePathInIndex(from, to);
  if (changes.needsFullScan) {
    await indexer.indexVaultFull();
    return;
  }
  for (const path of changes.removed ?? []) await indexer.removePathFromIndex(path);
  for (const path of new Set([...(changes.moved ?? []).map((m) => m.to), ...(changes.added ?? [])])) {
    await indexer.indexPath(path);
  }
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
    moved: [{ from: opts.oldPath, to: opts.newPath }],
    added: opts.isFolder ? [] : opts.changedPaths,
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
  } catch (err) {
    // Nothing moves while its unsaved text cannot land (issue 113, V3).
    console.error("[fileActions] rename refused: the pending save failed", err);
    ctx.toast.error(ctx.t("dialogs.moveBlockedUnsaved", { name: moveItemName(path), error: errorText(err) }));
    return;
  }
  try {
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
    let followUpError = result.followUpError;
    if (ctx.indexer) {
      followUpError ??= await followUp(() =>
        reindexAfterRename(ctx.indexer!, { oldPath: path, newPath: result.newPath, isFolder: false, changedPaths: result.changedPaths }));
    }
    ctx.refresh?.();
    if (followUpError) {
      // Renamed all the same (V4): name what failed, not the rename.
      ctx.toast.warning(ctx.t("dialogs.movedWithFollowUpError", { name: moveItemName(result.newPath), error: followUpError }));
    } else if (result.linkUpdateFailed) {
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

/* ------------------------------------------------------------------ */
/* Move                                                                */

export interface MoveOp {
  type: "move";
  from: string;
  to: string;
  isFolder: boolean;
}

export interface MoveItemsDeps {
  adapter: FileActionAdapter;
  queryService: PinboardSweepDeps["queryService"];
  indexer: RenameReindexer | null | undefined;
  /** Whether a path is a folder — the tree knows, the adapter would need a stat. */
  isFolder: (path: string) => boolean;
  /** Hears every executed move, so open tabs can follow the file. */
  onMoved?: (from: string, to: string) => void;
}

export interface MoveItemsResult {
  moved: MoveOp[];
  /** Names that stayed where they were: the target exists, or the adapter refused. */
  errors: string[];
  /**
   * Moved — the item IS at its destination and counts among `moved` — but a
   * step after the move failed (issue 113, V4). Said as "moved, but …",
   * never as a failed move.
   */
  followUpErrors: Array<{ name: string; error: string }>;
  /** Pinboard .base files rewritten because they referenced a moved path. */
  sweptBases: string[];
}

/**
 * Sources that may legitimately move into `target`: never into themselves or
 * one of their descendants, and not into the folder they are already in.
 */
export function movableInto(sources: readonly string[], target: string): string[] {
  return sources.filter((p) => Boolean(p) && p !== target && !target.startsWith(p + "/") && parentOf(p) !== target);
}

/**
 * Moves files and folders into `target` ("" = vault root). Drag & drop in the
 * tree and the context menu's "Move to…" (Issue #77) both run through here,
 * so a move behaves the same whichever way it was asked for: the pinboard
 * references follow (plan Pinboard P5; folders rewrite by prefix), the index
 * relocates the paths, and moves deliberately rewrite no links — a moved note
 * keeps its raw paths exactly as a drag always did.
 */
export async function moveItems(deps: MoveItemsDeps, sources: readonly string[], target: string): Promise<MoveItemsResult> {
  const moved: MoveOp[] = [];
  const errors: string[] = [];
  const followUpErrors: MoveItemsResult["followUpErrors"] = [];
  for (const from of movableInto(sources, target)) {
    const name = from.split(/[/\\]/).pop();
    if (!name) continue;
    const to = target ? `${target}/${name}` : name;
    try {
      if (await deps.adapter.exists(to)) {
        errors.push(name);
        continue;
      }
      await deps.adapter.renameItem(from, to);
    } catch (err) {
      // The disk rename and the queued MOVE are two steps: when the second
      // fails the item has moved all the same (V4). Only an item still at its
      // source is a failed move.
      if (!(await landedAtDestination(deps.adapter, from, to))) {
        console.error("[fileActions] move failed", from, err);
        errors.push(name);
        continue;
      }
      console.error("[fileActions] move landed, a later step failed", from, err);
      followUpErrors.push({ name, error: errorText(err) });
    }
    const bookmarkError = await followUp(() => retargetDesktopBookmarks(deps.adapter, from, to));
    if (bookmarkError) followUpErrors.push({ name, error: bookmarkError });
    // The tab follows whatever failed after the move: the file IS there now.
    deps.onMoved?.(from, to);
    moved.push({ type: "move", from, to, isFolder: deps.isFolder(from) });
  }
  let sweptBases: string[] = [];
  if (moved.length > 0) {
    try {
      sweptBases = await sweepPinboardRefs(
        { adapter: deps.adapter, queryService: deps.queryService },
        moved.filter((o) => !o.isFolder).map((o) => ({ from: o.from, to: o.to })),
        moved.filter((o) => o.isFolder).map((o) => ({ from: o.from, to: o.to })),
      );
    } catch (err) {
      console.warn("[fileActions] pinboard sweep after move failed", err);
    }
    if (deps.indexer) {
      // A moved folder changes many descendant paths → full scan; moved files
      // just relocate.
      const anyFolder = moved.some((o) => o.isFolder);
      const indexError = await followUp(() => applyIndexChanges(deps.indexer!, {
        needsFullScan: anyFolder,
        moved: moved.map((o) => ({ from: o.from, to: o.to })),
        added: anyFolder ? [] : sweptBases,
      }));
      if (indexError) followUpErrors.push({ name: moved.map((o) => o.to.split("/").pop()).join(", "), error: indexError });
    }
  }
  return { moved, errors, followUpErrors, sweptBases };
}
