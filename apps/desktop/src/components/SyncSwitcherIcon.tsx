import { useTranslation } from "react-i18next";
import { AlertTriangle, Cloud } from "lucide-react";
import { ICON } from "@plainva/ui";
import { useDisplaySyncStatus } from "../services/syncStatusStore";
import { useVault, type VaultSyncWorker } from "../contexts/VaultContext";

/**
 * Sync icon in the vault switcher, isolated as a leaf (2026-07-06 fix). It is
 * the only always-mounted consumer of the sync status: subscribing HERE means a
 * 15 s poll flip re-renders just this 16px icon, not the whole App tree (which
 * used to remount the read-mode Mermaid diagram and disturb the live caret).
 * The switcher keeps the calm cloud while syncing — only errors change the icon;
 * busy feedback lives in the status bar.
 *
 * It lives in its own file since the shell moved out of App (stage C0): the
 * shell draws the switcher, the central window owns the error dialog it opens.
 */
export function SyncSwitcherIcon({ syncWorker, onError }: { syncWorker: VaultSyncWorker; onError: () => void }) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const { status } = useDisplaySyncStatus(vaultPath);
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        if (status === 'error') onError();
        // Always also force a retry: unblocks stuck/backed-off ops and syncs now.
        syncWorker.retryFailed();
      }}
      data-tip={status === 'error' ? t("sync.error") : (status === 'syncing' ? t("sync.syncing") : t("sync.idle"))}
    >
      {status === "error"
        ? <AlertTriangle size={ICON.ui} color="var(--error-text)" />
        : <Cloud size={ICON.ui} color="var(--accent-color)" />}
    </div>
  );
}
