import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ICON, IconButton } from "@plainva/ui";
import { PanelRight } from "lucide-react";
import { RightSidebar, type SectionId } from "./components/RightSidebar";
import { windowStateKey } from "./services/windowContext";
import { AuxTitleBar } from "./components/AuxTitleBar";
import { AuxPane } from "./components/AuxPane";
import { PaneTabStrip } from "./components/PaneTabStrip";
import { useVault } from "./contexts/VaultContext";
import { usePaneLayout } from "./hooks/usePaneLayout";
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
  const { vaultAdapter, vaultPath, isLoading, error, fileTreeVersion } = useVault();
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
    openTab, openInFocusedPane, openInOtherPane, selectTab, closeTab, focusPane,
    splitEditorWithTab, moveTabTo, setSplitRatio,
  } = usePaneLayout({
    vaultPath,
    validatePath,
    // Each window keeps its own panes and tabs; the central window's key stays
    // untouched, so an existing layout survives the update.
    layoutScope: label,
  });

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
          onClose={(idx) => closeTab(0, idx)}
          onContextMenu={() => {}}
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
                      onClose={(idx) => closeTab(i, idx)}
                      onContextMenu={() => {}}
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
    </div>
  );
}
