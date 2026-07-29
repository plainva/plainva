import { useTranslation } from "react-i18next";
import {
  ArchiveRestore, Bookmark, Check, ClipboardCopy, Columns2, Copy, Database, Download,
  ExternalLink, FilePlus, FolderPlus, History, ListTree, Pencil, RefreshCw, Rows2, Trash2,
  XCircle, FolderTree, X as XIcon, Files } from "lucide-react";
import { ICON, MenuSurface, MenuItem, MenuSeparator, MenuLabel } from "@plainva/ui";
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
  isBookmarked?: (path: string) => boolean;
  onToggleBookmark?: (path: string) => void;
  onVersionHistory?: (path: string) => void;
  onRevealInTree?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  /** Removes the entry from the list it was right-clicked in (never the file). */
  onRemoveFromList?: (path: string) => void;
  onDelete?: (path: string, isFolder: boolean) => void;

  /* Conflict copies */
  onKeepConflict?: (path: string) => void;
  onDiscardConflict?: (path: string) => void;
  onResolveConflict?: (path: string) => void;

  /* New / folder (tree only) */
  onNewItem?: (type: "file" | "folder" | "base", parentPath: string) => void;
  onImport?: () => void;
  onRefresh?: (path: string) => void;
  onGenerateIndex?: (path: string) => void;
  onUpdateAllIndexes?: () => void;
  onRestoreDeleted?: () => void;

  /* Bulk (tree only) */
  onBulkDuplicate?: () => void;
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

  return surface(
    <>
      {conflict && (props.onKeepConflict || props.onDiscardConflict) && (
        <>
          {props.onKeepConflict && (
            <MenuItem icon={<Check size={ICON.ui} />} onSelect={() => props.onKeepConflict!(path)}>{t("fileTree.keepVersion")}</MenuItem>
          )}
          {props.onDiscardConflict && (
            <MenuItem danger icon={<Trash2 size={ICON.ui} />} onSelect={() => props.onDiscardConflict!(path)}>{t("fileTree.discardConflict")}</MenuItem>
          )}
          <MenuSeparator />
        </>
      )}
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
          {props.onGenerateIndex && (
            <MenuItem icon={<ListTree size={ICON.ui} />} onSelect={() => props.onGenerateIndex!(path)}>{t("indexMd.contextAction")}</MenuItem>
          )}
          {path === "" && props.onUpdateAllIndexes && (
            <MenuItem icon={<RefreshCw size={ICON.ui} />} onSelect={props.onUpdateAllIndexes}>{t("indexMd.updateAllAction")}</MenuItem>
          )}
          {path === "" && props.onRestoreDeleted && (
            <MenuItem icon={<ArchiveRestore size={ICON.ui} />} data-testid="tree-deleted-files" onSelect={props.onRestoreDeleted}>
              {t("fileTree.restoreDeleted")}
            </MenuItem>
          )}
          {path && (
            <>
              {props.onRename && (
                <MenuItem icon={<Pencil size={ICON.ui} />} onSelect={() => props.onRename!(path, true)}>{t("common.rename")}</MenuItem>
              )}
              {props.onCopyPath && (
                <MenuItem icon={<ClipboardCopy size={ICON.ui} />} onSelect={() => props.onCopyPath!(path)}>{t("fileTree.copyPath")}</MenuItem>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <MenuLabel>{t("fileTree.groupOpen", "Öffnen")}</MenuLabel>
          {props.onOpenNewTab && (
            <MenuItem icon={<ExternalLink size={ICON.ui} />} onSelect={() => props.onOpenNewTab!(path)}>{t("fileTree.openNewTab")}</MenuItem>
          )}
          {props.onOpenInSplit && (
            <>
              <MenuItem icon={<Columns2 size={ICON.ui} />} onSelect={() => props.onOpenInSplit!(path, "vertical")}>{t("fileTree.openSplitRight")}</MenuItem>
              <MenuItem icon={<Rows2 size={ICON.ui} />} onSelect={() => props.onOpenInSplit!(path, "horizontal")}>{t("fileTree.openSplitDown")}</MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuLabel>{t("fileTree.groupFile", "Datei")}</MenuLabel>
          {props.onRename && (
            <MenuItem icon={<Pencil size={ICON.ui} />} onSelect={() => props.onRename!(path, false)}>{t("common.rename")}</MenuItem>
          )}
          {!conflict && props.onDuplicate && (
            <MenuItem icon={<Copy size={ICON.ui} />} onSelect={() => props.onDuplicate!([path])}>{t("fileTree.duplicate")}</MenuItem>
          )}
          {props.onToggleBookmark && (
            <MenuItem
              icon={<Bookmark size={ICON.ui} fill={props.isBookmarked?.(path) ? "currentColor" : "none"} />}
              onSelect={() => props.onToggleBookmark!(path)}
            >
              {props.isBookmarked?.(path) ? t("editor.removeBookmark") : t("editor.addBookmark")}
            </MenuItem>
          )}
          {!conflict && props.onVersionHistory && (
            <MenuItem icon={<History size={ICON.ui} />} data-testid="tree-version-history" onSelect={() => props.onVersionHistory!(path)}>
              {t("fileTree.versionHistory")}
            </MenuItem>
          )}
          {conflict && props.onResolveConflict && (
            <MenuItem icon={<History size={ICON.ui} />} data-testid="tree-resolve-conflict" onSelect={() => props.onResolveConflict!(path)}>
              {t("conflict.resolveAction")}
            </MenuItem>
          )}
          {props.onRevealInTree && (
            <MenuItem icon={<FolderTree size={ICON.ui} />} onSelect={() => props.onRevealInTree!(path)}>
              {t("editor.revealInTree", { defaultValue: "Im Dateibaum anzeigen" })}
            </MenuItem>
          )}
          {props.onCopyPath && (
            <MenuItem icon={<ClipboardCopy size={ICON.ui} />} onSelect={() => props.onCopyPath!(path)}>{t("fileTree.copyPath")}</MenuItem>
          )}
          {props.onRemoveFromList && (
            <MenuItem icon={<XIcon size={ICON.ui} />} onSelect={() => props.onRemoveFromList!(path)}>
              {t("fileTree.removeFromList", { defaultValue: "Aus der Liste entfernen" })}
            </MenuItem>
          )}
        </>
      )}
      {path && props.onDelete && (
        <>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 size={ICON.ui} />} onSelect={() => props.onDelete!(path, isFolder)}>{t("common.delete")}</MenuItem>
        </>
      )}
    </>,
  );
}
