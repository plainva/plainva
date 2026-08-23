import { useTranslation } from "react-i18next";
import { ChevronUp, Folder, Settings, SquareArrowOutUpRight } from "lucide-react";
import { ICON, IconButton } from "@plainva/ui";
import { SyncSwitcherIcon } from "./SyncSwitcherIcon";
import type { VaultSyncWorker } from "../contexts/VaultContext";

export interface VaultSwitcherProps {
  vaultPath: string | null;
  /** Null in a vault without a provider; the icon then shows a plain folder. */
  syncWorker: VaultSyncWorker | null;
  /** Recently opened vaults, offered as switch targets. */
  recentVaults?: readonly string[];
  /** Switch this window to another vault / go back to the chooser. */
  openVault?: (path: string) => void;
  closeVault?: () => void;
  /** Opens a known vault in a window of its own (stage D). */
  openVaultWindow?: (path: string) => void;
  onSyncError?: () => void;
  /** Controlled by the shell: another window can ask for this menu (C2). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The vault line at the foot of the left sidebar.
 *
 * Extracted from the shell for stage C6 because it is the one place in the
 * sidebar where a client window behaves DIFFERENTLY, and the automated harness
 * that drives the app never sees a second window — so this had no coverage at
 * all. Everything else in the sidebar renders the same in both.
 *
 * Since stage D there is no difference left to explain: several vaults can be
 * open at once, so a second window switches its own — the line behaves the same
 * in both. What differs is one level down: the central window RUNS the runtime
 * this window then reads through.
 */
export function VaultSwitcher({
  vaultPath,
  syncWorker,
  recentVaults,
  openVault,
  closeVault,
  openVaultWindow,
  onSyncError,
  open,
  onOpenChange,
}: VaultSwitcherProps) {
  const { t } = useTranslation();
  const setOpen = onOpenChange;
  const canSwitchHere = !!closeVault;

  return (
    <div style={{ position: "relative", width: "100%", marginTop: "auto" }}>
      {open && canSwitchHere && (
        <div className="pv-menu" style={{ position: "absolute", bottom: "100%", left: 0, width: "100%", marginBottom: "0.25rem", zIndex: "var(--z-menu)" }}>
          <div className="pv-menu-label">{t("sidebar.recentVaults")}</div>
          {(recentVaults ?? []).filter((p) => p !== vaultPath).slice(0, 5).map((path) => (
            <div key={path} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => { setOpen(false); openVault?.(path); }} className="pv-menu-item" style={{ flex: 1 }}>
                <Folder size={ICON.ui} color="var(--accent-color)" />
                <span className="pv-menu-text">{path.split(/[/\\]/).pop() || path}</span>
              </button>
              {openVaultWindow && (
                <IconButton label={t("window.openVaultWindow")} onClick={() => { setOpen(false); openVaultWindow(path); }}>
                  <SquareArrowOutUpRight size={ICON.ui} />
                </IconButton>
              )}
            </div>
          ))}
          <button onClick={() => { setOpen(false); closeVault?.(); }} className="pv-menu-item">
            <Settings size={ICON.ui} />
            <span className="pv-menu-text">{t("sidebar.switchVault")}</span>
          </button>
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "0.75rem 0.5rem", background: open ? "var(--bg-hover)" : "transparent",
      }}>
        <button
          onClick={canSwitchHere ? () => setOpen(!open) : undefined}
          aria-expanded={canSwitchHere ? open : undefined}
          aria-haspopup={canSwitchHere ? "true" : undefined}
          disabled={!canSwitchHere}
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem", overflow: "hidden",
            background: "transparent", border: "none", color: "var(--text-main)", cursor: "pointer", flex: 1, textAlign: "left",
          }}
        >
          {syncWorker ? (
            <SyncSwitcherIcon syncWorker={syncWorker} onError={onSyncError ?? (() => {})} />
          ) : (
            <Folder size={ICON.ui} color="var(--accent-color)" />
          )}
          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {vaultPath?.split(/[/\\]/).pop()}
          </span>
          {canSwitchHere && (
            <ChevronUp size={ICON.ui} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-2) var(--ease-1)", marginLeft: "auto", flexShrink: 0 }} />
          )}
        </button>
      </div>
    </div>
  );
}
