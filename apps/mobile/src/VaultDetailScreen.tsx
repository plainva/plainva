import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronLeft, Cloud, FileClock, Lock, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { mConfirm, mPrompt, mSelect } from "./services/mobileDialogs";
import {
  canChangeRemoteFolder,
  changeRemoteFolder,
  getStoredProvider,
  getSyncStatus,
  listProviderFolders,
  pauseProvider,
  remoteFolderOf,
  resumeProvider,
  restartSync,
  subscribeSyncStatus,
  syncNow,
  type MobileSyncProvider,
} from "./services/syncService";
import { isMobilePassphraseEveryStart, isMobileSettingsSyncEnabled, lockMobileEncryption, mobileEncryptionStatus, setMobilePassphraseEveryStart, setMobileSettingsSyncEnabled, unlockMobileEncryption } from "./services/mobileSettingsSync";
import { reconnectVault } from "./services/oauthService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, type VaultEntry } from "./services/vaultRegistry";
import { deleteVault, switchVault, type MobileVault } from "./services/vaultService";
import { exportVault } from "./services/vaultExport";
import { DeletedFilesSheet } from "./components/DeletedFilesSheet";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { getMobileSettings, applyVaultSettings } from "./services/mobileSettings";
import { MIN_SYNC_INTERVAL_SECONDS } from "./services/mobileSettingsScope";
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
  /** H2b: passphrase re-entry after every start (desktop parity). */
  const [everyStart, setEveryStart] = useState(false);
  /** H2a: cycle interval, per vault and syncable (was hard-coded to 30 s). */
  const [interval, setIntervalSeconds] = useState(() => getMobileSettings().syncIntervalSeconds);
  /** H2d: change the remote folder of an existing connection. */
  const [folderPick, setFolderPick] = useState<MobileSyncProvider | null>(null);

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
      void isMobilePassphraseEveryStart(vaultId).then(setEveryStart);
      setIntervalSeconds(getMobileSettings().syncIntervalSeconds);
    };
    reload();
    window.addEventListener("m-encryption-locked", reload);
    window.addEventListener("m-settings-changed", reload);
    return () => {
      window.removeEventListener("m-encryption-locked", reload);
      window.removeEventListener("m-settings-changed", reload);
    };
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
            {entry.paused && <span className="m-badge-muted">{t("mobile.syncDisconnect")}</span>}
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
        {/* H2a: the cycle interval was hard-coded to 30 s on mobile while the
            desktop exposed it AND synced it in the profile — a value set there
            never arrived here. Same field, same lower bound, applied live. */}
        {isActive && entry.provider && (
          <>
            <button
              className="m-row"
              disabled={busy}
              onClick={() => {
                void mSelect({
                  title: t("settings.syncInterval"),
                  options: [15, 30, 60, 300, 900].map((seconds) => ({
                    value: String(seconds),
                    label: t("mobile.syncIntervalValue", { seconds }),
                  })),
                  value: String(interval),
                }).then(async (picked) => {
                  if (picked === null) return;
                  const seconds = Math.max(MIN_SYNC_INTERVAL_SECONDS, Number(picked));
                  setBusy(true);
                  try {
                    await applyVaultSettings(vaultId, { syncIntervalSeconds: seconds });
                    setIntervalSeconds(seconds);
                    await restartSync(activeVault); // the worker takes the interval at construction
                  } finally {
                    setBusy(false);
                  }
                });
              }}
            >
              <RefreshCw className="m-chevron" size={16} />
              <span className="m-linestack">
                {t("settings.syncInterval")}
                <small>{t("mobile.syncIntervalValue", { seconds: interval })}</small>
              </span>
            </button>
            <p className="m-hint">{t("settings.syncIntervalDesc", { min: MIN_SYNC_INTERVAL_SECONDS })}</p>
          </>
        )}
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
            {/* P6: the bare "Enter passphrase" / "Lock" button used to sit here
                with nothing explaining WHICH passphrase (it is NOT the encrypted
                workspace's), what it protects, or what locking does. Three
                states, each with the two sentences that answer that. */}
            {!settingsSyncOn && (
              <div className="m-card">
                <p><b>{t("settingsSync.offTitle")}</b></p>
                <p>{t("settingsSync.explainer")}</p>
              </div>
            )}
            {settingsSyncOn && (
              <p className="m-hint">{t("settingsSync.secretsNoteMobile")}</p>
            )}
            {settingsSyncOn && encryption === "locked" && (
              <div className="m-card">
                <span className="m-state m-state--warn">
                  <Lock size={12} />
                  {t("settingsSync.statePassphraseMissing")}
                </span>
                <p><b>{t("settingsSync.passphraseTitle")}</b></p>
                <p>{t("settingsSync.lockedBody")}</p>
                <button
                  className="m-btn m-btn--filled"
                  disabled={busy}
                  onClick={() => {
                    void mPrompt({ title: t("settingsSync.passphraseTitle"), placeholder: t("encryption.passphrase"), secure: true }).then(async ({ value, cancelled }) => {
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
              </div>
            )}
            {settingsSyncOn && encryption !== "none" && (
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("encryption.everyStart")}
                  <small>{t("encryption.everyStartDesc")}</small>
                </span>
                <Switch
                  checked={everyStart}
                  disabled={busy}
                  label={t("encryption.everyStart")}
                  onChange={(next) => {
                    setBusy(true);
                    void setMobilePassphraseEveryStart(vaultId, next)
                      .then(() => setEveryStart(next))
                      .then(() => mobileEncryptionStatus(activeVault))
                      .then(setEncryption)
                      .finally(() => setBusy(false));
                  }}
                />
              </div>
            )}
            {settingsSyncOn && encryption === "unlocked" && (
              <div className="m-card">
                <span className="m-state m-state--ok">
                  <Check size={12} />
                  {t("settingsSync.stateUnlocked")}
                </span>
                <p><b>{t("settingsSync.unlockedTitle")}</b></p>
                <p>{t("settingsSync.unlockedBody")}</p>
                <button className="m-btn m-btn--tonal" disabled={busy} onClick={() => void lockMobileEncryption(vaultId).then(() => restartSync(activeVault)).then(() => setEncryption("locked"))}>
                  {t("encryption.lock")}
                </button>
              </div>
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
          {/* H2d: the folder was only choosable while connecting; the desktop
              has had this on its sync page. Not offered for WebDAV, where the
              folder is baked into the base URL at connect time. */}
          {isActive && canChangeRemoteFolder(entry.provider) && (
            <button
              className="m-btn m-btn--tonal"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void getStoredProvider(vaultId)
                  .then((stored) => { if (stored) setFolderPick(stored); })
                  .finally(() => setBusy(false));
              }}
            >
              <Cloud size={16} /> {t("mobile.changeCloudFolder")}
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
      {folderPick && (
        <CloudFolderPickerSheet
          title={t("mobile.changeCloudFolder")}
          listFolders={(path) => listProviderFolders(folderPick, path)}
          onClose={() => setFolderPick(null)}
          onPick={(path) => {
            const target = path || remoteFolderOf(folderPick);
            setFolderPick(null);
            void mConfirm({
              title: t("mobile.changeCloudFolder"),
              message: t("mobile.changeCloudFolderConfirm", { folder: target || "/" }),
              confirmLabel: t("common.ok"),
            }).then(async (ok) => {
              if (!ok) return;
              setBusy(true);
              try {
                await changeRemoteFolder(activeVault, path);
              } catch (e) {
                toast.warning(String(e));
              } finally {
                setBusy(false);
              }
            });
          }}
        />
      )}
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
