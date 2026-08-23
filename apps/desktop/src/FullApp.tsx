import { useCallback, useMemo } from "react";
import { AppShell } from "./AppShell";
import { getWindowBus } from "./services/windowBus";
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
 * - **Reporting open contents** — the dedup registry lives in the owner, and
 *   this window already reports its tabs through `window-contents`. Handing the
 *   owner a second, competing list would make it forget the first.
 */
export function FullApp() {
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

  const capabilities = useMemo<ShellCapabilities>(() => ({
    openSettings: (opts) => openOwnerSurface("settings", opts),
    openSyncError: () => openOwnerSurface("sync-error"),
    openImport: () => openOwnerSurface("import"),
    // Deliberately absent: reportOpenContents, closeVault, openVault,
    // recentVaults — see the note above.
  }), [openOwnerSurface]);

  return <AppShell capabilities={capabilities} />;
}
