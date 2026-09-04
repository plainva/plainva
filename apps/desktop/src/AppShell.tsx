import { useState, useEffect, useCallback, useRef, Fragment, type MouseEvent as ReactMouseEvent, type CSSProperties, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { applyIndexChanges } from "./services/fileActions";
import { openAttachmentExternally } from "./services/openAttachment";
import { useVault } from "./contexts/VaultContext";
// Rarely-shown surfaces load lazily (P2.9): none of these are needed to
// paint the first frame, and each becomes its own chunk that only ever
// downloads when the user opens it.
import type { CompareSubject } from "./components/CompareModal";
const CompareModal = lazy(() => import("./components/CompareModal").then(m => ({ default: m.CompareModal })));
const DeletedFilesModal = lazy(() => import("./components/DeletedFilesModal").then(m => ({ default: m.DeletedFilesModal })));
const ImageViewer = lazy(() => import("./components/ImageViewer").then(m => ({ default: m.ImageViewer })));
import { RecentSearchesPopover } from "./components/RecentSearchesPopover";
import { VaultSwitcher } from "./components/VaultSwitcher";
import type { ShellCapabilities } from "./shellCapabilities";
import { ICON, isImagePath, RECENTS_MAX, parkTreeReveal, parseBookmarksFile, rememberSearch, removeBookmarksOnDisk, SearchField, serializeBookmarksFile, toggleBookmarkOnDisk, useStableHandler } from "@plainva/ui";
import { createIndexAutoUpdater, notifyFileOps, updateAllManagedIndexes, type FileOp } from "./services/indexMdAutoUpdate";
import { FileTree } from "./components/FileTree";
import { DatabasesList } from "./components/DatabasesList";
import { LeftPinnedSections } from "./components/LeftPinnedSections";
import { LeftSidebarTabs } from "./components/LeftSidebarTabs";
import { useSidebarStep } from "./lib/sidebarStep";
const Editor = lazy(() => import('./components/Editor').then(m => ({ default: m.Editor })));
const VaultGraphView = lazy(() => import('./components/graph/VaultGraphView').then(m => ({ default: m.VaultGraphView })));
const TasksView = lazy(() => import('./components/tasks/TasksView').then(m => ({ default: m.TasksView })));
const CalendarView = lazy(() => import('./components/pimcal/CalendarView').then(m => ({ default: m.CalendarView })));
const MailView = lazy(() => import('./components/mail/MailView').then(m => ({ default: m.MailView })));
const MailDraftModal = lazy(() => import('./components/mail/MailDraftModal').then(m => ({ default: m.MailDraftModal })));
const CommentsOverview = lazy(() => import('./components/comments/CommentsOverview').then(m => ({ default: m.CommentsOverview })));
import type { MailAttachment } from "@plainva/ui/mail";
const VaultFindReplaceModal = lazy(() => import('./components/VaultFindReplaceModal').then(m => ({ default: m.VaultFindReplaceModal })));
import { GRAPH_TAB_PATH, TASKS_TAB_PATH, CALENDAR_TAB_PATH, MAIL_TAB_PATH, COMMENTS_TAB_PATH, isVirtualPath } from "./components/graph/virtualPaths";
import { requestCommentJump, type CommentNotificationNote } from "@plainva/ui";
import { requestCalendarDay } from "./services/pim/calendarNav";
import { BaseViewer } from "./components/BaseViewer";
import { CascadeDeleteHost } from "./components/CascadeDeleteHost";
import { requestCascadeDelete } from "./services/cascadeDelete";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { TemplatePickerModal } from "./components/TemplatePickerModal";
import { TitleBar } from "./components/TitleBar";
import { AppRibbon } from "./components/AppRibbon";
import { StatusBar } from "./components/StatusBar";
import { RightSidebar } from "./components/RightSidebar";
import { DropdownMenu } from "./components/DropdownMenu";
import { PaneTabStrip } from "./components/PaneTabStrip";
import { TabContextMenu } from "./components/TabContextMenu";
import { useActiveDrag } from "./components/tabStrip";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { resolveOrCreateDailyNote, listExistingDailyNotes, resolveActiveDailyNoteDate, makeDailyPathProvider } from "./services/dailyNotes";
import { applyTemplateInteractive, pokeTemplateCaret } from "./services/templateInteractive";
import { activeDocument } from "./services/activeDocument";
import { TagTree } from "./components/TagTree";
import { appConfirm } from "./services/appDialogs";
import { getConfiguredNoteType, buildNewNoteContent } from "./services/newNote";
import { wikiTargetToPath } from "@plainva/ui";
import { getAskBeforeCreateLink } from "./services/linkCreatePrompt";
import { toast } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { CommandPalette } from "./components/CommandPalette";
import { buildAppCommands, newEntries, newHandlersOf, requestNew } from "@plainva/ui";
import { toggleLightDark, isModePinned, DEFAULT_THEME_NAME } from "./services/theme";
import { Plus, ChevronsDownUp, ChevronsUpDown, FolderTree, RefreshCw, ArrowUpDown } from "lucide-react";
import { nextFolderSort, readStoredFolderSort, writeStoredFolderSort, type FolderSort, type FolderSortKey } from "@plainva/ui";
import { useDebouncedValue } from "@plainva/ui";
import { stripFrontmatter, frontmatterToAddress } from "@plainva/ui";
const ShortcutsModal = lazy(() => import("./components/ShortcutsModal").then(m => ({ default: m.ShortcutsModal })));
import { popOutCompose } from "./services/mail/composeWindow";
import {
  openOrFocusContent,
  openPresetWindow,
  openFullWindow,
} from "./services/windowManager";
import { currentWindowParams, windowStateKey } from "./services/windowContext";
import "./App.css";

/**
 * The recents service is loaded on demand, never at App's module init.
 *
 * Importing it statically put it in the chunk that initialises alongside
 * VaultContext, and rolldown then emitted an interop call there that ran
 * before the chunk it referenced — the production bundle died on startup
 * while dev and all unit tests stayed green (the shape of `ec0b8b64`). Every
 * use here is already async, so nothing is lost by asking for it late.
 */
const recentsModule = () => import("./services/recents");

export function AppShell({ capabilities, children }: { capabilities: ShellCapabilities; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const drag = useActiveDrag();
  const { vaultPath, selectVault, syncWorker, vaultAdapter, indexer, triggerFileTreeUpdate, fileTreeVersion, queryService, pimRuntime, refreshVault, rebuildIndex, listWorkspaceComments, listWorkspaceMembers, listAllWorkspaceComments, listAllPublicationComments, listOwnedPaths, getCommentSelfId, discardLocalFork } = useVault();
  // Identity of this window, not a capability: it is a fact about where the
  // code runs (null in the central window), and every per-window store keys off
  // it — panes, tabs, expanded folders (plan § 5.5).
  const windowLabel = currentWindowParams().label;
  /** Spins the tree-header refresh button while a reconcile is running (P1). */
  const [refreshing, setRefreshing] = useState(false);

  // Ribbon gating (cloud-accounts split, mockup screen 6): the calendar/mail
  // actions exist only while an account carries the service. The registry is
  // reconciled here on vault boot, so migrated setups gate correctly without
  // ever opening the new settings area.
  const [cloudServices, setCloudServices] = useState<{ calendar: boolean; mail: boolean }>({ calendar: false, mail: false });
  useEffect(() => {
    if (!vaultPath) {
      setCloudServices({ calendar: false, mail: false });
      return;
    }
    let alive = true;
    const refresh = () => {
      void import("./services/cloudAccounts")
        .then((m) => m.refreshCloudAccounts(vaultPath, pimRuntime ?? null))
        .then(async (records) => {
          if (!alive) return;
          const { hasCloudService } = await import("@plainva/ui");
          setCloudServices({ calendar: hasCloudService(records, "calendar"), mail: hasCloudService(records, "mail") });
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("plainva-cloud-accounts-changed", refresh);
    window.addEventListener("plainva-credentials-saved", refresh);
    return () => {
      alive = false;
      window.removeEventListener("plainva-cloud-accounts-changed", refresh);
      window.removeEventListener("plainva-credentials-saved", refresh);
    };
  }, [vaultPath, pimRuntime]);
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
  // Mail-raus (stage 6) / compose (mail-client E5): the dialog is prefilled
  // from the active note, optionally with the note as an attachment.
  const [mailDraft, setMailDraft] = useState<{ subject: string; markdown: string; attachments?: MailAttachment[]; to?: string } | null>(null);
  // Version history + deleted-files recovery (Gesamtplan Backups &
  // Versionierung, P5/P6), opened via window events from the file tree,
  // tab context menu and the settings section.
  // Both open the ONE comparison surface (feedback round 2026-09-01, P2):
  // the version history with its timeline, or a sync-conflict copy. The
  // conflict entry is fired from the editor's conflict banner, the tree's
  // .CONFLICT context entry and the sync-error dialog's conflict rows.
  const [compareTarget, setCompareTarget] = useState<CompareSubject | null>(null);
  const [showDeletedFiles, setShowDeletedFiles] = useState(false);
  useEffect(() => {
    const onShowVersions = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; orphan?: boolean } | undefined;
      if (detail?.path) setCompareTarget({ kind: "version", path: detail.path, orphan: detail.orphan });
    };
    const onShowDeleted = () => setShowDeletedFiles(true);
    const onResolveConflict = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path) setCompareTarget({ kind: "conflict", conflictPath: detail.path });
    };
    // A local fork from the Security page (C36): the same window, the same exits.
    const onCompareFork = (e: Event) => {
      const detail = (e as CustomEvent).detail as { forkId?: string; originalPath?: string; forkPath?: string } | undefined;
      if (detail?.forkId && detail.originalPath && detail.forkPath) setCompareTarget({ kind: "fork", forkId: detail.forkId, originalPath: detail.originalPath, forkPath: detail.forkPath });
    };
    // Compose mail from anywhere (mail-client E5: editor ⋮ send / send as attachment).
    const onComposeMail = (e: Event) => {
      const detail = (e as CustomEvent).detail as { subject?: string; markdown?: string; attachments?: MailAttachment[]; to?: string } | undefined;
      if (detail) setMailDraft({ subject: detail.subject ?? "", markdown: detail.markdown ?? "", attachments: detail.attachments, to: detail.to });
    };
    window.addEventListener("plainva-show-version-history", onShowVersions);
    window.addEventListener("plainva-show-deleted-files", onShowDeleted);
    window.addEventListener("plainva-resolve-conflict", onResolveConflict);
    window.addEventListener("plainva-compare-fork", onCompareFork);
    window.addEventListener("plainva-compose-mail", onComposeMail);
    return () => {
      window.removeEventListener("plainva-show-version-history", onShowVersions);
      window.removeEventListener("plainva-show-deleted-files", onShowDeleted);
      window.removeEventListener("plainva-resolve-conflict", onResolveConflict);
      window.removeEventListener("plainva-compare-fork", onCompareFork);
      window.removeEventListener("plainva-compose-mail", onComposeMail);
    };
  }, []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showVaultMenu, setShowVaultMenu] = useState(false);
  // A client window follows the owner's vault (plan E7): it shows WHICH vault it
  // is looking at, but the switcher that would change it for the whole process
  // is not offered there at all.
  const [leftSidebarTab, setLeftSidebarTab] = useState<"files" | "tags" | "databases">("files");
  // Whether any tree folder is expanded — drives the collapse/expand-all
  // toggle in the sidebar tab row (E3 2026-07-09; reported by the FileTree).
  const [treeHasExpanded, setTreeHasExpanded] = useState(false);
  const [leftQuery, setLeftQuery] = useState("");
  // Input state stays immediate (controlled field, X button); the consumers
  // (file search, tag filter, bookmark filter) get the debounced value so
  // typing does not fire one FTS query per keystroke (plan Suche P3).
  const leftQueryDebounced = useDebouncedValue(leftQuery, 150);
  const leftSearchRef = useRef<HTMLInputElement>(null);
  // Recent searches (parity with the phone since 4ec8cd76): offered while the field is
  // focused and empty. Remembering happens on blur, not per keystroke — every
  // prefix on the way to a word would otherwise eat the five slots.
  const [leftSearchFocused, setLeftSearchFocused] = useState(false);
  const [recentSearchTick, setRecentSearchTick] = useState(0);
  const leftSearchWrapRef = useRef<HTMLDivElement>(null);
  const rememberLeftQuery = useStableHandler((q: string) => {
    if (!vaultPath || q.trim().length < 2) return;
    void rememberSearch(vaultPath, q).then(() => setRecentSearchTick((n) => n + 1)).catch(() => {});
  });
  const clearLeftQuery = () => {
    rememberLeftQuery(leftQuery);
    setLeftQuery("");
    leftSearchRef.current?.focus();
  };
  const [showNewMenu, setShowNewMenu] = useState(false);
  // Folder sort (feedback round 2026-09-01, P11): the same three keys and the
  // same device-local memory as the phone's folder view. Title A–Z is the
  // default the tree always had; the choice is remembered per device.
  const [treeSort, setTreeSort] = useState<FolderSort>(() => readStoredFolderSort());
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const chooseTreeSort = (key: FolderSortKey) => {
    setTreeSort((current) => {
      const next = nextFolderSort(current, key);
      writeStoredFolderSort(next);
      return next;
    });
  };
  const [quickSwitcherNewTab, setQuickSwitcherNewTab] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  // The two sides need different floors (plan P3): on the left a narrow strip
  // still works — file names simply truncate — while on the right no section is
  // usable below 200 px. The calendar, the property rows and the graph all need
  // real room.
  const SIDEBAR_MIN_LEFT = 150;
  const SIDEBAR_MIN_RIGHT = 200;
  const SIDEBAR_MAX = 600;
  // Sidebar geometry is WINDOW state, not vault state: each window keeps its
  // own (multi-window C4, § 5.5), the central one keeps the unscoped key.
  const readSidebarWidth = (key: string, min: number) => {
    const v = Number(localStorage.getItem(windowStateKey(key)));
    // A width stored below the new floor is lifted rather than discarded.
    return v >= min && v <= SIDEBAR_MAX ? v : Math.max(min, 250);
  };
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => readSidebarWidth("plainva-left-sidebar-width", SIDEBAR_MIN_LEFT));
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => readSidebarWidth("plainva-right-sidebar-width", SIDEBAR_MIN_RIGHT));
  // The left panel degrades in the same named steps as the right one. Measured
  // on the element rather than derived from `leftSidebarWidth`, so a collapsed
  // panel or a future non-drag resize reaches the same answer.
  const { step: leftStep, ref: leftAsideRef } = useSidebarStep();
  // Collapsible sidebars (plan Designsprache P6/L1): toggled via title-bar
  // buttons and Mod+Alt+B / Mod+Alt+R (Mod+B stays bold in the editor).
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem(windowStateKey("plainva-left-sidebar-collapsed")) === "1");
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    const global = localStorage.getItem(windowStateKey("plainva-right-sidebar-collapsed"));
    if (global !== null) return global === "1";
    // One-time migration from the former per-view model: the note/editor
    // preference is the only one with meaningful contextual content.
    // The legacy key is the central window's alone — a second window did not
    // exist when it was written, and reading it here would seed every new
    // window from a preference somebody set years ago in another one.
    const legacyEditor = localStorage.getItem("plainva-right-collapsed-editor");
    if (legacyEditor !== null) {
      localStorage.setItem(windowStateKey("plainva-right-sidebar-collapsed"), legacyEditor);
      return legacyEditor === "1";
    }
    return false;
  });
  // The user's sidebar choice is global. Full-surface/non-note tabs temporarily
  // close it because their context panels have no useful active document; that
  // temporary state must not overwrite what comes back for the next note.
  const tabKindOf = (p: string | null): "editor" | "base" | "graph" | "tasks" | "calendar" | "mail" | "comments" =>
    p === GRAPH_TAB_PATH ? "graph" : p === TASKS_TAB_PATH ? "tasks" : p === CALENDAR_TAB_PATH ? "calendar" : p === MAIL_TAB_PATH ? "mail" : p === COMMENTS_TAB_PATH ? "comments" : p?.toLowerCase().endsWith(".base") ? "base" : "editor";
  const rightCollapsedFor = (kind: "editor" | "base" | "graph" | "tasks" | "calendar" | "mail" | "comments"): boolean => {
    if (kind !== "editor") return true;
    return localStorage.getItem(windowStateKey("plainva-right-sidebar-collapsed")) === "1";
  };
  // Focus mode (P7.4): one command collapses BOTH sidebars; invoking it again
  // restores the layout from before. Transient — nothing is persisted.
  const [focusReturn, setFocusReturn] = useState<{ left: boolean; right: boolean } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ paneIndex: number; tabIndex: number; x: number; y: number } | null>(null);

  // Panes/tabs/active-file layout + per-vault persistence live in usePaneLayout (plan D1);
  // App only wires the returned operations to the UI. Opening a path is tracked as a recent
  // file; a fresh split pane asks us to open the quick switcher so the user picks a document.
  const validatePath = useCallback(async (p: string) => {
    try { return vaultAdapter ? await vaultAdapter.exists(p) : false; } catch { return false; }
  }, [vaultAdapter]);
  const {
    layout, splitRatio, activePane, activePath, isSplit, activeSplitDirection,
    openTab, openInFocusedPane, focusOrOpenVirtual, openInOtherPane, openPathInSplit, navigateTab, selectTab, closeTab, closeTabsBulk, toggleTabPinned, closeTabsByPrefix,
    renameTabPrefix, focusPane, splitEditor, splitEditorWithTab, moveTabTo, setSplitRatio, normalizeNow,
  } = usePaneLayout({
    vaultPath,
    validatePath,
    // The strip updates at once and the file follows (C12/S20): the shared
    // contract owns the grammar, the click must not wait for a write.
    onOpenPath: (p) => {
      setRecentPaths((prev) => [p, ...prev.filter((x) => x !== p)].slice(0, RECENTS_MAX));
      if (vaultAdapter) void recentsModule().then((m) => m.pushRecent(vaultAdapter, p)).catch(() => undefined);
    },
    // (P7.2 continues below the hook: the per-kind right-sidebar apply effect
    // needs activePath, which this hook provides.)
    onRequestPick: () => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); },
    // An attachment goes to the OS, which knows what a PDF is and Plainva does
    // not (issue #55). The only case that stays visible in Plainva is failure —
    // and then the message names the file and the reason, because "could not be
    // opened" alone leaves the user with nothing to do.
    openExternally: (p) => {
      if (!vaultPath) return;
      void openAttachmentExternally(vaultPath, p, t);
    },
    // Client windows ask the owner before drawing anything (multi-window C1);
    // the central window holds the registry and answers for itself.
    routeOpen: capabilities.routeOpen,
    // Panes and tabs belong to THIS window (P4/E4). The label is the scope: a
    // restored window comes back under its stored name, so its layout comes
    // back with it. The central window passes nothing and keeps the historic
    // key.
    layoutScope: windowLabel,
  });

  /**
   * Remark notifications (Stufe F, F2).
   *
   * Registered here because this is the one place that can answer all of it at
   * once: what the vault holds, who this device is, and where a click should
   * land. The notifier owns no state beyond its ledger - it wakes on the
   * sideband cycle's event and asks these functions.
   */
  useEffect(() => {
    if (!vaultPath) return;
    let disposer: (() => void) | undefined;
    void import("./services/commentNotifier").then(({ setCommentNotifierDeps, startCommentNotifier }) => {
      setCommentNotifierDeps({
        listNotes: async () => {
          // Two sources, one list. A guest remark is reported on every level
          // (§4), so it travels as its own entry with `source: "publication"`
          // rather than being merged into the note's own thread - they come
          // from outside the vault and cannot be answered from this side.
          const [own, guests] = await Promise.all([listAllWorkspaceComments(), listAllPublicationComments()]);
          const notes: CommentNotificationNote[] = [...own].map(([path, comments]) => ({ path, comments }));
          for (const [path, entries] of guests) {
            for (const entry of entries) {
              notes.push({
                path,
                comments: [entry.comment],
                source: "publication" as const,
                publicationName: entry.publicationName,
              });
            }
          }
          return notes;
        },
        listNames: async () =>
          new Map((await listWorkspaceMembers()).map((m) => [m.memberId, m.displayName])),
        identity: async () => ({ memberId: await getCommentSelfId(), deviceId: null }),
        ownedPaths: () => listOwnedPaths(),
        openComment: ({ path, commentId }) => {
          // The request is parked BEFORE the tab opens, so a note that mounts
          // fresh finds it already waiting rather than racing the event.
          requestCommentJump({ path, commentId });
          openTab(0, path, false);
        },
        openOverview: () => openTab(0, COMMENTS_TAB_PATH, false),
        // A window in the foreground has the column; a system notification for
        // something already on screen is noise (FB5).
        isForeground: () => document.visibilityState === "visible" && document.hasFocus(),
      });
      disposer = startCommentNotifier();
    });
    return () => {
      disposer?.();
      void import("./services/commentNotifier").then(({ setCommentNotifierDeps }) => setCommentNotifierDeps(null));
    };
  }, [vaultPath, listAllWorkspaceComments, listAllPublicationComments, listOwnedPaths, listWorkspaceMembers, getCommentSelfId, openTab]);

  // Apply either the global note preference or a contextless temporary close.
  const activeTabKind = tabKindOf(activePath);
  useEffect(() => {
    setRightCollapsed(rightCollapsedFor(activeTabKind));
  }, [activeTabKind]);

  const toggleRightSidebar = useCallback(() => {
    setRightCollapsed((c) => {
      const next = !c;
      if (activeTabKind === "editor") localStorage.setItem(windowStateKey("plainva-right-sidebar-collapsed"), next ? "1" : "0");
      return next;
    });
  }, [activeTabKind]);

  const toggleFocusMode = useCallback(() => {
    if (!leftCollapsed || !rightCollapsed) {
      setFocusReturn({ left: leftCollapsed, right: rightCollapsed });
      setLeftCollapsed(true);
      setRightCollapsed(true);
    } else {
      const prev = focusReturn ?? { left: false, right: false };
      setLeftCollapsed(prev.left);
      setRightCollapsed(prev.right);
      setFocusReturn(null);
    }
  }, [leftCollapsed, rightCollapsed, focusReturn]);

  // --- Keyboard-shortcut handlers -------------------------------------------
  // Stable identities (useStableHandler) so the single global keydown listener
  // never re-subscribes; each reads the latest render's layout/active state.
  const closedTabsRef = useRef<string[]>([]);
  // Mirrors the stack's depth so the tab menu can grey out "reopen closed tab"
  // without reading the ref during render.
  const [closedTabCount, setClosedTabCount] = useState(0);
  // Records a closed tab's path so Mod+Shift+T can reopen it (wired through the
  // tab strips + Mod+W; bulk closes via closeTabsByPrefix are left untracked).
  const trackClose = useStableHandler((paneIndex: number, index: number) => {
    const tab = layout.panes[paneIndex]?.tabs[index];
    const path = tab?.history[tab.historyIndex];
    if (path) {
      closedTabsRef.current.push(path);
      if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      setClosedTabCount(closedTabsRef.current.length);
    }
    closeTab(paneIndex, index);
  });
  const closeActiveTab = useStableHandler(() => {
    if (activePane) trackClose(layout.activePaneIndex, activePane.activeIndex);
  });
  /**
   * Move a note or database into its own window (multi-window P1).
   *
   * A MOVE, not a copy: content is open once app-wide, so the tab that held it
   * closes as the window opens. It is tracked as a close, which means Mod+Shift+T
   * brings it back into a tab — the way out of a popout without hunting for the
   * window.
   */
  const openInNewWindow = useStableHandler((path: string) => {
    if (!vaultPath) return;
    // A client asks the owner to create the window — only the central window may
    // (its capability withholds window creation from the others). The answer is
    // never "caller" for a pop-out, so the local tab always goes.
    if (capabilities.routeOpen) {
      capabilities.routeOpen(path, () => {}, { newWindow: true });
      closeTabsByPrefix(path);
      return;
    }
    void (async () => {
      try {
        const result = await openOrFocusContent({ vaultPath, path, newWindow: true });
        if (result.where === "focused") closeTabsByPrefix(path);
      } catch (e: any) {
        toast.error(t("dialogs.errorTitle", { defaultValue: "Fehler" }) + ": " + (e?.message ?? String(e)));
      }
    })();
  });
  /**
   * Open a singleton view — graph, tasks, calendar, mail (multi-window P2).
   *
   * `focusOrOpenVirtual` dedups across the PANES of this window; once a view
   * can also live in its own window, that is no longer the whole picture. The
   * owner asks itself first: if a window already shows the view, it comes
   * forward, and only otherwise does a tab open here. Without this the ribbon
   * would quietly build a second calendar next to the one on screen.
   */
  const openView = useStableHandler((path: string) => {
    if (!vaultPath) {
      focusOrOpenVirtual(path);
      return;
    }
    // A client cannot read the registry, so it asks. Since the loosening of
    // 2026-08-23 the answer for a view is usually "you draw it" — graph, tasks,
    // calendar and mail may exist more than once — but the question still has
    // to be asked: the owner is the one that knows.
    if (capabilities.routeOpen) {
      capabilities.routeOpen(path, () => focusOrOpenVirtual(path));
      return;
    }
    void (async () => {
      try {
        const result = await openOrFocusContent({ vaultPath, path });
        if (result.where !== "focused") focusOrOpenVirtual(path);
      } catch (e) {
        // No window registry (browser/test): the tab is the honest fallback.
        console.warn("[App] could not route the view request", e);
        focusOrOpenVirtual(path);
      }
    })();
  });

  /**
   * The communications window: mail beside the calendar (multi-window P4, E4).
   *
   * A preset, not a window type — it only seeds the split of an ordinary
   * auxiliary window, so closing a pane or adding a tab afterwards works like
   * everywhere else and the combination stays the user's to change.
   */
  const openCommsWindow = useStableHandler(() => {
    if (!vaultPath) return;
    void (async () => {
      try {
        await openPresetWindow({
          vaultPath,
          preset: "mail-calendar",
          // The taskbar entry names the window, not the command that opened it.
          title: t("window.commsTitle"),
        });
      } catch (e: any) {
        toast.error(t("dialogs.errorTitle", { defaultValue: "Fehler" }) + ": " + (e?.message ?? String(e)));
      }
    })();
  });

  /**
   * A second full window: the same shell again, on another monitor (stage C).
   *
   * Not deduplicated, unlike content: a window is a WORKPLACE, and having two
   * of them is the point. What stays deduplicated is what they SHOW.
   */
  const openSecondWindow = useStableHandler((target?: string) => {
    const forVault = target ?? vaultPath;
    if (!forVault) return;
    void (async () => {
      try {
        await openFullWindow({ vaultPath: forVault });
      } catch (e: any) {
        toast.error(t("dialogs.errorTitle", { defaultValue: "Fehler" }) + ": " + (e?.message ?? String(e)));
      }
    })();
  });

  /**
   * Opens ANOTHER vault in a window of its own (stage D).
   *
   * The owner creates the window itself; a client asks, because creating one is
   * owner-only by capability. Both doors end in the same `openFullWindow`.
   */
  const openVaultInWindow = useStableHandler((path: string) => {
    if (capabilities.openVaultWindow) {
      capabilities.openVaultWindow(path);
      return;
    }
    openSecondWindow(path);
  });

  // Asked for from another window (the client has no permission to create one).
  useEffect(() => {
    if (capabilities.deferToOwner) return;
    // The detail names the vault when the request came from a window looking at
    // a different one (stage D); without it, this window's own vault.
    const onOpen = (e: Event) => openSecondWindow((e as CustomEvent<{ vaultPath?: string }>).detail?.vaultPath);
    window.addEventListener("plainva-open-full-window", onOpen);
    return () => window.removeEventListener("plainva-open-full-window", onOpen);
  }, [capabilities, openSecondWindow]);

  const reopenClosedTab = useStableHandler(() => {
    const path = closedTabsRef.current.pop();
    setClosedTabCount(closedTabsRef.current.length);
    if (path) openInFocusedPane(path, true);
  });
  const cycleTab = useStableHandler((dir: number) => {
    const pane = activePane;
    if (!pane || pane.tabs.length < 2) return;
    const n = pane.tabs.length;
    selectTab(layout.activePaneIndex, (pane.activeIndex + dir + n) % n);
  });
  const goToTab = useStableHandler((index: number) => {
    const pane = activePane;
    if (!pane) return;
    const n = pane.tabs.length;
    const i = index < 0 ? n - 1 : index;
    if (i >= 0 && i < n) selectTab(layout.activePaneIndex, i);
  });
  const navBack = useStableHandler(() => navigateTab(layout.activePaneIndex, -1));
  const navForward = useStableHandler(() => navigateTab(layout.activePaneIndex, 1));
  const openNewTabPrompt = useStableHandler(() => { setQuickSwitcherNewTab(true); setShowQuickSwitcher(true); });
  const dispatchNewNote = useStableHandler(() => window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: "file" } })));
  const toggleReadEdit = useStableHandler(() => window.dispatchEvent(new CustomEvent("plainva-toggle-view-mode", { detail: { axis: "read" } })));
  const toggleSourceMode = useStableHandler(() => window.dispatchEvent(new CustomEvent("plainva-toggle-view-mode", { detail: { axis: "source" } })));
  const renameActiveNote = useStableHandler(() => {
    if (activePath && !isVirtualPath(activePath)) window.dispatchEvent(new CustomEvent("plainva-rename-active"));
  });
  const flushSave = useStableHandler(() => {
    if (activePath && !isVirtualPath(activePath)) {
      window.dispatchEvent(new CustomEvent("plainva-flush-pending-save", { detail: { path: activePath } }));
      toast.info(t("shortcuts.savedToast", { defaultValue: "Gespeichert" }));
    }
  });

  // Load recent paths (C12/S20: the shared `.plainva/recents.json` contract,
  // migrating the old localStorage list on first read). Writes happen at the
  // two mutation sites, so there is no save effect mirroring state to disk.
  useEffect(() => {
    let cancelled = false;
    if (!vaultPath || !vaultAdapter) {
      setRecentPaths([]);
      return;
    }
    void recentsModule().then((m) => m.loadRecents(vaultAdapter, vaultPath))
      .then((paths) => {
        if (!cancelled) setRecentPaths(paths);
      })
      .catch(() => {
        if (!cancelled) setRecentPaths([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, vaultAdapter]);

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

        // Check Plainva bookmarks (shared parser accepts the legacy mobile
        // bare-array shape too — .plainva/bookmarks.json is one contract now)
        let plainvaBookmarksExisted = false;
        try {
          const plData = await vaultAdapter.readTextFile(".plainva/bookmarks.json");
          const plFile = parseBookmarksFile(plData);
          plainvaBookmarks = plFile.paths;
          plainvaBookmarksExisted = plFile.existed;
        } catch(e) {
          console.debug("No plainva bookmarks or parse error", e);
        }

        // Merge without overwriting
        const merged = Array.from(new Set([...plainvaBookmarks, ...obsidianBookmarks]));

        // Save back if there were obsidian bookmarks imported that weren't in plainva
        if (obsidianBookmarks.length > 0 && merged.length > plainvaBookmarks.length || !plainvaBookmarksExisted && merged.length > 0) {
          await vaultAdapter.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(merged));
        }

        setBookmarks(merged);
      } catch (e) {
        console.error("Failed to load bookmarks", e);
      }
    };
    loadBookmarks();
  }, [vaultPath, vaultAdapter]);

  /**
   * The list is re-read from disk before it is written (multi-window C1).
   *
   * Since stage C two windows can draw the same bookmark list, and each holds
   * its own copy in React state. Writing the whole file from that copy means the
   * second window's star quietly drops whatever the first one added. The shared
   * helper does read-modify-write — the shape `pushRecent` has always had — so
   * the state below is a mirror of the file rather than its source.
   */
  const toggleBookmark = (path: string) => {
    if (!vaultPath || !vaultAdapter) return;
    // Optimistic, so the star flips under the finger; the disk answer wins.
    setBookmarks(prev => (prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]));
    void toggleBookmarkOnDisk(vaultAdapter, path)
      .then(setBookmarks)
      .catch((e) => {
        // The optimistic state update already happened — a silent write
        // failure would leave bookmarks permanently out of sync with disk.
        console.error("Failed to persist bookmarks", e);
        toast.error(t("sidebar.bookmarkSaveFailed"));
      });
  };

  // An auxiliary window (multi-window P2) has the star in its graph but not the
  // list: it asks over the bus, and the owner handler writes the file of the
  // vault it is bound to. What arrives here is the RESULT -- and it is checked,
  // because since stage D this window may well be drawing a different vault.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ vaultPath?: string; bookmarks?: string[] }>).detail;
      if (!detail || detail.vaultPath !== vaultPath) return;
      if (Array.isArray(detail.bookmarks)) setBookmarks(detail.bookmarks);
    };
    window.addEventListener("plainva-bookmarks-changed", onChanged);
    return () => window.removeEventListener("plainva-bookmarks-changed", onChanged);
  }, [vaultPath]);

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

  /**
   * The vault-wide runs, handed to the central window when this is not it
   * (multi-window C2).
   *
   * They are gated HERE rather than at each button because they have four
   * entry points between them — ribbon, palette, tree context menu, settings —
   * and all of them already travel as an event. One listener therefore covers
   * every present and future dispatcher; `plainva-backup-now` gets a listener
   * only in a client, because in the central window the scheduler owns it.
   */
  useEffect(() => {
    const defer = capabilities.deferToOwner;
    if (!defer) return;
    const onIndexes = () => defer("update-indexes");
    const onBackup = () => defer("backup");
    // Opening a window is one of them: the client capability deliberately does
    // not carry `create-webview-window` — only the central window opens windows
    // (P0), so from here the command asks it to.
    const onNewWindow = () => defer("new-window");
    window.addEventListener("plainva-update-all-indexes", onIndexes);
    window.addEventListener("plainva-backup-now", onBackup);
    window.addEventListener("plainva-open-full-window", onNewWindow);
    return () => {
      window.removeEventListener("plainva-update-all-indexes", onIndexes);
      window.removeEventListener("plainva-backup-now", onBackup);
      window.removeEventListener("plainva-open-full-window", onNewWindow);
    };
  }, [capabilities]);

  // The vault switcher, asked for from another window: it lives in this
  // window's sidebar, so the request only has to open it.
  useEffect(() => {
    if (capabilities.deferToOwner) return;
    const onSwitch = () => setShowVaultMenu(true);
    window.addEventListener("plainva-open-vault-switcher", onSwitch);
    return () => window.removeEventListener("plainva-open-vault-switcher", onSwitch);
  }, [capabilities]);

  // "Alle index.md aktualisieren" (root context menu + settings, P11).
  useEffect(() => {
    if (!vaultAdapter || !queryService) return;
    if (capabilities.deferToOwner) return; // handed over above
    const onUpdateAll = () => {
      void (async () => {
        try {
          const result = await updateAllManagedIndexes({
            adapter: vaultAdapter,
            queryService,
            vaultName: () => vaultPath?.split(/[/\\]/).pop() ?? "Vault",
            subfoldersHeading: () => t("indexMd.subfoldersHeading"),
          });
          // Only the regenerated index.md files changed — reindex just those (Issue #9).
          if (indexer) await applyIndexChanges(indexer, { added: result.updated });
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
  }, [vaultAdapter, queryService, vaultPath, indexer, capabilities]);

  const handleDeleteFile = async (path: string) => {
    if (!vaultAdapter) return;
    // The cascade host owns the whole flow (plan Kaskadenloeschung): slim
    // confirmation when nothing hangs off the file, the cascade dialog for
    // relation targets and `.base` files, execution, reindex and the tab/
    // bookmark cleanup via handleCascadeDeleted.
    await requestCascadeDelete({ paths: [path] });
  };

  // Central after-delete cleanup for every cascade deletion (tree, editor ⋮,
  // pinboard, graph…): close affected tabs and drop dangling bookmarks (the
  // desktop previously left deleted paths in the bookmark list — mobile
  // already cleans them in vaultOps.remove).
  const handleCascadeDeleted = useStableHandler((paths: string[]) => {
    for (const p of paths) closeTabsByPrefix(p);
    const gone = new Set(paths);
    if (!bookmarks.some((b) => gone.has(b))) return;
    setBookmarks((prev) => prev.filter((b) => !gone.has(b)));
    if (!vaultAdapter) return;
    void removeBookmarksOnDisk(vaultAdapter, paths)
      .then(setBookmarks)
      .catch((e) => {
        console.error("Failed to persist bookmarks", e);
        toast.error(t("sidebar.bookmarkSaveFailed"));
      });
  });

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


  // Slash command "insert template" (mobile round 3): the shared plugin
  // fires this event; it opens the same picker as Mod+Alt+T / the palette.
  useEffect(() => {
    const open = () => setShowTemplatePicker(true);
    window.addEventListener("plainva-open-template-picker", open);
    return () => window.removeEventListener("plainva-open-template-picker", open);
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key === "o") {
        // Mod+K is now "insert link" in the editor; the switcher keeps Mod+O.
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
        openView(GRAPH_TAB_PATH);
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        // Vault-wide find & replace (B6); the in-editor panel keeps Mod+F.
        e.preventDefault();
        setShowFindReplace(true);
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
        toggleRightSidebar();
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        // New note in the tree-selected folder (issue #13).
        e.preventDefault();
        dispatchNewNote();
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "e") {
        // Toggle reading ↔ editing (issue #13; Mod+E is Obsidian's standard,
        // Mod+R is reserved as the reload guard).
        e.preventDefault();
        toggleReadEdit();
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        // Toggle live preview ↔ Markdown source.
        e.preventDefault();
        toggleSourceMode();
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "t") {
        // New tab: pick the note to open in a fresh tab.
        e.preventDefault();
        openNewTabPrompt();
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        reopenClosedTab();
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeActiveTab();
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        // Today's daily note (a dedicated listener owns the daily-note helper).
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("plainva-open-daily-today"));
      } else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        // Command-palette alias for VS Code muscle memory (Mod+P also works).
        e.preventDefault();
        setShowCommandPalette(true);
      } else if (mod && e.altKey && !e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        navBack();
      } else if (mod && e.altKey && !e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        navForward();
      } else if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        // Cycle tabs — Ctrl(+Shift)+Tab on every OS (browser convention).
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      } else if (mod && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        // Jump to tab 1–8; 9 = last tab.
        e.preventDefault();
        goToTab(e.key === "9" ? -1 : Number(e.key) - 1);
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        // Autosave flush + confirmation, so Mod+S does not feel like a no-op.
        e.preventDefault();
        flushSave();
      } else if (e.key === "F2" && !mod && !e.altKey) {
        // Rename the active note (skip while typing in a form field).
        const tag = document.activeElement?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          renameActiveNote();
        }
      } else if (mod && !e.altKey && (e.key === "+" || e.key === "=")) {
        // UI zoom (issue #5 a11y follow-up). "=" covers US layouts where the
        // plus sign shares the key; Tauri ships with browser zoom hotkeys
        // disabled, so these are free.
        e.preventDefault();
        void import("./services/uiZoom").then(({ adjustUiZoom }) => adjustUiZoom(1)).catch(() => {});
      } else if (mod && !e.altKey && e.key === "-") {
        e.preventDefault();
        void import("./services/uiZoom").then(({ adjustUiZoom }) => adjustUiZoom(-1)).catch(() => {});
      } else if (mod && !e.altKey && !e.shiftKey && e.key === "0") {
        e.preventDefault();
        void import("./services/uiZoom").then(({ setStoredUiZoom, DEFAULT_UI_ZOOM }) => setStoredUiZoom(DEFAULT_UI_ZOOM)).catch(() => {});
      } else if (mod && e.key === ",") {
        e.preventDefault();
        capabilities.openSettings();
      } else if (e.key === "F1") {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [vaultPath, splitEditor, openView, toggleRightSidebar, dispatchNewNote, toggleReadEdit, toggleSourceMode, openNewTabPrompt, reopenClosedTab, closeActiveTab, navBack, navForward, cycleTab, goToTab, flushSave, renameActiveNote, capabilities]);

  // Draft-journal retention (P2.4): prune crash-recovery snapshots older
  // than the retention window once per vault open (best-effort).
  useEffect(() => {
    if (!vaultPath) return;
    void import("./services/draftJournal").then(({ pruneDrafts }) => pruneDrafts(vaultPath)).catch(() => {});
  }, [vaultPath]);

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

  // "Open properties" (the stale-note banner, OKF v0.2 plan P3a) must be able
  // to un-collapse the right sidebar; the sidebar itself expands the section.
  useEffect(() => {
    const onReveal = () => setRightCollapsed(false);
    window.addEventListener("plainva-reveal-properties", onReveal);
    return () => window.removeEventListener("plainva-reveal-properties", onReveal);
  }, []);

  // Clicking a link to a not-yet-created note (unresolved wiki link) creates it
  // (maintainer 2026-07-18, Obsidian parity). The editor / read view resolve the
  // target and, on a miss, dispatch here — App owns the vault write + index +
  // open. Default: create immediately; the per-user "ask first" setting confirms.
  useEffect(() => {
    const onCreate = (e: Event) => {
      const d = (e as CustomEvent).detail as { target: string; hostPath?: string; newTab?: boolean };
      if (!d?.target || !vaultAdapter) return;
      void (async () => {
        const { path, title } = wikiTargetToPath(d.target, d.hostPath);
        if (!title) return;
        try {
          if (await vaultAdapter.exists(path)) { openInFocusedPane(path, !!d.newTab); return; }
          if (await getAskBeforeCreateLink()) {
            const ok = await appConfirm({
              title: t("dialogs.createNoteFromLinkTitle", { defaultValue: "Notiz anlegen?" }),
              message: t("dialogs.createNoteFromLinkMsg", { title, defaultValue: "„{{title}}“ existiert noch nicht. Jetzt anlegen?" }),
              confirmLabel: t("dialogs.createNoteFromLinkConfirm", { defaultValue: "Anlegen" }),
            });
            if (!ok) return;
          }
          const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          if (folder && !(await vaultAdapter.exists(folder))) await vaultAdapter.createDir(folder);
          const noteType = await getConfiguredNoteType(vaultPath ?? "");
          await vaultAdapter.writeTextFile(path, buildNewNoteContent(noteType, title));
          if (indexer) await applyIndexChanges(indexer, { added: [path] });
          triggerFileTreeUpdate();
          notifyFileOps([{ type: "create", path }]);
          openInFocusedPane(path, !!d.newTab);
        } catch (err: any) {
          toast.error(t("dialogs.createErrorMsg", { error: err?.message ?? String(err) }));
        }
      })();
    };
    window.addEventListener("plainva-create-note-from-link", onCreate);
    return () => window.removeEventListener("plainva-create-note-from-link", onCreate);
  }, [vaultAdapter, indexer, vaultPath, openInFocusedPane, triggerFileTreeUpdate, t]);

  /**
   * The dedup mirror (multi-window P1).
   *
   * "Is this open somewhere?" is a question about the whole app, and half the
   * answer lives in this window's React state. Mirroring it into the window
   * manager on every layout change is the cheap half of the deal — the routing
   * decision itself stays in one place.
   */
  useEffect(() => {
    const paths: string[] = [];
    for (const pane of layout.panes) {
      for (const tab of pane.tabs) {
        const p = tab.history[tab.historyIndex];
        if (p) paths.push(p);
      }
    }
    capabilities.reportOpenContents?.(paths, activePath ?? null);
  }, [layout, activePath, capabilities]);

  // Popout requests from the editor ⋮ and the peek header. They announce rather
  // than act, because only this window can open the window AND close the tab.
  useEffect(() => {
    const onPopout = (e: Event) => {
      const path = (e as CustomEvent).detail?.path as string | undefined;
      if (path) openInNewWindow(path);
    };
    // An auxiliary window asked for content the central window already holds:
    // the owner brings itself forward (bus side) and shows the tab (here).
    const onShow = (e: Event) => {
      const path = (e as CustomEvent).detail?.path as string | undefined;
      if (path) openInFocusedPane(path, false);
    };
    window.addEventListener("plainva-open-in-new-window", onPopout);
    window.addEventListener("plainva-window-show-content", onShow);
    return () => {
      window.removeEventListener("plainva-open-in-new-window", onPopout);
      window.removeEventListener("plainva-window-show-content", onShow);
    };
  }, [openInNewWindow, openInFocusedPane]);

  // Persist user-chosen sidebar widths.
  useEffect(() => { localStorage.setItem(windowStateKey("plainva-left-sidebar-width"), String(leftSidebarWidth)); }, [leftSidebarWidth]);
  useEffect(() => { localStorage.setItem(windowStateKey("plainva-right-sidebar-width"), String(rightSidebarWidth)); }, [rightSidebarWidth]);
  useEffect(() => { localStorage.setItem(windowStateKey("plainva-left-sidebar-collapsed"), leftCollapsed ? "1" : "0"); }, [leftCollapsed]);

  // Drag-to-resize for the left/right sidebars (clamped to SIDEBAR_MIN..MAX).
  const startSidebarResize = (side: "left" | "right") => (e: ReactMouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const raw = side === "left" ? ev.clientX : window.innerWidth - ev.clientX;
      const min = side === "left" ? SIDEBAR_MIN_LEFT : SIDEBAR_MIN_RIGHT;
      const w = Math.max(min, Math.min(SIDEBAR_MAX, raw));
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

  /**
   * "New note / folder / database" is answered by the FILE TREE, which is only
   * mounted on the Files tab and not at all while the sidebar is collapsed. Sent
   * from anywhere else the event used to vanish without a trace (plan § 7.1).
   *
   * So the request is parked and the sidebar is put into a state that can answer
   * it; the effect below fires once the tree is actually there. Child effects run
   * before parent effects, so its listener is registered by then.
   */
  const [pendingNewItem, setPendingNewItem] = useState<"file" | "folder" | "base" | null>(null);
  const requestNewItem = (kind: "file" | "folder" | "base") => {
    if (leftCollapsed) setLeftCollapsed(false);
    if (leftSidebarTab !== "files") setLeftSidebarTab("files");
    setPendingNewItem(kind);
  };

  useEffect(() => {
    if (!pendingNewItem || leftCollapsed || leftSidebarTab !== "files") return;
    window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: pendingNewItem } }));
    setPendingNewItem(null);
  }, [pendingNewItem, leftCollapsed, leftSidebarTab]);

  /** The placeholder says WHAT is being searched — three tabs, three answers. */
  const searchPlaceholderKey =
    leftSidebarTab === "tags" ? "sidebar.searchTags"
    : leftSidebarTab === "databases" ? "sidebar.searchDatabases"
    : "sidebar.searchNotes";

  // Calendar click: open the daily note for the picked date, creating it from
  // the template if it doesn't exist yet.
  const handleOpenDailyNote = async (date: Date) => {
    if (!vaultPath || !vaultAdapter || !indexer) return;
    try {
      // No confirmation (plan § 7.2): six entry points used to disagree about
      // whether creating a daily note needs asking. Creating one is harmless and
      // undoable, so the answer is the same everywhere — just do it.
      const path = await resolveOrCreateDailyNote(date, {
        vaultPath,
        adapter: vaultAdapter,
        onIndex: () => indexer.indexVaultFull(),
        confirmCreate: false,
        onCreated: (p) => notifyFileOps([{ type: "create", path: p }]),
        // Opening a daily note is a deliberate act, so its template may ask
        // (plan Vorlagen-Engine, P3). A template without questions still opens
        // no dialog; cancelling creates no note at all.
        resolveTemplate: async (raw, ctx) =>
          applyTemplateInteractive(
            raw,
            {
              ...ctx,
              vaultName: vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? "",
              // A daily note is the one place where "yesterday" and "tomorrow"
              // are obvious, so `{{daily±N}}` belongs here. Without the provider
              // the token has nothing to resolve against and would stay visible
              // in every note the template writes.
              dailyPath: await makeDailyPathProvider(vaultPath, ctx.now),
            },
            t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" })
          ),
      });
      if (path) {
        triggerFileTreeUpdate();
        openInFocusedPane(path);
        pokeTemplateCaret(path);
      }
    } catch (e) {
      console.error("Failed to open daily note from calendar", e);
    }
  };

  /** "+ → Tageseintrag" and the palette: today's note, same path as the calendar. */
  const openTodayDailyNote = () => handleOpenDailyNote(new Date());

  /**
   * What "New …" can make from this shell, in the catalog's vocabulary — read
   * by the sidebar's ＋ menu and the palette's create group alike. A term and a
   * task are made where they live: the view opens and takes the request.
   */
  const newHandlers = newHandlersOf({
    newItem: (kind, opts) =>
      opts?.fromTemplate
        ? window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind, ...opts } }))
        : requestNewItem(kind),
    openDailyNote: openTodayDailyNote,
    newEvent: cloudServices.calendar ? () => { openView(CALENDAR_TAB_PATH); requestNew("event"); } : undefined,
    newTask: () => { openView(TASKS_TAB_PATH); requestNew("task"); },
  });

  // Mod+Shift+D dispatches an event (the global keydown handler cannot depend on
  // the non-memoized daily helper); this stable wrapper opens today's note.
  const openDailyTodayStable = useStableHandler(() => { void openTodayDailyNote(); });
  useEffect(() => {
    const h = () => openDailyTodayStable();
    window.addEventListener("plainva-open-daily-today", h);
    return () => window.removeEventListener("plainva-open-daily-today", h);
  }, [openDailyTodayStable]);

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
    // Virtual tabs (calendar/mail/graph/tasks) are not vault files, so the
    // Editor never publishes for them — without this the status bar would keep
    // showing the LAST markdown/base file's stale word count. Publish a
    // "virtual" doc so the status bar shows the tab name (and the view fills in
    // a live info line). The label is derived from the path by the status bar.
    else if (isVirtualPath(activePath)) activeDocument.set({ path: activePath, content: "", kind: "virtual", meta: {} });
    else if (activePath.endsWith(".base")) activeDocument.set({ path: activePath, content: "", kind: "base", meta: {} });
  }, [activePath]);
  const showVerticalPreview = drag.splitPreview === "vertical";
  const showHorizontalPreview = drag.splitPreview === "horizontal";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <TitleBar
        tabs={isSplit ? [] : activePane.tabs.map((tb) => tb.history[tb.historyIndex])}
        pinnedTabs={isSplit ? [] : activePane.tabs.map((tb) => tb.pinned === true)}
        activeIndex={activePane.activeIndex}
        onSelectTab={(i) => selectTab(layout.activePaneIndex, i)}
        onCloseTab={(i) => trackClose(layout.activePaneIndex, i)}
        onNewTab={() => { setQuickSwitcherNewTab(true); setShowQuickSwitcher(true); }}
        onTabContextMenu={(i, x, y) => setTabMenu({ paneIndex: layout.activePaneIndex, tabIndex: i, x, y })}
        leftWidth={leftCollapsed ? 0 : leftSidebarWidth}
        paneIndex={layout.activePaneIndex}
        onMoveTab={moveTabTo}
        onSplitWithTab={splitEditorWithTab}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeftSidebar={() => setLeftCollapsed((c) => !c)}
        onToggleRightSidebar={toggleRightSidebar}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <AppRibbon
        onNewNote={() => requestNewItem("file")}
        onNewFolder={() => requestNewItem("folder")}
        onNewBase={() => requestNewItem("base")}
        onQuickSwitcher={() => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); }}
        onDailyNote={() => { void handleOpenDailyNote(new Date()); }}
        onOpenGraph={() => openView(GRAPH_TAB_PATH)}
        onOpenTasks={() => openView(TASKS_TAB_PATH)}
        onOpenCalendar={cloudServices.calendar ? () => openView(CALENDAR_TAB_PATH) : undefined}
        onOpenMail={cloudServices.mail ? () => openView(MAIL_TAB_PATH) : undefined}
        onOpenComments={() => openView(COMMENTS_TAB_PATH)}
        onOpenViewInNewWindow={(p) => openInNewWindow(p)}
        onCommandPalette={() => setShowCommandPalette(true)}
        onShortcuts={() => setShowShortcuts(true)}
        onSettings={() => capabilities.openSettings()}
      />
      {!leftCollapsed && (
      <aside
        ref={leftAsideRef}
        aria-label="Left Sidebar"
        className="pv-side-left"
        // Same three named steps as the right panel: the head, the tabs and the
        // tree rows tighten at the SAME two widths, so "narrow sidebar" means
        // one thing across the app instead of one thing per surface.
        data-side-step={leftStep}
        style={{ width: `${leftSidebarWidth}px`, flexShrink: 0, borderRight: '1px solid var(--border-color-light)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      >
        {/* Search + "+" on one row (plan P5): the full-width green button cost a
            whole chrome row for something reachable seven other ways, so it is
            an icon beside the search field and always opens its menu. */}
        <div style={{ padding: 'var(--side-head-pad) var(--side-head-pad) var(--space-1)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', minWidth: 0 }}>
          <div ref={leftSearchWrapRef} style={{ flex: 1, minWidth: 0 }}>
          <SearchField
            ref={leftSearchRef}
            form
            value={leftQuery}
            onFocus={() => setLeftSearchFocused(true)}
            onBlur={() => { setLeftSearchFocused(false); rememberLeftQuery(leftQuery); }}
            onValueChange={(v) => { if (v === '' && leftQuery !== '') clearLeftQuery(); else setLeftQuery(v); }}
            placeholder={t(searchPlaceholderKey, { defaultValue: t('fileTree.search') })}
            aria-label={t(searchPlaceholderKey, { defaultValue: t('fileTree.search') })}
            clearLabel={t('sidebar.clearSearch')}
            style={{ width: '100%', minWidth: 0 }}
          />
          <RecentSearchesPopover
            vaultPath={vaultPath ?? ''}
            anchorRef={leftSearchWrapRef}
            open={leftSearchFocused && leftQuery === ''}
            reloadKey={recentSearchTick}
            onPick={(q) => { setLeftQuery(q); leftSearchRef.current?.focus(); }}
            onClose={() => setLeftSearchFocused(false)}
          />
          </div>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={sortBtnRef}
              aria-haspopup="menu"
              aria-expanded={showSortMenu}
              aria-label={t('browse.sortBy')}
              data-tip={t('browse.sortBy')}
              data-testid="sidebar-sort"
              onClick={() => setShowSortMenu((s) => !s)}
              className={`pv-btn pv-btn--ghost${treeSort.key !== 'title' ? ' is-active' : ''}`}
              style={{ width: 34, height: 34, padding: 0 }}
            >
              <ArrowUpDown size={ICON.ui} />
            </button>
            <DropdownMenu
              open={showSortMenu}
              anchorRef={sortBtnRef}
              onClose={() => setShowSortMenu(false)}
              ariaLabel={t('browse.sortBy')}
              items={(['title', 'modified', 'created'] as const).map((key) => ({
                id: `sort-${key}`,
                label: t(key === 'title' ? 'browse.sortTitle' : key === 'modified' ? 'browse.sortModified' : 'browse.sortCreated'),
                hint: treeSort.key === key ? t(treeSort.dir === 'asc' ? 'browse.sortAsc' : 'browse.sortDesc') : undefined,
                onSelect: () => chooseTreeSort(key),
              }))}
            />
          </div>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ display: 'flex' }}>
              <button
                ref={newBtnRef}
                aria-haspopup="menu"
                aria-expanded={showNewMenu}
                aria-label={t('sidebar.new', { defaultValue: 'Neu' })}
                data-tip={t('sidebar.new', { defaultValue: 'Neu' })}
                data-testid="sidebar-new"
                onClick={() => setShowNewMenu((s) => !s)}
                className="pv-btn pv-btn--primary"
                style={{ width: 34, height: 34, padding: 0 }}
              >
                <Plus size={ICON.ui} />
              </button>
            </div>
            <DropdownMenu
              open={showNewMenu}
              anchorRef={newBtnRef}
              onClose={() => setShowNewMenu(false)}
              ariaLabel={t('sidebar.new', { defaultValue: 'Neu' })}
              // The one "New …" catalog (Design-Runde E4): the same entries, in
              // the same groups and order, as the palette's create group, the
              // ribbon and the phone's FAB. A hairline between the groups.
              items={newEntries(t, newHandlers).flatMap((g, gi) => [
                ...(gi > 0 ? (['separator'] as const) : []),
                ...g.items.map((it) => ({
                  id: it.id,
                  label: it.label,
                  icon: <it.icon size={ICON.ui} />,
                  hint: it.id === 'daily' ? t('sidebar.today', { defaultValue: 'heute' }) : undefined,
                  onSelect: it.run,
                })),
              ])}
            />
          </div>
        </div>
        {/* "Recently opened" and Bookmarks sit ABOVE the view switch, so they
            stay put whichever view is showing. They used to live inside the
            Files branch, which meant switching to Tags or Databases hid the two
            lists a person navigates by — and moved the switch itself down the
            sidebar, away from the tree it switches (device report 2026-08-15,
            point 9). */}
        {vaultPath && (
          <LeftPinnedSections
            vaultPath={vaultPath}
            recentPaths={recentPaths}
            bookmarks={bookmarks}
            activePath={activePath}
            onOpen={openInFocusedPane}
            query={leftQueryDebounced}
            onOpenNewTab={(p) => openInFocusedPane(p, true)}
            onOpenInSplit={openPathInSplit}
            isBookmarked={(p) => bookmarks.includes(p)}
            onToggleBookmarkPath={toggleBookmark}
            onForgetRecent={(p) => {
              setRecentPaths((prev) => prev.filter((x) => x !== p));
              if (vaultAdapter) void recentsModule().then((m) => m.forgetRecent(vaultAdapter, p)).catch(() => undefined);
            }}
          />
        )}
        {/* View switch (Files / Tags / Databases), directly above the tree it
            switches. There is no separate Bookmarks tab — bookmarks are one of
            the pinned sections above. The tree collapse/expand-all toggle lives
            in the file-tree heading below. Which tabs show and in which order
            is the shared bar model. */}
        <LeftSidebarTabs vaultPath={vaultPath} active={leftSidebarTab} onSelect={setLeftSidebarTab} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {leftSidebarTab === "files" ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 2px" }}>
                <FolderTree size={ICON.ui} style={{ flexShrink: 0, color: "var(--text-muted)" }} aria-hidden />
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {vaultPath ? (vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? vaultPath) : ""}
                </span>
                <button
                  className="pv-iconbtn"
                  aria-label={t('refresh.action', { defaultValue: 'Vault neu einlesen' })}
                  data-tip={t('refresh.action', { defaultValue: 'Vault neu einlesen' })}
                  data-testid="tree-refresh"
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true);
                    void refreshVault().catch(() => {}).finally(() => setRefreshing(false));
                  }}
                >
                  <RefreshCw size={ICON.ui} className={refreshing ? 'spin-animation' : undefined} />
                </button>
                <button
                  className="pv-iconbtn"
                  aria-label={treeHasExpanded ? t('sidebar.collapseAll') : t('sidebar.expandAll')}
                  data-tip={treeHasExpanded ? t('sidebar.collapseAll') : t('sidebar.expandAll')}
                  onClick={() => window.dispatchEvent(new CustomEvent('plainva-tree-toggle-all'))}
                >
                  {treeHasExpanded ? <ChevronsDownUp size={ICON.ui} /> : <ChevronsUpDown size={ICON.ui} />}
                </button>
              </div>
              <div data-testid="file-tree" style={{ flex: 1, minHeight: 0 }}>
                <FileTree
                  activePath={activePath}
                  onSelect={openInFocusedPane}
                  onExpandedStateChange={setTreeHasExpanded}
                  onCloseTabsByPrefix={closeTabsByPrefix}
                  onRenameTabPrefix={renameTabPrefix}
                  externalQuery={leftQueryDebounced}
                  sort={treeSort}
                  onOpenInSplit={openPathInSplit}
                  isBookmarked={(p) => bookmarks.includes(p)}
                  onToggleBookmarkPath={toggleBookmark}
                />
              </div>
            </div>
          ) : leftSidebarTab === "tags" ? (
            <TagTree onSelectPath={openInFocusedPane} filter={leftQueryDebounced} />
          ) : (
            <div className="custom-scrollbar" style={{ overflowY: 'auto', height: '100%', padding: '0.5rem' }}>
              <DatabasesList
                query={leftQueryDebounced}
                activePath={activePath}
                onOpen={openInFocusedPane}
                onCreate={() => requestNewItem('base')}
              />
            </div>
          )}
        </div>
        <div style={{ padding: '0.5rem', borderTop: '1px solid var(--border-color-light)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {/* The one sidebar surface that differs between windows (C6). */}
          <VaultSwitcher
            vaultPath={vaultPath}
            syncWorker={syncWorker}
            recentVaults={capabilities.recentVaults}
            openVault={capabilities.openVault}
            closeVault={capabilities.closeVault}
            openVaultWindow={openVaultInWindow}
            onSyncError={capabilities.openSyncError}
            open={showVaultMenu}
            onOpenChange={setShowVaultMenu}
          />
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
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '50%', background: 'var(--accent-color)', opacity: 0.15, pointerEvents: 'none', zIndex: 'var(--z-popover)', borderLeft: '2px solid var(--accent-color)' }} />
        )}
        {showHorizontalPreview && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: 'var(--accent-color)', opacity: 0.15, pointerEvents: 'none', zIndex: 'var(--z-popover)', borderTop: '2px solid var(--accent-color)' }} />
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
                    pinnedTabs={pane.tabs.map((tb) => tb.pinned === true)}
                    activeIndex={pane.activeIndex}
                    onSelect={(idx) => selectTab(i, idx)}
                    onClose={(idx) => trackClose(i, idx)}
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
                    ) : path === TASKS_TAB_PATH ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <TasksView onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)} />
                      </Suspense>
                    ) : path === CALENDAR_TAB_PATH ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <CalendarView onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)} isActivePane={isActivePane} />
                      </Suspense>
                    ) : path === MAIL_TAB_PATH ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <MailView onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)} isActivePane={isActivePane} />
                      </Suspense>
                    ) : path === COMMENTS_TAB_PATH ? (
                      <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("splash.initializing", "Lade...")}</div>}>
                        <CommentsOverview onOpenPath={(p, newTab) => openTab(i, p, newTab ?? false)} />
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
          onOpenCalendarDay={(dayKey) => {
            requestCalendarDay(dayKey);
            openView(CALENDAR_TAB_PATH);
          }}
          loadMarkedDates={loadMarkedDates}
          activeDailyDate={activeDailyDate}
          refreshToken={fileTreeVersion}
        />
      </aside>
      )}
      </div>

      {/* No clock here. The shell is shared, so everything it MOUNTS runs in
          every window — and since stage D it does not even run for every open
          vault, because only the vault a window SHOWS renders a shell. The
          reminder scheduler therefore lives in the runtime (VaultContext), one
          per open vault, where neither a second window nor a window looking
          elsewhere can double it or drop it. */}
      <StatusBar />

      {/* Lazy modal chunks (P2.9): mounted conditionally, so the Suspense
          fallback is never visible longer than the chunk download. */}
      <Suspense fallback={null}>
        {compareTarget && (
          <CompareModal
            subject={compareTarget}
            onClose={() => setCompareTarget(null)}
            onResolved={(outcome) => {
              setCompareTarget(null);
              closeTabsByPrefix(outcome.conflictPath);
              // The fork record follows its file (C36); the governance card re-reads.
              if (outcome.forkId) void discardLocalFork(outcome.forkId).catch(console.error);
              if (outcome.mergedContent !== null) {
                // Same adoption path as a version restore: the open editor
                // takes the merged text without re-dirtying or racing a save.
                window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: outcome.originalPath, content: outcome.mergedContent } }));
              }
              void (async () => {
                if (indexer) {
                  for (const p of outcome.touched) await indexer.indexPath(p).catch(console.error);
                }
                triggerFileTreeUpdate(outcome.touched);
              })();
            }}
          />
        )}
        {showDeletedFiles && <DeletedFilesModal onClose={() => setShowDeletedFiles(false)} />}
      </Suspense>
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={buildAppCommands({
            newItem: (kind, opts) => window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind, ...opts } })),
            openDailyNote: () => { void handleOpenDailyNote(new Date()); },
            newEvent: newHandlers.event,
            newTask: newHandlers.task,
            openQuickSwitcher: () => { setQuickSwitcherNewTab(false); setShowQuickSwitcher(true); },
            openTemplatePicker: () => setShowTemplatePicker(true),
            openGraph: () => openView(GRAPH_TAB_PATH),
            openTasks: () => openView(TASKS_TAB_PATH),
            openCalendar: () => openView(CALENDAR_TAB_PATH),
            openMail: () => openView(MAIL_TAB_PATH),
            openComments: () => openView(COMMENTS_TAB_PATH),
            openCommsWindow: vaultPath ? openCommsWindow : undefined,
            // Dispatched rather than called, so a client window travels the
            // listener above instead of needing a capability it does not have.
            openSecondWindow: vaultPath
              ? () => window.dispatchEvent(new CustomEvent("plainva-open-full-window"))
              : undefined,
            // Opens the vault line's menu: the switch and the new window sit
            // side by side there, and the palette is the door that does not
            // depend on the sidebar being visible.
            openVaultWindow: vaultPath ? () => setShowVaultMenu(true) : undefined,
            split: splitEditor,
            toggleLeftSidebar: () => setLeftCollapsed((c) => !c),
            toggleRightSidebar: () => toggleRightSidebar(),
            toggleFocusMode,
            toggleReadEdit,
            toggleSourceMode,
            renameActive: renameActiveNote,
            closeActiveTab,
            reopenClosedTab,
            openImport: () => capabilities.openImport(),
            toggleTheme: () => { void toggleLightDark(); },
            themeTogglePinned: () => isModePinned(document.documentElement.getAttribute("data-theme-name") || DEFAULT_THEME_NAME),
            openSettings: () => capabilities.openSettings(),
            openShortcuts: () => setShowShortcuts(true),
            openFindReplace: () => setShowFindReplace(true),
            activePath: () => activePath,
            showVersionHistory: (path) => setCompareTarget({ kind: "version", path }),
            backupNow: () => window.dispatchEvent(new CustomEvent("plainva-backup-now")),
            updateAllIndexes: () => window.dispatchEvent(new CustomEvent("plainva-update-all-indexes")),
            refreshVault: () => { void refreshVault(); },
            rebuildIndex: () => { void rebuildIndex(); },
            switchVault: () => capabilities.closeVault?.(),
            printActive: () => window.dispatchEvent(new CustomEvent("plainva-print-active")),
            hasActiveNote: () => activeDocument.get().kind === "markdown",
            exportActiveMarkdown: () => {
              const p = activePath;
              if (!p || !vaultAdapter) return;
              void import("./services/exportNote")
                .then(({ exportNoteAsMarkdown }) =>
                  // The export asks how annotations should travel, and only when
                  // the note has any (D10). The source is passed as functions so
                  // the lazy chunk never reaches into the vault context itself.
                  exportNoteAsMarkdown(vaultAdapter, p, {
                    listComments: (path) => listWorkspaceComments(path),
                    listNames: async () =>
                      new Map((await listWorkspaceMembers()).map((m) => [m.memberId, m.displayName])),
                  }),
                )
                .catch((e) => { console.error("[App] markdown export failed", e); toast.error(t("editor.exportFailed")); });
            },
            createTemplate: () => {
              if (!vaultAdapter || !vaultPath) return;
              void import("./services/templateActions")
                .then(async ({ createNewTemplate }) => {
                  const path = await createNewTemplate(vaultAdapter, vaultPath, t("database.newTemplateName", "Neue Vorlage"));
                  if (!path) return;
                  if (indexer) applyIndexChanges(indexer, { added: [path] }).then(() => triggerFileTreeUpdate()).catch(() => {});
                  openInFocusedPane(path, true);
                })
                .catch((e) => console.error("[App] creating a template failed", e));
            },
            saveActiveAsTemplate: () => {
              const p = activePath;
              if (!p || !vaultAdapter || !vaultPath) return;
              void import("./services/templateActions")
                .then(async ({ saveNoteAsTemplate }) => {
                  const saved = await saveNoteAsTemplate(vaultAdapter, vaultPath, p);
                  if (!saved) return;
                  if (indexer) applyIndexChanges(indexer, { added: [saved] }).then(() => triggerFileTreeUpdate()).catch(() => {});
                  toast.info(t("editor.templateSaved", { name: saved.split("/").pop() ?? saved }));
                })
                .catch((e) => console.error("[App] saving note as template failed", e));
            },
            // Mail-raus (stage 6): three SMTP-free ways out of the vault.
            copyNoteAsEmail: () => {
              const p = activePath;
              if (!p || !vaultAdapter) return;
              void (async () => {
                try {
                  const content = await vaultAdapter.readTextFile(p);
                  const { noteToClipboardFlavors } = await import("@plainva/ui/mail");
                  const flavors = noteToClipboardFlavors(stripFrontmatter(content));
                  await navigator.clipboard.write([
                    new ClipboardItem({
                      "text/html": new Blob([flavors.html], { type: "text/html" }),
                      "text/plain": new Blob([flavors.text], { type: "text/plain" }),
                    }),
                  ]);
                  toast.info(t("mail.copied", { defaultValue: "Formatierter Text kopiert — im Mail-Programm einfügen." }));
                } catch (e) {
                  console.error("[App] copy as email failed", e);
                }
              })();
            },
            sendNoteViaMailto: () => {
              const p = activePath;
              if (!p || !vaultAdapter) return;
              void (async () => {
                try {
                  const content = await vaultAdapter.readTextFile(p);
                  const [{ buildMailtoUrl }, { markdownToPlainText }, { openUrl }] = await Promise.all([
                    import("@plainva/ui/mail"),
                    import("@plainva/ui"),
                    import("@tauri-apps/plugin-opener"),
                  ]);
                  const title = (p.split("/").pop() ?? "").replace(/\.md$/i, "");
                  const res = buildMailtoUrl(title, markdownToPlainText(stripFrontmatter(content)), frontmatterToAddress(content) ?? "");
                  if (res.truncated) toast.info(t("mail.mailtoTruncated", { defaultValue: "Der Text wurde für mailto gekürzt." }));
                  await openUrl(res.url);
                } catch (e) {
                  console.error("[App] mailto failed", e);
                }
              })();
            },
            saveNoteAsMailDraft: () => {
              const p = activePath;
              if (!p || !vaultAdapter) return;
              void (async () => {
                try {
                  const content = await vaultAdapter.readTextFile(p);
                  const title = (p.split("/").pop() ?? "").replace(/\.md$/i, "");
                  setMailDraft({ subject: title, markdown: stripFrontmatter(content), to: frontmatterToAddress(content) ?? undefined });
                } catch (e) {
                  console.error("[App] draft prefill failed", e);
                }
              })();
            },
          })}
        />
      )}
      <Suspense fallback={null}>
        {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
        {mailDraft && (
          <Suspense fallback={null}>
            <MailDraftModal
              subject={mailDraft.subject}
              markdown={mailDraft.markdown}
              attachments={mailDraft.attachments}
              initialTo={mailDraft.to}
              onPopOut={vaultPath ? (snap) => void popOutCompose(vaultPath, snap) : undefined}
              onClose={() => setMailDraft(null)}
            />
          </Suspense>
        )}
        {showFindReplace && (
          <Suspense fallback={null}>
            <VaultFindReplaceModal onClose={() => setShowFindReplace(false)} onOpenPath={openInFocusedPane} />
          </Suspense>
        )}
      </Suspense>
      <CascadeDeleteHost onDeleted={handleCascadeDeleted} />
      <QuickSwitcher isOpen={showQuickSwitcher} onClose={() => { setShowQuickSwitcher(false); setQuickSwitcherNewTab(false); normalizeNow(); }} onOpenPath={(p) => openInFocusedPane(p, quickSwitcherNewTab)} recentPaths={recentPaths} />
      {tabMenu && (() => {
        // Everything the tab menu needs about the RIGHT-CLICKED tab (not the
        // active one — they differ whenever you right-click a background tab).
        const pane = layout.panes[tabMenu.paneIndex];
        const tab = pane?.tabs[tabMenu.tabIndex];
        const tabPath = tab ? tab.history[tab.historyIndex] : null;
        const isFile = !!tabPath && !isVirtualPath(tabPath);
        const isPinned = tab?.pinned === true;
        // "Left" is dead on the first tab, "right" on the last — shown disabled
        // rather than hidden, so the menu keeps a stable shape.
        const hasUnpinnedLeft = !!pane && pane.tabs.slice(0, tabMenu.tabIndex).some((tb) => !tb.pinned);
        const hasUnpinnedRight = !!pane && pane.tabs.slice(tabMenu.tabIndex + 1).some((tb) => !tb.pinned);
        return (
          <TabContextMenu
            x={tabMenu.x}
            y={tabMenu.y}
            onSplitVertical={() => splitEditorWithTab("vertical", tabMenu.paneIndex, tabMenu.tabIndex)}
            onSplitHorizontal={() => splitEditorWithTab("horizontal", tabMenu.paneIndex, tabMenu.tabIndex)}
            activeDirection={activeSplitDirection}
            onCloseTab={() => trackClose(tabMenu.paneIndex, tabMenu.tabIndex)}
            onClose={() => setTabMenu(null)}
            pinned={isPinned}
            onTogglePin={() => toggleTabPinned(tabMenu.paneIndex, tabMenu.tabIndex)}
            onReload={isFile ? () => window.dispatchEvent(new CustomEvent("plainva-reload-file", { detail: { path: tabPath } })) : undefined}
            onRevealInTree={isFile ? () => { parkTreeReveal(tabPath!); window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: tabPath } })); } : undefined}
            onCopyPath={isFile ? () => { void navigator.clipboard.writeText(tabPath!).then(() => toast.success(t("fileTree.pathCopied", { defaultValue: "Pfad kopiert" }))); } : undefined}
            onRename={isFile ? () => { selectTab(tabMenu.paneIndex, tabMenu.tabIndex); window.dispatchEvent(new CustomEvent("plainva-rename-active")); } : undefined}
            onToggleBookmark={isFile ? () => toggleBookmark(tabPath!) : undefined}
            isBookmarked={isFile ? bookmarks.includes(tabPath!) : false}
            onReopenClosed={() => reopenClosedTab()}
            canReopenClosed={closedTabCount > 0}
            onCloseOthers={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "others")}
            onCloseLeft={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "left")}
            onCloseRight={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "right")}
            onCloseAll={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "all")}
            canCloseLeft={hasUnpinnedLeft}
            canCloseRight={hasUnpinnedRight}
            onShowVersionHistory={isFile ? () => window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: tabPath } })) : undefined}
            // Not gated on `isFile`: a view is content too, and the calendar
            // was the one people most wanted on the second monitor (maintainer
            // finding 2026-08-23). Everything else in this menu stays file-only
            // because a view has no path to rename, bookmark or reveal.
            onOpenInNewWindow={tabPath ? () => openInNewWindow(tabPath) : undefined}
          />
        );
      })()}
      <TemplatePickerModal isOpen={showTemplatePicker} onClose={() => setShowTemplatePicker(false)} />
      {children}
    </div>
  );
}
