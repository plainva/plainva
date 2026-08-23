import { useTranslation } from "react-i18next";
import { ChevronUp, Folder, Settings } from "lucide-react";
import { ICON } from "@plainva/ui";
import { SyncSwitcherIcon } from "./SyncSwitcherIcon";
import type { VaultSyncWorker } from "../contexts/VaultContext";

export interface VaultSwitcherProps {
  vaultPath: string | null;
  /** Null in a vault without a provider; the icon then shows a plain folder. */
  syncWorker: VaultSyncWorker | null;
  /** Recently opened vaults — owner only; a client never has this list. */
  recentVaults?: readonly string[];
  /** Owner only: switch to another vault / go back to the splash. */
  openVault?: (path: string) => void;
  closeVault?: () => void;
  /** Client only: ask the central window to show its switcher (stage C2). */
  deferToOwner?: () => void;
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
 * The difference is deliberately not a disabled control: one process holds one
 * open vault (plan E7), so a client cannot switch it — but a dead grey line
 * explains nothing. It asks the central window instead, which is exactly what
 * the palette entry does, so both doors end in the same place.
 */
export function VaultSwitcher({
  vaultPath,
  syncWorker,
  recentVaults,
  openVault,
  closeVault,
  deferToOwner,
  onSyncError,
  open,
  onOpenChange,
}: VaultSwitcherProps) {
  const { t } = useTranslation();
  const setOpen = onOpenChange;
  const canSwitchHere = !!closeVault;
  const interactive = canSwitchHere || !!deferToOwner;

  return (
    <div style={{ position: "relative", width: "100%", marginTop: "auto" }}>
      {open && canSwitchHere && (
        <div className="pv-menu" style={{ position: "absolute", bottom: "100%", left: 0, width: "100%", marginBottom: "0.25rem", zIndex: "var(--z-menu)" }}>
          <div className="pv-menu-label">{t("sidebar.recentVaults")}</div>
          {(recentVaults ?? []).filter((p) => p !== vaultPath).slice(0, 5).map((path) => (
            <button key={path} onClick={() => { setOpen(false); openVault?.(path); }} className="pv-menu-item">
              <Folder size={ICON.ui} color="var(--accent-color)" />
              <span className="pv-menu-text">{path.split(/[/\\]/).pop() || path}</span>
            </button>
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
          onClick={canSwitchHere ? () => setOpen(!open) : deferToOwner}
          aria-expanded={canSwitchHere ? open : undefined}
          aria-haspopup={canSwitchHere ? "true" : undefined}
          disabled={!interactive}
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
