import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@capacitor/dialog";
import { AlertTriangle, Check, ChevronLeft, Cloud, Pencil, Trash2 } from "lucide-react";
import { Button } from "@plainva/ui";
import {
  getSyncStatus,
  pauseProvider,
  resumeProvider,
  subscribeSyncStatus,
  syncNow,
} from "./services/syncService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, type VaultEntry } from "./services/vaultRegistry";
import { deleteVault, switchVault, type MobileVault } from "./services/vaultService";

const PROVIDER_LABELS: Record<string, string> = {
  webdav: "WebDAV / Nextcloud",
  s3: "S3",
  drive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
};

/**
 * Per-vault management screen (M3.6): use/rename/pause/resume/delete live
 * HERE, on the vault itself (maintainer feedback — not on a global sync
 * page). "Trennen" pauses sync but keeps the stored credentials, so
 * "Wieder verbinden" is one tap; deleting removes the device-local
 * container, database and credentials — never the cloud storage.
 */
export function VaultDetailScreen({
  vaultId,
  activeVault,
  onBack,
}: {
  vaultId: string;
  activeVault: MobileVault;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const isLocal = vaultId === LOCAL_VAULT_ID;
  const isActive = activeVault.vaultId === vaultId;

  useEffect(() => {
    void getVaultEntry(vaultId).then(setEntry);
    const reload = () => void getVaultEntry(vaultId).then(setEntry);
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [vaultId]);

  if (!entry) return <div className="m-page" />;

  const name = entry.name || t("mobile.vaultLocal");
  const connected = isActive && status.status !== "off";

  // window.confirm/prompt return false/null unanswered in the Capacitor 8
  // WebView — the Dialog plugin shows real native dialogs instead.
  const rename = () => {
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.vaultRenamePrompt"),
        inputText: entry.name,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed) return;
      setBusy(true);
      await updateVault(vaultId, { name: trimmed }).finally(() => setBusy(false));
    })();
  };

  const remove = () => {
    void (async () => {
      const { value } = await Dialog.confirm({
        title: t("mobile.vaultDelete"),
        message: t("mobile.vaultDeleteConfirm", { name }),
      });
      if (!value) return;
      setBusy(true);
      await deleteVault(vaultId)
        .then(onBack)
        .finally(() => setBusy(false));
    })();
  };

  const statusLabel =
    status.status === "syncing"
      ? t("mobile.syncSyncing")
      : status.status === "error"
        ? t("mobile.syncError")
        : status.status === "idle"
          ? t("mobile.syncIdle")
          : t("mobile.syncDisconnect");

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{name}</h1>
      </header>

      <div className="m-sync">
        {entry.provider && (
          <div className="m-row m-row--static">
            <span>{PROVIDER_LABELS[entry.provider] ?? entry.provider}</span>
            {entry.paused && <span className="m-soon">{t("mobile.syncDisconnect")}</span>}
          </div>
        )}

        {isActive && entry.provider && !entry.paused && (
          <div className="m-row m-row--static">
            <span className="m-sync-status">
              {status.status === "error" ? (
                <AlertTriangle className="m-error" size={16} />
              ) : (
                <Cloud className={connected ? "m-accent" : "m-chevron"} size={16} />
              )}
              {statusLabel}
            </span>
            {connected && (
              <Button disabled={busy} onClick={() => syncNow()} size="sm" variant="ghost">
                {t("mobile.syncNow")}
              </Button>
            )}
          </div>
        )}
        {isActive && status.message && <p className="m-sync-error">{status.message}</p>}

        <div className="m-sync-actions m-sync-actions--column">
          {!isActive && (
            <Button disabled={busy} onClick={() => void switchVault(vaultId)} variant="primary">
              <Check size={16} /> {t("mobile.vaultUse")}
            </Button>
          )}
          {!isLocal && (
            <Button disabled={busy} onClick={rename}>
              <Pencil size={16} /> {t("mobile.vaultRename")}
            </Button>
          )}
          {entry.provider && !entry.paused && (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void pauseProvider(vaultId).finally(() => setBusy(false));
              }}
            >
              {t("mobile.syncDisconnect")}
            </Button>
          )}
          {entry.provider && entry.paused && (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void resumeProvider(vaultId).finally(() => setBusy(false));
              }}
              variant="primary"
            >
              {t("mobile.syncResume")}
            </Button>
          )}
          {!isLocal && (
            <Button className="m-danger" disabled={busy} onClick={remove}>
              <Trash2 size={16} /> {t("mobile.vaultDelete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
