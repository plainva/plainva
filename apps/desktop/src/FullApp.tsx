import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, ICON } from "@plainva/ui";
import { FolderOpen } from "lucide-react";
import { AppShell } from "./AppShell";
import { useVault } from "./contexts/VaultContext";
import { useApp } from "./contexts/AppContext";
import { getWindowBus, type OwnerSurface } from "./services/windowBus";
import { routeOpenThroughOwner } from "./services/openRouting";
import { currentWindowParams } from "./services/windowContext";
import { composeWindowTitle, useOsWindowTitle } from "./services/windowTitle";
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
 * - **Runs across the whole vault** — the index.md sweep, the manual backup —
 *   same treatment, for a different reason: they belong to the window that
 *   holds the indexer and the schedulers (C2).
 * - Switching the vault is NOT on this list any more (stage D): several vaults
 *   can be open at once, so this window switches its own. What it still cannot
 *   do is CREATE one — scaffolding a vault writes a tree and touches the
 *   settings, which is the owner's job; the chooser below therefore offers the
 *   known vaults and a folder, not the full splash.
 * - **Deciding where content opens** — the owner knows every window, this one
 *   knows only itself. Every door into a pane asks first (C1).
 */
export function FullApp() {
  const label = currentWindowParams().label;
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const { openVault, closeVault, selectVault, recentVaults, heldVaults } = useApp();

  // A full window is a WORKPLACE, not a piece of content: its name is the vault
  // it shows. With a second vault open that is also what tells two of these
  // apart in the taskbar (stage D).
  useOsWindowTitle(composeWindowTitle({ vaultPath, vaultCount: heldVaults.length }));

  const openOwnerSurface = useCallback(
    (
      surface: OwnerSurface,
      opts?: { provider?: string; area?: string },
    ) => {
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
    deferToOwner: (run) => openOwnerSurface(run),
    // Present since stage D: this window's own vault line. The calls change
    // what THIS window shows; the runtime behind it is still the owner's.
    openVault: (path) => { void openVault(path); },
    closeVault: () => { void closeVault(); },
    recentVaults,
    openVaultWindow: (path) => {
      void (async () => {
        try {
          const bus = await getWindowBus();
          await bus.request("owner-surface", { surface: "new-window", vaultPath: path });
        } catch {
          /* no owner listening (browser/test) */
        }
      })();
    },
  }), [openOwnerSurface, reportOpenContents, label, openVault, closeVault, recentVaults]);

  // No vault here: offer the ones that are known, and a folder. Deliberately
  // not the splash — that one creates vaults, imports and sets up cloud
  // connections, all of which write and belong to the central window.
  if (!vaultPath) {
    return (
      <EmptyState title={t("window.noVaultTitle")} icon={<FolderOpen size={ICON.empty} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "center" }}>
          <span>{t("window.noVaultBody")}</span>
          {recentVaults.slice(0, 5).map((path) => (
            <Button key={path} variant="ghost" onClick={() => { void openVault(path); }}>
              {path.split(/[/\\]/).filter(Boolean).pop() ?? path}
            </Button>
          ))}
          <Button variant="primary" onClick={() => { void selectVault(); }}>{t("splash.openVault")}</Button>
        </div>
      </EmptyState>
    );
  }

  return <AppShell capabilities={capabilities} />;
}
