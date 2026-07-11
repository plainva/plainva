import React, { useEffect, useMemo, useState } from "react";
import { appConfirm } from "../services/appDialogs";
import { confirmDeletion, countAffectedFiles } from "../services/deleteConfirm";
import { toast } from "@plainva/ui";
import { MenuSurface, MenuItem, MenuSeparator, MenuLabel } from "@plainva/ui";
import { openPath } from "@tauri-apps/plugin-opener";

import { isTextFile, isInternalPath, VaultQueryService } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import {
  FileText, ChevronRight, ChevronDown, Folder, AlertTriangle, Paperclip, Database,
  FilePlus, FolderPlus, ExternalLink, Columns2, Rows2, Pencil, Copy, Bookmark,
  History, ClipboardCopy, Trash2, RefreshCw, ArchiveRestore, ListTree, Check, XCircle,
} from "lucide-react";
import { buildNewNoteContent, getConfiguredNoteType } from "../services/newNote";
import { hasSnippetMark, renderSnippetNodes } from "@plainva/ui";
import { setPendingSearchJump } from "@plainva/ui";
import { useStableHandler } from "@plainva/ui";
import { sameTreeFiles } from "@plainva/ui";
import { consumePendingTreeReveal } from "@plainva/ui";
import { useDocumentIcons, type DocIconEntry } from "../hooks/useDocumentIcons";
import { DocIcon, isRenderableDocIcon, stripNoteExtension } from "@plainva/ui";
import { duplicateFile, renameInitialName, renameToName } from "../services/fileActions";
import { generateIndexForFolder } from "../services/indexMd";
import { isImagePath } from "@plainva/ui";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { serializeBaseConfig } from "@plainva/ui";
// Lazily loaded (P2.9 "wizards"): the creation wizard is a rarely-opened
// surface and must not sit in the initial bundle.
const BaseCreateWizard = React.lazy(() => import("./base/BaseCreateWizard").then(m => ({ default: m.BaseCreateWizard })));
import {
  ancestorsOf,
  applyClickSelection,
  buildTree,
  collectFolderPaths,
  flattenVisibleTree,
  parentOf,
  pruneNestedPaths,
  resolveCreateTarget,
  sortedChildren,
  type TreeNode,
} from "./fileTreeModel";
import { useTranslation } from "react-i18next";

const isConflictPath = (p: string) => p.includes(".CONFLICT-");

/** Maps a .CONFLICT-<timestamp> sibling back to the original file path. */
const originalOfConflict = (p: string) => p.replace(/\.CONFLICT-[0-9TZ-]+(\.[^.\\/]+)?$/, "$1");

type NewItemType = "file" | "folder" | "base";

// Icon + placeholder for the inline new-item input. A `.base` is neither a plain
// file nor a folder, so both need an explicit third case — otherwise a new base
// shows the folder icon and "Ordnername…" while it is actually a database (#3).
const newItemIcon = (type: NewItemType) =>
  type === "base"
    ? <Database size={14} style={{ opacity: 0.7 }} />
    : type === "folder"
      ? <Folder size={14} style={{ opacity: 0.7 }} />
      : <FileText size={14} style={{ opacity: 0.7 }} />;

const newItemPlaceholder = (type: NewItemType, t: (k: string, o?: any) => string) =>
  type === "base"
    ? t("fileTree.namePlaceholderBase", { defaultValue: "Base-Name..." })
    : type === "folder"
      ? t("fileTree.namePlaceholderFolder", { defaultValue: "Ordnername..." })
      : t("fileTree.namePlaceholderFile", { defaultValue: "Dateiname..." });

// Small trailing dot marking an unsynced (local_ahead) file.
const PendingDot: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span data-tip={t("fileTree.unsynced")} style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: "var(--accent-color)", flexShrink: 0 }} />
  );
};

interface ContextMenuState {
  path: string;
  isFolder: boolean;
  x: number;
  y: number;
}

// Memoized (P2.12): the tree nodes only re-render when their data actually
// changes — context-menu/session state flips in FileTree no longer walk every
// visible row. All handler props are wrapped in useStableHandler so the
// shallow compare holds across renders.
const TreeNodeView: React.FC<{
  node: TreeNode;
  activePath: string | null;
  pendingPaths: Set<string>;
  /** Path -> document icon (plainva.icon/.icon_color), shown instead of the generic file icon. */
  docIcons: Map<string, DocIconEntry>;
  selection: Set<string>;
  expandedFolders: Set<string>;
  onItemClick: (path: string, isFolder: boolean, e: React.MouseEvent) => void;
  onItemAuxClick: (path: string, isFolder: boolean, e: React.MouseEvent) => void;
  onContextMenu: (path: string, isFolder: boolean, event: React.MouseEvent<HTMLElement>) => void;
  depth: number;
  renamingItemParams: { path: string, initialName: string, isFolder: boolean } | null;
  renamingName: string;
  renamingError: string | null;
  setRenamingName: (n: string) => void;
  handleRenameSubmit: (e?: React.FormEvent) => void;
  cancelRenaming: () => void;
  onDragStart: (e: React.DragEvent, path: string) => void;
  onDragOver: (e: React.DragEvent, path: string) => void;
  onDrop: (e: React.DragEvent, path: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  draggedPath: string | null;
  dropTarget: string | null;
  newItemParams: { type: "file" | "folder" | "base", parentPath: string } | null;
  newItemName: string;
  newItemError: string | null;
  setNewItemName: (n: string) => void;
  handleNewItemSubmit: (e?: React.FormEvent) => void;
}> = React.memo(({ node, activePath, pendingPaths, docIcons, selection, expandedFolders, onItemClick, onItemAuxClick, onContextMenu, depth, renamingItemParams, renamingName, renamingError, setRenamingName, handleRenameSubmit, cancelRenaming, onDragStart, onDragOver, onDrop, onDragEnd, draggedPath, dropTarget, newItemParams, newItemName, newItemError, setNewItemName, handleNewItemSubmit }) => {
  const { t } = useTranslation();
  const isOpen = expandedFolders.has(node.path);
  const isFile = !node.children;
  const isSelected = selection.has(node.path);
  const paddingLeft = depth * 12 + 8;

  if (isFile) {
    // A .base is indexed as "attachment" but is a first-class Plainva document:
    // database icon (tinted via views[i].plainva.fileIconColor) and no visible
    // extension, like .md (Base-UX2 P7).
    const isBase = /\.base$/i.test(node.path!);
    const attachment = node.mode === "attachment" && !isBase;
    let displayName = node.title || node.name;
    // Remove .md/.base extension for display (attachments keep their extension).
    if (!attachment) displayName = stripNoteExtension(displayName);
    const conflict = isConflictPath(node.path!);
    const pending = pendingPaths.has(node.path!);

    const isRenaming = renamingItemParams?.path === node.path;

    return (
      <div
        draggable={true}
        data-tree-path={node.path}
        onDragStart={(e) => onDragStart(e, node.path!)}
        onDragEnd={onDragEnd}
        onClick={(e) => { if (isRenaming) return; onItemClick(node.path!, false, e); }}
        onAuxClick={(e) => { if (!isRenaming) onItemAuxClick(node.path!, false, e); }}
        onContextMenu={(e) => onContextMenu(node.path, false, e)}
        style={{
          padding: `var(--tree-row-pad-y) 8px var(--tree-row-pad-y) ${paddingLeft}px`,
          cursor: "pointer",
          borderRadius: "var(--radius-xs)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "var(--tree-row-font)",
          background: isSelected || activePath === node.path ? "var(--bg-active)" : "transparent",
          color: conflict ? "var(--error-text)" : "var(--text-main)",
          fontWeight: activePath === node.path ? 600 : 400,
          boxShadow: activePath === node.path ? "inset 3px 0 0 var(--accent-color)" : undefined,
        }}
        data-tip={conflict ? t("fileTree.conflictTooltip") : (attachment ? t("fileTree.attachmentTooltip") : undefined)}
      >
        <div style={{ width: 14, minWidth: 14, height: 14, flexShrink: 0 }} />
        {conflict
          ? <AlertTriangle size={14} color="var(--error-text)" style={{ flexShrink: 0 }} />
          : isBase
            ? <span aria-hidden="true" style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <DocIcon icon={docIcons.get(node.path!)?.icon ?? "lucide:database"} color={docIcons.get(node.path!)?.color} size={14} />
              </span>
            : attachment
              ? <Paperclip size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
              : docIcons.get(node.path!) && isRenderableDocIcon(docIcons.get(node.path!)!.icon)
                ? <span aria-hidden="true" style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <DocIcon icon={docIcons.get(node.path!)!.icon} color={docIcons.get(node.path!)!.color} size={14} />
                  </span>
                : <FileText size={14} style={{ opacity: 0.7, flexShrink: 0 }} />}
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }} onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={renamingName}
              aria-invalid={!!renamingError}
              onChange={e => setRenamingName(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") cancelRenaming(); }}
              onBlur={() => handleRenameSubmit()}
              style={{ flex: 1, background: "var(--bg-primary)", color: "var(--text-main)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "2px 4px", fontSize: "0.9rem", outline: "none", minWidth: 0 }}
            />
            {renamingError && <div className="pv-inline-error">{renamingError}</div>}
          </form>
        ) : (
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </span>
        )}
        {pending && <PendingDot />}
      </div>
    );
  }

  // Folder
  const childrenNodes = sortedChildren(node);

  const isRenaming = renamingItemParams?.path === node.path;

  return (
    <div
      onDragOver={(e) => onDragOver(e, node.path!)}
      onDrop={(e) => onDrop(e, node.path!)}
    >
      <div
        draggable={true}
        data-tree-path={node.path}
        onDragStart={(e) => onDragStart(e, node.path!)}
        onDragEnd={onDragEnd}
        onClick={(e) => { if (!isRenaming) onItemClick(node.path, true, e); }}
        onContextMenu={(e) => onContextMenu(node.path, true, e)}
        style={{
          padding: `var(--tree-row-pad-y) 8px var(--tree-row-pad-y) ${paddingLeft}px`,
          cursor: "pointer",
          borderRadius: "var(--radius-xs)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "var(--tree-row-font)",
          color: "var(--text-main)",
          fontWeight: 500,
          background: isSelected ? "var(--bg-active)" : dropTarget === node.path ? "var(--bg-hover)" : "transparent",
        }}
        onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseOut={e => e.currentTarget.style.background = isSelected ? "var(--bg-active)" : dropTarget === node.path ? "var(--bg-hover)" : "transparent"}
      >
        {isOpen ? <ChevronDown size={14} style={{ opacity: 0.5 }} /> : <ChevronRight size={14} style={{ opacity: 0.5 }} />}
        <Folder size={14} style={{ opacity: 0.7, color: "var(--text-muted)" }} />
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }} onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={renamingName}
              aria-invalid={!!renamingError}
              onChange={e => setRenamingName(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") cancelRenaming(); }}
              onBlur={() => handleRenameSubmit()}
              style={{ flex: 1, background: "var(--bg-primary)", color: "var(--text-main)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "2px 4px", fontSize: "0.9rem", outline: "none", minWidth: 0 }}
            />
            {renamingError && <div className="pv-inline-error">{renamingError}</div>}
          </form>
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </span>
        )}
      </div>
      {isOpen && (
        <div>
          {childrenNodes.map(child => (
            <TreeNodeView
              key={child.name}
              node={child}
              activePath={activePath}
              pendingPaths={pendingPaths}
              docIcons={docIcons}
              selection={selection}
              expandedFolders={expandedFolders}
              onItemClick={onItemClick}
              onItemAuxClick={onItemAuxClick}
              onContextMenu={onContextMenu}
              depth={depth + 1}
              renamingItemParams={renamingItemParams}
              renamingName={renamingName}
              renamingError={renamingError}
              setRenamingName={setRenamingName}
              handleRenameSubmit={handleRenameSubmit}
              cancelRenaming={cancelRenaming}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              draggedPath={draggedPath}
              dropTarget={dropTarget}
              newItemParams={newItemParams}
              newItemName={newItemName}
              newItemError={newItemError}
              setNewItemName={setNewItemName}
              handleNewItemSubmit={handleNewItemSubmit}
            />
          ))}
          {newItemParams && newItemParams.parentPath === node.path && (
            <form onSubmit={handleNewItemSubmit} style={{ padding: `4px 8px 4px ${paddingLeft + 12 + 8}px`, display: "flex", alignItems: "flex-start", gap: "6px" }} onClick={e => e.stopPropagation()}>
              <div style={{ width: 14, minWidth: 14, height: 14, flexShrink: 0 }} />
              {newItemIcon(newItemParams.type)}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                <input
                  autoFocus
                  value={newItemName}
                  aria-invalid={!!newItemError}
                  onChange={e => setNewItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") setNewItemName(""); }}
                  onBlur={() => {
                    if (newItemName.trim()) {
                      handleNewItemSubmit();
                    } else {
                      setNewItemName(""); // Setting empty string triggers the cancel in FileTree logic if needed, or we just let it be handled
                    }
                  }}
                  placeholder={newItemPlaceholder(newItemParams.type, t)}
                  style={{ flex: 1, background: "var(--bg-primary)", color: "var(--text-main)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "2px 4px", fontSize: "0.9rem", outline: "none", minWidth: 0 }}
                />
                {newItemError && <div className="pv-inline-error">{newItemError}</div>}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
});

export const FileTree: React.FC<{
  onSelect: (path: string, newTab: boolean) => void;
  onCloseTabsByPrefix?: (prefix: string) => void;
  onRenameTabPrefix?: (oldPrefix: string, newPrefix: string) => void;
  activePath: string | null;
  /** When provided, the tree is filtered by this (sidebar-level) query and the
   *  built-in search box + toolbar are hidden (the sidebar provides them). */
  externalQuery?: string;
  /** Opens a file in the split pane (right = vertical, bottom = horizontal). */
  onOpenInSplit?: (path: string, direction: "vertical" | "horizontal") => void;
  isBookmarked?: (path: string) => boolean;
  onToggleBookmarkPath?: (path: string) => void;
  /** Reports whether any folder is expanded — feeds the sidebar's
   *  collapse/expand-all toggle icon (E3 2026-07-09). */
  onExpandedStateChange?: (hasExpanded: boolean) => void;
}> = ({ onSelect, onCloseTabsByPrefix, onRenameTabPrefix, activePath, externalQuery, onOpenInSplit, isBookmarked, onToggleBookmarkPath, onExpandedStateChange }) => {
  const { t } = useTranslation();
  // Performance telemetry removed to reduce console noise
  const { queryService, isLoading, fileTreeVersion, treeStructureVersion, syncWorker, vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate } = useVault();
  const docIcons = useDocumentIcons();
  const [files, setFiles] = useState<{ path: string; title: string; mode?: string; isDir?: boolean; snippet?: string | null; titleHl?: string | null }[]>([]);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [newItemParams, setNewItemParams] = useState<{ type: "file" | "folder" | "base", parentPath: string } | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [renamingItemParams, setRenamingItemParams] = useState<{ path: string, initialName: string, isFolder: boolean } | null>(null);
  const [renamingName, setRenamingName] = useState("");
  // Inline validation (plan Designsprache P3/§6): name errors show under the
  // active input instead of a blocking dialog; typing clears them.
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const [renamingError, setRenamingError] = useState<string | null>(null);
  // The tree-node handlers below are identity-stable (useStableHandler) so the
  // memoized TreeNodeView's shallow prop compare holds across renders (P2.12).
  const updateNewItemName = useStableHandler((n: string) => { setNewItemName(n); setNewItemError(null); });
  const updateRenamingName = useStableHandler((n: string) => { setRenamingName(n); setRenamingError(null); });
  const cancelRenaming = useStableHandler(() => { setRenamingItemParams(null); setRenamingError(null); });
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Explorer-style selection (P7/P9): plain click selects, Ctrl/Meta toggles,
  // Shift ranges over the visible rows; the anchor is the last plain target.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  // The sidebar owns the search box (plan Suche P3); the built-in fallback
  // field is gone — without an externalQuery the tree simply shows everything.
  const effectiveQuery = externalQuery ?? "";

  // Folders are invisible to the SQL index (only file rows exist), so they
  // need a recursive DISK listing — the expensive half of every tree refresh.
  // It now hangs on treeStructureVersion only (P2.5): file-only refreshes
  // (every save) reuse the cached folder list instead of re-walking the vault.
  const [diskFolders, setDiskFolders] = useState<{ path: string; title: string; isDir: true }[]>([]);
  useEffect(() => {
    if (!vaultAdapter) {
      setDiskFolders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const diskFiles = await vaultAdapter.listDir("", true);
        const folders = diskFiles
          .filter(f => f.isDirectory && !isInternalPath(f.path))
          .map(f => ({ path: f.path, title: f.name, isDir: true as const }));
        if (!cancelled) setDiskFolders(folders);
      } catch (err) {
        console.warn("Failed to list folders from disk", err);
      }
    })();
    return () => { cancelled = true; };
  }, [vaultAdapter, treeStructureVersion, isLoading]);

  useEffect(() => {
    if (!queryService) return;
    // Guards against out-of-order responses while typing: only the latest
    // query may write results (plan Suche P4).
    let cancelled = false;

    const fetchFiles = async () => {
      try {
        if (effectiveQuery.trim() === "") {
          const dbFiles = await queryService.db.query<{ path: string; title: string; mode: string }>(
            `SELECT path, title, mode FROM files ORDER BY path ASC`
          );

          const allFiles: { path: string; title: string; mode?: string; isDir?: boolean }[] =
            [...dbFiles, ...diskFolders];

          // Keep the previous reference when nothing tree-relevant changed, so a
          // content-only autosave does not rebuild + re-render the whole tree.
          if (!cancelled) setFiles((prev) => (sameTreeFiles(prev, allFiles) ? prev : allFiles));
        } else {
          // FTS5 search — prefix matching + snippets/title highlight (P1/P2).
          const { perfMeasure } = await import("../services/perfMetrics");
          const results = await perfMeasure("sidebar search", () => queryService.searchFullText(effectiveQuery));
          if (!cancelled) {
            setFiles(results.map(r => ({
              path: r.path,
              title: r.title || r.path,
              snippet: r.snippet ?? null,
              titleHl: r.titleHighlighted ?? null,
            })));
          }
        }

        // Pending (local_ahead) indicator only makes sense with an active sync
        // target; without one every edited file would stay "local_ahead" forever.
        if (syncWorker) {
          const pending = await queryService.db.query<{ path: string }>(
            `SELECT path FROM files WHERE sync_state IS NOT NULL AND sync_state != 'synced'`
          );
          if (!cancelled) setPendingPaths((prev) => {
            const next = new Set(pending.map(p => p.path));
            return prev.size === next.size && [...next].every((p) => prev.has(p)) ? prev : next;
          });
        } else {
          // No sync target -> keep the empty reference (a new Set every save
          // would needlessly re-render the tree rows).
          if (!cancelled) setPendingPaths((prev) => (prev.size === 0 ? prev : new Set()));
        }
      } catch (e) {
        console.error("Error fetching files:", e);
        // A failed search must not leave stale rows standing.
        if (!cancelled && effectiveQuery.trim() !== "") setFiles([]);
      }
    };

    fetchFiles();
    return () => { cancelled = true; };
  }, [queryService, effectiveQuery, isLoading, fileTreeVersion, syncWorker, diskFolders]);

  const modeByPath = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const f of files) m.set(f.path, f.mode);
    return m;
  }, [files]);

  const folderPaths = useMemo(() => collectFolderPaths(files), [files]);
  const tree = useMemo(() => buildTree(files), [files]);
  const isSearching = effectiveQuery.trim() !== "";
  // Search hits split into "file name" vs "content" groups (plan Suche O2):
  // a marker in the highlighted title means the term matched the name.
  const searchGroups = useMemo(() => {
    if (!isSearching) return { name: [] as typeof files, content: [] as typeof files };
    return {
      name: files.filter((f) => hasSnippetMark(f.titleHl)),
      content: files.filter((f) => !hasSnippetMark(f.titleHl)),
    };
  }, [isSearching, files]);
  const orderedSearchFiles = useMemo(
    () => [...searchGroups.name, ...searchGroups.content],
    [searchGroups]
  );
  // First positive term of the query — the jump target when opening a hit
  // (plan Suche P5/O1) .
  const searchJumpTerm = useMemo(
    () => (isSearching ? VaultQueryService.parseSearchQuery(effectiveQuery).terms[0] ?? null : null),
    [isSearching, effectiveQuery]
  );
  // The rows currently on screen, in render order — Shift-range selection and
  // the search's flat list share this shape (P9).
  const visibleEntries = useMemo(
    () => (isSearching
      ? orderedSearchFiles.filter((f) => !f.isDir).map((f) => ({ path: f.path, isFolder: false }))
      : flattenVisibleTree(tree, expandedFolders)),
    [isSearching, orderedSearchFiles, tree, expandedFolders]
  );

  // Drop selected paths that disappeared with a refetch (rename/delete/sync).
  useEffect(() => {
    setSelection((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((p) => folderPaths.has(p) || files.some((f) => f.path === p)));
      return next.size === prev.size ? prev : next;
    });
    setSelectionAnchor((prev) => (prev && (folderPaths.has(prev) || files.some((f) => f.path === prev)) ? prev : null));
  }, [files, folderPaths]);

  // Markdown notes open in the editor; attachments (binary) open in the OS default app
  // instead of being loaded as text. openPath is best-effort (needs the opener path
  // permission natively); it never loads binary content into the editor.
  const handleOpen = (path: string, newTab: boolean) => {
    if (modeByPath.get(path) === "attachment" && !path.endsWith('.base')) {
      // Images open in the in-app viewer tab (P10); other attachments external.
      if (isImagePath(path)) {
        onSelect(path, newTab);
        return;
      }
      if (vaultPath) {
        openPath(`${vaultPath}/${path}`).catch((e) => console.warn("Failed to open attachment externally", e));
      }
      return;
    }
    onSelect(path, newTab);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleItemClick = useStableHandler((path: string, isFolder: boolean, e: React.MouseEvent) => {
    const mode = e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single";
    const res = applyClickSelection(selection, selectionAnchor, visibleEntries, path, mode);
    setSelection(res.selection);
    setSelectionAnchor(res.anchor);
    if (mode !== "single") return; // Ctrl/Shift only select — no open, no toggle
    if (isFolder) toggleFolder(path);
    else handleOpen(path, false);
  });

  // Middle click keeps the previous Ctrl+click behavior: open in a new tab.
  const handleItemAuxClick = useStableHandler((path: string, isFolder: boolean, e: React.MouseEvent) => {
    if (e.button !== 1 || isFolder) return;
    e.preventDefault();
    handleOpen(path, true);
  });

  const resolveConflictKeep = async (conflictPath: string) => {
    setContextMenu(null);
    if (!vaultAdapter || !indexer) return;
    try {
      const original = originalOfConflict(conflictPath);
      // Binary attachments must be copied byte-wise; text round-trip would corrupt them.
      if (isTextFile(original)) {
        const content = await vaultAdapter.readTextFile(conflictPath);
        await vaultAdapter.writeTextFile(original, content);
      } else {
        const bytes = await vaultAdapter.readBinaryFile(conflictPath);
        await vaultAdapter.writeBinaryFile(original, bytes);
      }
      await vaultAdapter.deleteItem(conflictPath);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: original } }));
    } catch (e) {
      console.error("Failed to keep conflict version", e);
    }
  };

  const resolveConflictDiscard = async (conflictPath: string) => {
    setContextMenu(null);
    if (!vaultAdapter || !indexer) return;
    const ok = await appConfirm({
      title: t("dialogs.discardConflictTitle"),
      message: t("dialogs.discardConflictMsg", { name: conflictPath.split(/[/\\]/).pop() }),
      kind: "danger",
      confirmLabel: t("common.delete", { defaultValue: "Löschen" }),
    });
    if (!ok) return;
    try {
      await vaultAdapter.deleteItem(conflictPath);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
    } catch (e) {
      console.error("Failed to discard conflict", e);
    }
  };

  const createNewItem = React.useCallback((type: "file" | "folder" | "base", parentPath: string) => {
    // Make the inline input visible: expand the target folder and its ancestors.
    if (parentPath) setExpandedFolders((prev) => new Set([...prev, ...ancestorsOf(parentPath), parentPath]));
    setNewItemParams({ type, parentPath });
    setNewItemName("");
    setNewItemError(null);
    setContextMenu(null);
  }, []);

  // A new .base goes through the source wizard (plan W3/P1) — the file is only
  // written once the wizard confirms; cancelling creates nothing.
  const [baseWizardPath, setBaseWizardPath] = useState<string | null>(null);
  const handleWizardCreate = async (config: any) => {
    const path = baseWizardPath;
    if (!path || !vaultAdapter || !indexer) { setBaseWizardPath(null); return; }
    try {
      await vaultAdapter.writeTextFile(path, serializeBaseConfig(config));
      setBaseWizardPath(null);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      onSelect(path, false);
    } catch (err: any) {
      console.error("Fehler beim Erstellen", err);
      toast.error(t("dialogs.createErrorMsg", { error: err.message }));
    }
  };

  // The sidebar "Neu ▾" menu requests creation via a window event. The target
  // folder follows the tree selection (P7): selected folder, or the selected
  // file's parent, falling back to the vault root. Re-registering on state
  // change keeps the listener's closure fresh.
  useEffect(() => {
    const onNew = (e: Event) => {
      const kind = (e as CustomEvent).detail?.kind as "file" | "folder" | "base" | undefined;
      if (!kind) return;
      let target = "";
      if (selectionAnchor) {
        const isFolder = folderPaths.has(selectionAnchor);
        if (isFolder || files.some((f) => f.path === selectionAnchor)) {
          target = resolveCreateTarget({ path: selectionAnchor, isFolder });
        }
      }
      createNewItem(kind, target);
    };
    window.addEventListener("plainva-new-item", onNew);
    return () => window.removeEventListener("plainva-new-item", onNew);
  }, [selectionAnchor, folderPaths, files, createNewItem]);

  // Reveal + select a path: expand the ancestors, select the row and scroll it
  // into view. Shared by folder links in read-mode listings (2026-07-04), the
  // editor's ⋮ "Reveal in file tree" and the parked hand-off below.
  const revealPath = useStableHandler((path: string) => {
    if (path === "") {
      setSelection(new Set());
      setSelectionAnchor(null);
      return;
    }
    setExpandedFolders((prev) => new Set([...prev, ...ancestorsOf(path), path]));
    setSelection(new Set([path]));
    setSelectionAnchor(path);
    // Double rAF: the first frame fires before React committed the expanded
    // children; the probe is DOM-based so the memoized rows stay untouched.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-tree-path="${CSS.escape(path)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      })
    );
  });

  useEffect(() => {
    const onReveal = (e: Event) => {
      const path = (e as CustomEvent).detail?.path as string | undefined;
      if (path == null) return;
      // Handled live — drop a parked copy so it cannot replay stale on remount.
      consumePendingTreeReveal();
      revealPath(path);
    };
    window.addEventListener("plainva-reveal-folder", onReveal);
    return () => window.removeEventListener("plainva-reveal-folder", onReveal);
  }, [revealPath]);

  // Sidebar "collapse/expand all" toggle (E3 2026-07-09): anything expanded →
  // collapse everything, else expand every folder (collectFolderPaths memo).
  useEffect(() => {
    const onToggleAll = () => {
      setExpandedFolders((prev) => (prev.size > 0 ? new Set() : new Set(folderPaths)));
    };
    window.addEventListener("plainva-tree-toggle-all", onToggleAll);
    return () => window.removeEventListener("plainva-tree-toggle-all", onToggleAll);
  }, [folderPaths]);

  useEffect(() => {
    onExpandedStateChange?.(expandedFolders.size > 0);
  }, [expandedFolders, onExpandedStateChange]);

  // The ⋮ menu can fire while this tree is unmounted (tags/bookmarks tab) or
  // before its rows exist after a remount: consume the parked path once the
  // file list is loaded (lib/treeReveal).
  useEffect(() => {
    if (files.length === 0) return;
    const parked = consumePendingTreeReveal();
    if (parked !== null) revealPath(parked);
  }, [files, revealPath]);

  const handleNewItemSubmit = useStableHandler(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newItemParams || !newItemName.trim() || !vaultAdapter || !indexer) {
      setNewItemParams(null);
      return;
    }
    
    const name = newItemName.trim();
    if (name.includes("/") || name.includes("\\")) {
      setNewItemError(t("dialogs.invalidNameMsg"));
      return;
    }
    setNewItemError(null);

    const isFolder = newItemParams.type === "folder";
    const isBase = newItemParams.type === "base";
    const extension = isFolder ? "" : isBase ? (name.toLowerCase().endsWith(".base") ? "" : ".base") : (name.toLowerCase().endsWith(".md") ? "" : ".md");
    const finalName = name + extension;
    const newPath = newItemParams.parentPath ? `${newItemParams.parentPath}/${finalName}` : finalName;

    try {
      if (await vaultAdapter.exists(newPath)) {
        setNewItemError(t("dialogs.alreadyExistsMsg"));
        return;
      }
      if (isFolder) {
        await vaultAdapter.createDir(newPath);
      } else if (isBase) {
        // Open the creation wizard instead of writing an empty config (plan W3/P1).
        setNewItemParams(null);
        setBaseWizardPath(newPath);
        return;
      } else {
        const noteType = await getConfiguredNoteType(vaultPath ?? "");
        await vaultAdapter.writeTextFile(newPath, buildNewNoteContent(noteType, finalName.replace(/\.md$/i, "")));
        onSelect(newPath, false);
      }
      setNewItemParams(null);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "create", path: newPath, isFolder }]);
    } catch (err: any) {
      console.error("Fehler beim Erstellen", err);
      toast.error(t("dialogs.createErrorMsg", { error: err.message }));
    }
  });

  const startRenaming = (path: string, isFolder: boolean) => {
    if (!path) return;
    const name = renameInitialName(path, isFolder);
    setRenamingItemParams({ path, initialName: name, isFolder });
    setRenamingName(name);
    setRenamingError(null);
    setContextMenu(null);
  };

  const handleRenameSubmit = useStableHandler(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!renamingItemParams || !renamingName.trim() || !vaultAdapter || !indexer) {
      setRenamingItemParams(null);
      return;
    }
    const oldPath = renamingItemParams.path;
    const isFolder = renamingItemParams.isFolder;
    setRenamingError(null);

    try {
      // Shared rename core (services/fileActions): notes get the vault-wide
      // link retargeting (W5); folders and attachments keep the plain rename.
      const result = await renameToName({
        adapter: vaultAdapter,
        queryService,
        oldPath,
        newName: renamingName,
        isFolder,
      });
      if (!result.ok) {
        if (result.reason === "unchanged") setRenamingItemParams(null);
        else if (result.reason === "already-exists") setRenamingError(t("dialogs.alreadyExistsMsg"));
        else setRenamingError(t("dialogs.invalidNameMsg"));
        return;
      }
      setRenamingItemParams(null);
      onRenameTabPrefix?.(oldPath, result.newPath);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      if (result.linkUpdateFailed) {
        toast.warning(t("dialogs.renameLinksFailed"));
      } else if (result.changedFiles > 0) {
        toast.success(t("dialogs.renameLinksUpdated", { links: result.renamedLinks, files: result.changedFiles }));
      }
      notifyFileOps([{ type: "move", from: oldPath, to: result.newPath, isFolder }]);
    } catch (err: any) {
      console.error("Fehler beim Umbenennen", err);
      toast.error(t("dialogs.renameErrorMsg", { error: err.message }));
      setRenamingItemParams(null);
    }
  });

  const handleDelete = async (path: string, isFolder: boolean) => {
    setContextMenu(null);
    if (!vaultAdapter || !indexer) return;

    const displayName = path.split(/[/\\]/).pop();
    // Shared confirmation (cloud note + second prompt for large deletions, E2).
    const ok = await confirmDeletion({
      t,
      single: { name: displayName ?? path, isFolder },
      fileCount: countAffectedFiles(files, [path]),
      vaultFileCount: files.filter((f) => !f.isDir).length,
      syncActive: !!syncWorker,
    });
    if (!ok) return;
    // Fully confirmed: the mass-deletion guard must not hold (and on "restore"
    // resurrect) this deliberate deletion on the next sync cycle.
    syncWorker?.noteUserInitiatedDeletion([path]);

    try {
      await vaultAdapter.deleteItem(path, true);
      onCloseTabsByPrefix?.(path);
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "delete", path, isFolder }]);
    } catch (err: any) {
      console.error("Fehler beim Löschen", err);
      toast.error(t("dialogs.deleteErrorMsg", { error: err.message }));
    }
  };

  const handleDuplicate = async (paths: string[]) => {
    setContextMenu(null);
    if (!vaultAdapter || !indexer) return;
    const targets = paths.filter((p) => !folderPaths.has(p));
    const errors: string[] = [];
    const createdOps: { type: "create"; path: string }[] = [];
    for (const p of targets) {
      try {
        // Shared with the editor's ⋮ menu (services/fileActions).
        createdOps.push({ type: "create", path: await duplicateFile(vaultAdapter, p, t("fileTree.copySuffix")) });
      } catch (err) {
        console.error("Fehler beim Duplizieren", p, err);
        errors.push(p.split(/[/\\]/).pop() ?? p);
      }
    }
    await indexer.indexVaultFull();
    triggerFileTreeUpdate();
    notifyFileOps(createdOps);
    if (errors.length > 0) {
      toast.error(t("dialogs.bulkErrorsMsg", { count: errors.length, names: errors.join(", ") }));
    }
  };

  // Bulk delete (P9): nested paths pruned to their roots, ONE confirmation,
  // tab cleanup per root, one reindex at the end, errors collected.
  const handleBulkDelete = async (paths: string[]) => {
    setContextMenu(null);
    if (!vaultAdapter || !indexer) return;
    const roots = pruneNestedPaths(paths);
    // Shared confirmation (cloud note + second prompt for large deletions, E2).
    const ok = await confirmDeletion({
      t,
      rootCount: roots.length,
      fileCount: countAffectedFiles(files, roots),
      vaultFileCount: files.filter((f) => !f.isDir).length,
      syncActive: !!syncWorker,
    });
    if (!ok) return;
    syncWorker?.noteUserInitiatedDeletion(roots);
    const errors: string[] = [];
    const deletedOps: { type: "delete"; path: string; isFolder: boolean }[] = [];
    for (const p of roots) {
      try {
        await vaultAdapter.deleteItem(p, true);
        onCloseTabsByPrefix?.(p);
        deletedOps.push({ type: "delete", path: p, isFolder: folderPaths.has(p) });
      } catch (err) {
        console.error("Fehler beim Löschen", p, err);
        errors.push(p.split(/[/\\]/).pop() ?? p);
      }
    }
    setSelection(new Set());
    setSelectionAnchor(null);
    await indexer.indexVaultFull();
    triggerFileTreeUpdate();
    notifyFileOps(deletedOps);
    if (errors.length > 0) {
      toast.error(t("dialogs.bulkErrorsMsg", { count: errors.length, names: errors.join(", ") }));
    }
  };

  const handleDragStart = useStableHandler((e: React.DragEvent, path: string) => {
    if (isConflictPath(path)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("plainva/path", path);
    // Dragging a selected row moves the whole selection (P9).
    if (selection.has(path) && selection.size > 1) {
      e.dataTransfer.setData("plainva/paths", JSON.stringify(pruneNestedPaths(selection)));
    }
    e.dataTransfer.effectAllowed = "move";
    setDraggedPath(path);
  });

  const handleDragOver = useStableHandler((e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (draggedPath && draggedPath !== folderPath && !folderPath.startsWith(draggedPath + "/")) {
      const sourceParent = draggedPath.split(/[/\\]/).slice(0, -1).join("/");
      if (sourceParent !== folderPath) {
        setDropTarget(folderPath);
        return;
      }
    }
    setDropTarget(null);
  });

  const handleDrop = useStableHandler(async (e: React.DragEvent, targetFolderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setDraggedPath(null);

    // Multi-payload when a selected row was dragged (P9), single path otherwise.
    let sources: string[] = [];
    const multi = e.dataTransfer.getData("plainva/paths");
    if (multi) {
      try { sources = JSON.parse(multi); } catch { sources = []; }
    }
    if (sources.length === 0) {
      const single = e.dataTransfer.getData("plainva/path");
      if (single) sources = [single];
    }
    // Per-path validation: never into itself/descendants, no same-folder moves.
    sources = sources.filter((p) =>
      p && p !== targetFolderPath && !targetFolderPath.startsWith(p + "/") && parentOf(p) !== targetFolderPath
    );
    if (sources.length === 0) return;

    const errors: string[] = [];
    const movedOps: { type: "move"; from: string; to: string; isFolder: boolean }[] = [];
    for (const sourcePath of sources) {
      const sourceName = sourcePath.split(/[/\\]/).pop();
      if (!sourceName) continue;
      const newPath = targetFolderPath ? `${targetFolderPath}/${sourceName}` : sourceName;
      try {
        if (await vaultAdapter?.exists(newPath)) {
          errors.push(sourceName);
          continue;
        }
        await vaultAdapter?.renameItem(sourcePath, newPath);
        onRenameTabPrefix?.(sourcePath, newPath);
        movedOps.push({ type: "move", from: sourcePath, to: newPath, isFolder: folderPaths.has(sourcePath) });
      } catch (err) {
        console.error("Fehler beim Verschieben", sourcePath, err);
        errors.push(sourceName);
      }
    }
    if (movedOps.length > 0) {
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
      notifyFileOps(movedOps);
    }
    if (errors.length > 0) {
      toast.error(t("dialogs.bulkErrorsMsg", { count: errors.length, names: errors.join(", ") }));
    }
  });

  const handleDragEnd = useStableHandler(() => {
    setDropTarget(null);
    setDraggedPath(null);
  });

  // Outside-click / Escape / scroll close comes from MenuSurface (plan P5).
  const openContextMenu = useStableHandler((path: string, isFolder: boolean, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    // Right-click outside the current selection re-selects the target row
    // (Explorer behavior); inside it, the menu acts on the whole selection.
    if (path && !(selection.has(path) && selection.size > 1)) {
      setSelection(new Set([path]));
      setSelectionAnchor(path);
    }
    setContextMenu({ path, isFolder, x: event.clientX, y: event.clientY });
  });

  const openContextPathInNewTab = () => {
    if (!contextMenu) return;
    handleOpen(contextMenu.path, true);
    setContextMenu(null);
  };

  // Generate/refresh the OKF index.md listing for a folder (Gesamtplan W7).
  const handleGenerateIndex = async (folder: string) => {
    setContextMenu(null);
    if (!vaultAdapter || !queryService || !indexer) return;
    try {
      const indexPath = folder ? `${folder}/index.md` : "index.md";
      if (await vaultAdapter.exists(indexPath)) {
        const ok = await appConfirm({
          title: t("indexMd.contextAction"),
          message: t("indexMd.overwriteConfirm", { path: indexPath }),
          kind: "warning",
        });
        if (!ok) return;
      }
      const heading = folder ? folder.split("/").pop()! : (vaultPath?.split(/[/\\]/).pop() ?? "Vault");
      const result = await generateIndexForFolder({
        adapter: vaultAdapter,
        queryService,
        folder,
        heading,
        subfoldersHeading: t("indexMd.subfoldersHeading"),
      });
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: result.indexPath } }));
    } catch (err: any) {
      toast.error(t("dialogs.createErrorMsg", { error: err.message }));
    }
  };

  const copyContextPath = async () => {
    if (!contextMenu) return;

    try {
      await navigator.clipboard.writeText(contextMenu.path);
      toast.info(t("fileTree.pathCopied", "Pfad kopiert."));
    } catch (error) {
      console.warn("Failed to copy file path", error);
    } finally {
      setContextMenu(null);
    }
  };

  if (isLoading) {
    return <div style={{ padding: "1rem" }}>{t("fileTree.scanning")}</div>;
  }

  let content;

  if (files.length === 0) {
    content = (
      <div style={{ padding: "1rem", color: "var(--text-faint)", textAlign: "center", fontSize: "0.9rem" }}>
        {isSearching ? t("sidebar.noResults") : t("fileTree.noNotes")}
      </div>
    );
  } else if (isSearching) {
    // Flat, grouped list for search results (plan Suche P4/O2): every hit
    // shows its document icon, highlighted title, folder line and — for
    // content hits — the match snippet with <mark>s.
    const renderHit = (file: (typeof files)[number]) => {
      let displayName = file.title || file.path;
      displayName = displayName.replace(/\.md$/i, "");
      const conflict = isConflictPath(file.path);
      const pending = pendingPaths.has(file.path);
      const isRenaming = renamingItemParams?.path === file.path;
      const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      const isBase = file.path.toLowerCase().endsWith(".base");
      const docIcon = docIcons.get(file.path);
      const titleContent = file.titleHl && hasSnippetMark(file.titleHl)
        ? renderSnippetNodes(file.titleHl)
        : displayName;

      return (
        <div
          key={file.path}
          onClick={(e) => {
            if (isRenaming) return;
            const plainClick = !e.ctrlKey && !e.metaKey && !e.shiftKey;
            handleItemClick(file.path, false, e);
            // A plain click opened the file — reveal the first match there
            // (plan Suche P5/O1). Ctrl/Shift only change the selection. The
            // jump is PARKED (the editor pane may not be mounted yet) and
            // mounted panes get poked via the event.
            if (plainClick && searchJumpTerm) {
              setPendingSearchJump({ path: file.path, term: searchJumpTerm });
              window.dispatchEvent(new CustomEvent("plainva-search-jump", { detail: { path: file.path } }));
            }
          }}
          onAuxClick={(e) => { if (!isRenaming) handleItemAuxClick(file.path, false, e); }}
          onContextMenu={(e) => openContextMenu(file.path, false, e)}
          style={{
            padding: "5px 8px",
            cursor: "pointer",
            borderRadius: "var(--radius-xs)",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            fontSize: "0.9rem",
            background: selection.has(file.path) || activePath === file.path ? "var(--bg-active)" : "transparent",
            color: conflict ? "var(--error-text)" : "var(--text-main)",
            fontWeight: activePath === file.path ? 600 : 400,
            boxShadow: activePath === file.path ? "inset 3px 0 0 var(--accent-color)" : undefined,
          }}
        >
          <span aria-hidden="true" style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 3 }}>
            {conflict
              ? <AlertTriangle size={14} color="var(--error-text)" />
              : isBase
                ? <DocIcon icon={docIcon?.icon ?? "lucide:database"} color={docIcon?.color} size={14} />
                : docIcon && isRenderableDocIcon(docIcon.icon)
                  ? <DocIcon icon={docIcon.icon} color={docIcon.color} size={14} />
                  : <FileText size={14} style={{ opacity: 0.7 }} />}
          </span>
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }} onClick={e => e.stopPropagation()}>
              <input
                autoFocus
                value={renamingName}
                aria-invalid={!!renamingError}
                onChange={e => updateRenamingName(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") cancelRenaming(); }}
                onBlur={() => handleRenameSubmit()}
                style={{ flex: 1, background: "var(--bg-primary)", color: "var(--text-main)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "2px 4px", fontSize: "0.9rem", outline: "none", minWidth: 0 }}
              />
              {renamingError && <div className="pv-inline-error">{renamingError}</div>}
            </form>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {titleContent}
                </span>
                {pending && <PendingDot />}
              </div>
              {folder && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folder}
                </div>
              )}
              {file.snippet && hasSnippetMark(file.snippet) && (
                <div className="pv-search-snippet" style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {renderSnippetNodes(file.snippet)}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    const groupHeader = (key: string, label: string, count: number) => (
      <div key={key} style={{ padding: "8px 8px 2px", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)" }}>
        {label} ({count})
      </div>
    );
    const showGroupHeaders = searchGroups.name.length > 0 && searchGroups.content.length > 0;

    content = (
      <>
        <div style={{ padding: "2px 8px 4px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {t("sidebar.resultCount", { count: files.length })}
        </div>
        {showGroupHeaders && groupHeader("gh-name", t("sidebar.matchesName"), searchGroups.name.length)}
        {searchGroups.name.map(renderHit)}
        {showGroupHeaders && groupHeader("gh-content", t("sidebar.matchesContent"), searchGroups.content.length)}
        {searchGroups.content.map(renderHit)}
      </>
    );
  } else {
    // Tree view
    const childrenNodes = sortedChildren(tree);

    content = childrenNodes.map(child => (
      <TreeNodeView
        key={child.name}
        node={child}
        activePath={activePath}
        pendingPaths={pendingPaths}
        docIcons={docIcons}
        selection={selection}
        expandedFolders={expandedFolders}
        onItemClick={handleItemClick}
        onItemAuxClick={handleItemAuxClick}
        onContextMenu={openContextMenu}
        depth={0}
        renamingItemParams={renamingItemParams}
        renamingName={renamingName}
        renamingError={renamingError}
        setRenamingName={updateRenamingName}
        handleRenameSubmit={handleRenameSubmit}
        cancelRenaming={cancelRenaming}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        draggedPath={draggedPath}
        dropTarget={dropTarget}
        newItemParams={newItemParams}
        newItemName={newItemName}
        newItemError={newItemError}
        setNewItemName={updateNewItemName}
        handleNewItemSubmit={handleNewItemSubmit}
      />
    ));
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)" }}
      onContextMenu={(e) => {
        // If clicking on the empty background of the tree, open context menu for root
        if (e.target === e.currentTarget) {
          openContextMenu("", true, e);
        }
      }}
    >
      <div
        style={{ flex: 1, overflowY: "auto", padding: "0.5rem", background: dropTarget === "" ? "var(--bg-hover)" : "transparent" }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return; // row clicks handle themselves
          if (newItemParams) setNewItemParams(null);
          setSelection(new Set());
          setSelectionAnchor(null);
        }}
        onContextMenu={(e) => {
          // Blank area below the rows = the vault root. (The outer wrapper's
          // handler could never fire — this scroller covers it completely.)
          if (e.target === e.currentTarget) openContextMenu("", true, e);
        }}
        onDragOver={(e) => handleDragOver(e, "")}
        onDrop={(e) => handleDrop(e, "")}
      >
        {newItemParams && newItemParams.parentPath === "" && (
          <form onSubmit={handleNewItemSubmit} style={{ padding: "4px 8px 4px 18px", display: "flex", alignItems: "flex-start", gap: "6px" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 14, minWidth: 14, height: 14, flexShrink: 0 }} />
            {newItemIcon(newItemParams.type)}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
              <input
                autoFocus
                value={newItemName}
                aria-invalid={!!newItemError}
                onChange={e => updateNewItemName(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") { setNewItemParams(null); setNewItemError(null); } }}
                onBlur={() => {
                  if (newItemName.trim()) {
                    handleNewItemSubmit();
                  } else {
                    setNewItemParams(null);
                    setNewItemError(null);
                  }
                }}
                placeholder={newItemPlaceholder(newItemParams.type, t)}
                style={{ flex: 1, background: "var(--bg-primary)", color: "var(--text-main)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-xs)", padding: "2px 4px", fontSize: "0.9rem", outline: "none", minWidth: 0 }}
              />
              {newItemError && <div className="pv-inline-error">{newItemError}</div>}
            </div>
          </form>
        )}
        {content}
      </div>
      {contextMenu && (
        <MenuSurface
          open
          onClose={() => setContextMenu(null)}
          at={{ x: contextMenu.x, y: contextMenu.y }}
          minWidth={188}
          ariaLabel={t("fileTree.fileActions")}
        >
          {selection.size > 1 && selection.has(contextMenu.path) ? (
            // Bulk menu (P9): the actions target the whole (pruned) selection.
            <>
              <MenuLabel>{t("fileTree.selectedCount", { count: selection.size })}</MenuLabel>
              <MenuItem icon={<Copy size={15} />} onSelect={() => handleDuplicate([...selection])}>{t("fileTree.duplicate")}</MenuItem>
              <MenuItem icon={<XCircle size={15} />} onSelect={() => { setSelection(new Set()); setSelectionAnchor(null); }}>{t("fileTree.clearSelection")}</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => handleBulkDelete([...selection])}>{t("common.delete")}</MenuItem>
            </>
          ) : (
            // Grouped single-target menu (plan UI-Menüs 2026-07-05, P3):
            // labelled sections instead of one flat list.
            <>
              {isConflictPath(contextMenu.path) && (
                <>
                  <MenuItem icon={<Check size={15} />} onSelect={() => resolveConflictKeep(contextMenu.path)}>{t("fileTree.keepVersion")}</MenuItem>
                  <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => resolveConflictDiscard(contextMenu.path)}>{t("fileTree.discardConflict")}</MenuItem>
                  <MenuSeparator />
                </>
              )}
              {contextMenu.isFolder ? (
                <>
                  <MenuLabel>{t("fileTree.groupNew", "Neu")}</MenuLabel>
                  <MenuItem icon={<FilePlus size={15} />} onSelect={() => createNewItem("file", contextMenu.path)}>{t("fileTree.newNoteHere")}</MenuItem>
                  <MenuItem icon={<FolderPlus size={15} />} onSelect={() => createNewItem("folder", contextMenu.path)}>{t("fileTree.newFolderHere")}</MenuItem>
                  <MenuItem icon={<Database size={15} />} onSelect={() => createNewItem("base", contextMenu.path)}>{t("fileTree.newBaseHere", "Neue Datenbank (.base)")}</MenuItem>
                  <MenuSeparator />
                  <MenuLabel>{contextMenu.path === "" ? t("fileTree.groupVault", "Vault") : t("fileTree.groupFolder", "Ordner")}</MenuLabel>
                  <MenuItem icon={<ListTree size={15} />} onSelect={() => handleGenerateIndex(contextMenu.path)}>{t("indexMd.contextAction")}</MenuItem>
                  {contextMenu.path === "" && (
                    <MenuItem icon={<RefreshCw size={15} />} onSelect={() => window.dispatchEvent(new CustomEvent("plainva-update-all-indexes"))}>
                      {t("indexMd.updateAllAction")}
                    </MenuItem>
                  )}
                  {contextMenu.path === "" && (
                    <MenuItem icon={<ArchiveRestore size={15} />} data-testid="tree-deleted-files" onSelect={() => window.dispatchEvent(new CustomEvent("plainva-show-deleted-files"))}>
                      {t("fileTree.restoreDeleted")}
                    </MenuItem>
                  )}
                  {contextMenu.path && (
                    <>
                      <MenuItem icon={<Pencil size={15} />} onSelect={() => startRenaming(contextMenu.path, true)}>{t("common.rename")}</MenuItem>
                      <MenuItem icon={<ClipboardCopy size={15} />} onSelect={copyContextPath}>{t("fileTree.copyPath")}</MenuItem>
                    </>
                  )}
                </>
              ) : (
                <>
                  <MenuLabel>{t("fileTree.groupOpen", "Öffnen")}</MenuLabel>
                  <MenuItem icon={<ExternalLink size={15} />} onSelect={openContextPathInNewTab}>{t("fileTree.openNewTab")}</MenuItem>
                  {onOpenInSplit && (
                    <>
                      <MenuItem icon={<Columns2 size={15} />} onSelect={() => onOpenInSplit(contextMenu.path, "vertical")}>{t("fileTree.openSplitRight")}</MenuItem>
                      <MenuItem icon={<Rows2 size={15} />} onSelect={() => onOpenInSplit(contextMenu.path, "horizontal")}>{t("fileTree.openSplitDown")}</MenuItem>
                    </>
                  )}
                  <MenuSeparator />
                  <MenuLabel>{t("fileTree.groupFile", "Datei")}</MenuLabel>
                  <MenuItem icon={<Pencil size={15} />} onSelect={() => startRenaming(contextMenu.path, false)}>{t("common.rename")}</MenuItem>
                  {!isConflictPath(contextMenu.path) && (
                    <MenuItem icon={<Copy size={15} />} onSelect={() => handleDuplicate([contextMenu.path])}>{t("fileTree.duplicate")}</MenuItem>
                  )}
                  {onToggleBookmarkPath && (
                    <MenuItem icon={<Bookmark size={15} fill={isBookmarked?.(contextMenu.path) ? "currentColor" : "none"} />} onSelect={() => onToggleBookmarkPath(contextMenu.path)}>
                      {isBookmarked?.(contextMenu.path) ? t("editor.removeBookmark") : t("editor.addBookmark")}
                    </MenuItem>
                  )}
                  {!isConflictPath(contextMenu.path) && (
                    <MenuItem
                      icon={<History size={15} />}
                      data-testid="tree-version-history"
                      onSelect={() => window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: contextMenu.path } }))}
                    >
                      {t("fileTree.versionHistory")}
                    </MenuItem>
                  )}
                  {isConflictPath(contextMenu.path) && (
                    <MenuItem
                      icon={<History size={15} />}
                      data-testid="tree-resolve-conflict"
                      onSelect={() => window.dispatchEvent(new CustomEvent("plainva-resolve-conflict", { detail: { path: contextMenu.path } }))}
                    >
                      {t("conflict.resolveAction")}
                    </MenuItem>
                  )}
                  <MenuItem icon={<ClipboardCopy size={15} />} onSelect={copyContextPath}>{t("fileTree.copyPath")}</MenuItem>
                </>
              )}
              {contextMenu.path && (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => handleDelete(contextMenu.path, contextMenu.isFolder)}>{t("common.delete")}</MenuItem>
                </>
              )}
            </>
          )}
        </MenuSurface>
      )}
      {baseWizardPath && (
        <React.Suspense fallback={null}>
          <BaseCreateWizard
            fileName={baseWizardPath.split("/").pop() ?? baseWizardPath}
            onCreate={handleWizardCreate}
            onCancel={() => setBaseWizardPath(null)}
          />
        </React.Suspense>
      )}
    </div>
  );
};
