import { useTranslation } from "react-i18next";
import { Fragment } from "react";
import {
  ArchiveRestore, Copy, Database, Download,
  ExternalLink, FilePlus, FolderPlus, FolderInput, RefreshCw, Trash2,
  XCircle, X as XIcon, Files } from "lucide-react";
import { fileRowActions, ICON, MenuSurface, MenuItem, MenuSeparator, MenuLabel, type RowActionSpec } from "@plainva/ui";

/**
 * Test ids the E2E reach for. They hang on the shared list's ids, so a renamed
 * label cannot break them and a new entry gets one for free.
 */
const TEST_ID: Partial<Record<string, string>> = {
  move: "tree-move-to",
  versionHistory: "tree-version-history",
  resolveConflict: "tree-resolve-conflict",
  delete: "tree-delete",
};
/** The "Öffnen" group of the file menu; everything else is "Datei". */
const OPEN_IDS = new Set(["openNewTab", "openSplitRight", "openSplitDown"]);
import { isVirtualPath } from "./graph/virtualPaths";

/**
 * The right-click menu for a vault path — one component for the file tree AND
 * the two pinned lists above it ("Recently opened", "Bookmarks"), so those
 * lists stop being the only places where a right-click does nothing (plan P4).
 *
 * Purely presentational: it owns no state and knows no services. Every action
 * is an optional callback, and a missing callback means a missing entry — that
 * is how the lists drop the tree-only branches (creating things, the whole
 * folder arm, bulk actions) without a second menu implementation.
 *
 * Virtual rows (vault map, tasks, calendar, mail) can appear in "Recently
 * opened" but are not files: they get "open" and "remove from list" only.
 */

const isConflictPath = (p: string) => p.includes(".CONFLICT-");

export interface FileContextMenuProps {
  x: number;
  y: number;
  path: string;
  isFolder: boolean;
  /** >1 renders the bulk variant (the tree's multi-selection). */
  selectionCount?: number;
  onClose: () => void;

  /* Open */
  onOpenNewTab?: (path: string) => void;
  onOpenInSplit?: (path: string, direction: "vertical" | "horizontal") => void;

  /* File */
  /** Opens the template picker, then names the note in the tree. */
  onNewFromTemplate?: (parentPath: string) => void;
  onRename?: (path: string, isFolder: boolean) => void;
  onDuplicate?: (paths: string[]) => void;
  /** Opens the folder picker for the given paths (Issue #77: a way without drag). */
  onMove?: (paths: string[]) => void;
  isBookmarked?: (path: string) => boolean;
  onToggleBookmark?: (path: string) => void;
  onVersionHistory?: (path: string) => void;
  onRevealInTree?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  /** Removes the entry from the list it was right-clicked in (never the file). */
  onRemoveFromList?: (path: string) => void;
  onDelete?: (path: string, isFolder: boolean) => void;

  /* Conflict copies: the ONLY way out leads through the comparison (P2) —
     the two blind entries ("keep this version" / "discard conflict") are gone. */
  onResolveConflict?: (path: string) => void;

  /* New / folder (tree only) */
  onNewItem?: (type: "file" | "folder" | "base", parentPath: string) => void;
  onImport?: () => void;
  onRefresh?: (path: string) => void;
  onGenerateIndex?: (path: string) => void;
  /** True when the folder already carries an overview note — the entry then says "refresh" (shared list). */
  hasOverview?: (path: string) => boolean;
  onUpdateAllIndexes?: () => void;
  onRestoreDeleted?: () => void;

  /* Bulk (tree only) */
  onBulkDuplicate?: () => void;
  onBulkMove?: () => void;
  onClearSelection?: () => void;
  onBulkDelete?: () => void;
}

export function FileContextMenu(props: FileContextMenuProps) {
  const { t } = useTranslation();
  const { x, y, path, isFolder, selectionCount = 1, onClose } = props;
  const conflict = isConflictPath(path);
  const virtual = isVirtualPath(path);

  const surface = (children: React.ReactNode) => (
    <MenuSurface open onClose={onClose} at={{ x, y }} minWidth={188} ariaLabel={t("fileTree.fileActions")}>
      {children}
    </MenuSurface>
  );

  // Bulk: the actions target the whole (pruned) selection.
  if (selectionCount > 1 && props.onBulkDelete) {
    return surface(
      <>
        <MenuLabel>{t("fileTree.selectedCount", { count: selectionCount })}</MenuLabel>
        {props.onBulkDuplicate && (
          <MenuItem icon={<Copy size={ICON.ui} />} onSelect={props.onBulkDuplicate}>{t("fileTree.duplicate")}</MenuItem>
        )}
        {props.onBulkMove && (
          <MenuItem icon={<FolderInput size={ICON.ui} />} data-testid="tree-move-to" onSelect={props.onBulkMove}>{t("fileTree.moveTo")}</MenuItem>
        )}
        {props.onClearSelection && (
          <MenuItem icon={<XCircle size={ICON.ui} />} onSelect={props.onClearSelection}>{t("fileTree.clearSelection")}</MenuItem>
        )}
        <MenuSeparator />
        <MenuItem danger icon={<Trash2 size={ICON.ui} />} onSelect={props.onBulkDelete}>{t("common.delete")}</MenuItem>
      </>,
    );
  }

  // A vault map / task view is a place, not a file: open it or forget it.
  if (virtual) {
    return surface(
      <>
        {props.onOpenNewTab && (
          <MenuItem icon={<ExternalLink size={ICON.ui} />} onSelect={() => props.onOpenNewTab!(path)}>{t("fileTree.openNewTab")}</MenuItem>
        )}
        {props.onRemoveFromList && (
          <MenuItem icon={<XIcon size={ICON.ui} />} onSelect={() => props.onRemoveFromList!(path)}>
            {t("fileTree.removeFromList", { defaultValue: "Aus der Liste entfernen" })}
          </MenuItem>
        )}
      </>,
    );
  }

  // The row's own actions, once. Handlers the caller did not pass leave no
  // entry; the delete sits at the end of every list, with its own separator.
  const rowList: RowActionSpec[] = !path
    ? []
    : fileRowActions(t, {
        isFolder,
        openNewTab: !isFolder && props.onOpenNewTab ? () => props.onOpenNewTab!(path) : undefined,
        openSplitRight: !isFolder && props.onOpenInSplit ? () => props.onOpenInSplit!(path, "vertical") : undefined,
        openSplitDown: !isFolder && props.onOpenInSplit ? () => props.onOpenInSplit!(path, "horizontal") : undefined,
        rename: props.onRename ? () => props.onRename!(path, isFolder) : undefined,
        duplicate: !isFolder && !conflict && props.onDuplicate ? () => props.onDuplicate!([path]) : undefined,
        move: props.onMove ? () => props.onMove!([path]) : undefined,
        overview: isFolder && props.onGenerateIndex ? () => props.onGenerateIndex!(path) : undefined,
        overviewExists: isFolder ? props.hasOverview?.(path) === true : undefined,
        bookmarked: !isFolder && props.onToggleBookmark ? props.isBookmarked?.(path) === true : undefined,
        bookmark: !isFolder && props.onToggleBookmark ? () => props.onToggleBookmark!(path) : undefined,
        versionHistory: !isFolder && !conflict && props.onVersionHistory ? () => props.onVersionHistory!(path) : undefined,
        resolveConflict: !isFolder && conflict && props.onResolveConflict ? () => props.onResolveConflict!(path) : undefined,
        reveal: !isFolder && props.onRevealInTree ? () => props.onRevealInTree!(path) : undefined,
        copyPath: props.onCopyPath ? () => props.onCopyPath!(path) : undefined,
        removeFromList: !isFolder && props.onRemoveFromList ? () => props.onRemoveFromList!(path) : undefined,
        delete: props.onDelete ? () => props.onDelete!(path, isFolder) : undefined,
      });

  return surface(
    <>
      {isFolder ? (
        <>
          {props.onNewItem && (
            <>
              <MenuLabel>{t("fileTree.groupNew", "Neu")}</MenuLabel>
              <MenuItem icon={<FilePlus size={ICON.ui} />} onSelect={() => props.onNewItem!("file", path)}>{t("fileTree.newNoteHere")}</MenuItem>
              {props.onNewFromTemplate && (
                <MenuItem icon={<Files size={ICON.ui} />} data-testid="tree-new-from-template" onSelect={() => props.onNewFromTemplate!(path)}>
                  {t("fileTree.newFromTemplate", "Neue Notiz aus Vorlage …")}
                </MenuItem>
              )}
              <MenuItem icon={<FolderPlus size={ICON.ui} />} onSelect={() => props.onNewItem!("folder", path)}>{t("fileTree.newFolderHere")}</MenuItem>
              <MenuItem icon={<Database size={ICON.ui} />} onSelect={() => props.onNewItem!("base", path)}>{t("fileTree.newBaseHere", "Neue Datenbank (.base)")}</MenuItem>
              {props.onImport && (
                <MenuItem icon={<Download size={ICON.ui} />} onSelect={props.onImport}>{t("import.contextAction", "Aus anderer App importieren...")}</MenuItem>
              )}
              <MenuSeparator />
            </>
          )}
          <MenuLabel>{path === "" ? t("fileTree.groupVault", "Vault") : t("fileTree.groupFolder", "Ordner")}</MenuLabel>
          {/* The fast path on a huge vault — reconcile just this subtree
              instead of walking all 20.000 files. */}
          {props.onRefresh && (
            <MenuItem icon={<RefreshCw size={ICON.ui} />} data-testid="tree-refresh-folder" onSelect={() => props.onRefresh!(path)}>
              {path === ""
                ? t("refresh.action", { defaultValue: "Vault neu einlesen" })
                : t("refresh.folderAction", { defaultValue: "Ordner neu einlesen" })}
            </MenuItem>
          )}
          {path === "" && props.onGenerateIndex && (
            <MenuItem icon={<RefreshCw size={ICON.ui} />} onSelect={() => props.onGenerateIndex!(path)}>{t("indexMd.contextAction")}</MenuItem>
          )}
          {path === "" && props.onUpdateAllIndexes && (
            <MenuItem icon={<RefreshCw size={ICON.ui} />} onSelect={props.onUpdateAllIndexes}>{t("indexMd.updateAllAction")}</MenuItem>
          )}
          {path === "" && props.onRestoreDeleted && (
            <MenuItem icon={<ArchiveRestore size={ICON.ui} />} data-testid="tree-deleted-files" onSelect={props.onRestoreDeleted}>
              {t("fileTree.restoreDeleted")}
            </MenuItem>
          )}
          {/* What a FOLDER row can do — from the one list both shells read
              (Design-Runde E2). The place actions above (new here, refresh,
              restore) belong to the place, not to the row. */}
          {path && rowList.map((a) => (
            <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={TEST_ID[a.id]} onSelect={a.run}>{a.label}</MenuItem>
          ))}
        </>
      ) : (
        <>
          {/* What a FILE row can do — the same list the phone's sheet and swipe
              read. The two headings are the desktop's grouping of it: what
              opens the file elsewhere, then what changes the file. */}
          {rowList.map((a, i, all) => {
            const first = i === 0;
            const startsFileGroup = !OPEN_IDS.has(a.id) && (first || OPEN_IDS.has(all[i - 1].id));
            return (
              <Fragment key={a.id}>
                {first && OPEN_IDS.has(a.id) && <MenuLabel>{t("fileTree.groupOpen", "Öffnen")}</MenuLabel>}
                {startsFileGroup && !first && <MenuSeparator />}
                {startsFileGroup && <MenuLabel>{t("fileTree.groupFile", "Datei")}</MenuLabel>}
                {a.danger && !all[i - 1]?.danger && <MenuSeparator />}
                <MenuItem icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={TEST_ID[a.id]} onSelect={a.run}>{a.label}</MenuItem>
              </Fragment>
            );
          })}
        </>
      )}
    </>,
  );
}
