import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Folder, Settings, SquareArrowOutUpRight } from "lucide-react";
import { ICON, IconButton, MenuItem, MenuLabel, MenuSurface } from "@plainva/ui";
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
  // The line the menu hangs on. A press on it is the line's own — it is what
  // opens and closes the menu — and never a press beside the menu.
  const lineRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <div style={{ width: "100%", marginTop: "auto" }}>
      {/* The menu primitive, so that Escape, a press beside it and its layer
          are the ones every menu has. Drawn by hand it had none of them: it
          stayed open until its own line was pressed again. It opens over the
          line — there is no room under it — and is as wide as the line. */}
      <MenuSurface
        open={open && canSwitchHere}
        onClose={close}
        anchorRef={lineRef}
        matchAnchorWidth
        ariaLabel={t("sidebar.switchVault")}
      >
        <MenuLabel>{t("sidebar.recentVaults")}</MenuLabel>
        {(recentVaults ?? []).filter((p) => p !== vaultPath).slice(0, 5).map((path) => (
          <div key={path} style={{ display: "flex", alignItems: "center" }}>
            <MenuItem
              icon={<Folder size={ICON.ui} color="var(--accent-color)" />}
              onSelect={() => openVault?.(path)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {path.split(/[/\\]/).pop() || path}
            </MenuItem>
            {openVaultWindow && (
              <IconButton label={t("window.openVaultWindow")} onClick={() => { close(); openVaultWindow(path); }}>
                <SquareArrowOutUpRight size={ICON.ui} />
              </IconButton>
            )}
          </div>
        ))}
        <MenuItem icon={<Settings size={ICON.ui} />} onSelect={() => closeVault?.()}>
          {t("sidebar.switchVault")}
        </MenuItem>
      </MenuSurface>
      <div ref={lineRef} style={{
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
