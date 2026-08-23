import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppShell } from "./AppShell";
import { getWindowBus } from "./services/windowBus";
import { routeOpenThroughOwner } from "./services/openRouting";
import { currentWindowParams } from "./services/windowContext";
import type { ShellCapabilities } from "./shellCapabilities";

/**
 * A full second window (stage C).
 *
 * It renders the SAME shell the central window renders — sidebars, ribbon,
 * tabs, status bar — but in client mode: reads come from the local vault, every
 * write travels the window bus to the owner. Only the owner keeps the
 * background services, so "full" describes what this window DRAWS, never what
 * it runs.
 *
 * The list below is therefore the honest answer to "what can this window not
 * do?", in one place instead of scattered across thirty `if (owner)` branches:
 *
 * - **Settings, import, the sync-error dialog** — they start services and bind
 *   credentials. The buttons stay (a greyed-out gear explains nothing); they
 *   bring the central window forward and open the surface there.
 * - **Switching the vault** — one process, one open vault (plan E7). The
 *   switcher still NAMES the vault this window is looking at; it just does not
 *   offer to change it for everyone else.
 * - **Deciding where content opens** — the owner knows every window, this one
 *   knows only itself. Every door into a pane asks first (C1).
 */
export function FullApp() {
  const label = currentWindowParams().label;

  const openOwnerSurface = useCallback(
    (surface: "settings" | "import" | "sync-error", opts?: { provider?: string; area?: string }) => {
      void (async () => {
        try {
          const bus = await getWindowBus();
          await bus.request("owner-surface", { surface, ...opts });
        } catch (e) {
          console.warn("[FullApp] the central window did not answer", e);
        }
      })();
    },
    [],
  );

  /**
   * Debounced: the shell reports on every layout change, and this ends in a
   * write to the owner's stored window list. Dragging a tab across a split
   * would otherwise be a burst of them (same reason as in `AuxApp`).
   */
  const reportTimer = useRef<number | null>(null);
  const reportOpenContents = useCallback(
    (contents: readonly string[], active: string | null) => {
      if (!label) return;
      if (reportTimer.current !== null) window.clearTimeout(reportTimer.current);
      reportTimer.current = window.setTimeout(() => {
        void (async () => {
          try {
            const bus = await getWindowBus();
            await bus.request("window-contents", { label, active, contents: [...contents] });
          } catch {
            /* no owner listening (browser/test) */
          }
        })();
      }, 200);
    },
    [label],
  );
  useEffect(() => () => {
    if (reportTimer.current !== null) window.clearTimeout(reportTimer.current);
  }, []);

  const capabilities = useMemo<ShellCapabilities>(() => ({
    openSettings: (opts) => openOwnerSurface("settings", opts),
    openSyncError: () => openOwnerSurface("sync-error"),
    openImport: () => openOwnerSurface("import"),
    reportOpenContents,
    routeOpen: (path, openHere, opts) => routeOpenThroughOwner(path, openHere, { from: label, ...opts }),
    // Deliberately absent: closeVault, openVault, recentVaults — see the note
    // above (plan E7).
  }), [openOwnerSurface, reportOpenContents, label]);

  return <AppShell capabilities={capabilities} />;
}
