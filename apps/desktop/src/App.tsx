import { useState, useEffect, useCallback, useRef, Fragment, type MouseEvent as ReactMouseEvent, type CSSProperties, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Store } from "@tauri-apps/plugin-store";
import { useVault, STORE_KEY, okfPromptDismissedKey, syncFirstNoticeKey, type SyncProviderId } from "./contexts/VaultContext";
import { useDisplaySyncStatus } from "./services/syncStatusStore";
import type { SyncWorker } from "@plainva/core";
import { scanVaultOkf } from "./services/okfConversion";
// Rarely-shown surfaces load lazily (P2.9): none of these are needed to
// paint the first frame, and each becomes its own chunk that only ever
// downloads when the user opens it.
const OkfConversionModal = lazy(() => import("./components/OkfConversionModal").then(m => ({ default: m.OkfConversionModal })));
const VersionHistoryModal = lazy(() => import("./components/VersionHistoryModal").then(m => ({ default: m.VersionHistoryModal })));
const DeletedFilesModal = lazy(() => import("./components/DeletedFilesModal").then(m => ({ default: m.DeletedFilesModal })));
const ImageViewer = lazy(() => import("./components/ImageViewer").then(m => ({ default: m.ImageViewer })));
const OkfInfoModal = lazy(() => import("./components/OkfInfoModal").then(m => ({ default: m.OkfInfoModal })));
const ConflictResolveModal = lazy(() => import("./components/ConflictResolveModal").then(m => ({ default: m.ConflictResolveModal })));
import { isImagePath } from "./services/imageFiles";
import { createIndexAutoUpdater, notifyFileOps, updateAllManagedIndexes, type FileOp } from "./services/indexMdAutoUpdate";
import { IndexMdModal } from "./components/IndexMdModal";
import { FileTree } from "./components/FileTree";
const Editor = lazy(() => import('./components/Editor').then(m => ({ default: m.Editor })));
const VaultGraphView = lazy(() => import('./components/graph/VaultGraphView').then(m => ({ default: m.VaultGraphView })));
import { GRAPH_TAB_PATH, isVirtualPath } from "./components/graph/virtualPaths";
import { BaseViewer } from "./components/BaseViewer";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { TemplatePickerModal } from "./components/TemplatePickerModal";
import { TitleBar } from "./components/TitleBar";
import { WindowChromeStrip } from "./components/WindowControls";
import { AppRibbon } from "./components/AppRibbon";
import { StatusBar } from "./components/StatusBar";
import { RightSidebar } from "./components/RightSidebar";
import { DropdownMenu } from "./components/DropdownMenu";
import { PaneTabStrip } from "./components/PaneTabStrip";
import { TabContextMenu } from "./components/TabContextMenu";
import { useActiveDrag } from "./components/tabStrip";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { resolveOrCreateDailyNote, listExistingDailyNotes, resolveActiveDailyNoteDate } from "./services/dailyNotes";
import { activeDocument } from "./services/activeDocument";
import { TagTree } from "./components/TagTree";
import { appMessage } from "./services/appDialogs";
import { confirmDeletion } from "./services/deleteConfirm";
import { toast } from "./services/toastStore";
import { Button } from "@plainva/ui";
import { CommandPalette } from "./components/CommandPalette";
import { buildAppCommands } from "./services/commandRegistry";
import { toggleLightDark, isModePinned, DEFAULT_THEME_NAME } from "./services/theme";
import { Settings, Cloud, AlertTriangle, Folder, ChevronUp, Hash, Bookmark, Search, Plus, ChevronDown, ChevronsDownUp, ChevronsUpDown, FilePlus, FolderPlus, Database, CalendarDays, X } from "lucide-react";
import { useDebouncedValue } from "@plainva/ui";
import { scheduleStartupUpdateCheck } from "./services/appUpdate";
const SettingsModal = lazy(() => import("./components/SettingsModal").then(m => ({ default: m.SettingsModal })));
const ShortcutsModal = lazy(() => import("./components/ShortcutsModal").then(m => ({ default: m.ShortcutsModal })));
import { SplashScreen } from "./components/SplashScreen";
import "./App.css";

function App() {
  const { t } = useTranslation();
  const drag = useActiveDrag();
  const { vaultPath, loadingPath, selectVault, openVault, closeVault, recentVaults, isLoading, syncWorker, loadingProgress, vaultAdapter, indexer, triggerFileTreeUpdate, fileTreeVersion, queryService } = useVault();
  // Sync status is NOT read here (2026-07-06 fix): the worker flips
  // idle→syncing→idle every 15 s poll, and a real network cycle (Dropbox/…)
  // outlasts the anti-flicker delay, so the display value genuinely changes
  // twice per tick. Subscribing at the App top level therefore re-rendered the
  // WHOLE tree every 15 s — remounting the read-mode Mermaid diagram (flicker)
  // and churning the live editor around the caret (misplaced cursor), both
  // sync-only because a local vault has no worker. The two surfaces that
  // actually show sync state — the switcher cloud/error icon and the error
  // dialog — subscribe themselves as leaves (SyncSwitcherIcon / SyncErrorDialog
  // below), so a status flip re-renders only that icon, never the editor.
  const [showSettings, setShowSettings] = useState(false);
  // Deep link from the splash's online-vault chooser: open Settings with the
  // picked sync provider preselected once the vault has loaded.
  const [settingsInitialProvider, setSettingsInitialProvider] = useState<string | null>(null);
  useEffect(() => {
    const onOpenSyncSettings = (e: Event) => {
      const provider = (e as CustomEvent).detail?.provider;
      setSettingsInitialProvider(typeof provider === "string" ? provider : null);
      setShowSettings(true);
    };
    window.addEventListener("plainva-open-sync-settings", onOpenSyncSettings);
    return () => window.removeEventListener("plainva-open-sync-settings", onOpenSyncSettings);
  }, []);
  const [showOkfWizard, setShowOkfWizard] = useState(false);
  const [showIndexManager, setShowIndexManager] = useState(false);
  // Version history + deleted-files recovery (Gesamtplan Backups &
  // Versionierung, P5/P6), opened via window events from the file tree,
  // tab context menu and the settings section.
  const [versionHistoryTarget, setVersionHistoryTarget] = useState<{ path: string; orphan?: boolean } | null>(null);
  const [showDeletedFiles, setShowDeletedFiles] = useState(false);
  // Sync conflict resolution (P3.11): opened via "plainva-resolve-conflict"
  // from the editor's conflict banner, the tree's .CONFLICT context entry, or
  // the sync-error dialog's conflict rows below.
  const [conflictResolveTarget, setConflictResolveTarget] = useState<string | null>(null);
  // .CONFLICT copies listed in the sync-error dialog (P3.11 "Sync-Dialog"
  // entry point): looked up from the index whenever the dialog opens (effect
  // lives below the showErrorModal declaration).
  const [dialogConflicts, setDialogConflicts] = useState<string[]>([]);
  useEffect(() => {
    const onShowVersions = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; orphan?: boolean } | undefined;
      if (detail?.path) setVersionHistoryTarget({ path: detail.path, orphan: detail.orphan });
    };
    const onShowDeleted = () => setShowDeletedFiles(true);
    const onResolveConflict = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path) setConflictResolveTarget(detail.path);
    };
    window.addEventListener("plainva-show-version-history", onShowVersions);
    window.addEventListener("plainva-show-deleted-files", onShowDeleted);
    window.addEventListener("plainva-resolve-conflict", onResolveConflict);
    return () => {
      window.removeEventListener("plainva-show-version-history", onShowVersions);
      window.removeEventListener("plainva-show-deleted-files", onShowDeleted);
      window.removeEventListener("plainva-resolve-conflict", onResolveConflict);
    };
  }, []);
  // "Was ist OKF?" explainer (P12): shown once per vault; with violations it
  // carries the conversion CTA and replaces the old native prompt.
  const [showOkfInfo, setShowOkfInfo] = useState(false);
  const [okfInfoViolations, setOkfInfoViolations] = useState(0);
  // One-time OKF conversion offer after a vault finished loading (W8). A "no"
  // is persisted per vault; afterwards the settings section is the entry point
  // (it reappears there automatically while violations exist).
  const okfPromptCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultPath || isLoading || !vaultAdapter || !queryService) return;
    if (okfPromptCheckedRef.current === vaultPath) return;
    okfPromptCheckedRef.current = vaultPath;
    (async () => {
      try {
        const store = await Store.load(STORE_KEY);
        if (await store.get<boolean>(okfPromptDismissedKey(vaultPath))) return;
        const scan = await scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter });
        // One-time explainer (P12) for every vault — new/empty ones included.
        // With violations it doubles as the conversion offer (CTA opens the
        // wizard); afterwards the settings section stays the entry point.
        setOkfInfoViolations(scan.violations.length);
        setShowOkfInfo(true);
        await store.set(okfPromptDismissedKey(vaultPath), true);
        await store.save();
      } catch (e) {
        console.warn("[App] OKF vault-open check failed", e);
      }
    })();
  }, [vaultPath, isLoading, vaultAdapter, queryService, t]);
  // One-time notice when an online vault is first connected (WP6): the initial
  // sync can take a while for large vaults. Shown once per vault; the running
  // count then lives in the status bar. `isNewConnection` fires once at OAuth /
  // first-save completion for every provider.
  useEffect(() => {
    const onCredsSaved = (e: Event) => {
      if (!(e as CustomEvent).detail?.isNewConnection || !vaultPath) return;
      void (async () => {
        try {
          const store = await Store.load(STORE_KEY);
          if (await store.get<boolean>(syncFirstNoticeKey(vaultPath))) return;
          await store.set(syncFirstNoticeKey(vaultPath), true);
          await store.save();
          await appMessage({ title: t("sync.firstSyncTitle"), message: t("sync.firstSyncBody") });
        } catch (err) {
          console.warn("[App] first-sync notice failed", err);
        }
      })();
    };
    window.addEventListener("plainva-credentials-saved", onCredsSaved);
    return () => window.removeEventListener("plainva-credentials-saved", onCredsSaved);
  }, [vaultPath, t]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  // Fill the dialog's conflict rows from the index whenever it opens (P3.11).
  useEffect(() => {
    if (!showErrorModal || !queryService) {
      setDialogConflicts([]);
      return;
    }
    let alive = true;
    queryService.db
      .query<{ path: string }>(`SELECT path FROM files WHERE path LIKE ? ORDER BY path LIMIT 5`, ["%.CONFLICT-%"])
      .then((rows) => { if (alive) setDialogConflicts(rows.map((r) => r.path)); })
      .catch(() => { if (alive) setDialogConflicts([]); });
    return () => { alive = false; };
  }, [showErrorModal, queryService]);
  // The status bar's "Offline" button routes here: same error dialog as the
  // vault-switcher warning triangle.
  useEffect(() => {
    const onShowSyncError = () => setShowErrorModal(true);
    window.addEventListener("plainva-show-sync-error", onShowSyncError);
    return () => window.removeEventListener("plainva-show-sync-error", onShowSyncError);
  }, []);
  const [showVaultMenu, setShowVaultMenu] = useState(false);
  const [leftSidebarTab, setLeftSidebarTab] = useState<"files" | "tags" | "bookmarks">("files");
  // Whether any tree folder is expanded — drives the collapse/expand-all
  // toggle in the sidebar tab row (E3 2026-07-09; reported by the FileTree).
  const [treeHasExpanded, setTreeHasExpanded] = useState(false);
  const [leftQuery, setLeftQuery] = useState("");
  // Input state stays immediate (controlled field, X button); the consumers
  // (file search, tag filter, bookmark filter) get the debounced value so
  // typing does not fire one FTS query per keystroke (plan Suche P3).
  const leftQueryDebounced = useDebouncedValue(leftQuery, 150);
  const leftSearchRef = useRef<HTMLInputElement>(null);
  const clearLeftQuery = () => {
    setLeftQuery("");
    leftSearchRef.current?.focus();
  };
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [quickSwitcherNewTab, setQuickSwitcherNewTab] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const SIDEBAR_MIN = 150;
  const SIDEBAR_MAX = 600;
  const readSidebarWidth = (key: string) => {
    const v = Number(localStorage.getItem(key));
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 250;
  };
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => readSidebarWidth("plainva-left-sidebar-width"));
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => readSidebarWidth("plainva-right-sidebar-width"));
  // Collapsible sidebars (plan Designsprache P6/L1): toggled via title-bar
  // buttons and Mod+Alt+B / Mod+Alt+R (Mod+B stays bold in the editor).
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem("plainva-left-sidebar-collapsed") === "1");
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem("plainva-right-sidebar-collapsed") === "1");
  const [tabMenu, setTabMenu] = useState<{ paneIndex: number; tabIndex: number; x: number; y: number } | null>(null);

  // Panes/tabs/active-file layout + per-vault persistence live in usePaneLayout (plan D1);
  // App only wires the returned operations to the UI. Opening a path is tracked as a recent
  // file; a fresh split pane asks us to open the quick switcher so the user picks a document.
  const validatePath = useCallback(async (p: string) => {
    try { return vaultAdapter ? await vaultAdapter.exists(p) : false; } catch { return false; }
  }, [vaultAdapter]);
  const {
    layout, splitRatio, activePane, activePath, isSplit, activeSplitDirection,
    openTab, openInFocusedPane, openInOtherPane, openPathInSplit, navigateTab, selectTab, closeTab, closeTabsByPrefix,
    renameTabPrefix, focusPane, splitEditor, splitEditorWithTab, moveTabTo, setSplitRatio, normalizeNow,
  } = usePaneLayout({
    vaultPath,
    validatePath,
    onOpenPath: (p) => setRecentPaths((prev) => [p, ...prev.filter((x) => x !== p)].slice(0, 20)),
    onRequestPick: () => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); },
  });

  // Load recent paths
  useEffect(() => {
    if (vaultPath) {
      const stored = localStorage.getItem(`recentPaths-${vaultPath}`);
      if (stored) {
        try {
          setRecentPaths(JSON.parse(stored));
        } catch { /* ignore */ }
      } else {
        setRecentPaths([]);
      }
    } else {
      setRecentPaths([]);
    }
  }, [vaultPath]);

  // Save recent paths
  useEffect(() => {
    if (vaultPath) {
      localStorage.setItem(`recentPaths-${vaultPath}`, JSON.stringify(recentPaths));
    }
  }, [recentPaths, vaultPath]);

  // Load bookmarks
  useEffect(() => {
    if (!vaultPath || !vaultAdapter) {
      setBookmarks([]);
      return;
    }
    const loadBookmarks = async () => {
      try {
        let plainvaBookmarks: string[] = [];
        let obsidianBookmarks: string[] = [];

        // Check Obsidian bookmarks
        try {
          const obsData = await vaultAdapter.readTextFile(".obsidian/bookmarks.json");
          const obsJson = JSON.parse(obsData);
          if (obsJson.items) {
             const extractFiles = (items: any[]) => {
               let res: string[] = [];
               for (const item of items) {
                 if (item.type === "file" && item.path) res.push(item.path);
                 if (item.type === "group" && item.items) res.push(...extractFiles(item.items));
               }
               return res;
             };
             obsidianBookmarks = extractFiles(obsJson.items);
          }
        } catch(e) {
          console.debug("No obsidian bookmarks or parse error", e);
        }

        // Check Plainva bookmarks
        let plainvaBookmarksExisted = false;
        try {
          const plData = await vaultAdapter.readTextFile(".plainva/bookmarks.json");
          const plJson = JSON.parse(plData);
          if (plJson.items) {
            plainvaBookmarks = plJson.items.map((i: any) => i.path);
            plainvaBookmarksExisted = true;
          }
        } catch(e) {
          console.debug("No plainva bookmarks or parse error", e);
        }

        // Merge without overwriting
        const merged = Array.from(new Set([...plainvaBookmarks, ...obsidianBookmarks]));

        // Save back if there were obsidian bookmarks imported that weren't in plainva
        if (obsidianBookmarks.length > 0 && merged.length > plainvaBookmarks.length || !plainvaBookmarksExisted && merged.length > 0) {
          const newJson = { items: merged.map(p => ({ type: "file", path: p })) };
          await vaultAdapter.writeTextFile(".plainva/bookmarks.json", JSON.stringify(newJson, null, 2));
        }

        setBookmarks(merged);
      } catch (e) {
        console.error("Failed to load bookmarks", e);
      }
    };
    loadBookmarks();
  }, [vaultPath, vaultAdapter]);

  const toggleBookmark = (path: string) => {
    setBookmarks(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      if (vaultPath && vaultAdapter) {
        const newJson = { items: next.map(p => ({ type: "file", path: p })) };
        vaultAdapter.writeTextFile(".plainva/bookmarks.json", JSON.stringify(newJson, null, 2)).catch((e) => {
          // The optimistic state update already happened — a silent write
          // failure would leave bookmarks permanently out of sync with disk.
          console.error("Failed to persist bookmarks", e);
          toast.error(t("sidebar.bookmarkSaveFailed"));
        });
      }
      return next;
    });
  };

  // index.md auto-update (plan UI-UX P11): file operations report themselves
  // via "plainva-file-ops" AFTER their reindex; managed listings of the
  // affected folders refresh debounced. Loop-free: index.md writes are
  // reserved-name paths and never queue again.
  useEffect(() => {
    if (!vaultAdapter || !queryService) return;
    const updater = createIndexAutoUpdater({
      adapter: vaultAdapter,
      queryService,
      vaultName: () => vaultPath?.split(/[/\\]/).pop() ?? "Vault",
      subfoldersHeading: () => t("indexMd.subfoldersHeading"),
      onWritten: (indexPath) => {
        triggerFileTreeUpdate();
        window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: indexPath } }));
      },
    });
    const onOps = (e: Event) => {
      const ops = (e as CustomEvent).detail?.ops as FileOp[] | undefined;
      if (Array.isArray(ops) && ops.length > 0) updater.notify(ops);
    };
    window.addEventListener("plainva-file-ops", onOps);
    return () => {
      window.removeEventListener("plainva-file-ops", onOps);
      updater.dispose();
    };
    // t/triggerFileTreeUpdate change identity per render — remounting here
    // would dispose pending debounced refreshes; the mount-time closures work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultAdapter, queryService, vaultPath]);

  // "Alle index.md aktualisieren" (root context menu + settings, P11).
  useEffect(() => {
    if (!vaultAdapter || !queryService) return;
    const onUpdateAll = () => {
      void (async () => {
        try {
          const result = await updateAllManagedIndexes({
            adapter: vaultAdapter,
            queryService,
            vaultName: () => vaultPath?.split(/[/\\]/).pop() ?? "Vault",
            subfoldersHeading: () => t("indexMd.subfoldersHeading"),
          });
          if (indexer) await indexer.indexVaultFull();
          triggerFileTreeUpdate();
          for (const p of result.updated) {
            window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: p } }));
          }
          toast.success(t("indexMd.updateAllResult", { updated: result.updated.length, skipped: result.skippedNoMarker }));
        } catch (e) {
          console.error("[App] updating all index.md failed", e);
        }
      })();
    };
    window.addEventListener("plainva-update-all-indexes", onUpdateAll);
    return () => window.removeEventListener("plainva-update-all-indexes", onUpdateAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultAdapter, queryService, vaultPath, indexer]);

  const handleDeleteFile = async (path: string) => {
    if (!vaultAdapter) return;
    // Shared confirmation with the tree (cloud note when sync is connected);
    // a single file never triggers the large-deletion second prompt.
    const ok = await confirmDeletion({
      t,
      single: { name: path.split(/[/\\]/).pop() ?? path, isFolder: false },
      fileCount: 1,
      vaultFileCount: 0,
      syncActive: !!syncWorker,
    });
    if (!ok) return;
    syncWorker?.noteUserInitiatedDeletion([path]);
    try {
      await vaultAdapter.deleteItem(path);
      closeTabsByPrefix(path);
      if (indexer) await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "delete", path }]);
    } catch (e) {
      // The user explicitly confirmed the deletion — if the file is still
      // there, that must never fail silently into the console only.
      console.error("Failed to delete file", e);
      toast.error(t("dialogs.deleteFailedMsg", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  // Drag the divider between the two panes to change their size ratio (the hook clamps
  // the value and persists it as part of the per-vault layout).
  const startPaneResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const mainEl = (e.currentTarget as HTMLElement).parentElement;
    const vertical = layout.direction === "vertical";
    const onMove = (ev: MouseEvent) => {
      if (!mainEl) return;
      const r = mainEl.getBoundingClientRect();
      const ratio = vertical ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setSplitRatio(ratio);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    (window as any).selectVault = selectVault;
    return () => {
      delete (window as any).selectVault;
    };
  }, [selectVault]);

  // Quiet startup update check (P3.8): one toast if a release is available;
  // failures (no feed yet, offline, dev build) stay silent. Opt-out lives in
  // the settings ("Updates" section).
  useEffect(() => {
    scheduleStartupUpdateCheck();
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === "o" || e.key === "k")) {
        e.preventDefault();
        setShowQuickSwitcher(true);
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowCommandPalette(true);
      } else if (mod && e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowTemplatePicker(true);
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        // New tab (report #10) — never replace the currently open file.
        openInFocusedPane(GRAPH_TAB_PATH, true);
      } else if (mod && e.altKey && e.key.toLowerCase() === "v") {
        // Split shortcuts use Mod+Alt+<letter> like the template shortcut. V/S avoid
        // AltGr-produced characters on German keyboards and the macOS Cmd+Alt+H "Hide
        // others" reservation. V = side by side (vertical), S = stacked (horizontal).
        e.preventDefault();
        splitEditor("vertical");
      } else if (mod && e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        splitEditor("horizontal");
      } else if (mod && e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setLeftCollapsed((c) => !c);
      } else if (mod && e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRightCollapsed((c) => !c);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      } else if (e.key === "F1") {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [vaultPath, splitEditor, openInFocusedPane]);

  // "Reveal in file tree" (editor ⋮, folder links, templates folder) must be
  // able to un-collapse the left sidebar and switch to the files tab — the
  // tree itself may be unmounted when the event fires; it then consumes the
  // parked path on mount (lib/treeReveal).
  useEffect(() => {
    const onReveal = () => {
      setLeftCollapsed(false);
      setLeftSidebarTab("files");
    };
    window.addEventListener("plainva-reveal-folder", onReveal);
    return () => window.removeEventListener("plainva-reveal-folder", onReveal);
  }, []);

  // Persist user-chosen sidebar widths.
  useEffect(() => { localStorage.setItem("plainva-left-sidebar-width", String(leftSidebarWidth)); }, [leftSidebarWidth]);
  useEffect(() => { localStorage.setItem("plainva-right-sidebar-width", String(rightSidebarWidth)); }, [rightSidebarWidth]);
  useEffect(() => { localStorage.setItem("plainva-left-sidebar-collapsed", leftCollapsed ? "1" : "0"); }, [leftCollapsed]);
  useEffect(() => { localStorage.setItem("plainva-right-sidebar-collapsed", rightCollapsed ? "1" : "0"); }, [rightCollapsed]);

  // Drag-to-resize for the left/right sidebars (clamped to SIDEBAR_MIN..MAX).
  const startSidebarResize = (side: "left" | "right") => (e: ReactMouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const raw = side === "left" ? ev.clientX : window.innerWidth - ev.clientX;
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, raw));
      if (side === "left") setLeftSidebarWidth(w);
      else setRightSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const sidebarResizeHandleStyle: CSSProperties = {
    width: "5px", flexShrink: 0, cursor: "col-resize", background: "transparent", alignSelf: "stretch",
  };

  // Calendar click: open the daily note for the picked date, creating it (after
  // a confirm dialog) from the template if it doesn't exist yet.
  const handleOpenDailyNote = async (date: Date) => {
    if (!vaultPath || !vaultAdapter || !indexer) return;
    try {
      const path = await resolveOrCreateDailyNote(date, {
        vaultPath,
        adapter: vaultAdapter,
        onIndex: () => indexer.indexVaultFull(),
        confirmCreate: true,
        confirmMessage: (p) => t("calendar.createConfirm", { path: p }),
        confirmTitle: t("sidebar.newDaily", { defaultValue: "Tageseintrag" }),
        onCreated: (p) => notifyFileOps([{ type: "create", path: p }]),
      });
      if (path) {
        triggerFileTreeUpdate();
        openInFocusedPane(path);
      }
    } catch (e) {
      console.error("Failed to open daily note from calendar", e);
    }
  };

  // "Neu ▾ → Tageseintrag": open/create today's daily note (no confirm dialog).
  const openTodayDailyNote = async () => {
    if (!vaultPath || !vaultAdapter || !indexer) return;
    try {
      const path = await resolveOrCreateDailyNote(new Date(), {
        vaultPath, adapter: vaultAdapter, onIndex: () => indexer.indexVaultFull(), confirmCreate: false,
        onCreated: (p) => notifyFileOps([{ type: "create", path: p }]),
      });
      if (path) { triggerFileTreeUpdate(); openInFocusedPane(path); }
    } catch (e) {
      console.error("Failed to open today's daily note", e);
    }
  };

  // Which of the given calendar days already have a daily note (for the dots).
  const loadMarkedDates = useCallback(async (dates: Date[]) => {
    if (!vaultPath || !vaultAdapter) return new Set<string>();
    return listExistingDailyNotes(dates, { vaultPath, adapter: vaultAdapter });
  }, [vaultPath, vaultAdapter]);

  // The date of the currently open daily note (if the active file is one), so the
  // calendar can highlight it with precedence over "today". Recomputed when the
  // open file or vault changes; daily-note settings changes are rare enough that
  // reopening the note re-derives it.
  const [activeDailyDate, setActiveDailyDate] = useState<Date | null>(null);
  useEffect(() => {
    let active = true;
    resolveActiveDailyNoteDate(activePath, vaultPath ?? "")
      .then((d) => { if (active) setActiveDailyDate(d); })
      .catch(() => { if (active) setActiveDailyDate(null); });
    return () => { active = false; };
  }, [activePath, vaultPath]);

  // The Editor publishes markdown documents to the shared channel; here we cover
  // the `.base` viewer and the no-file case so the status bar/properties reflect them.
  // (The active pane's BaseViewer refines meta.entries once its rows are loaded — plan D4.)
  useEffect(() => {
    if (!activePath) activeDocument.clear();
    else if (activePath.endsWith(".base")) activeDocument.set({ path: activePath, content: "", kind: "base", meta: {} });
  }, [activePath]);

  if (isLoading) {
    // Show the vault being loaded (loadingPath), not the one we're leaving (vaultPath
    // stays set until the new vault finishes loading).
    const loadingTarget = loadingPath ?? vaultPath;
    const loadingVaultName = loadingTarget ? loadingTarget.split(/[/\\]/).pop() : null;
    return (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-primary)", color: "var(--text-main)" }}>
        {/* No regular title bar while loading — keep the window movable/closable. */}
        <WindowChromeStrip />
        <p style={{ fontSize: "1.1rem", fontWeight: 500, margin: 0 }}>
          {loadingVaultName ? t("splash.loadingVault", { name: loadingVaultName }) : t("splash.initializing")}
        </p>
        {/* Fixed-width block: the (path-bearing) message is one ellipsized line
            and the bar spans the container, so nothing jumps with path length. */}
        <div style={{ margin: '1rem 0', width: 'min(480px, 80vw)' }}>
          <p
            style={{ margin: 0, height: '1.45em', lineHeight: '1.45em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
            title={loadingProgress?.message}
          >
            {loadingProgress?.message ?? ''}
          </p>
          <div style={{ width: '100%', height: '4px', background: 'var(--bg-hover)', marginTop: '0.5rem', borderRadius: '2px', overflow: 'hidden' }}>
            {loadingProgress ? (
              <div style={{
                width: `${(loadingProgress.current / Math.max(1, loadingProgress.total)) * 100}%`,
                height: '100%',
                background: 'var(--accent-color)',
                borderRadius: '2px',
                transition: 'width 0.2s'
              }} />
            ) : (
              <div className="indeterminate-progress" style={{
                height: '100%',
                background: 'var(--accent-color)',
                borderRadius: '2px'
              }} />
            )}
          </div>
        </div>

        <button
          onClick={closeVault}
          style={{
            marginTop: '2rem', padding: '0.75rem 1.5rem',
            background: 'var(--error-bg)', color: 'var(--error-text)', border: 'none',
            borderRadius: "var(--radius-sm)", cursor: 'pointer', fontWeight: 500
          }}
        >
          {t("splash.cancelLoad")}
        </button>
      </div>
    );
  }


  if (!vaultPath) {
    return <SplashScreen />;
  }

  const showVerticalPreview = drag.splitPreview === "vertical";
  const showHorizontalPreview = drag.splitPreview === "horizontal";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <TitleBar
        tabs={isSplit ? [] : activePane.tabs.map((tb) => tb.history[tb.historyIndex])}
        activeIndex={activePane.activeIndex}
        onSelectTab={(i) => selectTab(layout.activePaneIndex, i)}
        onCloseTab={(i) => closeTab(layout.activePaneIndex, i)}
        onNewTab={() => { setQuickSwitcherNewTab(true); setShowQuickSwitcher(true); }}
        onTabContextMenu={(i, x, y) => setTabMenu({ paneIndex: layout.activePaneIndex, tabIndex: i, x, y })}
        leftWidth={leftCollapsed ? 0 : leftSidebarWidth}
        paneIndex={layout.activePaneIndex}
        onMoveTab={moveTabTo}
        onSplitWithTab={splitEditorWithTab}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeftSidebar={() => setLeftCollapsed((c) => !c)}
        onToggleRightSidebar={() => setRightCollapsed((c) => !c)}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <AppRibbon
        onNewNote={() => window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: "file" } }))}
        onQuickSwitcher={() => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); }}
        onDailyNote={() => { void handleOpenDailyNote(new Date()); }}
        onOpenGraph={() => openInFocusedPane(GRAPH_TAB_PATH, true)}
        onCommandPalette={() => setShowCommandPalette(true)}
        onShortcuts={() => setShowShortcuts(true)}
        onSettings={() => setShowSettings(true)}
      />
      {!leftCollapsed && (
      <aside aria-label="Left Sidebar" style={{ width: `${leftSidebarWidth}px`, flexShrink: 0, borderRight: '1px solid var(--border-color-light)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
        {/* Search */}
        <div style={{ padding: '10px 10px 6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
            <input
              ref={leftSearchRef}
              value={leftQuery}
              onChange={(e) => setLeftQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && leftQuery !== '') {
                  e.preventDefault();
                  e.stopPropagation();
                  clearLeftQuery();
                }
              }}
              placeholder={t('fileTree.search')}
              aria-label={t('fileTree.search')}
              style={{ width: '100%', height: 34, padding: leftQuery ? '0 34px 0 32px' : '0 10px 0 32px', borderRadius: "var(--radius-md)", border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-main)', boxSizing: 'border-box', fontSize: '0.85rem', outline: 'none' }}
            />
            {leftQuery !== '' && (
              <button
                type="button"
                onClick={clearLeftQuery}
                title={t('sidebar.clearSearch')}
                aria-label={t('sidebar.clearSearch')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, padding: 0, background: 'transparent', border: 'none', borderRadius: 'var(--radius-xs)', color: 'var(--text-muted)', cursor: 'pointer' }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {/* New ▾ split button */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', width: '100%', height: 38, background: 'var(--accent-color)', color: 'var(--accent-on)', borderRadius: "var(--radius-md)", overflow: 'hidden' }}>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'file' } }))}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--accent-color-hover)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus size={16} />{t('sidebar.new', { defaultValue: 'Neu' })}
              </button>
              <button
                ref={newBtnRef}
                aria-haspopup="menu"
                aria-expanded={showNewMenu}
                aria-label={t('sidebar.newMore', { defaultValue: 'Weitere Optionen' })}
                onClick={() => setShowNewMenu((s) => !s)}
                style={{ width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'inherit', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.22)', cursor: 'pointer' }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--accent-color-hover)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronDown size={15} style={{ transform: showNewMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
              </button>
            </div>
            <DropdownMenu
              open={showNewMenu}
              anchorRef={newBtnRef}
              onClose={() => setShowNewMenu(false)}
              ariaLabel={t('sidebar.new', { defaultValue: 'Neu' })}
              items={[
                { id: 'note', label: t('sidebar.newNote', { defaultValue: 'Neue Notiz' }), icon: <FilePlus size={16} />, onSelect: () => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'file' } })) },
                { id: 'folder', label: t('sidebar.newFolder', { defaultValue: 'Neuer Ordner' }), icon: <FolderPlus size={16} />, onSelect: () => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'folder' } })) },
                { id: 'base', label: t('sidebar.newBase', { defaultValue: 'Neue Base' }), icon: <Database size={16} />, onSelect: () => window.dispatchEvent(new CustomEvent('plainva-new-item', { detail: { kind: 'base' } })) },
                'separator',
                { id: 'daily', label: t('sidebar.newDaily', { defaultValue: 'Tageseintrag' }), icon: <CalendarDays size={16} />, hint: t('sidebar.today', { defaultValue: 'heute' }), onSelect: openTodayDailyNote },
              ]}
            />
          </div>
        </div>
        {/* View switch (Files / Tags / Bookmarks) + tree collapse/expand-all */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px 8px' }}>
          <div role="tablist" aria-label={t('sidebar.viewSwitch', { defaultValue: 'Ansicht' })} style={{ display: 'flex', gap: 4, flex: 1 }}>
            {([['files', Folder, t('sidebar.files')], ['tags', Hash, t('sidebar.tags')], ['bookmarks', Bookmark, t('sidebar.bookmarks', { defaultValue: 'Lesezeichen' })]] as const).map(([key, Icon, label]) => {
              const active = leftSidebarTab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  aria-label={label}
                  title={label}
                  onClick={() => setLeftSidebarTab(key as 'files' | 'tags' | 'bookmarks')}
                  style={{ flex: 1, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: active ? 'var(--bg-active)' : 'transparent', border: 'none', color: active ? 'var(--accent-color)' : 'var(--text-muted)', borderRadius: "var(--radius-md)", cursor: 'pointer' }}
                  onMouseOver={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseOut={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
          {leftSidebarTab === 'files' && (
            <button
              className="pv-icon-btn"
              aria-label={treeHasExpanded ? t('sidebar.collapseAll') : t('sidebar.expandAll')}
              data-tip={treeHasExpanded ? t('sidebar.collapseAll') : t('sidebar.expandAll')}
              onClick={() => window.dispatchEvent(new CustomEvent('plainva-tree-toggle-all'))}
            >
              {treeHasExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {leftSidebarTab === "files" ? (
            <FileTree
              activePath={activePath}
              onSelect={openInFocusedPane}
              onExpandedStateChange={setTreeHasExpanded}
              onCloseTabsByPrefix={closeTabsByPrefix}
              onRenameTabPrefix={renameTabPrefix}
              externalQuery={leftQueryDebounced}
              onOpenInSplit={openPathInSplit}
              isBookmarked={(p) => bookmarks.includes(p)}
              onToggleBookmarkPath={toggleBookmark}
            />
          ) : leftSidebarTab === "tags" ? (
            <TagTree onSelectPath={openInFocusedPane} filter={leftQueryDebounced} />
          ) : (
            <div className="custom-scrollbar" style={{ overflowY: 'auto', height: '100%', padding: '0.5rem' }}>
              {bookmarks.filter((b) => b.toLowerCase().includes(leftQueryDebounced.toLowerCase())).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>{t("sidebar.noBookmarks", { defaultValue: "Keine Lesezeichen" })}</div>
              ) : (
                bookmarks.filter((b) => b.toLowerCase().includes(leftQueryDebounced.toLowerCase())).map(b => (
                  <button
                    key={b}
                    onClick={() => openInFocusedPane(b)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '0.5rem', background: activePath === b ? 'var(--bg-hover)' : 'transparent',
                      border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: "var(--radius-xs)", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}
                    title={b}
                  >
                    {b.split(/[/\\]/).pop()}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '0.5rem', borderTop: '1px solid var(--border-color-light)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {/* Vault Switcher */}
          <div style={{ position: "relative", width: "100%", marginTop: "auto" }}>
            {showVaultMenu && (
              <div style={{
                position: "absolute", bottom: "100%", left: 0, width: "100%",
                background: "var(--bg-primary)", border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)", marginBottom: "0.25rem", zIndex: 10,
                boxShadow: "0 -4px 12px rgba(0,0,0,0.1)", display: "flex", flexDirection: "column"
              }}>
                <div style={{ padding: "0.5rem", borderBottom: "1px solid var(--border-color)", fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  {t("sidebar.recentVaults")}
                </div>
                {recentVaults.filter(p => p !== vaultPath).slice(0, 5).map(path => (
                  <button
                    key={path}
                    onClick={() => { setShowVaultMenu(false); openVault(path); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem',
                      background: 'transparent', border: 'none', borderBottom: "1px solid var(--border-color-light)",
                      color: 'var(--text-main)', cursor: 'pointer', textAlign: "left", width: "100%"
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Folder size={14} color="var(--accent-color)" />
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {path.split(/[/\\]/).pop() || path}
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => { setShowVaultMenu(false); closeVault(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem',
                    background: 'transparent', border: 'none', color: 'var(--text-main)',
                    cursor: 'pointer', textAlign: "left", width: "100%"
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <Settings size={14} />
                  <span>{t("sidebar.switchVault")}</span>
                </button>
              </div>
            )}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '0.75rem 0.5rem', background: showVaultMenu ? 'var(--bg-hover)' : 'transparent'
            }}>
              <button
                onClick={() => setShowVaultMenu(!showVaultMenu)}
                aria-expanded={showVaultMenu}
                aria-haspopup="true"
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden',
                  background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', flex: 1, textAlign: 'left'
                }}
              >
                {syncWorker ? (
                  <SyncSwitcherIcon syncWorker={syncWorker} onError={() => setShowErrorModal(true)} />
                ) : (
                  <Folder size={16} color="var(--accent-color)" />
                )}
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {vaultPath.split(/[/\\]/).pop()}
                </span>
                <ChevronUp size={16} style={{ transform: showVaultMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginLeft: 'auto', flexShrink: 0 }} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      )}
      {!leftCollapsed && (
        <div onMouseDown={startSidebarResize("left")} style={sidebarResizeHandleStyle} aria-hidden="true" data-tip={t("sidebar.resize")} />
      )}
      {/* Document surface (plan Designsprache P12): panes float as cards on the
          chrome background instead of butting squarely against the sidebars. */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: layout.direction === 'vertical' ? 'row' : 'column', background: 'var(--canvas-bg)', position: 'relative', padding: 'var(--space-2)', gap: isSplit ? 0 : undefined }}>
        <h1 style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 }}>Plainva Desktop</h1>
        
        {showVerticalPreview && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '50%', background: 'var(--accent-color)', opacity: 0.15, pointerEvents: 'none', zIndex: 1000, borderLeft: '2px solid var(--accent-color)' }} />
        )}
        {showHorizontalPreview && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: 'var(--accent-color)', opacity: 0.15, pointerEvents: 'none', zIndex: 1000, borderTop: '2px solid var(--accent-color)' }} />
        )}

        {layout.panes.map((pane, i) => {
          const tab = pane.activeIndex >= 0 && pane.activeIndex < pane.tabs.length ? pane.tabs[pane.activeIndex] : null;
          const path = tab ? tab.history[tab.historyIndex] : null;
          const isActivePane = i === layout.activePaneIndex;
          const basis = i === 0 ? `${splitRatio * 100}%` : `${(1 - splitRatio) * 100}%`;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <div
                  onMouseDown={startPaneResize}
                  aria-hidden="true"
                  style={{ flex: '0 0 8px', cursor: layout.direction === 'vertical' ? 'col-resize' : 'row-resize', background: 'transparent' }}
                />
              )}
              <section
                aria-label={t("editor.pane", { defaultValue: "Editor-Bereich" })}
                onMouseDownCapture={() => focusPane(i)}
                style={{
                  ...(isSplit ? { flexGrow: 0, flexShrink: 1, flexBasis: basis } : { flex: 1 }),
                  minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative',
                  background: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                  boxShadow: 'var(--shadow-1)',
                  // Active-pane cue while split: an accent-tinted card border
                  // instead of the old hard 2px outline (P12).
                  border: `1px solid ${isSplit && isActivePane ? 'color-mix(in srgb, var(--accent-color) 55%, var(--border-color))' : 'var(--border-color-light)'}`,
                }}
              >
                {isSplit && (
                  <PaneTabStrip
                    paneIndex={i}
                    tabs={pane.tabs.map((tb) => tb.history[tb.historyIndex])}
                    activeIndex={pane.activeIndex}
                    onSelect={(idx) => selectTab(i, idx)}
                    onClose={(idx) => closeTab(i, idx)}
                    onContextMenu={(idx, x, y) => setTabMenu({ paneIndex: i, tabIndex: idx, x, y })}
                    onMoveTab={moveTabTo}
                    onSplitWithTab={splitEditorWithTab}
                  />
                )}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {path ? (
                    path === GRAPH_TAB_PATH ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <VaultGraphView
                          onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)}
                          onOpenInSplit={(p) => openInOtherPane(i, p)}
                          onToggleBookmark={toggleBookmark}
                        />
                      </Suspense>
                    ) : isImagePath(path) ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <ImageViewer
                          key={path}
                          path={path}
                          onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)}
                          isBookmarked={bookmarks.includes(path)}
                          onToggleBookmark={() => toggleBookmark(path)}
                          onDelete={() => handleDeleteFile(path)}
                          onSplit={splitEditor}
                          activeSplitDirection={activeSplitDirection}
                        />
                      </Suspense>
                    ) : path.endsWith('.base') ? (
                      <BaseViewer
                        key={path}
                        activePath={path}
                        onOpenPath={(p, newTab) => openTab(i, p, newTab)}
                        onOpenInSplit={(p) => openInOtherPane(i, p)}
                        onNavigateBack={() => navigateTab(i, -1)}
                        onNavigateForward={() => navigateTab(i, 1)}
                        canGoBack={tab ? tab.historyIndex > 0 : false}
                        canGoForward={tab ? tab.historyIndex < tab.history.length - 1 : false}
                        isBookmarked={bookmarks.includes(path)}
                        onToggleBookmark={() => toggleBookmark(path)}
                        onDelete={() => handleDeleteFile(path)}
                        onSplit={splitEditor}
                        activeSplitDirection={activeSplitDirection}
                        isActivePane={isActivePane}
                      />
                    ) : (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <Editor
                          key={path}
                          activePath={path}
                          onOpenPath={(p, newTab) => openTab(i, p, newTab)}
                          onNavigateBack={() => navigateTab(i, -1)}
                          onNavigateForward={() => navigateTab(i, 1)}
                          canGoBack={tab ? tab.historyIndex > 0 : false}
                          canGoForward={tab ? tab.historyIndex < tab.history.length - 1 : false}
                          isBookmarked={bookmarks.includes(path)}
                          onToggleBookmark={() => toggleBookmark(path)}
                          onDelete={() => handleDeleteFile(path)}
                          onRenamed={renameTabPrefix}
                          onSplit={splitEditor}
                          activeSplitDirection={activeSplitDirection}
                          isActivePane={isActivePane}
                        />
                      </Suspense>
                    )
                  ) : (
                    // Empty pane (plan Designsprache P6/L7): quick actions
                    // instead of a dead end — open, create, daily note.
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', color: 'var(--text-muted)', padding: 'var(--space-8)', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 'var(--text-md)' }}>{t("editor.emptyPane", { defaultValue: "Kein Dokument geöffnet" })}</p>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <Button
                          variant="primary"
                          onClick={() => { focusPane(i); setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); }}
                        >
                          {t("editor.openFile", { defaultValue: "Datei öffnen" })}
                        </Button>
                        <Button onClick={() => { focusPane(i); window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: "file" } })); }}>
                          {t("common.newNote", { defaultValue: "Neue Notiz" })}
                        </Button>
                        <Button onClick={() => { focusPane(i); void handleOpenDailyNote(new Date()); }}>
                          {t("sidebar.newDaily", { defaultValue: "Tageseintrag" })}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </Fragment>
          );
        })}
      </main>

      {!rightCollapsed && (
        <div onMouseDown={startSidebarResize("right")} style={sidebarResizeHandleStyle} aria-hidden="true" data-tip={t("sidebar.resize")} />
      )}
      {!rightCollapsed && (
      <aside aria-label="Right Sidebar" style={{ width: `${rightSidebarWidth}px`, flexShrink: 0, borderLeft: '1px solid var(--border-color-light)', background: 'var(--bg-secondary)' }}>
        <RightSidebar
          activePath={activePath}
          onOpenPath={openInFocusedPane}
          onOpenPathInSplit={(path) => openPathInSplit(path, "vertical")}
          onSelectDate={handleOpenDailyNote}
          loadMarkedDates={loadMarkedDates}
          activeDailyDate={activeDailyDate}
          refreshToken={fileTreeVersion}
        />
      </aside>
      )}
      </div>

      <StatusBar />

      {/* Lazy modal chunks (P2.9): mounted conditionally, so the Suspense
          fallback is never visible longer than the chunk download. */}
      <Suspense fallback={null}>
        {showSettings && <SettingsModal initialProvider={settingsInitialProvider ?? undefined} onClose={() => { setShowSettings(false); setSettingsInitialProvider(null); }} />}
        {showOkfInfo && (
          <OkfInfoModal
            violations={okfInfoViolations}
            onStartConversion={() => { setShowOkfInfo(false); setShowOkfWizard(true); }}
            onClose={() => setShowOkfInfo(false)}
          />
        )}
        {showOkfWizard && (
          <OkfConversionModal
            onClose={() => setShowOkfWizard(false)}
            onOpenIndexManager={() => setShowIndexManager(true)}
          />
        )}
        {showIndexManager && <IndexMdModal onClose={() => setShowIndexManager(false)} />}
        {versionHistoryTarget && (
          <VersionHistoryModal
            path={versionHistoryTarget.path}
            orphan={versionHistoryTarget.orphan}
            onClose={() => setVersionHistoryTarget(null)}
          />
        )}
        {showDeletedFiles && <DeletedFilesModal onClose={() => setShowDeletedFiles(false)} />}
        {conflictResolveTarget && (
          <ConflictResolveModal
            conflictPath={conflictResolveTarget}
            onClose={() => setConflictResolveTarget(null)}
            onResolved={(originalPath, conflictPath, mergedContent) => {
              setConflictResolveTarget(null);
              closeTabsByPrefix(conflictPath);
              if (mergedContent !== null) {
                // Same adoption path as a version restore: the open editor
                // takes the merged text without re-dirtying or racing a save.
                window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: originalPath, content: mergedContent } }));
              }
              void (async () => {
                if (indexer) {
                  await indexer.indexPath(originalPath).catch(console.error);
                  await indexer.indexPath(conflictPath).catch(console.error);
                }
                triggerFileTreeUpdate([originalPath, conflictPath]);
              })();
              toast.success(t("conflict.resolvedToast"));
            }}
          />
        )}
      </Suspense>
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={buildAppCommands({
            newItem: (kind) => window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind } })),
            openDailyNote: () => { void handleOpenDailyNote(new Date()); },
            openQuickSwitcher: () => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); },
            openTemplatePicker: () => setShowTemplatePicker(true),
            openGraph: () => openInFocusedPane(GRAPH_TAB_PATH, true),
            split: splitEditor,
            toggleLeftSidebar: () => setLeftCollapsed((c) => !c),
            toggleRightSidebar: () => setRightCollapsed((c) => !c),
            toggleTheme: () => { void toggleLightDark(); },
            themeTogglePinned: () => isModePinned(document.documentElement.getAttribute("data-theme-name") || DEFAULT_THEME_NAME),
            openSettings: () => setShowSettings(true),
            openShortcuts: () => setShowShortcuts(true),
            activePath: () => activePath,
            showVersionHistory: (path) => setVersionHistoryTarget({ path }),
            backupNow: () => window.dispatchEvent(new CustomEvent("plainva-backup-now")),
            updateAllIndexes: () => window.dispatchEvent(new CustomEvent("plainva-update-all-indexes")),
            switchVault: () => { void closeVault(); },
            printActive: () => window.dispatchEvent(new CustomEvent("plainva-print-active")),
            canPrint: () => activeDocument.get().kind === "markdown",
          })}
        />
      )}
      <Suspense fallback={null}>
        {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      </Suspense>
      <QuickSwitcher isOpen={showQuickSwitcher} onClose={() => { setShowQuickSwitcher(false); setQuickSwitcherNewTab(false); normalizeNow(); }} onOpenPath={(p) => openInFocusedPane(p, quickSwitcherNewTab)} recentPaths={recentPaths} />
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onSplitVertical={() => splitEditorWithTab("vertical", tabMenu.paneIndex, tabMenu.tabIndex)}
          onSplitHorizontal={() => splitEditorWithTab("horizontal", tabMenu.paneIndex, tabMenu.tabIndex)}
          activeDirection={activeSplitDirection}
          onCloseTab={() => closeTab(tabMenu.paneIndex, tabMenu.tabIndex)}
          onClose={() => setTabMenu(null)}
          onShowVersionHistory={(() => {
            const tab = layout.panes[tabMenu.paneIndex]?.tabs[tabMenu.tabIndex];
            const tabPath = tab ? tab.history[tab.historyIndex] : null;
            if (!tabPath || isVirtualPath(tabPath)) return undefined;
            return () => window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: tabPath } }));
          })()}
        />
      )}
      <TemplatePickerModal isOpen={showTemplatePicker} onClose={() => setShowTemplatePicker(false)} />

      {showErrorModal && (
        <SyncErrorDialog
          dialogConflicts={dialogConflicts}
          onClose={() => setShowErrorModal(false)}
          onResolveConflict={(p) => { setShowErrorModal(false); setConflictResolveTarget(p); }}
          onOpenSettings={(provider) => { setShowErrorModal(false); setSettingsInitialProvider(provider); setShowSettings(true); }}
        />
      )}
    </div>
  );
}

/**
 * Sync icon in the vault switcher, isolated as a leaf (2026-07-06 fix). It is
 * the only always-mounted consumer of the sync status: subscribing HERE means a
 * 15 s poll flip re-renders just this 16px icon, not the whole App tree (which
 * used to remount the read-mode Mermaid diagram and disturb the live caret).
 * The switcher keeps the calm cloud while syncing — only errors change the icon;
 * busy feedback lives in the status bar.
 */
function SyncSwitcherIcon({ syncWorker, onError }: { syncWorker: SyncWorker; onError: () => void }) {
  const { t } = useTranslation();
  const { status } = useDisplaySyncStatus();
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        if (status === 'error') onError();
        // Always also force a retry: unblocks stuck/backed-off ops and syncs now.
        syncWorker.retryFailed();
      }}
      title={status === 'error' ? t("sync.error") : (status === 'syncing' ? t("sync.syncing") : t("sync.idle"))}
    >
      {status === "error"
        ? <AlertTriangle size={16} color="var(--error-text)" />
        : <Cloud size={16} color="var(--accent-color)" />}
    </div>
  );
}

/**
 * Sync-error dialog, extracted as a leaf (2026-07-06 fix) so it can read the
 * error message/provider from the store WITHOUT App subscribing at the top
 * level. Mounted only while open, so its per-cycle re-render never reaches the
 * editor.
 */
function SyncErrorDialog({
  dialogConflicts,
  onClose,
  onResolveConflict,
  onOpenSettings,
}: {
  dialogConflicts: string[];
  onClose: () => void;
  onResolveConflict: (path: string) => void;
  onOpenSettings: (provider: SyncProviderId | null) => void;
}) {
  const { t } = useTranslation();
  const { message, provider } = useDisplaySyncStatus();
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 2000
    }}>
      <div style={{
        background: "var(--bg-primary)", padding: "2rem", borderRadius: "var(--radius-md)",
        width: "400px", color: "var(--text-main)", boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        display: "flex", flexDirection: "column"
      }}>
        <h2 style={{ marginTop: 0, color: "var(--error-text)", display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={24} /> {t("sync.errorTitle", { defaultValue: "Sync-Fehler" })}
        </h2>
        <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--error-bg)", color: "var(--error-text)", borderRadius: "var(--radius-xs)", wordBreak: "break-word", fontSize: "0.9rem", maxHeight: "300px", overflowY: "auto" }}>
          {message || t("sync.unknownError", { defaultValue: "Unbekannter Fehler aufgetreten." })}
        </div>
        <p style={{ margin: "0.85rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {t("sync.errorHint")}
        </p>
        {dialogConflicts.length > 0 && (
          <div style={{ marginTop: "0.85rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              {t("sync.conflictCopies", { defaultValue: "Gefundene Konfliktkopien:" })}
            </div>
            {dialogConflicts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onResolveConflict(p)}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.35rem 0.5rem", marginBottom: "2px", background: "var(--bg-secondary)", color: "var(--text-main)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", cursor: "pointer", fontSize: "0.85rem" }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p}</span>
                <span style={{ color: "var(--accent-color)", flexShrink: 0 }}>{t("conflict.resolveAction")}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
          <button
            onClick={onClose}
            style={{ padding: "0.5rem 1.5rem", background: "var(--bg-secondary)", color: "var(--text-main)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", cursor: "pointer" }}
          >
            {t("common.close")}
          </button>
          <button
            onClick={() => onOpenSettings(provider)}
            style={{ padding: "0.5rem 1.5rem", background: "var(--accent-color)", color: "var(--accent-on)", border: "none", borderRadius: "var(--radius-xs)", cursor: "pointer" }}
          >
            {t("sync.openSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
