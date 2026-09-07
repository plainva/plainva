import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ICON, IconButton, toast } from "@plainva/ui";
import { PanelRight } from "lucide-react";
import { RightSidebar, type SectionId } from "./components/RightSidebar";
import { windowStateKey } from "./services/windowContext";
import { AuxTitleBar } from "./components/AuxTitleBar";
import { AuxPane } from "./components/AuxPane";
import { PaneTabStrip } from "./components/PaneTabStrip";
import { TabContextMenu } from "./components/TabContextMenu";
import { TemplatePickerModal } from "./components/TemplatePickerModal";
import { isVirtualPath } from "./components/graph/virtualPaths";
import { useVault } from "./contexts/VaultContext";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { useAuxBridge } from "./hooks/useAuxBridge";
import { popOutCompose } from "./services/mail/composeWindow";
import { currentWindowParams } from "./services/windowContext";
import { composeWindowTitle, useOsWindowTitle } from "./services/windowTitle";
import { useApp } from "./contexts/AppContext";
import { virtualTabMeta } from "./components/graph/virtualPaths";
import { getWindowBus } from "./services/windowBus";
import { routeOpenThroughOwner } from "./services/openRouting";
import { PRESET_CONTENT } from "./services/windowManager";

/** Sections an auxiliary window may show (E5): everything note-bound, no calendar. */
const AUX_SECTIONS: readonly SectionId[] = ["outline", "graph", "databases", "backlinks", "properties"];
const AUX_RIGHT_WIDTH = 300;

const ComposeWindow = lazy(() => import("./components/mail/ComposeWindow").then((m) => ({ default: m.ComposeWindow })));
// The surfaces the aux bridge opens (finding 2026-09-07) — the same lazy
// chunks the central window mounts, loaded on first use.
const CompareModal = lazy(() => import("./components/CompareModal").then((m) => ({ default: m.CompareModal })));
const MailDraftModal = lazy(() => import("./components/mail/MailDraftModal").then((m) => ({ default: m.MailDraftModal })));

/**
 * The shell of an auxiliary window (multi-window P0/P1, panes since P4).
 *
 * It renders what it holds and nothing else: no ribbon, no sidebars, no status
 * bar, no settings. The vault behind it runs in client mode — reads local,
 * writes over the bus — so the editor here is the SAME editor the central
 * window uses, saving through the SAME chain. What differs is only where the
 * write is executed.
 *
 * Since P4 a window carries tabs and can be split, on the SAME `usePaneLayout`
 * the central window uses, scoped to this window's label. Following a link
 * stays in this window (a popped-out note behaves like a small browser),
 * unless the target is already open somewhere: content is open once, app-wide,
 * so the owner routes the request and this window only draws what it is told
 * to draw (plan E2).
 */
export function AuxApp() {
  const { heldVaults } = useApp();
  const { t } = useTranslation();
  const params = currentWindowParams();
  const { vaultAdapter, vaultPath, isLoading, error, fileTreeVersion, triggerFileTreeUpdate } = useVault();
  // Per window (multi-window C4 convention): whether the context sidebar is
  // open describes THIS window's view.
  const rightCollapsedKey = windowStateKey("plainva-aux-right-collapsed");
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(rightCollapsedKey) === "true"; } catch { return false; }
  });
  const toggleRightSidebar = useCallback(() => {
    setRightCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(rightCollapsedKey, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [rightCollapsedKey]);
  /** "Show properties" must be able to unfold the sidebar (the section expands itself). */
  const revealRightSidebar = useCallback(() => {
    setRightCollapsed(false);
    try { localStorage.setItem(rightCollapsedKey, "false"); } catch { /* storage unavailable */ }
  }, [rightCollapsedKey]);
  const label = params.label;

  const validatePath = useCallback(
    async (p: string) => {
      try {
        return vaultAdapter ? await vaultAdapter.exists(p) : false;
      } catch {
        return false;
      }
    },
    [vaultAdapter],
  );

  const {
    layout, splitRatio, activePath, isSplit, activeSplitDirection,
    openTab, openInFocusedPane, openInOtherPane, selectTab, closeTab, closeTabsBulk, closeTabsByPrefix, toggleTabPinned, focusPane,
    splitEditorWithTab, moveTabTo, setSplitRatio,
  } = usePaneLayout({
    vaultPath,
    validatePath,
    // Each window keeps its own panes and tabs; the central window's key stays
    // untouched, so an existing layout survives the update.
    layoutScope: label,
  });

  // What the shared components ask the shell for (finding 2026-09-07): the
  // version history, "reveal in tree", the note behind a link, the composer,
  // the template picker — answered here, from the table in services/auxBridge.
  const bridge = useAuxBridge({ label, openInFocusedPane, revealRightSidebar });

  // The tab menu (finding 2026-09-07): right-click on a tab used to be an empty
  // handler here. The closed-tab stack behind "reopen closed tab" is this
  // window's own, like its tabs.
  const [tabMenu, setTabMenu] = useState<{ paneIndex: number; tabIndex: number; x: number; y: number } | null>(null);
  const closedTabsRef = useRef<string[]>([]);
  const [closedTabCount, setClosedTabCount] = useState(0);
  const trackClose = useCallback((paneIndex: number, index: number) => {
    const tab = layout.panes[paneIndex]?.tabs[index];
    const path = tab?.history[tab.historyIndex];
    if (path) {
      closedTabsRef.current.push(path);
      if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      setClosedTabCount(closedTabsRef.current.length);
    }
    closeTab(paneIndex, index);
  }, [layout, closeTab]);
  const reopenClosedTab = useCallback(() => {
    const path = closedTabsRef.current.pop();
    setClosedTabCount(closedTabsRef.current.length);
    if (path) openInFocusedPane(path, true);
  }, [openInFocusedPane]);

  // Cmd/Ctrl+W (#86). The central window's key handler does not run here,
  // and a window without a close button of its own (macOS, before the
  // chrome fix) had no way out at all. With several tabs the key closes the
  // active one, as it does in the central window; the last tab, or a window
  // that has none (the composer), takes the window with it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "w") return;
      e.preventDefault();
      const tabCount = layout.panes.reduce((n, p) => n + p.tabs.length, 0);
      if (tabCount > 1) {
        const pane = layout.panes[layout.activePaneIndex];
        if (pane && pane.activeIndex >= 0) closeTab(layout.activePaneIndex, pane.activeIndex);
        return;
      }
      void import("@tauri-apps/api/window")
        .then((m) => m.getCurrentWindow().close())
        .catch(() => {
          /* browser/test: no OS window to close */
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, closeTab]);

  // What the window opened with, once the stored layout has had its say. A
  // window that was closed with three tabs comes back with three; a fresh one
  // starts with what it was popped out with, and a preset window starts split.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !vaultPath) return;
    if (layout.panes.some((p) => p.tabs.length > 0)) {
      setSeeded(true);
      return;
    }
    // The restore is async: wait for it before deciding the window is empty,
    // otherwise the seed lands first and the stored tabs replace it a moment
    // later — the window would visibly change under the user's hands.
    const id = window.setTimeout(() => {
      setSeeded(true);
      if (params.preset) {
        const [first, second] = PRESET_CONTENT[params.preset];
        openInFocusedPane(first, true);
        openInOtherPane(0, second);
        return;
      }
      if (params.content) openInFocusedPane(params.content, true);
    }, 120);
    return () => window.clearTimeout(id);
  }, [seeded, vaultPath, layout, params.content, params.preset, openInFocusedPane, openInOtherPane]);

  // A virtual view carries no file name: splitting "plainva://graph" on "/"
  // would name the window "graph" — the exact defect the recents strip had
  // before virtualTabMeta existed.
  // Until the layout is seeded there is no active path yet — but the window
  // already KNOWS what it was asked to show, and the URL says so. Falling back
  // to the request rather than to "Plainva" matters most where several windows
  // come up at once (restore on start, E5): a row of identical "Plainva"
  // taskbar entries that only sort themselves out a moment later is worse than
  // no titles at all. The named content wins as soon as it arrives.
  const shown = activePath || params.content || "";
  const meta = virtualTabMeta(shown);
  const title = meta
    ? t(meta.labelKey, meta.defaultLabel)
    : shown
      ? shown.split("/").pop() || shown
      : "Plainva";

  // The OS title bar and the taskbar entry follow the content, not the window
  // it started with — after following a link the taskbar would otherwise still
  // show the note the window was popped out with. Since stage D the vault joins
  // in as soon as a second one is open (see composeWindowTitle).
  //
  // A compose window keeps the title the owner gave it: the SUBJECT of the
  // message. Two composers in the taskbar are otherwise two entries called
  // "Plainva", and this window never learns a file name to replace it with.
  useOsWindowTitle(
    params.role === "compose"
      ? null
      : composeWindowTitle({ subject: title, vaultPath: params.vaultPath, vaultCount: heldVaults.length }),
  );

  /**
   * Where a click should land. The owner decides — it is the only participant
   * that knows every window and the central window's tabs.
   */
  const openPath = useCallback(
    (paneIndex: number, next: string) => {
      routeOpenThroughOwner(next, () => openTab(paneIndex, next, false), { from: label });
    },
    [label, openTab],
  );

  /**
   * The star in the graph. Bookmarks are OWNER state — its sidebar renders the
   * list — so this window asks rather than writing `.plainva/bookmarks.json`
   * from a list it never loaded: a blind write here would drop every bookmark
   * the owner knows about.
   */
  const toggleBookmark = useCallback((target: string) => {
    void (async () => {
      try {
        const bus = await getWindowBus();
        await bus.request("toggle-bookmark", { path: target });
      } catch (e) {
        console.warn("[AuxApp] could not toggle the bookmark", e);
      }
    })();
  }, []);

  // The owner can hand this window different content (dedup routing).
  useEffect(() => {
    if (!label) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void getWindowBus()
      .then(async (bus) => {
        const un = await bus.onBroadcast("set-content", (payload) => {
          if (payload.label === label && payload.path) openInFocusedPane(payload.path, true);
        });
        if (cancelled) un();
        else stop = un;
      })
      .catch(() => {
        /* single window: nothing to be told */
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [label, openInFocusedPane]);

  // Everything this window holds, so the owner can answer "is this note open
  // somewhere" for the whole app — with tabs, the active one is no longer the
  // whole truth (P4). Debounced: a tab switch is cheap, a localStorage write on
  // the other side is not.
  const contents = useMemo(
    () => layout.panes.flatMap((p) => p.tabs.map((tb) => tb.history[tb.historyIndex])),
    [layout],
  );
  useEffect(() => {
    if (!label) return;
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const bus = await getWindowBus();
          await bus.request("window-contents", { label, active: activePath, contents });
        } catch {
          /* no owner listening */
        }
      })();
    }, 200);
    return () => window.clearTimeout(id);
  }, [label, activePath, contents]);

  // Geometry belongs to the owner's window list so a restart can restore it
  // (E5). Debounced: a drag fires continuously, and this ends in a write to
  // localStorage on the other side.
  const boundsTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!label) return;
    let disposers: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const report = () => {
          if (boundsTimer.current) window.clearTimeout(boundsTimer.current);
          boundsTimer.current = window.setTimeout(() => {
            void (async () => {
              try {
                const pos = await win.outerPosition();
                const size = await win.outerSize();
                const bus = await getWindowBus();
                await bus.request("window-bounds", {
                  label,
                  bounds: { x: pos.x, y: pos.y, width: size.width, height: size.height },
                });
              } catch {
                /* the window is closing, or there is no owner listening */
              }
            })();
          }, 400);
        };
        const offMove = await win.onMoved(report);
        const offResize = await win.onResized(report);
        if (cancelled) {
          offMove();
          offResize();
        } else {
          disposers = [offMove, offResize];
        }
      } catch {
        /* browser/test */
      }
    })();
    return () => {
      cancelled = true;
      if (boundsTimer.current) window.clearTimeout(boundsTimer.current);
      for (const off of disposers) off();
    };
  }, [label]);

  // Dragging the divider between two panes — the central window's gesture,
  // with this window's ratio.
  const startPaneResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const host = (e.currentTarget as HTMLElement).parentElement;
      if (!host) return;
      const vertical = layout.direction === "vertical";
      const rect = host.getBoundingClientRect();
      const onMove = (ev: MouseEvent) => {
        const raw = vertical ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        setSplitRatio(raw);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [layout.direction, setSplitRatio],
  );

  // A compose window carries no vault content at all — it holds a message
  // someone is writing. It gets its own branch rather than a pseudo path,
  // because none of the content machinery above applies to it: no routing, no
  // dedup (writing two mails at once is ordinary), no title from a file name.
  if (params.role === "compose") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)" }}>
        <AuxTitleBar title={t("mail.composeTitle")} label={label} />
        <main style={{ flex: 1, minHeight: 0, overflow: "hidden" }} data-testid="aux-content">
          <Suspense fallback={<EmptyState>{t("common.loading")}</EmptyState>}>
            <ComposeWindow label={label} />
          </Suspense>
        </main>
      </div>
    );
  }

  const single = layout.panes[0];
  const activePaneIndex = layout.activePaneIndex;
  // The right-clicked tab, not the active one (they differ on a background
  // tab) — the central window's rule, same derivations.
  const menuPane = tabMenu ? layout.panes[tabMenu.paneIndex] : undefined;
  const menuTab = tabMenu && menuPane ? menuPane.tabs[tabMenu.tabIndex] : undefined;
  const menuTabPath = menuTab ? menuTab.history[menuTab.historyIndex] : null;
  const menuIsFile = !!menuTabPath && !isVirtualPath(menuTabPath);
  const menuHasUnpinnedLeft = !!tabMenu && !!menuPane && menuPane.tabs.slice(0, tabMenu.tabIndex).some((tb) => !tb.pinned);
  const menuHasUnpinnedRight = !!tabMenu && !!menuPane && menuPane.tabs.slice(tabMenu.tabIndex + 1).some((tb) => !tb.pinned);
  const rightSidebarToggle = (
    <IconButton
      label={t("titlebar.toggleRightSidebar")}
      size="sm"
      active={!rightCollapsed}
      data-testid="aux-right-toggle"
      onClick={toggleRightSidebar}
    >
      <PanelRight size={ICON.ui} />
    </IconButton>
  );
  // One row of chrome wherever possible: an unsplit window with several tabs
  // shows them IN the title bar. Split panes carry their own strips, because
  // one strip cannot say which pane a tab belongs to.
  const titleBarTabs =
    !isSplit && single && single.tabs.length > 1 ? (
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <PaneTabStrip
          paneIndex={0}
          tabs={single.tabs.map((tb) => tb.history[tb.historyIndex])}
          pinnedTabs={single.tabs.map((tb) => tb.pinned === true)}
          activeIndex={single.activeIndex}
          onSelect={(idx) => selectTab(0, idx)}
          onClose={(idx) => trackClose(0, idx)}
          onContextMenu={(idx, x, y) => setTabMenu({ paneIndex: 0, tabIndex: idx, x, y })}
          onMoveTab={moveTabTo}
        />
      </div>
    ) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)" }}>
      <AuxTitleBar title={title} tabs={titleBarTabs} label={label} actions={rightSidebarToggle} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: layout.direction === "vertical" ? "row" : "column",
          overflow: "hidden",
          background: "var(--canvas-bg)",
        }}
        data-testid="aux-content"
      >
        {error && <EmptyState>{error}</EmptyState>}
        {!error && !activePath && isLoading && <EmptyState>{t("common.loading")}</EmptyState>}
        {!error && !activePath && !isLoading && <EmptyState>{t("editor.emptyPane")}</EmptyState>}
        {!error &&
          !!vaultAdapter &&
          layout.panes.map((pane, i) => {
            const tab = pane.activeIndex >= 0 && pane.activeIndex < pane.tabs.length ? pane.tabs[pane.activeIndex] : null;
            const path = tab ? tab.history[tab.historyIndex] : null;
            if (!path) return null;
            const isActivePane = i === layout.activePaneIndex;
            const basis = i === 0 ? `${splitRatio * 100}%` : `${(1 - splitRatio) * 100}%`;
            return (
              <Fragment key={i}>
                {i > 0 && (
                  <div
                    onMouseDown={startPaneResize}
                    aria-hidden="true"
                    style={{
                      flex: "0 0 6px",
                      cursor: layout.direction === "vertical" ? "col-resize" : "row-resize",
                      background: "transparent",
                    }}
                  />
                )}
                <section
                  aria-label={t("editor.pane", { defaultValue: "Editor-Bereich" })}
                  data-testid={`aux-pane-${i}`}
                  onMouseDownCapture={() => focusPane(i)}
                  style={{
                    ...(isSplit ? { flexGrow: 0, flexShrink: 1, flexBasis: basis } : { flex: 1 }),
                    minWidth: 0,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    background: "var(--bg-primary)",
                    overflow: "hidden",
                    border: `1px solid ${isSplit && isActivePane ? "color-mix(in srgb, var(--accent-color) 55%, var(--border-color))" : "transparent"}`,
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
                  <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <AuxPane
                      path={path}
                      isActivePane={isActivePane}
                      onOpenPath={(p) => openPath(i, p)}
                      onOpenInSplit={(p) => openInOtherPane(i, p)}
                      onToggleBookmark={toggleBookmark}
                      activeSplitDirection={activeSplitDirection}
                    />
                  </div>
                </section>
              </Fragment>
            );
          })}
      </main>
      {/* The note-bound context of what this window shows (finding 2026-09-01,
          D4): outline, graph, databases, backlinks, properties. The calendar
          stays with the central window — it needs the owner's services (E5).
          Read-only client services carry everything these sections ask for. */}
      {!rightCollapsed && !error && !!vaultAdapter && (
        <aside
          aria-label="Right Sidebar"
          data-testid="aux-right-sidebar"
          style={{ width: `${AUX_RIGHT_WIDTH}px`, flexShrink: 0, borderLeft: "1px solid var(--border-color-light)", background: "var(--bg-secondary)" }}
        >
          <RightSidebar
            sections={AUX_SECTIONS}
            activePath={activePath}
            onOpenPath={(p) => openPath(activePaneIndex, p)}
            onOpenPathInSplit={(p) => openInOtherPane(activePaneIndex, p)}
            onSelectDate={() => {}}
            loadMarkedDates={async () => new Set<string>()}
            refreshToken={fileTreeVersion}
          />
        </aside>
      )}
      </div>

      {/* What the aux bridge opens (finding 2026-09-07): the comparison surface
          (version history, conflict), the floating composer, the template
          picker — the same components the central window mounts. A restore or
          a resolved conflict writes through the client adapter, so the owner
          indexes it; this window only re-reads its own views. */}
      <Suspense fallback={null}>
        {bridge.compareTarget && (
          <CompareModal
            subject={bridge.compareTarget}
            onClose={bridge.closeCompare}
            onResolved={(outcome) => {
              bridge.closeCompare();
              closeTabsByPrefix(outcome.conflictPath);
              if (outcome.mergedContent !== null) {
                // Same adoption path as a version restore: the open editor
                // takes the merged text without re-dirtying or racing a save.
                window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: outcome.originalPath, content: outcome.mergedContent } }));
              }
              triggerFileTreeUpdate(outcome.touched);
            }}
          />
        )}
        {bridge.mailDraft && vaultPath && (
          <MailDraftModal
            subject={bridge.mailDraft.subject}
            markdown={bridge.mailDraft.markdown}
            attachments={bridge.mailDraft.attachments}
            initialTo={bridge.mailDraft.to}
            onPopOut={(snap) => void popOutCompose(vaultPath, snap)}
            onClose={bridge.closeMailDraft}
          />
        )}
      </Suspense>
      <TemplatePickerModal isOpen={bridge.templatePickerOpen} onClose={bridge.closeTemplatePicker} />
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onSplitVertical={() => splitEditorWithTab("vertical", tabMenu.paneIndex, tabMenu.tabIndex)}
          onSplitHorizontal={() => splitEditorWithTab("horizontal", tabMenu.paneIndex, tabMenu.tabIndex)}
          activeDirection={activeSplitDirection}
          onCloseTab={() => trackClose(tabMenu.paneIndex, tabMenu.tabIndex)}
          onClose={() => setTabMenu(null)}
          pinned={menuTab?.pinned === true}
          onTogglePin={() => toggleTabPinned(tabMenu.paneIndex, tabMenu.tabIndex)}
          onReload={menuIsFile ? () => window.dispatchEvent(new CustomEvent("plainva-reload-file", { detail: { path: menuTabPath } })) : undefined}
          onRevealInTree={menuIsFile ? () => window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: menuTabPath } })) : undefined}
          onCopyPath={menuIsFile ? () => { void navigator.clipboard.writeText(menuTabPath!).then(() => toast.success(t("fileTree.pathCopied", { defaultValue: "Pfad kopiert" }))); } : undefined}
          onRename={menuIsFile ? () => { selectTab(tabMenu.paneIndex, tabMenu.tabIndex); window.dispatchEvent(new CustomEvent("plainva-rename-active")); } : undefined}
          onToggleBookmark={menuIsFile ? () => toggleBookmark(menuTabPath!) : undefined}
          onReopenClosed={reopenClosedTab}
          canReopenClosed={closedTabCount > 0}
          onCloseOthers={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "others")}
          onCloseLeft={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "left")}
          onCloseRight={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "right")}
          onCloseAll={() => closeTabsBulk(tabMenu.paneIndex, tabMenu.tabIndex, "all")}
          canCloseLeft={menuHasUnpinnedLeft}
          canCloseRight={menuHasUnpinnedRight}
          onShowVersionHistory={menuIsFile ? () => window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: menuTabPath } })) : undefined}
          // No "open in new window": the tab IS in one. Going back into the
          // central window is a different command (Sammelplan § 3.21).
        />
      )}
    </div>
  );
}
