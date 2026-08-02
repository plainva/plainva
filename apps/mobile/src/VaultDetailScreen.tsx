import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronLeft, Cloud, FileClock, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
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
import { SYNC_DIAGNOSTICS_EVENT, loadSyncDiagnostics, isMobilePassphraseEveryStart, isMobileSecretsSyncEnabled, isMobileSettingsSyncEnabled, lockMobileEncryption, mobileEncryptionStatus, setMobilePassphraseEveryStart, setMobileSecretsSyncEnabled, setMobileSettingsSyncEnabled, unlockMobileEncryption } from "./services/mobileSettingsSync";
import { reconnectVault } from "./services/oauthService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, type VaultEntry } from "./services/vaultRegistry";
import { deleteVault, switchVault, type MobileVault } from "./services/vaultService";
import { exportVault } from "./services/vaultExport";
import { DeletedFilesSheet } from "./components/DeletedFilesSheet";
import { EncryptionSetupSheet } from "./components/EncryptionSetupSheet";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { getMobileSettings, applyVaultSettings } from "./services/mobileSettings";
import { MIN_SYNC_INTERVAL_SECONDS } from "./services/mobileSettingsScope";
import { Banner, Button, deviceStateKey, diagnosticsState, emptyDiagnostics, IconButton, Switch, type SyncDiagnostics, toast, travellingAreas } from "@plainva/ui";

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
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  /** H2c: sign-in secrets — its own opt-in, and only while unlocked. */
  const [secretsSyncOn, setSecretsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");
  /** H2b: passphrase re-entry after every start (desktop parity). */
  const [everyStart, setEveryStart] = useState(false);
  /** H2a: cycle interval, per vault and syncable (was hard-coded to 30 s). */
  const [interval, setIntervalSeconds] = useState(() => getMobileSettings().syncIntervalSeconds);
  /** H2d: change the remote folder of an existing connection. */
  const [folderPick, setFolderPick] = useState<MobileSyncProvider | null>(null);
  /** What the settings sync last did here (P1/S10) — a report, not a control. */
  const [diag, setDiag] = useState<SyncDiagnostics>(emptyDiagnostics());

  useEffect(() => {
    void getVaultEntry(vaultId).then(setEntry);
    const reload = () => void getVaultEntry(vaultId).then(setEntry);
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [vaultId]);

  // Re-read on the event rather than poll: the record changes on a sync cycle,
  // which nobody sits watching this screen for.
  useEffect(() => {
    let alive = true;
    const read = () => void loadSyncDiagnostics(vaultId).then((d) => { if (alive) setDiag(d); });
    read();
    window.addEventListener(SYNC_DIAGNOSTICS_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(SYNC_DIAGNOSTICS_EVENT, read);
    };
  }, [vaultId]);

  useEffect(() => {
    if (!isActive) return;
    const reload = () => {
      void isMobileSettingsSyncEnabled(vaultId).then(setSettingsSyncOn);
      void isMobileSecretsSyncEnabled(vaultId).then(setSecretsSyncOn);
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
        <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
          <ChevronLeft size={20} />
        </IconButton>
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
              <Button variant="ghost" disabled={busy} onClick={() => syncNow()}>
                {t("mobile.syncNow")}
              </Button>
            )}
          </div>
        )}
        {isActive && status.message && <Banner kind="error" rounded>{status.message}</Banner>}
        {isActive && status.errorKind === "pair-required" && (
          <Button variant="tonal" onClick={() => window.dispatchEvent(new CustomEvent("m-open-security"))}>
            {t("workspaceSecurity.openSecurity", { defaultValue: "Open Security & Sharing" })}
          </Button>
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
            {/* Same chain as the desktop, same order (plan P5, corrected):
                syncing settings and accounts needs NO passphrase — only
                carrying sign-ins does. So the passphrase sits BETWEEN them. */}
            <p className="m-sectionlabel">{t("settingsSync.chainLabel")}</p>
            <p className="m-hint">{t("settingsSync.chainIntro")}</p>

            <div className="m-chain">
              {/* Sealed: another device set a passphrase, so the profile in the
                  vault is encrypted and this device cannot read or write it
                  until it unlocks. The switch stays on — nothing is wrong with
                  it — but the step must not claim to be running. */}
              <div className={`m-chain-step ${settingsSyncOn && encryption === "locked" ? "is-todo" : settingsSyncOn ? "is-done" : "is-todo"}`}>
                <div className="m-chain-node">{settingsSyncOn && encryption !== "locked" ? "✓" : settingsSyncOn ? "!" : "1"}</div>
                <div className="m-chain-body">
                  <div className="m-chain-head">
                    <span className="m-chain-title">
                      {t("settingsSync.step1")}
                      {settingsSyncOn && encryption === "locked" && (
                        <span className="m-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>
                      )}
                    </span>
                    <Switch
                      checked={settingsSyncOn}
                      disabled={busy}
                      label={t("settingsSync.step1")}
                      onChange={(next) => {
                        setBusy(true);
                        void setMobileSettingsSyncEnabled(vaultId, next)
                          .then(() => restartSync(activeVault))
                          .then(() => setSettingsSyncOn(next))
                          .finally(() => setBusy(false));
                      }}
                    />
                  </div>
                  <p className="m-chain-desc">
                    {settingsSyncOn && encryption === "locked" ? t("settingsSync.step1Sealed") : t("settingsSync.step1Desc")}
                  </p>
                  {/* Generated from the shared field catalog, like the desktop.
                      The phone carries fewer areas than the desktop does, and a
                      chip list that claims otherwise is worse than none. */}
                  <div className="m-chain-carries">
                    {travellingAreas("mobile").map((area) => (
                      <span className="m-chain-chip" key={area}>{t(`settingsSync.area_${area}`)}</span>
                    ))}
                    <span className="m-chain-chip is-excluded">{t("settingsSync.chipPasswords")}</span>
                  </div>
                </div>
              </div>

              {/* Optional, and independent of step 1 — it exists for step 3. */}
              <div className={`m-chain-step ${encryption === "unlocked" ? "is-done" : ""}`}>
                <div className="m-chain-node">{encryption === "unlocked" ? "✓" : "2"}</div>
                <div className="m-chain-body">
                  <div className="m-chain-head">
                    <span className="m-chain-title">
                      {t("settingsSync.step2")}
                      {encryption !== "unlocked" && <span className="m-chain-chip">{t("settingsSync.step2Optional")}</span>}
                    </span>
                  </div>
                  <p className="m-chain-desc">
                    {encryption === "unlocked" ? t("settingsSync.unlockedBody") : t("settingsSync.step2Desc")}
                  </p>
                  {encryption === "none" && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setSetupOpen(true)}
                      data-testid="encryption-setup-open"
                    >
                      {t("encryption.setPassphrase")}
                    </Button>
                  )}
                  {encryption === "locked" && (
                    <Button
                      variant="primary"
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
                    </Button>
                  )}
                  {encryption === "unlocked" && (
                    <Button
                      variant="tonal"
                      disabled={busy}
                      onClick={() => void lockMobileEncryption(vaultId).then(() => restartSync(activeVault)).then(() => setEncryption("locked"))}
                    >
                      {t("encryption.lock")}
                    </Button>
                  )}
                  {encryption !== "none" && (
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
                </div>
              </div>

              {/* Needs BOTH: the accounts from step 1 and the key from step 2. */}
              <div className={`m-chain-step ${secretsSyncOn && settingsSyncOn ? "is-done" : !settingsSyncOn || encryption !== "unlocked" ? "is-locked" : ""}`}>
                <div className="m-chain-node">{secretsSyncOn && settingsSyncOn ? "✓" : "3"}</div>
                <div className="m-chain-body">
                  <div className="m-chain-head">
                    <span className="m-chain-title">
                      {t("settingsSync.step3")}
                      {!settingsSyncOn && <span className="m-chain-chip is-excluded">{t("settingsSync.needsStep1")}</span>}
                      {settingsSyncOn && encryption !== "unlocked" && <span className="m-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>}
                    </span>
                    <Switch
                      checked={secretsSyncOn && settingsSyncOn && encryption === "unlocked"}
                      disabled={busy || !settingsSyncOn || encryption !== "unlocked"}
                      label={t("settingsSync.step3")}
                      onChange={(next) => {
                        setBusy(true);
                        void setMobileSecretsSyncEnabled(vaultId, next)
                          .then(() => restartSync(activeVault))
                          .then(() => setSecretsSyncOn(next))
                          .finally(() => setBusy(false));
                      }}
                    />
                  </div>
                  <p className="m-chain-desc">
                    {!settingsSyncOn ? t("settingsSync.needsStep1Body") : t("settingsSync.step3Desc")}
                  </p>
                  {settingsSyncOn && <p className="m-chain-desc">{t("settingsSync.oauthNote")}</p>}
                </div>
              </div>
            </div>

            {settingsSyncOn && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  toast.info(t("settingsSync.pullStarted"));
                  void syncNow();
                }}
              >
                {t("settingsSync.pullNow")}
              </Button>
            )}

            {/* The same statement as on the desktop: which of the three silent
                states this device is in, and what actually moved. */}
            <p className="m-sectionlabel">{t("settingsSync.diagTitle")}</p>
            <div className="m-card">
              <p className="m-hint" data-testid="sync-diag-state">
                {t(deviceStateKey(diagnosticsState(diag, {
                  enabled: settingsSyncOn,
                  encrypted: encryption !== "none",
                  unlocked: encryption === "unlocked",
                })))}
              </p>
              {/* With the field NAMES, same as the desktop: a count cannot tell
                  a working sync from one that re-publishes the same setting. */}
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("settingsSync.diagLastCheck")}
                  <small>
                    {diag.lastCheck
                      ? `${new Date(diag.lastCheck.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastCheck.fields}`
                      : t("settingsSync.diagNever")}
                  </small>
                  {diag.lastCheck?.names?.length ? <small>{diag.lastCheck.names.join(", ")}</small> : null}
                </span>
              </div>
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("settingsSync.diagLastDownload")}
                  <small>
                    {diag.lastDownload
                      ? `${new Date(diag.lastDownload.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastDownload.fields}`
                        + (diag.lastDownload.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastDownload.deviceId })}` : "")
                      : t("settingsSync.diagNever")}
                  </small>
                  {diag.lastDownload?.names?.length ? <small>{diag.lastDownload.names.join(", ")}</small> : null}
                </span>
              </div>
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("settingsSync.diagLastApply")}
                  <small>
                    {diag.lastApply
                      ? `${new Date(diag.lastApply.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastApply.fields}`
                        + (diag.lastApply.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastApply.deviceId })}` : "")
                      : t("settingsSync.diagNever")}
                  </small>
                  {diag.lastApply?.names?.length ? (
                    <small>{t("settingsSync.diagChanged")}: {diag.lastApply.names.join(", ")}</small>
                  ) : null}
                </span>
              </div>
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("settingsSync.diagLastUpload")}
                  <small>
                    {diag.lastUpload
                      ? `${new Date(diag.lastUpload.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastUpload.fields}`
                      : t("settingsSync.diagNever")}
                  </small>
                  {diag.lastUpload?.names?.length ? <small>{diag.lastUpload.names.join(", ")}</small> : null}
                </span>
              </div>
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("settingsSync.diagSecretResult")}
                  <small>{diag.lastSecrets ? new Date(diag.lastSecrets.at).toLocaleString() : t("settingsSync.diagNever")}</small>
                  {diag.lastSecrets ? (
                    <>
                      <small>
                        {t("settingsSync.diagSecretImported")}: {diag.lastSecrets.imported}
                        {" · "}{t("settingsSync.diagSecretUnchanged")}: {diag.lastSecrets.unchanged}
                        {" · "}{t("settingsSync.diagSecretRejected")}: {diag.lastSecrets.rejected}
                        {" · "}{t("settingsSync.diagSecretStale")}: {diag.lastSecrets.stale}
                        {" · "}{t("settingsSync.diagSecretErrors")}: {diag.lastSecrets.errors}
                        {" · "}{t("settingsSync.diagSecretWaiting")}: {diag.lastSecrets.waiting}
                      </small>
                      {diag.lastSecrets.reasons.length > 0 ? (
                        <small>{t("settingsSync.diagReasons")}: {diag.lastSecrets.reasons.map((item) => `${item.reason} (${item.count})`).join(", ")}</small>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </div>
              {diag.previousClientActivity && (
                <p className="m-hint">{t("settingsSync.diagPreviousActivity")}</p>
              )}
              {diag.legacyClient && (
                <Banner kind="warning" rounded>{t("settingsSync.legacyPublisherUpgrade")}</Banner>
              )}
              {diag.skipped && (
                <Banner kind="warning" rounded>{t("settingsSync.diagRefused")}: {diag.skipped.reasons.join("; ")}</Banner>
              )}
              {diag.lastError && (
                <Banner kind="warning" rounded>{t("settingsSync.diagError", { error: diag.lastError.message })}</Banner>
              )}
              <p className="m-hint">{t("settingsSync.diagStays")}</p>
            </div>
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
            <Button variant="primary" disabled={busy} onClick={() => void switchVault(vaultId)}>
              <Check size={16} /> {t("mobile.vaultUse")}
            </Button>
          )}
          {!isLocal && (
            <Button variant="tonal" disabled={busy} onClick={rename}>
              <Pencil size={16} /> {t("mobile.vaultRename")}
            </Button>
          )}
          {isActive && (
            <Button
              variant="tonal"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void exportVault(activeVault, entry.name)
                  .catch(() => toast.warning(t("mobile.vaultExportFailed")))
                  .finally(() => setBusy(false));
              }}
            >
              <Upload size={16} /> {t("mobile.vaultExport")}
            </Button>
          )}
          {isActive && (
            <Button variant="tonal" disabled={busy} onClick={() => setDeleted(true)}>
              <FileClock size={16} /> {t("versions.deletedTitle")}
            </Button>
          )}
          {/* H2d: the folder was only choosable while connecting; the desktop
              has had this on its sync page. Not offered for WebDAV, where the
              folder is baked into the base URL at connect time. */}
          {isActive && canChangeRemoteFolder(entry.provider) && (
            <Button
              variant="tonal"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void getStoredProvider(vaultId)
                  .then((stored) => { if (stored) setFolderPick(stored); })
                  .finally(() => setBusy(false));
              }}
            >
              <Cloud size={16} /> {t("mobile.changeCloudFolder")}
            </Button>
          )}
          {entry.provider && !entry.paused && (
            <Button
              variant="tonal"
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
              variant="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void resumeProvider(vaultId).finally(() => setBusy(false));
              }}
            >
              {t("mobile.syncResume")}
            </Button>
          )}
          {entry.provider && (entry.provider === "drive" || entry.provider === "onedrive" || entry.provider === "dropbox") && (
            <Button
              variant={status.status === "error" && isActive ? "primary" : "tonal"}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void reconnectVault(vaultId).finally(() => setBusy(false));
              }}
            >
              <Cloud size={16} /> {t("mobile.reconnectAction", { defaultValue: "Neu anmelden" })}
            </Button>
          )}
          {isActive && activeVault.indexer && (
            <Button variant="tonal" disabled={busy} onClick={rebuildIndex}>
              <RefreshCw size={16} /> {t("settings.rebuildIndexAction")}
            </Button>
          )}
          {!isLocal && (
            <Button variant="danger" disabled={busy} onClick={remove}>
              <Trash2 size={16} /> {t("mobile.vaultDelete")}
            </Button>
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
      {setupOpen && (
        <EncryptionSetupSheet
          onClose={() => setSetupOpen(false)}
          onDone={() => {
            setSetupOpen(false);
            setEncryption("unlocked");
            void restartSync(activeVault);
          }}
          vault={activeVault}
        />
      )}
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
