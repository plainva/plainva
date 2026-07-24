import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronLeft, Cloud, FileClock, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { mConfirm, mPrompt } from "./services/mobileDialogs";
import {
  getSyncStatus,
  pauseProvider,
  resumeProvider,
  restartSync,
  subscribeSyncStatus,
  syncNow,
} from "./services/syncService";
import { isMobileSettingsSyncEnabled, lockMobileEncryption, mobileEncryptionStatus, setMobileSettingsSyncEnabled, unlockMobileEncryption } from "./services/mobileSettingsSync";
import { reconnectVault } from "./services/oauthService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, type VaultEntry } from "./services/vaultRegistry";
import { deleteVault, switchVault, type MobileVault } from "./services/vaultService";
import { exportVault } from "./services/vaultExport";
import { DeletedFilesSheet } from "./components/DeletedFilesSheet";
import { Switch, toast } from "@plainva/ui";

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
  const [deleted, setDeleted] = useState(false);
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");

  useEffect(() => {
    void getVaultEntry(vaultId).then(setEntry);
    const reload = () => void getVaultEntry(vaultId).then(setEntry);
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [vaultId]);

  useEffect(() => {
    if (!isActive) return;
    const reload = () => {
      void isMobileSettingsSyncEnabled(vaultId).then(setSettingsSyncOn);
      void mobileEncryptionStatus(activeVault).then(setEncryption);
    };
    reload();
    window.addEventListener("m-encryption-locked", reload);
    return () => window.removeEventListener("m-encryption-locked", reload);
  }, [activeVault, isActive, vaultId]);

  if (!entry) return <div className="m-page" />;

  const name = entry.name || t("mobile.vaultLocal");
  const connected = isActive && status.status !== "off";

  const rename = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.vaultRenamePrompt"),
        initial: entry.name,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed) return;
      setBusy(true);
      await updateVault(vaultId, { name: trimmed }).finally(() => setBusy(false));
    })();
  };

  const remove = () => {
    void (async () => {
      const ok = await mConfirm({
        title: t("mobile.vaultDelete"),
        message: t("mobile.vaultDeleteConfirm", { name }),
        danger: true,
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      setBusy(true);
      await deleteVault(vaultId)
        .then(onBack)
        .finally(() => setBusy(false));
    })();
  };

  const statusLabel =
    status.status === "syncing"
      ? status.progress
        ? t("sync.syncingCount", { current: status.progress.current, total: status.progress.total })
        : t("mobile.syncSyncing")
      : status.status === "error"
        ? t("mobile.syncError")
        : status.status === "idle"
          ? t("mobile.syncIdle")
          : t("mobile.syncDisconnect");

  const rebuildIndex = () => {
    if (!activeVault.indexer) return;
    setBusy(true);
    void activeVault.indexer
      .indexVaultFull()
      .then(() => window.dispatchEvent(new CustomEvent("m-vault-changed")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
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
              <button className="m-btn" disabled={busy} onClick={() => syncNow()}>
                {t("mobile.syncNow")}
              </button>
            )}
          </div>
        )}
        {isActive && status.message && <p className="m-sync-error">{status.message}</p>}
        {isActive && status.errorKind === "pair-required" && (
          <button
            className="m-btn m-btn--tonal"
            onClick={() => window.dispatchEvent(new CustomEvent("m-open-security"))}
          >
            {t("workspaceSecurity.openSecurity", { defaultValue: "Open Security & Sharing" })}
          </button>
        )}
        {isActive && status.lastSyncAt !== null && (
          <p className="m-hint">
            {t("mobile.lastSync", {
              time: new Date(status.lastSyncAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        )}
        {isActive && entry.provider && <QueuePeek vault={activeVault} />}
        {isActive && entry.provider && (
          <>
            <p className="m-sectionlabel">{t("settingsSync.cardLabel")}</p>
            <div className="m-row m-row--static">
              <span>{t("settingsSync.toggleLabel")}</span>
              <Switch
                checked={settingsSyncOn}
                disabled={busy}
                label={t("settingsSync.toggleLabel")}
                onChange={(next) => {
                  setBusy(true);
                  void setMobileSettingsSyncEnabled(vaultId, next)
                    .then(() => restartSync(activeVault))
                    .then(() => setSettingsSyncOn(next))
                    .finally(() => setBusy(false));
                }}
              />
            </div>
            <p className="m-hint">{t("settingsSync.toggleDesc")}</p>
            {encryption === "locked" && (
              <button
                className="m-btn m-btn--filled"
                disabled={busy}
                onClick={() => {
                  void mPrompt({ title: t("encryption.modalUnlockTitle"), placeholder: t("encryption.passphrase"), secure: true }).then(async ({ value, cancelled }) => {
                    if (cancelled || !value) return;
                    setBusy(true);
                    try {
                      await unlockMobileEncryption(activeVault, value);
                      await restartSync(activeVault);
                      setEncryption("unlocked");
                    } catch {
                      toast.warning(t("encryption.wrongPassphrase"));
                    } finally {
                      setBusy(false);
                    }
                  });
                }}
              >
                {t("encryption.enterPassphrase")}
              </button>
            )}
            {encryption === "unlocked" && (
              <button className="m-btn m-btn--tonal" disabled={busy} onClick={() => void lockMobileEncryption(vaultId).then(() => restartSync(activeVault)).then(() => setEncryption("locked"))}>
                {t("encryption.lock")}
              </button>
            )}
          </>
        )}
        {isActive && status.errorHistory.length > 0 && (
          <>
            <p className="m-sectionlabel">{t("settings.syncErrorHistory")}</p>
            {status.errorHistory.map((e) => (
              <p className="m-hint" key={e.at}>
                {new Date(e.at).toLocaleTimeString()} · {e.message}
              </p>
            ))}
          </>
        )}

        <div className="m-sync-actions m-sync-actions--column">
          {!isActive && (
            <button className="m-btn m-btn--filled" disabled={busy} onClick={() => void switchVault(vaultId)}>
              <Check size={16} /> {t("mobile.vaultUse")}
            </button>
          )}
          {!isLocal && (
            <button className="m-btn m-btn--tonal" disabled={busy} onClick={rename}>
              <Pencil size={16} /> {t("mobile.vaultRename")}
            </button>
          )}
          {isActive && (
            <button
              className="m-btn m-btn--tonal"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void exportVault(activeVault, entry.name)
                  .catch(() => toast.warning(t("mobile.vaultExportFailed")))
                  .finally(() => setBusy(false));
              }}
            >
              <Upload size={16} /> {t("mobile.vaultExport")}
            </button>
          )}
          {isActive && (
            <button className="m-btn m-btn--tonal" disabled={busy} onClick={() => setDeleted(true)}>
              <FileClock size={16} /> {t("versions.deletedTitle")}
            </button>
          )}
          {entry.provider && !entry.paused && (
            <button
              className="m-btn m-btn--tonal"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void pauseProvider(vaultId).finally(() => setBusy(false));
              }}
            >
              {t("mobile.syncDisconnect")}
            </button>
          )}
          {entry.provider && entry.paused && (
            <button
              className="m-btn m-btn--filled"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void resumeProvider(vaultId).finally(() => setBusy(false));
              }}
            >
              {t("mobile.syncResume")}
            </button>
          )}
          {entry.provider && (entry.provider === "drive" || entry.provider === "onedrive" || entry.provider === "dropbox") && (
            <button
              className={status.status === "error" && isActive ? "m-btn m-btn--filled" : "m-btn m-btn--tonal"}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void reconnectVault(vaultId).finally(() => setBusy(false));
              }}
            >
              <Cloud size={16} /> {t("mobile.reconnectAction", { defaultValue: "Neu anmelden" })}
            </button>
          )}
          {isActive && activeVault.indexer && (
            <button className="m-btn m-btn--tonal" disabled={busy} onClick={rebuildIndex}>
              <RefreshCw size={16} /> {t("settings.rebuildIndexAction")}
            </button>
          )}
          {!isLocal && (
            <button className="m-btn m-btn--danger" disabled={busy} onClick={remove}>
              <Trash2 size={16} /> {t("mobile.vaultDelete")}
            </button>
          )}
        </div>
      </div>
      {deleted && <DeletedFilesSheet onClose={() => setDeleted(false)} vault={activeVault} />}
    </div>
  );
}

/** Pending sync queue peek (package I): oldest first, capped at five rows. */
function QueuePeek({ vault }: { vault: MobileVault }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [ops, setOps] = useState<Array<{ id: number; op_type: string; path: string }> | null>(null);
  useEffect(() => {
    let stale = false;
    const load = () => {
      if (!vault.syncQueue) return;
      void vault.syncQueue.getPendingOperations().then((list) => {
        if (!stale) setOps(list.slice(0, 5) as any);
      });
    };
    load();
    return () => {
      stale = true;
    };
    // Re-peek whenever a cycle settles.
  }, [vault, status.status, status.lastSyncAt]);
  if (!ops) return null;
  return (
    <>
      <p className="m-sectionlabel">{t("settings.syncQueue")}</p>
      {ops.length === 0 ? (
        <p className="m-hint">{t("settings.syncQueueEmpty")}</p>
      ) : (
        ops.map((op) => (
          <p className="m-hint" key={op.id}>
            {op.op_type} · {op.path}
          </p>
        ))
      )}
    </>
  );
}
