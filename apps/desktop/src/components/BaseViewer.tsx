import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { applyIndexChanges } from "../services/fileActions";
import { useTranslation } from "react-i18next";
import { useVault } from "../contexts/VaultContext";
import { Database, Trash2, Bookmark, MoreVertical, SlidersHorizontal, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString, renameFrontmatterKey, deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY } from "@plainva/core";
import { deletePropertyFromConfig, ICON, renamePropertyInConfig, Modal } from "@plainva/ui";
import { parseBaseConfig, serializeBaseConfig } from "@plainva/ui";
import {
  addReverseColumnToConfig,
  enableSubItemsConfig,
  findReverseColumn,
  removeReverseColumnFromConfig,
  resolveNewItemTarget,
  retargetReverseColumns,
  writeReverseColumnChange,
} from "@plainva/ui";
import {
  baseStemOf,
  buildCaptureContent,
  buildNewItemContent,
  collectPrefillValues,
  getTemplateFolder,
  listTemplatesScoped,
  nextItemName,
  relationPrefill,
} from "../services/newItemFlow";
import { captureFileName, captureTimestampName } from "@plainva/ui";
import { addTemplateForAssignment, removeTemplateForAssignment } from "@plainva/ui";
import { getConfiguredNoteType } from "../services/newNote";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { resolveGoverningBase } from "../services/baseSchema";
import { detectEmbedScopeRelations, computeScopePaths, computeContextScope, buildContextScopeRelation, getContextFilters, buildEmbedScopeOptions, type EmbedScopeRelation } from "../services/embedScope";
import { writeRelationLink } from "../services/graphRelationTargets";
import { toast } from "@plainva/ui";
import { appConfirm } from "../services/appDialogs";
import { NewItemButton, NewItemFolderDialog } from "./base/NewItemButton";
import type { ReverseIntent } from "./ColumnSchemaEditor";
import { activeDocument } from "../services/activeDocument";
import { getSettingsStore } from "../services/settingsStore";
import { SHOW_COMPATIBILITY_WARNING_KEY, extendedDatabasesKey } from "../contexts/VaultContext";
import { CompatibilityWarningDialog } from "./CompatibilityWarningDialog";
import { MissingRequirementDialog } from "./MissingRequirementDialog";
import { HeaderColorPicker } from "./HeaderColorPicker";
import { SplitButton, type SplitDirection } from "./SplitButton";
import { ColumnSchemaEditor, DeletePropertyDialog } from "./ColumnSchemaEditor";
import { BasePeekModal } from "./BasePeekModal";
import { ensureViews as ensureViewsShared, defaultViewName, viewLabel, columnLabel, BASE_VIEWER_STYLES, EXTENDED_TYPES } from "./base/baseViewerShared";
import { getLastActiveView, setLastActiveView, resolveViewIndex, viewStateName, getExpandedSubItems, setExpandedSubItems } from "../services/baseViewState";
import { buildSourceClause, stripPropertyFilters, combineFilters, migrateFiltersToPerView } from "@plainva/ui";
import { baseNeedsRefresh } from "./base/baseRefreshScope";
import { useBaseCells } from "./base/useBaseCells";
import { BaseViewTabs } from "./base/BaseViewTabs";
import { BaseConfigPanel } from "./base/BaseConfigPanel";
import { BaseTableView } from "./base/BaseTableView";
import { BaseListView } from "./base/BaseListView";
import { BasePinboardView } from "./base/BasePinboardView";
import { BaseGalleryView } from "./base/BaseGalleryView";
import { BaseBoardView } from "./base/BaseBoardView";
import { BaseCalendarView } from "./base/BaseCalendarView";
import { BaseTimelineView } from "./base/BaseTimelineView";
import { BaseGraphView } from "./base/BaseGraphView";

// Orchestrator of the `.base` database viewer (structurally split per plan C3):
// owns the file/config/query state and all .base config mutations, and wires the
// split-out pieces together — view tabs, docked config panel, the six views
// (table/list/gallery/board/calendar/timeline) and the shared cell layer.
export function BaseViewer({
  activePath,
  onOpenPath,
  onOpenInSplit,
  onOpenEntry,
  onNavigateBack,
  onNavigateForward,
  canGoBack,
  canGoForward,
  isBookmarked,
  onToggleBookmark,
  onDelete,
  onSplit,
  activeSplitDirection,
  isActivePane = true,
  embedded = false,
  hostPath
}: {
  activePath: string;
  onOpenPath?: (path: string, newTab: boolean) => void;
  /** Open a note in the neighboring pane (Base-UX2 P5: Ctrl+click, peek action, card drop). */
  onOpenInSplit?: (path: string) => void;
  /** When set, an entry click routes here instead of opening this base's own
   * peek — used when this base is itself rendered inside a floating peek, so
   * entries (and `.base` targets) navigate that peek's history. */
  onOpenEntry?: (path: string) => void;
  /** Tab history back/forward (only when opened as its own tab, not embedded). */
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onDelete?: () => void;
  onSplit?: (direction: SplitDirection) => void;
  activeSplitDirection?: SplitDirection;
  isActivePane?: boolean;
  /** True when rendered inside a markdown page (`![[x.base]]`), not as its own tab. */
  embedded?: boolean;
  /** Path of the note this base is embedded in — enables auto-scoping the rows
   * to the host element when the two bases are related (embedScope). */
  hostPath?: string;
}) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, vaultPath, indexer, triggerFileTreeUpdate, fileTreeVersion, fileTreeVersionPaths } = useVault();
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Reload the config when THIS .base changes on disk (sync, watcher, or the
  // cross-file "Auf Ziel anzeigen" write from another viewer). The content
  // comparison keeps our own saves from bouncing back as a reload.
  const contentRef = useRef("");
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => {
    const onExternal = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path !== activePath || !vaultAdapter) return;
      vaultAdapter
        .readTextFile(activePath)
        .then((text) => { if (text !== contentRef.current) setReloadTick((n) => n + 1); })
        .catch(() => { /* file gone — the tab host handles that */ });
    };
    window.addEventListener("plainva-external-update", onExternal);
    return () => window.removeEventListener("plainva-external-update", onExternal);
  }, [activePath, vaultAdapter]);

  const [dbData, setDbData] = useState<any[]>([]);

  // --- Embedded-base auto-scoping (embedScope) --------------------------------
  // When this base is embedded inside a database element (hostPath) and relates
  // to that element's base, its rows are scoped to the host — runtime only, never
  // written to the .base; composes with the saved filters and feeds the new-item
  // prefill. `scopeSelection` is a relation index or "off" (session, per embed).
  const [scopeRelations, setScopeRelations] = useState<EmbedScopeRelation[]>([]);
  const [scopeSelection, setScopeSelection] = useState<string>("0");
  const [scopePaths, setScopePaths] = useState<Set<string> | null>(null);
  // Bumped after an in-embed mutation (new item) to force a local refresh — a
  // live-preview embed lives in a detached React root whose VaultContext (and
  // thus fileTreeVersion) is frozen, so the usual re-query never reaches it.
  const [refreshTick, setRefreshTick] = useState(0);
  const [dbConfig, setDbConfig] = useState<any>(null);
  // Explicit "Diese Notiz" self-reference filters (plainva-side, base-global).
  const contextFilters = useMemo(() => getContextFilters(dbConfig), [dbConfig]);

  // Column management
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  // Every property the views can offer: keys present in the query data, columns
  // declared in the .base schema (a fresh property may not exist in any file yet
  // — decision F1: schema-only until a value is set) and columns referenced by a
  // view's order.
  const availableColumns = useMemo(() => {
    const keys = new Set<string>();
    // The `plainva` frontmatter namespace (doc icon, header color, pim anchor…)
    // is an object managed via its own editor UI — never a base property; hide
    // it from the config list, mirroring PropertiesSection's markdown panel.
    dbData.forEach((row) => Object.keys(row).forEach((k) => { if (!k.startsWith("file.") && k !== PLAINVA_NAMESPACE_KEY) keys.add(k); }));
    if (dbConfig?.columns && !Array.isArray(dbConfig.columns)) {
      Object.keys(dbConfig.columns).forEach((k) => { if (!k.startsWith("file.") && k !== PLAINVA_NAMESPACE_KEY) keys.add(k); });
    }
    (Array.isArray(dbConfig?.views) ? dbConfig.views : []).forEach((v: any) => {
      (Array.isArray(v?.order) ? v.order : []).forEach((c: any) => {
        const bare = String(c).replace(/^note\./, "");
        if (!bare.startsWith("file.") && bare !== PLAINVA_NAMESPACE_KEY) keys.add(bare);
      });
    });
    return Array.from(keys);
  }, [dbData, dbConfig]);

  // Coverage of every property across the loaded rows (in how many entries it is
  // set) — drives the x/y badge in the config panel; properties present in every
  // row form the default column set of a fresh view.
  const columnCoverage = useMemo(() => {
    const counts: Record<string, number> = {};
    dbData.forEach((row) => Object.keys(row).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
    return { counts, total: dbData.length };
  }, [dbData]);
  const commonColumns = useMemo(
    () => Object.keys(columnCoverage.counts).filter((k) => columnCoverage.counts[k] === columnCoverage.total && !k.startsWith("file.") && k !== PLAINVA_NAMESPACE_KEY),
    [columnCoverage]
  );
  // Single docked, view-adaptive config panel (points 2-4) replaces the
  // header Filter/Sort/Columns dropdowns and the inline view-option bars.
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Rows matching the SOURCE conditions only (property filters stripped). The
  // filter value dropdowns in the config panel derive their options from these,
  // not from the filtered dbData — otherwise a self-filtering column offers only
  // its own active value, or nothing at all once a filter matches zero rows.
  const [filterSourceRows, setFilterSourceRows] = useState<any[] | null>(null);
  useEffect(() => {
    if (!showConfigPanel || !queryService || !dbConfig) {
      setFilterSourceRows(null);
      return;
    }
    let alive = true;
    queryService
      .queryDatabaseFiles(stripPropertyFilters(dbConfig))
      .then((rows) => { if (alive) setFilterSourceRows(rows); })
      .catch(() => { if (alive) setFilterSourceRows(null); });
    return () => { alive = false; };
  }, [showConfigPanel, dbConfig, queryService]);

  // Notion-style multiple views (point 5): the .base `views[]` array with an active
  // index. The active view drives the rendered layout, visible columns, sort and
  // layout options. The component is remounted per file (key=activePath); the load
  // effect restores the last active view of this file (P6, app-side state).
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  // Set when the load effect restores a non-zero view index: it already applies
  // the view's layout and queries its data, so the index-sync effect must skip
  // that programmatic change once.
  const suppressViewSyncRef = useRef(false);

  // Views, Filters, Sorts UI
  const [currentViewType, setCurrentViewType] = useState<string>("table");

  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  // Color picker for the database icon (P7): anchored under the header icon.
  const [iconColorPicker, setIconColorPicker] = useState<{ x: number; y: number } | null>(null);

  // Settings & Warning
  const [extendedDbEnabled, setExtendedDbEnabled] = useState(true);
  const [showCompatWarning, setShowCompatWarning] = useState(true);
  const [pendingViewType, setPendingViewType] = useState<string | null>(null);
  const [boardGroupBy, setBoardGroupBy] = useState<string | null>(null);
  const [missingReqCheck, setMissingReqCheck] = useState<{ viewName: string; requiredType: string; targetViewType: string; } | null>(null);

  const [coverImageProperty, setCoverImageProperty] = useState<string | null>(null);
  // Calendar/timeline navigation (per-view browsing of the displayed period). The
  // state lives here — not in the view components — so switching views does not
  // reset the browsing position.
  const [calMonth, setCalMonth] = useState<{ y: number; m: number }>(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [timelineStart, setTimelineStart] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d; });

  // --- Opening notes from a base (Base-UX2 P5) ---
  // Default: a floating peek window. Ctrl/Cmd+click: the neighboring pane.
  // When this base lives inside a floating peek (onOpenEntry), entries navigate
  // that peek's history instead — including `.base` targets, which the peek can
  // now render. Standalone, a `.base` target opens as a regular tab.
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const requestOpen = (path: string, ev?: { ctrlKey?: boolean; metaKey?: boolean }) => {
    if (ev && (ev.ctrlKey || ev.metaKey) && onOpenInSplit) {
      onOpenInSplit(path);
      return;
    }
    if (onOpenEntry) {
      onOpenEntry(path);
      return;
    }
    if (/\.base$/i.test(path)) {
      onOpenPath?.(path, false);
      return;
    }
    setPeekPath(path);
  };

  // Shared cell layer (typed display + inline editing), used by every view.
  const cells = useBaseCells({
    dbConfig,
    dbData,
    setDbData,
    onOpenNote: requestOpen,
    dateFormat: dbConfig?.views?.[activeViewIndex]?.dateFormat ?? "default",
  });

  // Register this base's row count so a markdown page that embeds it can show the
  // aggregated entry count in its status bar (#1); clean up on unmount / path
  // change. Runs for embedded AND directly-opened bases.
  useEffect(() => {
    const shown = scopePaths ? dbData.filter((r) => scopePaths.has(r["file.path"])).length : dbData.length;
    activeDocument.setBaseEntryCount(activePath, shown);
    return () => activeDocument.clearBaseEntryCount(activePath);
  }, [activePath, dbData, scopePaths]);

  // Only a directly-opened base drives the shared document channel so the status
  // bar shows "N Einträge" (plan D4). An embedded base must NOT overwrite the host
  // page's markdown word/char/block stats (#1). Only the focused pane publishes,
  // mirroring the Editor, so two panes never fight over it.
  useEffect(() => {
    if (embedded || !isActivePane) return;
    activeDocument.set({ path: activePath, content: "", kind: "base", meta: { entries: dbData.length } });
  }, [embedded, isActivePane, activePath, dbData.length]);

  // Per-column schema authoring (input type, options/colors/groups, relation target).
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [baseFiles, setBaseFiles] = useState<string[]>([]);
  const openColumnEditor = async (col: string) => {
    setEditingColumn(col);
    if (queryService) {
      try {
        setBaseFiles(await queryService.listBaseFilePaths());
      } catch (e) {
        console.warn("[BaseViewer] listing .base files for the column editor failed", e);
      }
    }
  };

  // --- Multiple views (Notion-style, point 5) ---
  const ensureViews = (cfg: any): any[] => ensureViewsShared(cfg, currentViewType);
  const clampIdx = (views: any[]) => Math.max(0, Math.min(activeViewIndex, views.length - 1));

  // The query reads views[0] for sort and config.filters for filtering, so hand
  // it the active view AND merge that view's per-view property filters with the
  // file-level sources (folder/tag) — combineFilters AND-joins both.
  const queryForActiveView = async (cfg: any, idx: number): Promise<any[]> => {
    if (!queryService) return [];
    const views = Array.isArray(cfg?.views) ? cfg.views : [];
    const active = views[idx] || views[0] || {};
    const merged = { ...cfg, filters: combineFilters(cfg?.filters, active?.filters), views: [active] };
    return import("../services/perfMetrics").then(({ perfMeasure }) =>
      perfMeasure("base query", () => queryService.queryDatabaseFiles(merged))
    );
  };

  // Re-query when the index changes (P9): counterpart edits — reverse-column
  // writes, external note changes, sync — land here after the watcher/re-index
  // bumps fileTreeVersion. Skipped while a cell editor is open so an in-flight
  // edit never gets reset under the user's cursor.
  useEffect(() => {
    if (!dbConfig || !queryService || cells.editingCell) return;
    // File-only bumps carry their paths (P2.7): a save that cannot affect this
    // database (outside its folder sources, no tag/relation columns) skips the
    // full re-query instead of reloading rows + reverse relations every time.
    if (!baseNeedsRefresh(dbConfig, fileTreeVersionPaths)) return;
    let alive = true;
    queryForActiveView(dbConfig, activeViewIndex)
      .then((data) => { if (alive) setDbData(data); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTreeVersion]);

  // Forced local re-query after an in-embed mutation (new item). Unconditional
  // (no baseNeedsRefresh gate) because a detached-root embed never sees the
  // fileTreeVersion bump; the scope effect below also depends on refreshTick.
  useEffect(() => {
    if (refreshTick === 0 || !dbConfig || !queryService || cells.editingCell) return;
    let alive = true;
    queryForActiveView(dbConfig, activeViewIndex).then((d) => { if (alive) setDbData(d); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Body-refresh channel (plan Pinboard P2): the pinboard is the first view
  // that renders note BODIES, and pure prose edits deliberately skip the
  // fileTreeVersion bump (fix C, 2026-07-08) — without this listener a card
  // would show stale text after "click → peek → edit → close". The editor
  // dispatches plainva-note-saved after re-indexing; re-query (debounced) when
  // the saved path can affect this base. Sync/external edits already arrive
  // through the fileTreeVersionPaths effect above.
  useEffect(() => {
    const isPinboard = (dbConfig?.views?.[activeViewIndex]?.type ?? dbConfig?.views?.[0]?.type) === "pinboard";
    if (!isPinboard || !dbConfig || !queryService) return;
    let timer: number | null = null;
    const onSaved = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (typeof path !== "string" || !baseNeedsRefresh(dbConfig, [path])) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setRefreshTick((t) => t + 1);
      }, 250);
    };
    window.addEventListener("plainva-note-saved", onSaved);
    return () => {
      window.removeEventListener("plainva-note-saved", onSaved);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [dbConfig, activeViewIndex, queryService]);

  // Detect which relations connect the embedded base to the host element's base
  // (both directions). resolveGoverningBase runs the host's base query (cached).
  useEffect(() => {
    if (!embedded || !hostPath || !dbConfig || !queryService || !vaultAdapter) {
      setScopeRelations([]);
      return;
    }
    let alive = true;
    (async () => {
      const hostBase = await resolveGoverningBase(hostPath, queryService, vaultAdapter);
      if (!alive) return;
      if (!hostBase) { setScopeRelations([]); return; }
      const rels = detectEmbedScopeRelations({
        hostBasePath: hostBase.basePath,
        hostColumns: hostBase.columns,
        embeddedBasePath: activePath,
        embeddedColumns: (dbConfig.columns ?? {}) as Record<string, any>,
        labelOf: (key) => columnLabel(key, t, dbConfig),
      });
      if (alive) setScopeRelations(rels);
    })().catch(() => { if (alive) setScopeRelations([]); });
    return () => { alive = false; };
  }, [embedded, hostPath, activePath, dbConfig, queryService, vaultAdapter, fileTreeVersion, t]);

  // Default to the first relation; reset when host or embedded base changes.
  useEffect(() => { setScopeSelection("0"); }, [hostPath, activePath]);

  // Compute the in-scope path set (link-index based). Explicit "Diese Notiz"
  // filters (contextFilters) win over auto-detection (E3) and AND-combine.
  useEffect(() => {
    if (!queryService || !hostPath || scopeSelection === "off") { setScopePaths(null); return; }
    let alive = true;
    const subtreeOf = (rel: EmbedScopeRelation) =>
      rel.selfRelation && (dbConfig?.views?.[activeViewIndex]?.subItemsProperty ?? null) === rel.column;
    if (contextFilters.length > 0) {
      const rels = contextFilters.map((prop) =>
        buildContextScopeRelation((dbConfig?.columns ?? {}) as Record<string, any>, prop, activePath, (k) => columnLabel(k, t, dbConfig))
      );
      computeContextScope(queryService, hostPath, rels, new Set(rels.filter(subtreeOf).map((r) => r.column)))
        .then((set) => { if (alive) setScopePaths(set); })
        .catch(() => { if (alive) setScopePaths(null); });
      return () => { alive = false; };
    }
    const idx = Number(scopeSelection);
    const relation = Number.isInteger(idx) ? scopeRelations[idx] : undefined;
    if (!relation) { setScopePaths(null); return; }
    computeScopePaths(queryService, hostPath, relation, { subtree: subtreeOf(relation) })
      .then((set) => { if (alive) setScopePaths(set); })
      .catch(() => { if (alive) setScopePaths(null); });
    return () => { alive = false; };
  }, [contextFilters, scopeRelations, scopeSelection, hostPath, queryService, fileTreeVersion, activeViewIndex, dbConfig, activePath, refreshTick, t]);

  // The relation currently driving the scope (chip highlight + new-item link).
  // Explicit context filters take precedence; the first "down" one drives the
  // new-item auto-link.
  const activeScopeRelation: EmbedScopeRelation | null =
    !(embedded && hostPath && scopeSelection !== "off")
      ? null
      : contextFilters.length > 0
        ? contextFilters
            .map((prop) => buildContextScopeRelation((dbConfig?.columns ?? {}) as Record<string, any>, prop, activePath, (k) => columnLabel(k, t, dbConfig)))
            .find((r) => r.direction === "down") ?? null
        : scopeRelations[Number(scopeSelection)] ?? null;
  const hostTitle = hostPath ? (hostPath.split("/").pop() || hostPath).replace(/\.md$/i, "") : "";

  // Embed scope control, surfaced as a "Diese Notiz" row in the config panel's
  // Filter section (no separate header pill). Only when embedded in a related
  // element; runtime-only, never written to the .base.
  const embedScope =
    embedded && hostPath && (contextFilters.length > 0 || scopeRelations.length > 0)
      ? {
          selection: scopeSelection,
          onChange: setScopeSelection,
          options: buildEmbedScopeOptions(contextFilters.length > 0, scopeRelations, hostTitle, {
            thisNote: t("database.filterThisNote", "Diese Notiz"),
            showAll: t("database.embedScopeOff", "Alle anzeigen"),
          }),
        }
      : undefined;

  // Rows actually displayed: the query result intersected with the scope set
  // (AND with the base's saved filters). Editing/backfill/filter dropdowns keep
  // using the full dbData; only the rendered views + count use the scoped set.
  const scopedData = useMemo(
    () => (scopePaths ? dbData.filter((r) => scopePaths.has(r["file.path"])) : dbData),
    [dbData, scopePaths]
  );

  const addView = (type: string) => {
    if (!dbConfig) return;
    const views = [...ensureViews(dbConfig)];
    views.push({ type, name: defaultViewName(t, type) });
    setActiveViewIndex(views.length - 1);
    saveConfig({ ...dbConfig, views });
  };
  // The name comes from the inline rename input in the view tabs — native
  // window.prompt is unreliable in WebView2 (plan W6).
  const renameView = (i: number, name: string) => {
    if (!dbConfig) return;
    const views = ensureViews(dbConfig);
    const next = views.map((v: any, idx: number) => (idx === i ? { ...v, name: name.trim() || undefined } : v));
    saveConfig({ ...dbConfig, views: next });
  };
  const duplicateView = (i: number) => {
    if (!dbConfig) return;
    const views = ensureViews(dbConfig);
    const copy = JSON.parse(JSON.stringify(views[i]));
    copy.name = `${viewLabel(t, views[i])} ${t("database.copySuffix", "Kopie")}`;
    const next = [...views];
    next.splice(i + 1, 0, copy);
    setActiveViewIndex(i + 1);
    saveConfig({ ...dbConfig, views: next });
  };
  const deleteView = (i: number) => {
    if (!dbConfig) return;
    const views = ensureViews(dbConfig);
    if (views.length <= 1) return; // always keep at least one view
    const next = views.filter((_: any, idx: number) => idx !== i);
    setActiveViewIndex((prev) => Math.max(0, Math.min(prev >= i ? prev - 1 : prev, next.length - 1)));
    saveConfig({ ...dbConfig, views: next });
  };
  const reorderView = (from: number, to: number) => {
    if (from === to || !dbConfig) return;
    const views = [...ensureViews(dbConfig)];
    const [moved] = views.splice(from, 1);
    views.splice(to, 0, moved);
    setActiveViewIndex((prev) => {
      if (prev === from) return to;
      if (from < prev && to >= prev) return prev - 1;
      if (from > prev && to <= prev) return prev + 1;
      return prev;
    });
    saveConfig({ ...dbConfig, views });
  };

  // --- Table column order/width persistence (views[i].order / views[i].widths) ---
  const colWidths = (): Record<string, number> => {
    const w = dbConfig?.views?.[activeViewIndex]?.widths;
    return w && typeof w === "object" ? w : {};
  };
  const reorderColumns = (cols: string[]) => {
    setVisibleColumns(cols);
    if (dbConfig) {
      const base = Array.isArray(dbConfig.views) && dbConfig.views.length > 0 ? dbConfig.views : [{ type: currentViewType }];
      const i0 = Math.min(activeViewIndex, base.length - 1);
      const views = base.map((v: any, i: number) => (i === i0 ? { ...v, order: cols } : v));
      saveConfig({ ...dbConfig, views });
    }
  };
  const persistColumnWidth = (col: string, finalW: number) => {
    if (!dbConfig) return;
    const views = [...ensureViews(dbConfig)];
    const i = clampIdx(views);
    const prevW = views[i].widths && typeof views[i].widths === "object" ? views[i].widths : {};
    views[i] = { ...views[i], widths: { ...prevW, [col]: finalW } };
    saveConfig({ ...dbConfig, views });
  };

  // Persist board grouping / gallery cover per view (point 3) so they survive reloads.
  const setBoardGroupByPersisted = (col: string) => {
    setBoardGroupBy(col);
    if (!dbConfig) return;
    const views = [...ensureViews(dbConfig)];
    const i = clampIdx(views);
    views[i] = { ...views[i], groupBy: col };
    saveConfig({ ...dbConfig, views });
  };
  const setCoverImagePersisted = (col: string | null) => {
    setCoverImageProperty(col);
    if (!dbConfig) return;
    const views = [...ensureViews(dbConfig)];
    const i = clampIdx(views);
    const nv = { ...views[i] };
    if (col) nv.coverImage = col;
    else delete nv.coverImage;
    views[i] = nv;
    saveConfig({ ...dbConfig, views });
  };

  // Switching the active view re-derives its layout/columns and re-queries so the data
  // is sorted by that view. Runs on index change only — local column edits (same index)
  // must not be clobbered. The first run (mount) is handled by the load effect.
  const didMountViewSync = useRef(false);
  useEffect(() => {
    if (!didMountViewSync.current) { didMountViewSync.current = true; return; }
    if (suppressViewSyncRef.current) { suppressViewSyncRef.current = false; return; }
    const view = dbConfig?.views?.[activeViewIndex];
    if (!view) return;
    setCurrentViewType(view.type || "table");
    const savedOrder: string[] = Array.isArray(view.order) ? view.order : [];
    setVisibleColumns(savedOrder.length > 0 ? savedOrder.map((c) => c.replace(/^note\./, "")) : ["file.name", ...commonColumns]);
    setBoardGroupBy(view.groupBy ?? null);
    setCoverImageProperty(view.coverImage ?? null);
    if (queryService) queryForActiveView(dbConfig, activeViewIndex).then((d) => setDbData(d)).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewIndex]);

  useEffect(() => {
    if (!boardGroupBy && availableColumns.length > 0 && dbConfig?.columns) {
      // Find a column that is explicitly of type 'select'
      const selectCols = availableColumns.filter(c => dbConfig.columns[c]?.input === "select");
      if (selectCols.length > 0) {
        setBoardGroupBy(selectCols.find(c => c.toLowerCase() === "status") || selectCols[0]);
      }
    }
  }, [availableColumns, boardGroupBy, dbConfig]);

  // --- Property filters (plan Base-Filtergruppen P9): the panel edits top
  // rules and one level of groups through pure filterExpr mutators; this host
  // only clones, applies and saves. Source conditions are never touched.
  const mutateFilters = (mutate: (cfg: any) => any) => {
    if (!dbConfig) return;
    saveConfig(mutate(JSON.parse(JSON.stringify(dbConfig))));
  };

  // --- New items (plan Base-Neu P4/P5, Notion model) -----------------------
  // The header's "Neu" button creates a note in the base's storage folder
  // (persisted as `newItemFolder`); without a resolvable folder the dialog
  // decides first. Name: "{base stem} {count+1}", counted past collisions.
  const [newItemBusy, setNewItemBusy] = useState(false);
  // pendingTemplate: undefined = only change the setting (no item afterwards);
  // string|null = create an item with that template (null = without) once the
  // folder is confirmed.
  const [folderDialog, setFolderDialog] = useState<null | {
    mode: "setup" | "choice";
    pendingTemplate: string | null | undefined;
  }>(null);

  const doCreateItem = async (cfg: any, folder: string, inheritTags: string[], template: string | null) => {
    if (!vaultAdapter || !vaultPath) return;
    setNewItemBusy(true);
    try {
      const dir = folder.replace(/\/+$/, "");
      const name = await nextItemName(baseStemOf(activePath), dbData.length, (n) =>
        vaultAdapter.exists((dir ? dir + "/" : "") + n + ".md").catch(() => false)
      );
      const path = (dir ? dir + "/" : "") + name + ".md";
      let templateText: string | null = null;
      if (template) {
        try {
          templateText = await vaultAdapter.readTextFile(template);
        } catch (e) {
          console.warn("[BaseViewer] reading the template failed — creating without it", template, e);
        }
      }
      let prefills = collectPrefillValues(cfg, cells.getColumnInput);
      // Punkt 4: a new item created inside an auto-scoped embed inherits the
      // host link so it immediately belongs to the scoped view.
      const scopeRel = activeScopeRelation;
      if (scopeRel && hostPath && queryService && scopeRel.direction === "down") {
        const allPaths = (await queryService.listNotes()).map((n) => n.path);
        prefills = { ...prefills, ...relationPrefill(hostPath, allPaths, scopeRel) };
      }
      const content = buildNewItemContent({
        templateText,
        noteType: await getConfiguredNoteType(vaultPath),
        title: name,
        inheritTags,
        prefills,
      });
      await vaultAdapter.writeTextFile(path, content);
      // Upward scope: the owning link lives on the host — link it to the new
      // target, appending for unlimited and setting an empty limit-one slot;
      // a full limit-one slot is left untouched (no silent reassign).
      if (scopeRel && scopeRel.direction === "up" && scopeRel.hostProperty && hostPath && queryService) {
        const props = await queryService.getFileProperties(hostPath);
        const existing = props[scopeRel.hostProperty];
        const hasValue = Array.isArray(existing) ? existing.length > 0 : existing != null && existing !== "";
        if (scopeRel.limitOne && hasValue) {
          toast.info(t("database.embedLinkSkipped", { defaultValue: "Nicht verknüpft — bereits zugeordnet.", host: hostTitle }));
        } else {
          await writeRelationLink(vaultAdapter, queryService, hostPath, path, scopeRel.hostProperty, scopeRel.limitOne);
        }
      }
      // Reindex the new note (and the host note if its relation was written) —
      // no full-vault scan per new entry (Issue #9).
      if (indexer) applyIndexChanges(indexer, { added: hostPath ? [path, hostPath] : [path] }).then(() => {
        triggerFileTreeUpdate();
        notifyFileOps([{ type: "create", path }]);
        // Detached-root embeds don't see the fileTreeVersion bump — refresh locally.
        setRefreshTick((n) => n + 1);
      }).catch(() => {});
      // Straight into the peek window (maintainer decision) so title and
      // properties can be filled in immediately.
      setPeekPath(path);
    } catch (e) {
      console.error("[BaseViewer] creating a new base item failed", e);
    } finally {
      setNewItemBusy(false);
    }
  };

  const createNewItem = async (template: string | null) => {
    if (!dbConfig || !vaultAdapter || newItemBusy) return;
    const target = resolveNewItemTarget(dbConfig);
    if (!target.folder) {
      setFolderDialog({ mode: target.pending === "choice" ? "choice" : "setup", pendingTemplate: template });
      return;
    }
    await doCreateItem(dbConfig, target.folder, target.inheritTags, template);
  };

  // Quick capture (plan Pinboard P4): Enter in the board's capture field
  // creates a Keep-style sticky note via the title popup (2026-07-17): a typed
  // TITLE becomes the file name AND the H1; without one the file gets a
  // timestamp name and the note has no H1 — the text is the body either way
  // (no template). The new card floats on top via ctime (§3); no peek opens —
  // capture stays in the flow.
  const quickCapture = async (input: { title: string; text: string; labels?: string[]; labelProp?: string | null }): Promise<boolean> => {
    if (!dbConfig || !vaultAdapter || !vaultPath || newItemBusy) return false;
    const title = input.title.trim();
    const text = input.text;
    if (!title && !text.trim()) return false;
    const target = resolveNewItemTarget(dbConfig);
    if (!target.folder) {
      setFolderDialog({ mode: target.pending === "choice" ? "choice" : "setup", pendingTemplate: undefined });
      return false;
    }
    setNewItemBusy(true);
    try {
      const dir = target.folder.replace(/\/+$/, "");
      const withDir = (n: string) => (dir ? dir + "/" : "") + n + ".md";
      const stem = (title ? captureFileName(title, 80) : null) ?? captureTimestampName(new Date());
      let name = stem;
      for (let n = 2; await vaultAdapter.exists(withDir(name)).catch(() => false); n++) {
        name = `${stem} ${n}`;
      }
      const path = withDir(name);
      // Inherit the pinboard's active label filter into the new note: in tags
      // mode the labels merge into `tags:`, in property mode they pre-fill the
      // multiselect property the board filters on.
      const labels = input.labels ?? [];
      const inheritTags = input.labelProp ? target.inheritTags : [...target.inheritTags, ...labels];
      const prefills = input.labelProp && labels.length > 0 ? { [input.labelProp]: labels } : {};
      const content = buildCaptureContent({
        text,
        title,
        noteType: await getConfiguredNoteType(vaultPath),
        inheritTags,
        prefills,
      });
      await vaultAdapter.writeTextFile(path, content);
      if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => {});
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "create", path }]);
      window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
      setRefreshTick((n) => n + 1);
      return true;
    } catch (e) {
      console.error("[BaseViewer] quick capture failed", e);
      toast.error(String((e as { message?: string })?.message ?? e));
      return false;
    } finally {
      setNewItemBusy(false);
    }
  };

  const confirmFolderDialog = async (folder: string) => {
    const dlg = folderDialog;
    if (!dlg || !dbConfig || !vaultAdapter) return;
    setFolderDialog(null);
    const clean = folder.replace(/^\/+|\/+$/g, "").trim();
    if (!clean) return;
    // The folder must exist before a note can land in it; an already existing
    // folder counts as success (same contract as the source editor).
    try {
      await vaultAdapter.createDir(clean);
    } catch {
      if (!(await vaultAdapter.exists(clean).catch(() => false))) {
        console.error("[BaseViewer] creating the storage folder failed", clean);
        return;
      }
    }
    const nc = JSON.parse(JSON.stringify(dbConfig));
    const target = resolveNewItemTarget(nc);
    // Setup on a base WITHOUT any source: the folder also becomes the source
    // (requirement). A tag-sourced base keeps its membership definition — the
    // folder is only where new items are stored; the tags make them members.
    if (dlg.mode === "setup" && target.inheritTags.length === 0) {
      if (!nc.filters) nc.filters = {};
      if (!Array.isArray(nc.filters.and)) nc.filters.and = [];
      const clause = buildSourceClause("folder", clean);
      if (!nc.filters.and.includes(clause)) nc.filters.and.push(clause);
    }
    nc.newItemFolder = clean;
    await saveConfig(nc);
    if (dlg.pendingTemplate !== undefined) {
      await doCreateItem(nc, clean, resolveNewItemTarget(nc).inheritTags, dlg.pendingTemplate);
    }
  };

  const setDefaultTemplate = (path: string | null) => {
    if (!dbConfig) return;
    const nc = JSON.parse(JSON.stringify(dbConfig));
    if (path) nc.newItemTemplate = path;
    else delete nc.newItemTemplate;
    saveConfig(nc);
  };

  // Stable identity: the dropdown re-loads the list each time it opens. The
  // scoped variant reads each template's plainva.templateFor so the menu can
  // group by assignment (plan Vorlagen-Datenbank-Zuordnung P2).
  const loadTemplatesForMenu = useCallback(async () => {
    if (!vaultPath) return { folder: "Templates", items: [] };
    const folder = await getTemplateFolder(vaultPath);
    if (!vaultAdapter) return { folder, items: [] };
    return { folder, items: await listTemplatesScoped(vaultAdapter, folder) };
  }, [vaultAdapter, vaultPath]);

  // Quick-assign toggle in the dropdown (plan D3): writes/removes ONE wiki
  // link in the template's plainva.templateFor — same data the "target
  // databases" dialog on the template edits.
  const toggleTemplateAssignment = useCallback(
    async (templatePath: string, assign: boolean) => {
      if (!vaultAdapter) return;
      try {
        const content = await vaultAdapter.readTextFile(templatePath);
        let result: { content: string; changed: boolean };
        if (assign) {
          const rows = queryService
            ? await queryService.db.query<{ path: string }>(`SELECT path FROM files`)
            : [];
          result = addTemplateForAssignment(content, activePath, rows.map((r) => r.path));
        } else {
          result = removeTemplateForAssignment(content, activePath);
        }
        if (!result.changed) return;
        await vaultAdapter.writeTextFile(templatePath, result.content);
        if (indexer) await applyIndexChanges(indexer, { added: [templatePath] }).catch(() => {});
      } catch (e) {
        console.error("[BaseViewer] toggling template assignment failed", e);
      }
    },
    [vaultAdapter, queryService, indexer, activePath]
  );

  // "Neue Vorlage erstellen": a fresh OKF note in the vault's template folder,
  // opened as a regular tab for editing (not the peek — templates are edited,
  // not filled in). Created from THIS database, it starts assigned to it (P3).
  const createTemplate = async () => {
    if (!vaultAdapter || !vaultPath) return;
    try {
      const { createNewTemplate } = await import("../services/templateActions");
      const rows = queryService
        ? await queryService.db.query<{ path: string }>(`SELECT path FROM files`)
        : [];
      const path = await createNewTemplate(vaultAdapter, vaultPath, t("database.newTemplateName", "Neue Vorlage"), {
        basePath: activePath,
        allFilePaths: rows.map((r) => r.path),
      });
      if (!path) return;
      if (indexer) applyIndexChanges(indexer, { added: [path] }).then(() => triggerFileTreeUpdate()).catch(() => {});
      onOpenPath?.(path, true);
    } catch (e) {
      console.error("[BaseViewer] creating a template failed", e);
    }
  };

  // Add a new property as a schema-only column (decision F1): it becomes a
  // column of the active view immediately, but no note is written until a cell
  // value is actually set.
  const addProperty = (rawName: string, input: string) => {
    const name = rawName.trim();
    if (!name || !dbConfig) return;
    if (name.startsWith("file.") || name.startsWith("formula.") || availableColumns.includes(name)) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};
    newConfig.columns[name] = input && input !== "text" ? { input } : {};
    const views = [...ensureViews(newConfig)];
    const i = clampIdx(views);
    const baseOrder: string[] = Array.isArray(views[i].order) && views[i].order.length > 0 ? views[i].order : visibleColumns;
    views[i] = { ...views[i], order: [...baseOrder.filter((c: string) => c !== name), name] };
    newConfig.views = views;
    setVisibleColumns((prev) => (prev.includes(name) ? prev : [...prev, name]));
    saveConfig(newConfig);
    // A fresh relation needs its target/cardinality/show-on right away — open
    // the column editor for it (Notion opens the relation config on create too).
    if (input === "relation") setEditingColumn(name);
  };

  useEffect(() => {
    let isMounted = true;
    getSettingsStore().then(store => {
      if (!isMounted) return;
      store.get<boolean>(SHOW_COMPATIBILITY_WARNING_KEY).then(show => {
        if (show !== undefined && show !== null) setShowCompatWarning(show);
      });
      if (vaultPath) {
        store.get<boolean>(extendedDatabasesKey(vaultPath)).then(ext => {
          if (ext !== undefined && ext !== null) setExtendedDbEnabled(ext);
        });
      }
    }).catch(console.error);
    return () => { isMounted = false; };
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultAdapter || !activePath) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    vaultAdapter.readTextFile(activePath)
      .then(async text => {
        if (!isMounted) return;
        setContent(text);

        // Reconcile the recorded local hash with the content we just loaded (the Editor
        // does the same on open). Without this, a stale local_sha256 from an earlier
        // session makes the next saveConfig look like an external modification and spawns
        // a spurious .CONFLICT on every edit of this .base file.
        if (vaultAdapter.acknowledgeExternalUpdate) {
          await vaultAdapter.acknowledgeExternalUpdate(activePath).catch(console.error);
        }

        if (text && queryService) {
          try {
            // Per-view filters: distribute any legacy file-level property rules
            // into each view in-memory (idempotent). config.filters keeps only
            // folder/tag sources; the per-view form persists on the next save.
            const config = migrateFiltersToPerView(parseBaseConfig(text));
            setDbConfig(config);
            // Restore the last active view of this file (P6). Embedded bases keep
            // their own explicit view; the sync effect skips this programmatic
            // index change because everything below already applies the view.
            const storedView = embedded ? null : getLastActiveView(vaultPath, activePath);
            const initialViewIndex = resolveViewIndex(config.views, storedView);
            if (initialViewIndex !== 0) {
              suppressViewSyncRef.current = true;
              setActiveViewIndex(initialViewIndex);
            }
            const data = await queryForActiveView(config, initialViewIndex);
            if (isMounted) {
              setDbData(data);

              // Determine columns dynamically
              const allKeys = new Set<string>();
              const keyCounts: Record<string, number> = {};
              data.forEach(row => {
                Object.keys(row).forEach(k => {
                  allKeys.add(k);
                  keyCounts[k] = (keyCounts[k] || 0) + 1;
                });
              });

              const totalRows = data.length;
              const common = Array.from(allKeys).filter(k => keyCounts[k] === totalRows && !k.startsWith('file.'));

              const view = config.views?.[initialViewIndex] ?? config.views?.[0];
              if (view) {
                setCurrentViewType(view.type || "table");
                const savedOrder = view.order || [];
                if (savedOrder.length > 0) {
                  setVisibleColumns(savedOrder.map((c: string) => c.replace(/^note\./, '')));
                } else {
                  setVisibleColumns(['file.name', ...common]);
                }
                if (view.groupBy != null) setBoardGroupBy(view.groupBy);
                if (view.coverImage != null) setCoverImageProperty(view.coverImage);
              } else {
                setVisibleColumns(['file.name', ...common]);
              }
            }
          } catch (e: any) {
            console.error("Failed to parse or query base database:", e);
            if (isMounted) setError(t("database.failedRender", "Failed to render database: {{message}}", { message: e.message }));
          }
        }

        if (isMounted) setIsLoading(false);
      })
      .catch(e => {
        if (isMounted) {
          setError(e.message || t("database.failedLoad", "Failed to load base file"));
          setIsLoading(false);
        }
      });

    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultAdapter, queryService, activePath, t, reloadTick]);

  // Remember the active view per file (P6) — app-side, never written to the .base.
  useEffect(() => {
    if (embedded || !dbConfig?.views?.length) return;
    const idx = Math.max(0, Math.min(activeViewIndex, dbConfig.views.length - 1));
    setLastActiveView(vaultPath, activePath, viewStateName(dbConfig.views[idx], idx));
  }, [embedded, vaultPath, activePath, activeViewIndex, dbConfig]);

  const saveConfig = async (newConfig: any) => {
    if (!vaultAdapter) return;
    try {
      const newText = serializeBaseConfig(newConfig);
      // Optimistic UI update to prevent stuck screens
      setContent(newText);
      setDbConfig(newConfig);

      await vaultAdapter.writeTextFile(activePath, newText);

      // Re-query with new config
      if (queryService) {
        const data = await queryForActiveView(newConfig, activeViewIndex);
        setDbData(data);
      }
    } catch (e: any) {
      console.error("Failed to save database config", e);
    }
  };

  const toggleColumn = (col: string) => {
    let newCols;
    if (visibleColumns.includes(col)) {
      newCols = visibleColumns.filter(c => c !== col);
    } else {
      newCols = [...visibleColumns, col];
    }
    setVisibleColumns(newCols);

    if (dbConfig) {
      const views = [...ensureViews(dbConfig)];
      const i = clampIdx(views);
      views[i] = { ...views[i], order: newCols };
      saveConfig({ ...dbConfig, views });
    }
  };

  const setViewType = (type: string) => {
    // Every Plainva-only view type (board/calendar/timeline/graph/pinboard)
    // serializes as `type: table` + `plainva.render`, so it must show the
    // Obsidian-compatibility hint — not just board/calendar/timeline
    // (maintainer 2026-07-18: the hint was missing for graph and pinboard).
    if (EXTENDED_TYPES.includes(type)) {
      if (!extendedDbEnabled) return;

      let missingType = null;
      let viewDisplayName = "";
      if (type === "board") {
        // Groupable: select columns AND owning relations (P11, Notion board-by-relation).
        const hasSelectField = dbConfig?.columns && !Array.isArray(dbConfig.columns) &&
          Object.values(dbConfig.columns).some((c: any) => c.input === "select" || ((c.input === "relation" || c.input === "link") && !c.reverseOf));
        if (!hasSelectField) {
          const statusCol = availableColumns.find(c => c.toLowerCase() === "status");
          if (statusCol) {
            applyRequirement(statusCol, false, "select", type);
            return;
          }
          missingType = "select";
          viewDisplayName = t("database.viewBoard", "Board");
        }
      } else if (type === "calendar" || type === "timeline") {
        // A configured date field (persisted as views[0].dateField) counts even if the
        // column itself is not typed yet — otherwise the dialog re-prompts on every switch.
        const hasDate = !!getDateProperty();
        if (!hasDate) {
          const dateCol = availableColumns.find(c => ["date", "datum", "created", "deadline", "start"].includes(c.toLowerCase()));
          if (dateCol) {
            applyRequirement(dateCol, false, "date", type);
            return;
          }
          missingType = "date";
          viewDisplayName = type === "calendar" ? "Calendar" : "Timeline";
        }
      }

      if (missingType) {
        setMissingReqCheck({ viewName: viewDisplayName, requiredType: missingType, targetViewType: type });
        return;
      }

      if (showCompatWarning) {
        setPendingViewType(type);
        return;
      }
    }
    commitSetViewType(type);
  };

  const applyRequirement = async (selectedColumn: string, isNew: boolean, requiredType: string, targetViewType: string, dateInput?: "date" | "datetime") => {
    const newConfig = dbConfig ? JSON.parse(JSON.stringify(dbConfig)) : {};
    if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};

    const resolvedInput = requiredType.includes("date") ? (dateInput || "date") : "select";
    newConfig.columns[selectedColumn] = {
      ...newConfig.columns[selectedColumn],
      input: resolvedInput
    };

    // Persist the chosen field as the active date field for calendar/timeline so it is
    // remembered in the .base and does not have to be re-selected every time.
    if (targetViewType === "calendar" || targetViewType === "timeline") {
      if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: targetViewType }];
      const i = Math.min(activeViewIndex, newConfig.views.length - 1);
      newConfig.views[i] = { ...newConfig.views[i], dateField: selectedColumn };
    }

    if (isNew) {
      // Update all markdown files to include the new property
      if (vaultAdapter) {
        // Run asynchronously so we don't block the UI
        setTimeout(async () => {
          for (const row of dbData) {
            if (row[selectedColumn] === undefined) {
              try {
                const text = await vaultAdapter.readTextFile(row['file.path']);
                const ast = parseMarkdownAst(text);
                const fmResult = extractFrontmatter(ast);
                const props = fmResult.success && fmResult.data ? fmResult.data : {};
                const newProps = { ...props, [selectedColumn]: "" };
                const newText = updateFrontmatterString(text, newProps);
                await vaultAdapter.writeTextFile(row['file.path'], newText);
              } catch (e) {
                console.error("Failed to add property to file", row['file.path'], e);
              }
            }
          }
        }, 0);
      }
    }

    if (targetViewType === "board") {
      setBoardGroupBy(selectedColumn);
    }

    if (showCompatWarning) {
      await saveConfig(newConfig);
      setPendingViewType(targetViewType);
    } else {
      commitSetViewType(targetViewType, newConfig);
    }
  };

  const handleMissingRequirementConfirm = async (selectedColumn: string, isNew: boolean, dateType?: "date" | "datetime") => {
    if (!missingReqCheck) return;
    const req = missingReqCheck;
    setMissingReqCheck(null); // Prevent double clicks
    await applyRequirement(selectedColumn, isNew, req.requiredType, req.targetViewType, dateType);
  };

  const commitSetViewType = (type: string, overrideConfig?: any) => {
    setCurrentViewType(type);
    const configToUse = overrideConfig || dbConfig;
    if (configToUse) {
      const newConfig = JSON.parse(JSON.stringify(configToUse));
      if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{}];
      const i = Math.min(activeViewIndex, newConfig.views.length - 1);
      newConfig.views[i] = { ...newConfig.views[i], type };
      saveConfig(newConfig);
    }
  };

  // --- Sort rules (rows in the config panel, plan W2/P9). The rule order IS the
  // priority; all rules feed the query's stable multi-level sort. ---
  const currentSortRules = (): { property: string; direction: "ASC" | "DESC" }[] => {
    const raw = dbConfig?.views?.[activeViewIndex]?.sort;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s: any) => s && typeof s === "object" && (s.property ?? s.field))
      .map((s: any) => ({ property: String(s.property ?? s.field), direction: s.direction === "DESC" ? "DESC" as const : "ASC" as const }));
  };

  const setSortRules = (rules: { property: string; direction: "ASC" | "DESC" }[]) => {
    if (!dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: currentViewType }];
    const i = Math.min(activeViewIndex, newConfig.views.length - 1);
    if (rules.length > 0) newConfig.views[i].sort = rules.map((r) => ({ property: r.property, direction: r.direction }));
    else delete newConfig.views[i].sort;
    saveConfig(newConfig);
  };

  // Table header sort: clicking a header makes that column the PRIMARY rule and
  // toggles its direction; the remaining rules keep their relative order.
  const getSortState = (col: string): "ASC" | "DESC" | null => {
    const s = dbConfig?.views?.[activeViewIndex]?.sort?.[0];
    const p = s ? (s.property ?? s.field) : null;
    if (p !== col) return null;
    return s.direction === "DESC" ? "DESC" : "ASC";
  };
  const toggleHeaderSort = (col: string) => {
    if (!dbConfig) return;
    const dir = getSortState(col) === "ASC" ? "DESC" : "ASC";
    const rest = currentSortRules().filter((r) => r.property !== col);
    setSortRules([{ property: col, direction: dir }, ...rest]);
  };

  // Explicit bulk materialization of a schema-only property (decision F1): the
  // user confirms, then the property is written (empty) into every shown note
  // that lacks it. Never triggered implicitly.
  const materializeColumn = async (col: string) => {
    if (!vaultAdapter) return;
    const missing = dbData.filter((row) => row[col] === undefined);
    if (missing.length === 0) return;
    const ok = await appConfirm({
      title: t("common.confirm", { defaultValue: "Bestätigen" }),
      message: t("database.confirmFillMissing", "Die Eigenschaft \"{{column}}\" wird (leer) in {{count}} Dateien eingetragen. Fortfahren?", { column: col, count: missing.length }),
      kind: "warning",
    });
    if (!ok) return;
    for (const row of missing) {
      try {
        const text = await vaultAdapter.readTextFile(row["file.path"]);
        const ast = parseMarkdownAst(text);
        const fmResult = extractFrontmatter(ast);
        const props = fmResult.success && fmResult.data ? fmResult.data : {};
        const newText = updateFrontmatterString(text, { ...props, [col]: "" });
        await vaultAdapter.writeTextFile(row["file.path"], newText);
      } catch (e) {
        console.error("Failed to add property to file", row["file.path"], e);
      }
    }
    // Reflect the new (empty) values right away — the re-index lags the writes.
    setDbData((prev) => prev.map((r) => (r[col] === undefined ? { ...r, [col]: "" } : r)));
  };

  // Rename a property from this base (Base-UX2 follow-up): move every config
  // reference to the new name AND rename the frontmatter key in all notes the
  // SOURCE matches (property filters stripped — hidden rows must not keep the
  // stale key). The key rename is surgical, so position/comments survive.
  // While the files are being rewritten, a blocking progress overlay shows the
  // counter — and prevents a second rename from interleaving with the first
  // (two concurrent loops over the same files would lose updates).
  const [renameProgress, setRenameProgress] = useState<{ oldName: string; newName: string; done: number; total: number } | null>(null);
  const renameBusyRef = useRef(false);
  const renameColumn = async (oldName: string, newName: string, schema: any) => {
    if (!vaultAdapter || !dbConfig || renameBusyRef.current) return;
    // Computed reverse column: its values live in OTHER notes' owning property
    // — only this config changes; no note is touched, no confirm/progress needed.
    const isReverseCol = !!(dbConfig.columns && !Array.isArray(dbConfig.columns) && dbConfig.columns[oldName]?.reverseOf);
    if (isReverseCol) {
      await saveConfig(renamePropertyInConfig(dbConfig, oldName, newName, schema));
      setDbData((prev) => prev.map((r) => {
        if (r[oldName] === undefined) return r;
        const nr = { ...r, [newName]: r[oldName] };
        delete nr[oldName];
        return nr;
      }));
      setVisibleColumns((prev) => prev.map((c) => (c === oldName ? newName : c)));
      return;
    }
    let rows: any[] = dbData;
    if (queryService) {
      try {
        rows = await queryService.queryDatabaseFiles(stripPropertyFilters(dbConfig));
      } catch (e) {
        console.warn("[BaseViewer] source query for the property rename failed — using the visible rows", e);
      }
    }
    const affected = rows.filter((r) => r[oldName] !== undefined);
    if (affected.length > 0) {
      const ok = await appConfirm({
        title: t("common.confirm", { defaultValue: "Bestätigen" }),
        message: t("database.confirmRenameProperty", "Die Eigenschaft \"{{old}}\" wird in {{count}} Dateien in \"{{new}}\" umbenannt. Fortfahren?", { old: oldName, new: newName, count: affected.length }),
        kind: "warning",
      });
      if (!ok) return;
    }
    renameBusyRef.current = true;
    setRenameProgress({ oldName, newName, done: 0, total: affected.length });
    try {
      // A self-relation's reverse column lives in THIS base (e.g. sub-items),
      // so retarget its reverseOf pointer here too — the sibling-base loop
      // below skips activePath. renamePropertyInConfig already carried the
      // view's subItemsProperty across, so the nesting keeps working.
      let renamed = renamePropertyInConfig(dbConfig, oldName, newName, schema);
      renamed = retargetReverseColumns(renamed, activePath, oldName, newName) ?? renamed;
      await saveConfig(renamed);
      for (const row of affected) {
        const path = row["file.path"];
        try {
          const text = await vaultAdapter.readTextFile(path);
          const newText = renameFrontmatterKey(text, oldName, newName);
          if (newText !== text) await vaultAdapter.writeTextFile(path, newText);
        } catch (e) {
          console.error("Failed to rename property in", path, e);
        }
        setRenameProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      // Reflect immediately — the re-index lags the file writes.
      setDbData((prev) => prev.map((r) => {
        if (r[oldName] === undefined) return r;
        const nr = { ...r, [newName]: r[oldName] };
        delete nr[oldName];
        return nr;
      }));
      setVisibleColumns((prev) => prev.map((c) => (c === oldName ? newName : c)));
      if (boardGroupBy === oldName) setBoardGroupBy(newName);
      if (coverImageProperty === oldName) setCoverImageProperty(newName);
      // Repair reverseOf pointers in sibling bases: their computed reverse
      // columns must follow the owning property's new name (P8).
      if (queryService) {
        try {
          const basePaths = await queryService.listBaseFilePaths();
          for (const p of basePaths) {
            if (p === activePath) continue;
            await writeReverseColumnChange(vaultAdapter, p, (cfg) =>
              retargetReverseColumns(cfg, activePath, oldName, newName)
            );
          }
        } catch (e) {
          console.warn("[BaseViewer] repairing reverse columns after the rename failed", e);
        }
      }
    } finally {
      renameBusyRef.current = false;
      setRenameProgress(null);
    }
  };

  // --- Delete property (plan Base-Neu P11/P12) -----------------------------
  // The column editor's "Eigenschaft löschen" opens a confirmation: the config
  // is cleaned everywhere (schema, views, filters, raw entry), an owning
  // relation takes its reverse column in the target base along, and the
  // checkbox (default ON) also strips the frontmatter key from the source's
  // notes — same scope, busy-latch and progress pattern as the rename.
  const [deleteColumnAsk, setDeleteColumnAsk] = useState<null | {
    column: string;
    affected: number;
    isReverse: boolean;
    reverseInTarget: { base: string; name: string } | null;
  }>(null);
  const [deleteProgress, setDeleteProgress] = useState<{ column: string; done: number; total: number } | null>(null);

  const sourceRows = async (): Promise<any[]> => {
    if (queryService) {
      try {
        return await queryService.queryDatabaseFiles(stripPropertyFilters(dbConfig));
      } catch (e) {
        console.warn("[BaseViewer] source query failed — using the visible rows", e);
      }
    }
    return dbData;
  };

  const openDeleteColumn = async (column: string) => {
    if (!dbConfig || !vaultAdapter) return;
    const schema = dbConfig.columns && !Array.isArray(dbConfig.columns) ? dbConfig.columns[column] : undefined;
    const isReverse = !!schema?.reverseOf;
    const affected = isReverse ? 0 : (await sourceRows()).filter((r) => r[column] !== undefined).length;
    let reverseInTarget: { base: string; name: string } | null = null;
    if (!isReverse && schema?.input === "relation" && schema.relationBase) {
      try {
        const targetCfg = schema.relationBase === activePath
          ? dbConfig
          : parseBaseConfig(await vaultAdapter.readTextFile(schema.relationBase));
        const revName = findReverseColumn(targetCfg, activePath, column);
        if (revName) reverseInTarget = { base: schema.relationBase, name: revName };
      } catch {
        /* target unreadable — nothing to clean there */
      }
    }
    setDeleteColumnAsk({ column, affected, isReverse, reverseInTarget });
  };

  const performDeleteColumn = async (ask: NonNullable<typeof deleteColumnAsk>, cleanupFrontmatter: boolean) => {
    if (!dbConfig || !vaultAdapter || renameBusyRef.current) return;
    const { column } = ask;
    setDeleteColumnAsk(null);
    renameBusyRef.current = true; // shared latch: rename and delete both rewrite many files
    try {
      // 1. This base's config; a self-target reverse column folds into the same save.
      let nc = deletePropertyFromConfig(dbConfig, column);
      if (ask.reverseInTarget && ask.reverseInTarget.base === activePath) {
        nc = removeReverseColumnFromConfig(nc, ask.reverseInTarget.name);
      }
      await saveConfig(nc);
      // 2. Reverse column in ANOTHER base via the single cross-file writer.
      if (ask.reverseInTarget && ask.reverseInTarget.base !== activePath) {
        try {
          await writeReverseColumnChange(vaultAdapter, ask.reverseInTarget.base, (cfg) => {
            const rev = findReverseColumn(cfg, activePath, column);
            return rev ? removeReverseColumnFromConfig(cfg, rev) : null;
          });
        } catch (e) {
          console.error("[BaseViewer] removing the reverse column in the target base failed", ask.reverseInTarget.base, e);
        }
      }
      // 3. Frontmatter cleanup over the source scope (checkbox, default ON).
      if (cleanupFrontmatter && !ask.isReverse) {
        const affected = (await sourceRows()).filter((r) => r[column] !== undefined);
        setDeleteProgress({ column, done: 0, total: affected.length });
        for (const row of affected) {
          const path = row["file.path"];
          try {
            const text = await vaultAdapter.readTextFile(path);
            const newText = deleteFrontmatterPath(text, [column]);
            if (newText !== text) await vaultAdapter.writeTextFile(path, newText);
          } catch (e) {
            console.error("Failed to remove property from", path, e);
          }
          setDeleteProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      }
      // 4. Reflect immediately — the re-index lags the writes.
      setDbData((prev) => prev.map((r) => {
        if (r[column] === undefined) return r;
        const nr = { ...r };
        delete nr[column];
        return nr;
      }));
      setVisibleColumns((prev) => prev.filter((c) => c !== column));
      if (boardGroupBy === column) setBoardGroupBy(null);
      if (coverImageProperty === column) setCoverImageProperty(null);
    } finally {
      renameBusyRef.current = false;
      setDeleteProgress(null);
    }
  };

  // "Auf Ziel anzeigen" (P8, Notion "Show on related database"): create/remove
  // the computed reverse column in the TARGET base. A self-target folds into
  // the config we are about to save (one write); other bases go through the
  // single cross-file writer, whose plainva-external-update event reloads any
  // open viewer of that file.
  const handleColumnEditorSave = async (column: string, s: any, newName?: string, reverseIntent?: ReverseIntent) => {
    if (!vaultAdapter || !dbConfig) return;
    const targetBasePath: string | undefined = s?.relationBase;
    const owningProperty = newName ?? column;
    const mutate = (cfg: any) =>
      reverseIntent!.action === "create"
        ? addReverseColumnToConfig(cfg, { name: reverseIntent!.name, sourceBasePath: activePath, sourceProperty: owningProperty })
        : removeReverseColumnFromConfig(cfg, reverseIntent!.name);

    if (newName) {
      await renameColumn(column, newName, s);
      if (reverseIntent && targetBasePath) {
        try {
          if (targetBasePath === activePath) {
            // renameColumn already saved — mutate the freshly written file.
            const cfg = parseBaseConfig(await vaultAdapter.readTextFile(activePath));
            await saveConfig(mutate(cfg));
          } else {
            await writeReverseColumnChange(vaultAdapter, targetBasePath, mutate);
          }
        } catch (e) {
          console.error("[BaseViewer] applying the reverse column to the target base failed", targetBasePath, e);
        }
      }
      return;
    }

    let nc = { ...dbConfig };
    if (!nc.columns || Array.isArray(nc.columns)) nc.columns = {};
    nc.columns = { ...nc.columns, [column]: s };
    if (reverseIntent && targetBasePath === activePath) nc = mutate(nc);
    await saveConfig(nc);
    if (reverseIntent && targetBasePath && targetBasePath !== activePath) {
      try {
        await writeReverseColumnChange(vaultAdapter, targetBasePath, mutate);
      } catch (e) {
        console.error("[BaseViewer] applying the reverse column to the target base failed", targetBasePath, e);
      }
    }
  };

  // --- Sub-items (P10, Notion model) ---------------------------------------
  // Expanded rows per file, app-side (like the active view); default collapsed.
  const [expandedSubItems, setExpandedSubItemsState] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedSubItemsState(new Set(getExpandedSubItems(vaultPath, activePath)));
  }, [vaultPath, activePath]);
  const toggleSubItemExpand = (path: string) => {
    setExpandedSubItemsState((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setExpandedSubItems(vaultPath, activePath, [...next]);
      return next;
    });
  };

  // Sub-items is a database-level structure (a self-relation), not a per-view
  // toggle (maintainer 2026-07-18): derive the parent column from the WHOLE
  // config (any view that designates one) so the config toggle reads correctly
  // in every view type. Only table views render the nesting.
  const dbSubItemsParent: string | null =
    (dbConfig?.views ?? [])
      .map((v: any) => (typeof v?.subItemsProperty === "string" && v.subItemsProperty ? v.subItemsProperty : null))
      .find((p: string | null): p is string => !!p) ?? null;

  // The switch's ON path: reuse an existing self-relation as the parent
  // property (or create `parent`, limit 1), ensure the computed reverse column
  // exists, and designate it on EVERY view — one saveConfig, like Notion's
  // one-click setup. Database-global so any table view nests by it.
  const enableSubItems = () => {
    if (!dbConfig) return;
    // Auto-created columns keep stable, portable keys (`parent` / `subitems`)
    // and get a localized, paired header via displayName — no raw "parent" key
    // leaks into the header any more (naming fix).
    const { config: withCols, parentProperty } = enableSubItemsConfig(dbConfig, activePath, {
      parentItem: t("database.parentItem", "Übergeordnetes Element"),
      subItems: t("database.subItems", "Unterelemente"),
    });
    const nc = withCols;
    nc.views = ensureViews(nc).map((v: any) => ({ ...v, subItemsProperty: parentProperty }));
    saveConfig(nc);
  };

  // OFF / property switch: the view key changes on ALL views (database-global,
  // maintainer 2026-07-18) — columns stay (removing them fully goes through the
  // regular column mechanisms, see the panel hint).
  const setSubItemsProperty = (col: string | null) => {
    if (!dbConfig) return;
    const nc = JSON.parse(JSON.stringify(dbConfig));
    nc.views = ensureViews(nc).map((v: any) => {
      const nv = { ...v };
      if (col) nv.subItemsProperty = col;
      else delete nv.subItemsProperty;
      return nv;
    });
    saveConfig(nc);
  };

  // Per-view date display format (plan W2/P12, decision F2): default | long | iso | relative.
  const setDateFormat = (fmt: string) => {
    if (!dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: currentViewType }];
    const i = Math.min(activeViewIndex, newConfig.views.length - 1);
    if (fmt && fmt !== "default") newConfig.views[i].dateFormat = fmt;
    else delete newConfig.views[i].dateFormat;
    saveConfig(newConfig);
  };

  // The name comes from the board's inline input (plan W6, no window.prompt).
  const handleAddBoardGroup = (rawName: string) => {
    const name = rawName.trim();
    if (!name || !boardGroupBy || !dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};
    if (!newConfig.columns[boardGroupBy]) newConfig.columns[boardGroupBy] = { input: "select", options: [] };
    if (!Array.isArray(newConfig.columns[boardGroupBy].options)) newConfig.columns[boardGroupBy].options = [];
    const optArray = newConfig.columns[boardGroupBy].options;
    if (!optArray.some((o: any) => o.label === name || o.value === name)) {
      optArray.push({ value: name });
      saveConfig(newConfig);
    }
  };

  // Reorder board columns (report 2026-07-07): select/status/multiselect boards
  // reorder the group property's options (so dropdowns everywhere follow —
  // maintainer choice); relation/text boards remember a per-view layout under
  // views[i].plainva.boardColumnOrder instead.
  const handleReorderBoardColumns = (orderedKeys: string[]) => {
    if (!boardGroupBy || !dbConfig) return;
    const nc = JSON.parse(JSON.stringify(dbConfig));
    const col = nc.columns && !Array.isArray(nc.columns) ? nc.columns[boardGroupBy] : undefined;
    const optKey = (o: any) => o?.label || o?.value || String(o);
    const isOptionCol = col && ["select", "status", "multiselect"].includes(col.input) && Array.isArray(col.options) && col.options.length > 0;
    if (isOptionCol) {
      const remaining = new Map<string, any>(col.options.map((o: any) => [optKey(o), o]));
      const reordered: any[] = [];
      for (const k of orderedKeys) {
        const o = remaining.get(k);
        if (o) { reordered.push(o); remaining.delete(k); }
      }
      for (const o of col.options) if (remaining.has(optKey(o))) { reordered.push(o); remaining.delete(optKey(o)); }
      nc.columns[boardGroupBy] = { ...col, options: reordered };
    } else {
      if (!Array.isArray(nc.views) || nc.views.length === 0) nc.views = [{ type: currentViewType }];
      const vi = Math.min(activeViewIndex, nc.views.length - 1);
      nc.views[vi] = { ...nc.views[vi], boardColumnOrder: orderedKeys };
    }
    saveConfig(nc);
  };

  const getDateProperty = (): string | null => {
    // The explicitly chosen field (persisted in the .base view config) wins.
    const view = dbConfig?.views?.[activeViewIndex];
    if (view?.dateField) return view.dateField;
    // Fallback: first column explicitly typed as date/datetime.
    if (dbConfig?.columns && !Array.isArray(dbConfig.columns)) {
      const dateCol = Object.entries(dbConfig.columns).find(([, v]: [string, any]) => v.input === "date" || v.input === "datetime");
      if (dateCol) return dateCol[0];
    }
    return null;
  };

  const getEndDateProperty = (): string | null => dbConfig?.views?.[activeViewIndex]?.endField || null;

  // Database-icon tint (P7): kept in-memory as `config.iconColor`, persisted by
  // serializeBaseConfig under views[0].plainva.fileIconColor (Obsidian-safe).
  const baseIconColor: string | undefined = typeof dbConfig?.iconColor === "string" ? dbConfig.iconColor : undefined;
  const setBaseIconColor = async (color: string | null) => {
    setIconColorPicker(null);
    if (!dbConfig) return;
    const newConfig = { ...dbConfig };
    if (color) newConfig.iconColor = color;
    else delete newConfig.iconColor;
    await saveConfig(newConfig);
    // The tree and tab strips read the tint via useDocumentIcons — refresh them.
    triggerFileTreeUpdate();
  };

  // The date-field controls live in the config panel now; open it automatically
  // when a calendar/timeline view has no date field yet so the user can pick one.
  useEffect(() => {
    if ((currentViewType === "calendar" || currentViewType === "timeline") && !getDateProperty()) {
      setShowConfigPanel(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewType, dbConfig]);

  // Persist the active date field for calendar/timeline in the .base view config.
  const setDateField = (col: string) => {
    if (!dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: currentViewType }];
    const vi = Math.min(activeViewIndex, newConfig.views.length - 1);
    newConfig.views[vi].dateField = col;
    if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};
    const existing = newConfig.columns[col]?.input;
    if (existing !== "date" && existing !== "datetime") {
      newConfig.columns[col] = { ...newConfig.columns[col], input: "date" };
    }
    saveConfig(newConfig);
  };

  // Switch the active date field(s) between date-only and date & time. Switching the
  // type also converts the stored values in every matching note so data and type stay
  // consistent: date -> datetime appends a default time of 12:00; datetime -> date drops
  // the time (after the user confirms, since that loses information).
  const setDateFieldType = async (inputType: "date" | "datetime") => {
    const field = getDateProperty();
    if (!field || !dbConfig) return;
    const currentType = cells.getColumnInput(field) === "datetime" ? "datetime" : "date";
    if (currentType === inputType) return;

    const endField = getEndDateProperty();
    const fields = [field, endField].filter((f): f is string => !!f);

    if (inputType === "date") {
      const ok = await appConfirm({
        title: t("common.confirm", { defaultValue: "Bestätigen" }),
        message: t("database.confirmDropTime", "Beim Wechsel auf \"Nur Datum\" gehen die Uhrzeiten der ausgewählten Felder verloren. Fortfahren?"),
        kind: "warning",
      });
      if (!ok) {
        // Snap the (controlled) select back to the current type.
        setDbConfig({ ...dbConfig });
        return;
      }
    }

    const convert = (v: any): any => {
      if (v === undefined || v === null || v === "") return v;
      const datePart = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return v; // leave unparseable values alone
      if (inputType === "datetime") return String(v).length > 10 ? String(v) : `${datePart}T12:00`;
      return datePart;
    };

    // Rewrite the affected frontmatter values in every matching note.
    if (vaultAdapter) {
      for (const row of dbData) {
        const path = row['file.path'];
        try {
          const text = await vaultAdapter.readTextFile(path);
          const ast = parseMarkdownAst(text);
          const fmResult = extractFrontmatter(ast);
          const props = fmResult.success && fmResult.data ? { ...fmResult.data } : {};
          let changed = false;
          for (const f of fields) {
            const nv = convert(props[f]);
            if (nv !== props[f]) { props[f] = nv; changed = true; }
          }
          if (changed) {
            const newText = updateFrontmatterString(text, props);
            await vaultAdapter.writeTextFile(path, newText);
          }
        } catch (e) {
          console.error("Failed to convert date field type in", path, e);
        }
      }
    }

    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};
    for (const f of fields) {
      newConfig.columns[f] = { ...newConfig.columns[f], input: inputType };
    }
    await saveConfig(newConfig);

    // The DB re-index lags the file writes; reflect the converted values right away.
    setDbData(prev => prev.map(row => {
      const updated = { ...row };
      for (const f of fields) updated[f] = convert(updated[f]);
      return updated;
    }));
  };

  // Optional end-date field for the timeline (empty string clears it).
  const setEndDateField = (col: string) => {
    if (!dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: currentViewType }];
    const vi = Math.min(activeViewIndex, newConfig.views.length - 1);
    if (col) {
      newConfig.views[vi].endField = col;
      if (!newConfig.columns || Array.isArray(newConfig.columns)) newConfig.columns = {};
      const existing = newConfig.columns[col]?.input;
      if (existing !== "date" && existing !== "datetime") {
        newConfig.columns[col] = { ...newConfig.columns[col], input: "date" };
      }
    } else {
      delete newConfig.views[vi].endField;
    }
    saveConfig(newConfig);
  };

  // Per-view options (graph P8, board color mode WP3): keys live on the active
  // view's plainva namespace; a patch clones the config and persists through
  // saveConfig. `undefined` deletes a key so defaults stay unwritten.
  const patchActiveView = (patch: Record<string, unknown>) => {
    if (!dbConfig) return;
    const newConfig = JSON.parse(JSON.stringify(dbConfig));
    if (!Array.isArray(newConfig.views) || newConfig.views.length === 0) newConfig.views = [{ type: currentViewType }];
    const vi = Math.min(activeViewIndex, newConfig.views.length - 1);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete newConfig.views[vi][key];
      else newConfig.views[vi][key] = value;
    }
    saveConfig(newConfig);
  };

  const columnKeysByKind = (predicate: (col: any) => boolean): string[] =>
    Object.entries((dbConfig?.columns ?? {}) as Record<string, any>)
      .filter(([, col]) => col && typeof col === "object" && predicate(col))
      .map(([key]) => key);

  const renderViewContent = () => {
    if (currentViewType === "list") return <BaseListView dbData={scopedData} visibleColumns={visibleColumns} cells={cells} onOpenNote={requestOpen} />;
    if (currentViewType === "pinboard")
      return (
        <BasePinboardView
          dbData={scopedData}
          dbConfig={dbConfig}
          activeView={dbConfig?.views?.[activeViewIndex] ?? {}}
          visibleColumns={visibleColumns}
          cells={cells}
          onPatchView={patchActiveView}
          onOpenNote={requestOpen}
          onOpenInSplit={onOpenInSplit}
          onQuickCapture={quickCapture}
          embedded={embedded}
        />
      );
    if (currentViewType === "graph")
      return (
        <BaseGraphView
          dbData={scopedData}
          dbConfig={dbConfig}
          activeView={dbConfig?.views?.[activeViewIndex] ?? {}}
          relationKeys={columnKeysByKind((c) => c.input === "relation" || !!c.relationBase)}
          selectKeys={columnKeysByKind((c) => c.input === "select" || c.input === "status" || c.input === "multiselect")}
          numberKeys={columnKeysByKind((c) => c.input === "number")}
          onOpenNote={requestOpen}
          onDropToSplit={onOpenInSplit}
          onPatchView={patchActiveView}
        />
      );
    if (currentViewType === "gallery") return <BaseGalleryView dbData={scopedData} visibleColumns={visibleColumns} coverImageProperty={coverImageProperty} cells={cells} onOpenNote={requestOpen} onDropToSplit={onOpenInSplit} />;
    if (currentViewType === "board") return <BaseBoardView dbData={scopedData} dbConfig={dbConfig} visibleColumns={visibleColumns} boardGroupBy={boardGroupBy} boardColumnOrder={dbConfig?.views?.[activeViewIndex]?.boardColumnOrder} boardColorMode={dbConfig?.views?.[activeViewIndex]?.boardColorMode === "column" ? "column" : "chip"} cells={cells} onOpenNote={requestOpen} onDropToSplit={onOpenInSplit} onAddGroup={handleAddBoardGroup} onReorderColumns={handleReorderBoardColumns} />;
    if (currentViewType === "calendar") return <BaseCalendarView dbData={scopedData} dateProp={getDateProperty()} calMonth={calMonth} setCalMonth={setCalMonth} visibleColumns={visibleColumns} cells={cells} onOpenNote={requestOpen} onDropToSplit={onOpenInSplit} />;
    if (currentViewType === "timeline") return <BaseTimelineView dbData={scopedData} dateProp={getDateProperty()} endProp={getEndDateProperty()} timelineStart={timelineStart} setTimelineStart={setTimelineStart} visibleColumns={visibleColumns} cells={cells} onOpenNote={requestOpen} onDropToSplit={onOpenInSplit} />;
    return (
      <BaseTableView
        dbData={scopedData}
        visibleColumns={visibleColumns}
        colWidths={colWidths()}
        cells={cells}
        getSortState={getSortState}
        onToggleHeaderSort={toggleHeaderSort}
        onReorderColumns={reorderColumns}
        onPersistColumnWidth={persistColumnWidth}
        onOpenColumnEditor={openColumnEditor}
        onToggleColumn={toggleColumn}
        subItems={currentViewType === "table" && dbSubItemsParent ? { property: dbSubItemsParent, expandedKeys: expandedSubItems, onToggleExpand: toggleSubItemExpand } : undefined}
      />
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="base-header-container" style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        {/* Tab history back/forward (mirrors the Editor's nav row); only when
            opened as its own tab (not embedded in a markdown page). */}
        {onNavigateBack && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.15rem", flexShrink: 0 }}>
            <button
              type="button"
              onClick={onNavigateBack}
              disabled={!canGoBack}
              aria-label={t("editor.back")}
              data-tip={t("editor.back")}
              className="pv-iconbtn"
            >
              <ArrowLeft size={ICON.ui} />
            </button>
            <button
              type="button"
              onClick={onNavigateForward}
              disabled={!canGoForward}
              aria-label={t("editor.forward")}
              data-tip={t("editor.forward")}
              className="pv-iconbtn"
            >
              <ArrowRight size={ICON.ui} />
            </button>
          </div>
        )}

        {/* The file name lives in the tab now (point 8). The DB marker doubles as
            the icon-color button (P7): the tint mirrors into tree and tabs. */}
        <button
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setIconColorPicker({ x: r.left, y: r.bottom + 4 });
          }}
          aria-label={t("database.iconColor", "Icon-Farbe der Datenbank")}
          data-tip={t("database.iconColor", "Icon-Farbe der Datenbank")}
          className="pv-iconbtn"
        >
          <Database size={ICON.head} color={baseIconColor || "var(--accent-color)"} />
        </button>

        {/* "Neu" sits top-left with a small gap before the view tabs;
            "Konfigurieren" lives on the right next to the split/menu controls
            (maintainer layout 2026-07-04). */}
        <NewItemButton
          t={t}
          disabled={!dbConfig || !!error}
          busy={newItemBusy}
          basePath={activePath}
          currentFolder={dbConfig ? resolveNewItemTarget(dbConfig).folder : null}
          defaultTemplate={typeof dbConfig?.newItemTemplate === "string" && dbConfig.newItemTemplate ? dbConfig.newItemTemplate : null}
          loadTemplates={loadTemplatesForMenu}
          onToggleAssign={toggleTemplateAssignment}
          onCreate={(tpl) => { void createNewItem(tpl); }}
          onSetDefaultTemplate={setDefaultTemplate}
          onCreateTemplate={() => { void createTemplate(); }}
          onChangeFolder={() => {
            if (!dbConfig) return;
            const target = resolveNewItemTarget(dbConfig);
            setFolderDialog({ mode: target.folderSources.length > 0 ? "choice" : "setup", pendingTemplate: undefined });
          }}
          onOpenTemplatesFolder={() => {
            void (async () => {
              if (!vaultPath) return;
              const folder = await getTemplateFolder(vaultPath);
              // Reveal (and expand) the template folder in the file tree so the
              // user can edit/rename/delete templates there.
              window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: folder } }));
            })();
          }}
        />
        <div style={{ width: "0.25rem" }} aria-hidden="true" />

        <BaseViewTabs
          views={ensureViews(dbConfig)}
          activeViewIndex={activeViewIndex}
          extendedDbEnabled={extendedDbEnabled}
          onSelect={setActiveViewIndex}
          onReorder={reorderView}
          onAdd={addView}
          onRename={renameView}
          onDuplicate={duplicateView}
          onDelete={deleteView}
        />

        <div style={{ marginLeft: "auto" }} />

        {/* Scope moved into the config panel's Filter section as a "Diese Notiz"
            row (maintainer 2026-07-07: unify the embed scope with the filter
            mechanism instead of a separate header pill). */}

        {/* View options live in a single docked, view-adaptive config panel (points 2-4). */}
        <button
          onClick={() => setShowConfigPanel((s) => !s)}
          aria-label={t("database.configure", "Konfigurieren")}
          data-tip={t("database.configure", "Konfigurieren")}
          className="pv-btn pv-btn--secondary pv-btn--sm"
          style={showConfigPanel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
        >
          <SlidersHorizontal size={ICON.ui} /><span className="base-toolbar-label">{t("database.configure", "Konfigurieren")}</span>
        </button>
        <SplitButton onSplit={onSplit} activeDirection={activeSplitDirection} />
        <div style={{ position: "relative", marginLeft: "0.5rem" }}>
          <button
            onClick={() => setShowHeaderMenu(!showHeaderMenu)}
            data-tip={t("editor.menu", { defaultValue: "Menu" })}
            aria-label={t("editor.menu", { defaultValue: "Menu" })}
            className="pv-iconbtn"
          >
            <MoreVertical size={ICON.ui} />
          </button>
          {showHeaderMenu && (
            <>
              <div className="base-menu-backdrop" onClick={() => setShowHeaderMenu(false)} />
              <div className="pv-menu" style={{ position: "absolute", top: "100%", right: 0, left: "auto", marginTop: 4, minWidth: 170 }}>
                <button
                  onClick={() => { setShowHeaderMenu(false); onToggleBookmark?.(); }}
                  className="pv-menu-item"
                >
                  <Bookmark size={ICON.ui} fill={isBookmarked ? "currentColor" : "none"} />
                  {isBookmarked ? t("editor.removeBookmark", { defaultValue: "Lesezeichen entfernen" }) : t("editor.addBookmark", { defaultValue: "Lesezeichen hinzufügen" })}
                </button>
                <div className="pv-menu-sep" role="separator" />
                <button
                  onClick={() => { setShowHeaderMenu(false); onDelete?.(); }}
                  className="pv-menu-item pv-menu-item--danger"
                >
                  <Trash2 size={ICON.ui} />
                  {t("editor.delete", { defaultValue: "Löschen" })}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', position: 'relative' }}>
          {isLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>{t("common.loading", "Loading...")}</div>
          ) : error ? (
            <div style={{ color: 'var(--error-text)' }}>{error}</div>
          ) : (
            <div style={{ background: 'var(--bg-primary)', borderRadius: "var(--radius-sm)", border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
              {content ? renderViewContent() : <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>{t("database.emptyConfig", "Empty database configuration.")}</div>}
            </div>
          )}
        </div>
        {showConfigPanel && !isLoading && !error && (
          <BaseConfigPanel
            currentViewType={currentViewType}
            extendedDbEnabled={extendedDbEnabled}
            dbConfig={dbConfig}
            activeViewIndex={activeViewIndex}
            embedScope={embedScope}
            visibleColumns={visibleColumns}
            availableColumns={availableColumns}
            columnCoverage={columnCoverage}
            cells={cells}
            filterValueRows={filterSourceRows ?? dbData}
            onReorderColumns={reorderColumns}
            boardGroupBy={boardGroupBy}
            coverImageProperty={coverImageProperty}
            dateProp={getDateProperty()}
            endProp={getEndDateProperty()}
            dateFormat={dbConfig?.views?.[activeViewIndex]?.dateFormat ?? "default"}
            sortRules={currentSortRules()}
            onClose={() => setShowConfigPanel(false)}
            onSetViewType={setViewType}
            onToggleColumn={toggleColumn}
            onOpenColumnEditor={openColumnEditor}
            onSaveConfig={saveConfig}
            onMutateFilters={mutateFilters}
            onSetSortRules={setSortRules}
            onAddProperty={addProperty}
            onSetBoardGroupBy={setBoardGroupByPersisted}
            boardColorMode={dbConfig?.views?.[activeViewIndex]?.boardColorMode === "column" ? "column" : "chip"}
            onSetBoardColorMode={(m) => patchActiveView({ boardColorMode: m === "column" ? "column" : undefined })}
            pinboardFilterBy={typeof dbConfig?.views?.[activeViewIndex]?.pinboardFilterBy === "string" ? dbConfig.views[activeViewIndex].pinboardFilterBy : "tags"}
            onSetPinboardFilterBy={(src) => patchActiveView({ pinboardFilterBy: src === "tags" ? undefined : src })}
            onSetCoverImage={setCoverImagePersisted}
            onSetDateField={setDateField}
            onSetDateFieldType={setDateFieldType}
            onSetEndDateField={setEndDateField}
            onSetDateFormat={setDateFormat}
            subItemsProperty={dbSubItemsParent}
            onEnableSubItems={enableSubItems}
            onSetSubItemsProperty={setSubItemsProperty}
          />
        )}
      </div>

      <style>{BASE_VIEWER_STYLES}</style>
      {renameProgress && (
        <Modal
          onClose={() => {}}
          closeOnOverlay={false}
          hideClose
          title={t("database.renamingProperty", "Eigenschaft wird umbenannt…")}
          icon={<RefreshCw size={ICON.head} color="var(--accent-color)" className="spin-animation" />}
          size="sm"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
              {t("database.renamingProgress", "\"{{old}}\" → \"{{new}}\" · {{done}} von {{total}} Dateien", { old: renameProgress.oldName, new: renameProgress.newName, done: renameProgress.done, total: renameProgress.total })}
            </div>
            <div style={{ height: 6, borderRadius: "var(--radius-xs)", background: "var(--bg-secondary)", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--accent-color)", transition: "width var(--dur-1) var(--ease-1)", width: `${renameProgress.total > 0 ? Math.round((renameProgress.done / renameProgress.total) * 100) : 100}%` }} />
            </div>
          </div>
        </Modal>
      )}
      {peekPath && (
        <BasePeekModal
          path={peekPath}
          onClose={() => setPeekPath(null)}
          onMaximize={(p) => { onOpenPath?.(p, true); setPeekPath(null); }}
          onOpenSplit={onOpenInSplit ? (p) => { onOpenInSplit(p); setPeekPath(null); } : undefined}
        />
      )}
      {iconColorPicker && (
        <HeaderColorPicker
          x={iconColorPicker.x}
          y={iconColorPicker.y}
          value={baseIconColor}
          onSelect={(c) => { void setBaseIconColor(c); }}
          onRemove={() => { void setBaseIconColor(null); }}
          onClose={() => setIconColorPicker(null)}
        />
      )}
      {folderDialog && dbConfig && (() => {
        const target = resolveNewItemTarget(dbConfig);
        return (
          <NewItemFolderDialog
            t={t}
            mode={folderDialog.mode}
            folderSources={target.folderSources}
            current={typeof dbConfig.newItemFolder === "string" && dbConfig.newItemFolder ? dbConfig.newItemFolder : target.folder}
            hasTagSources={target.inheritTags.length > 0}
            onConfirm={(folder) => { void confirmFolderDialog(folder); }}
            onCancel={() => setFolderDialog(null)}
          />
        );
      })()}
      {pendingViewType && (
        <CompatibilityWarningDialog
          featureName={
            pendingViewType === "board" ? t("database.viewBoard", "Board") :
            pendingViewType === "calendar" ? t("database.viewCalendar", "Kalender") :
            pendingViewType === "timeline" ? t("database.viewTimeline", "Zeitachse") :
            pendingViewType === "graph" ? t("database.viewGraph", "Graph") :
            pendingViewType === "pinboard" ? t("database.viewPinboard", "Pinnwand") :
            pendingViewType
          }
          onConfirm={() => {
            commitSetViewType(pendingViewType);
            setPendingViewType(null);
          }}
          onCancel={() => setPendingViewType(null)}
        />
      )}
      {missingReqCheck && (
        <MissingRequirementDialog
          viewName={missingReqCheck.viewName}
          requiredType={missingReqCheck.requiredType}
          availableColumns={availableColumns}
          onConfirm={handleMissingRequirementConfirm}
          onCancel={() => setMissingReqCheck(null)}
        />
      )}
      {editingColumn && (
        <ColumnSchemaEditor
          column={editingColumn}
          schema={(dbConfig?.columns && !Array.isArray(dbConfig.columns) ? dbConfig.columns[editingColumn] : undefined) || {}}
          baseFiles={baseFiles}
          currentBasePath={activePath}
          existingColumns={availableColumns}
          rows={dbData}
          missingCount={dbData.filter((r) => r[editingColumn] === undefined).length}
          onFillMissing={() => { void materializeColumn(editingColumn); }}
          loadBaseConfig={vaultAdapter ? async (p) => parseBaseConfig(await vaultAdapter.readTextFile(p)) : undefined}
          onSave={(s, newName, reverseIntent) => { void handleColumnEditorSave(editingColumn, s, newName, reverseIntent); }}
          onDelete={() => { void openDeleteColumn(editingColumn); }}
          onClose={() => setEditingColumn(null)}
          t={t}
        />
      )}
      {deleteColumnAsk && (
        <DeletePropertyDialog
          column={deleteColumnAsk.column}
          affected={deleteColumnAsk.affected}
          isReverse={deleteColumnAsk.isReverse}
          reverseInTarget={deleteColumnAsk.reverseInTarget}
          onConfirm={(cleanup) => { void performDeleteColumn(deleteColumnAsk, cleanup); }}
          onCancel={() => setDeleteColumnAsk(null)}
          t={t}
        />
      )}
      {deleteProgress && (
        <Modal
          onClose={() => {}}
          closeOnOverlay={false}
          hideClose
          title={t("database.deletingProperty", "Eigenschaft wird entfernt…")}
          icon={<RefreshCw size={ICON.head} color="var(--accent-color)" className="spin-animation" />}
          size="sm"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
              {t("database.deletingProgress", "\"{{column}}\" · {{done}} von {{total}} Dateien", { column: deleteProgress.column, done: deleteProgress.done, total: deleteProgress.total })}
            </div>
            <div style={{ height: 6, borderRadius: "var(--radius-xs)", background: "var(--bg-secondary)", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--accent-color)", transition: "width var(--dur-1) var(--ease-1)", width: `${deleteProgress.total > 0 ? Math.round((deleteProgress.done / deleteProgress.total) * 100) : 100}%` }} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
