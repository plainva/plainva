import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";
import { AuxTitleBar } from "./components/AuxTitleBar";
import { useVault } from "./contexts/VaultContext";
import { currentWindowParams } from "./services/windowContext";
import { getWindowBus } from "./services/windowBus";

const Editor = lazy(() => import("./components/Editor").then((m) => ({ default: m.Editor })));
const BaseViewer = lazy(() => import("./components/BaseViewer").then((m) => ({ default: m.BaseViewer })));

/**
 * The shell of an auxiliary window (multi-window P0/P1).
 *
 * It renders the content it was opened with and nothing else: no ribbon, no
 * sidebars, no status bar, no settings. The vault behind it runs in client
 * mode — reads local, writes over the bus — so the editor here is the SAME
 * editor the central window uses, saving through the SAME chain. What differs
 * is only where the write is executed.
 *
 * Following a link stays in this window (a popped-out note behaves like a
 * small browser), unless the target is already open somewhere: content is open
 * once, app-wide, so the owner routes the request and this window only draws
 * what it is told to draw (plan E2).
 */
export function AuxApp() {
  const { t } = useTranslation();
  const params = currentWindowParams();
  const { vaultAdapter, isLoading, error } = useVault();
  const [path, setPath] = useState<string | null>(params.content);
  const label = params.label;

  const title = path ? path.split("/").pop() || path : "Plainva";

  // The OS title bar and the taskbar entry follow the content, not the window
  // it started with — after following a link the taskbar would otherwise still
  // show the note the window was popped out with.
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(`${title} — Plainva`);
      } catch {
        /* browser/test: no OS window to name */
      }
    })();
  }, [title]);

  /**
   * Where a click should land. The owner decides — it is the only participant
   * that knows every window and the central window's tabs.
   */
  const openPath = useCallback(
    (next: string) => {
      void (async () => {
        try {
          const bus = await getWindowBus();
          const result = await bus.request("open-content", { path: next, from: label ?? undefined });
          if (result.where === "caller") setPath(next);
        } catch (e) {
          // No bus (browser/test) or the owner did not answer: showing it here
          // is the honest fallback — worse than a duplicate is a dead click.
          console.warn("[AuxApp] could not route the open request", e);
          setPath(next);
        }
      })();
    },
    [label],
  );

  // The owner can hand this window different content (dedup routing, and the
  // window presets in P4).
  useEffect(() => {
    if (!label) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void getWindowBus()
      .then(async (bus) => {
        const un = await bus.onBroadcast("set-content", (payload) => {
          if (payload.label === label) setPath(payload.path);
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
  }, [label]);

  // Geometry belongs to the owner's window list so a restart can restore it
  // (P4/E5). Debounced: a drag fires continuously, and this ends in a write to
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

  const ready = !!vaultAdapter && !!path;
  const isBase = !!path && path.endsWith(".base");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)" }}>
      <AuxTitleBar title={title} />
      <main style={{ flex: 1, minHeight: 0, overflow: "hidden" }} data-testid="aux-content">
        {error && <EmptyState>{error}</EmptyState>}
        {!error && !path && <EmptyState>{t("editor.emptyPane")}</EmptyState>}
        {!error && path && !ready && isLoading && <EmptyState>{t("common.loading")}</EmptyState>}
        {!error && ready && (
          <Suspense fallback={<EmptyState>{t("common.loading")}</EmptyState>}>
            {isBase ? (
              <BaseViewer key={path} activePath={path} onOpenPath={(p) => openPath(p)} />
            ) : (
              <Editor key={path} activePath={path} onOpenPath={(p) => openPath(p)} />
            )}
          </Suspense>
        )}
      </main>
    </div>
  );
}
