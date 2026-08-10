import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import {
  Button,
  EmptyState,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  TextInput,
  ICON,
  familyOfSyncProvider,
  hasCloudService,
  toast,
  Banner,
  deviceStateKey,
  diagnosticsState,
  emptyDiagnostics,
  travellingAreas,
  type CloudAccountRecord,
  type SyncDiagnostics,
} from "@plainva/ui";
import { AreaHead } from "./AppPages";
import { MIN_SYNC_INTERVAL_SECONDS, useVault } from "../../contexts/VaultContext";
import { syncStatusStore } from "../../services/syncStatusStore";
import { getSettingsStore } from "../../services/settingsStore";
import {
  settingsSyncEnabledKey,
  secretsSyncEnabledKey,
  loadSyncDiagnostics,
  requestLegacySecretsCleanup,
  SYNC_DIAGNOSTICS_EVENT,
} from "../../services/settingsProfile";
import { appConfirm } from "../../services/appDialogs";
import {
  hasLocalKeyfile,
  loadCachedMasterKey,
  lockVault,
  isPassphraseEveryStart,
  setPassphraseEveryStart,
} from "../../services/encryptionSession";
import { EncryptionSetupModal } from "./EncryptionSetupModal";
import { CLOUD_ACCOUNTS_EVENT, loadCloudAccounts } from "../../services/cloudAccounts";
import { getSyncRootFolder, listSyncFoldersFromSlots, saveSyncRootFolder } from "../../services/cloudAccountsActions";
import { SyncFolderPickerModal } from "../SyncFolderPickerModal";
import { AccountMark, familyLabel } from "./cloudAccountsShared";
import { StoredCredentialsCard } from "./StoredCredentialsCard";

/**
 * The Sync settings page after the cloud-accounts split (mockup screen 5):
 * NO connection forms anymore — the connection is a reference card onto the
 * account (managed in the Cloud-Konten area); this page keeps the service
 * BEHAVIOR: remote folder, interval, queue insight, error history.
 */

export type SyncProvider = "none" | "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

export interface SyncQueueItem { operation: string; file_path: string; retry_count: number }

export interface SyncPageProps {
  selectedVault: string;
  isActiveVault: boolean;
  activeProvider: SyncProvider;
  onOpenCloudAccounts: () => void;
  intervalSec: string;
  onIntervalChange: (raw: string) => void;
  onIntervalBlur: () => void;
  hasSyncWorker: boolean;
  syncQueueSnapshot: { total: number; items: SyncQueueItem[] } | null;
  onLoadQueue: () => void;
}

export const SyncPage: React.FC<SyncPageProps> = (p) => {
  const { t, i18n } = useTranslation();
  const { backupAdapter, syncWorker } = useVault();
  const [records, setRecords] = useState<CloudAccountRecord[]>([]);
  const [rootFolder, setRootFolder] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [secretsSyncOn, setSecretsSyncOn] = useState(false);
  const [pendingSecretsEnable, setPendingSecretsEnable] = useState(false);
  const [encState, setEncState] = useState<"none" | "locked" | "unlocked">("none");
  /** What the settings sync last did here (P1/S10) — a report, not a control. */
  const [diag, setDiag] = useState<SyncDiagnostics>(emptyDiagnostics());
  const [everyStart, setEveryStart] = useState(false);
  const [encModal, setEncModal] = useState<null | "create" | "unlock">(null);
  const provider = p.activeProvider;

  /**
   * Asks the next cycle to drop the retired entries (P7). The question in the
   * dialog is the whole point: a device still on an older version would simply
   * publish them again, so only the user can answer it.
   */
  const requestCleanup = useCallback(async () => {
    const ok = await appConfirm({
      title: t("settingsSync.legacyEntriesCleanup"),
      message: t("settingsSync.legacyEntriesCleanupConfirm"),
      confirmLabel: t("settingsSync.legacyEntriesCleanup"),
    });
    if (!ok) return;
    await requestLegacySecretsCleanup(p.selectedVault);
    syncWorker?.triggerImmediate();
  }, [p.selectedVault, syncWorker, t]);

  // Encryption state for this vault (only meaningful for the active, open vault).
  // The record is read here rather than pushed: it changes on a sync cycle,
  // which nobody is watching this page for, and re-reading on the event keeps
  // an open page honest without polling.
  useEffect(() => {
    let alive = true;
    const read = () => {
      void loadSyncDiagnostics(p.selectedVault).then((d) => {
        if (alive) setDiag(d);
      });
    };
    read();
    window.addEventListener(SYNC_DIAGNOSTICS_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(SYNC_DIAGNOSTICS_EVENT, read);
    };
  }, [p.selectedVault]);

  useEffect(() => {
    if (!p.isActiveVault || !backupAdapter) {
      setEncState("none");
      return;
    }
    let alive = true;
    const refresh = async () => {
      const hasKf = await hasLocalKeyfile(backupAdapter);
      const mk = await loadCachedMasterKey(p.selectedVault);
      const every = await isPassphraseEveryStart(p.selectedVault);
      if (!alive) return;
      setEveryStart(every);
      setEncState(mk ? "unlocked" : hasKf ? "locked" : "none");
    };
    void refresh();
    window.addEventListener("plainva-encryption-changed", refresh);
    window.addEventListener("plainva-keyfile-arrived", refresh);
    return () => {
      alive = false;
      window.removeEventListener("plainva-encryption-changed", refresh);
      window.removeEventListener("plainva-keyfile-arrived", refresh);
    };
  }, [p.isActiveVault, p.selectedVault, backupAdapter]);

  const doLock = useCallback(async () => {
    await lockVault(p.selectedVault);
    window.dispatchEvent(new CustomEvent("plainva-encryption-changed"));
  }, [p.selectedVault]);

  const toggleEveryStart = useCallback(
    async (on: boolean) => {
      setEveryStart(on);
      await setPassphraseEveryStart(p.selectedVault, on);
    },
    [p.selectedVault]
  );

  useEffect(() => {
    void getSettingsStore().then(async (s) => {
      setSettingsSyncOn((await s.get<boolean>(settingsSyncEnabledKey(p.selectedVault))) === true);
      setSecretsSyncOn((await s.get<boolean>(secretsSyncEnabledKey(p.selectedVault))) === true);
    });
  }, [p.selectedVault]);

  const toggleSettingsSync = useCallback(
    async (on: boolean) => {
      setSettingsSyncOn(on);
      const s = await getSettingsStore();
      await s.set(settingsSyncEnabledKey(p.selectedVault), on);
      await s.save();
      // Live-swap the sideband into the running worker (VaultContext handles it).
      window.dispatchEvent(new CustomEvent("plainva-settings-sync-toggled"));
    },
    [p.selectedVault]
  );

  const toggleSecretsSync = useCallback(
    async (on: boolean) => {
      if (on && encState !== "unlocked") {
        setPendingSecretsEnable(true);
        setEncModal(encState === "none" ? "create" : "unlock");
        return;
      }
      setSecretsSyncOn(on);
      const s = await getSettingsStore();
      await s.set(secretsSyncEnabledKey(p.selectedVault), on);
      await s.save();
      window.dispatchEvent(new CustomEvent("plainva-settings-sync-toggled"));
    },
    [encState, p.selectedVault]
  );

  const reload = useCallback(async () => {
    setRecords(await loadCloudAccounts(p.selectedVault));
    if (provider !== "none") setRootFolder(await getSyncRootFolder(p.selectedVault, provider));
  }, [p.selectedVault, provider]);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
    window.addEventListener("plainva-credentials-saved", onChanged);
    return () => {
      window.removeEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
      window.removeEventListener("plainva-credentials-saved", onChanged);
    };
  }, [reload]);

  const filesAccount = records.find((r) => r.services.files);
  const connected = provider !== "none";
  // Registry label when known, family name otherwise — never the raw provider id.
  const accountName = filesAccount
    ? filesAccount.label.trim() || familyLabel(filesAccount.family, filesAccount.flavor)
    : connected
      ? familyLabel(familyOfSyncProvider(provider))
      : "";

  return (
    <div>
      <AreaHead areaId="sync" />

      <SettingCard label={t("settings.groupConnection", { defaultValue: "Verbindung" })}>
        {!connected && (
          <EmptyState title={t("cloudAccounts.noneYet")} icon={<Users size={ICON.empty} />}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
              {t("settings.pageDescCloudAccounts")}
              <Button variant="primary" onClick={p.onOpenCloudAccounts} data-testid="sync-open-cloudaccounts">
                {t("cloudAccounts.openArea")}
              </Button>
            </div>
          </EmptyState>
        )}
        {connected && (
          <div className="pv-acct">
            {filesAccount ? (
              <AccountMark family={filesAccount.family} flavor={filesAccount.flavor} />
            ) : (
              <AccountMark family={provider === "drive" ? "google" : provider === "onedrive" ? "microsoft" : provider === "dropbox" ? "dropbox" : provider === "s3" ? "s3" : "webdav"} />
            )}
            <div className="pv-acct-who">
              <div className="pv-acct-name">{t("cloudAccounts.filesVia", { name: accountName || provider })}</div>
              <div className="pv-acct-id">{rootFolder || t("cloudAccounts.cloudFolderHint")}</div>
            </div>
            <Button variant="ghost" onClick={p.onOpenCloudAccounts} data-testid="sync-manage-account">
              {t("cloudAccounts.manageAccount")}
            </Button>
          </div>
        )}
      </SettingCard>

      {connected && (
        <SettingCard label={t("settings.groupSyncBehavior", { defaultValue: "Verhalten" })}>
          <SettingRow label={t("cloudAccounts.cloudFolder")} desc={t("cloudAccounts.cloudFolderHint")}>
            <TextInput value={rootFolder} readOnly style={{ width: 180 }} data-testid="sync-cloud-folder" />
            {provider !== "webdav" && (
              <Button variant="secondary" onClick={() => setShowPicker(true)}>
                {t("settings.browseFolders")}
              </Button>
            )}
          </SettingRow>
          <SettingRow label={t("settings.syncInterval")} desc={t("settings.syncIntervalDesc", { min: MIN_SYNC_INTERVAL_SECONDS })}>
            <input
              type="number"
              min={MIN_SYNC_INTERVAL_SECONDS}
              value={p.intervalSec}
              onChange={(e) => p.onIntervalChange(e.target.value)}
              onBlur={p.onIntervalBlur}
              className="pv-field"
              style={{ flex: 1, minWidth: 0 }}
            />
          </SettingRow>
          {p.isActiveVault && p.hasSyncWorker && (
            <SettingRow
              label={t("settings.syncQueue", { defaultValue: "Ausstehende Übertragungen" })}
              desc={t("settings.syncQueueDesc", { defaultValue: "Zeigt, was noch zur Cloud übertragen wird (älteste zuerst)." })}
            >
              <Button variant="secondary" size="sm" onClick={p.onLoadQueue}>
                {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
              </Button>
            </SettingRow>
          )}
          {p.isActiveVault && p.syncQueueSnapshot && (
            <SettingCardNote>
              {p.syncQueueSnapshot.total === 0
                ? t("settings.syncQueueEmpty", { defaultValue: "Nichts ausstehend — alles übertragen." })
                : (
                  <>
                    <div style={{ marginBottom: "0.3rem" }}>
                      {t("settings.syncQueueCount", { defaultValue: "{{n}} Operation(en) ausstehend:", n: p.syncQueueSnapshot.total })}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                      {p.syncQueueSnapshot.items.map((it, i) => (
                        <div key={`${it.file_path}-${i}`} style={{ overflowWrap: "anywhere" }}>
                          <span style={{ color: "var(--text-faint)" }}>{it.operation}</span>{" "}
                          {it.file_path}
                          {it.retry_count > 0 ? ` (${t("settings.syncQueueRetries", { defaultValue: "Versuch {{n}}", n: it.retry_count + 1 })})` : ""}
                        </div>
                      ))}
                    </div>
                  </>
                )}
            </SettingCardNote>
          )}
          {p.isActiveVault && syncStatusStore.getErrorHistory().length > 0 && (
            <SettingCardNote>
              <div style={{ fontSize: "var(--text-ui)", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.3rem" }}>{t("settings.syncErrorHistory")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: 140, overflowY: "auto", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem" }}>
                {[...syncStatusStore.getErrorHistory()].reverse().map((e, i) => (
                  <div key={`${e.ts}-${i}`} style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                    <span style={{ color: "var(--text-faint)" }}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "medium" }).format(new Date(e.ts))}</span>{" — "}{e.message}
                  </div>
                ))}
              </div>
            </SettingCardNote>
          )}
        </SettingCard>
      )}

      {/* One chain instead of three switches in two places (plan P5). The steps
          build on each other, and until now nothing on screen said so: a user
          who only set the passphrase waited forever for accounts that were
          never going to travel. */}
      {connected && (
        <SettingCard label={t("settingsSync.chainLabel")}>
          <SettingCardNote>{t("settingsSync.chainIntro")}</SettingCardNote>

          <div className="pv-chain">
            {/* Step 1 stands alone: syncing settings and accounts needs NO
                passphrase — without one the profile is simply plaintext JSON in
                the vault. Only step 3 carries passwords and therefore needs a key. */}
            {/* …with ONE exception, and it has to be visible: once any device
                has set a passphrase, the profile in the vault is sealed, so a
                locked device can neither read nor write it. The switch stays
                on, but the step must not claim to be running. */}
            <div className={`pv-chain-step ${settingsSyncOn && encState === "locked" ? "is-todo" : settingsSyncOn ? "is-done" : "is-todo"}`}>
              <div className="pv-chain-node">{settingsSyncOn && encState !== "locked" ? "✓" : settingsSyncOn ? "!" : "1"}</div>
              <div className="pv-chain-body">
                <div className="pv-chain-head">
                  <span className="pv-chain-title">
                    {t("settingsSync.step1")}
                    {settingsSyncOn && encState === "locked" && (
                      <span className="pv-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>
                    )}
                  </span>
                  <Switch checked={settingsSyncOn} onChange={(on) => void toggleSettingsSync(on)} label={t("settingsSync.step1")} />
                </div>
                <p className="pv-chain-desc">
                  {settingsSyncOn && encState === "locked" ? t("settingsSync.step1Sealed") : t("settingsSync.step1Desc")}
                </p>
                {/* Generated from the shared field catalog, not written by
                    hand: a list that promises more than the code delivers is
                    worse than none, and a hand-written one is exactly how the
                    two shells drifted apart. */}
                <div className="pv-chain-carries">
                  {travellingAreas("desktop").map((area) => (
                    <span className="pv-chain-chip" key={area}>{t(`settingsSync.area_${area}`)}</span>
                  ))}
                  <span className="pv-chain-chip is-excluded">{t("settingsSync.chipPasswords")}</span>
                  <span className="pv-chain-chip is-excluded">{t("settingsSync.chipPaths")}</span>
                </div>
              </div>
            </div>

            {/* Step 2 is OPTIONAL — it exists for step 3, and encrypts step 1 as
                a side effect. This is also the only passphrase surface on this
                page now; a second one below used to offer the same thing twice. */}
            {p.isActiveVault && backupAdapter && (
              <div className={`pv-chain-step ${encState === "unlocked" ? "is-done" : ""}`}>
                <div className="pv-chain-node">{encState === "unlocked" ? "✓" : "2"}</div>
                <div className="pv-chain-body">
                  <div className="pv-chain-head">
                    <span className="pv-chain-title">
                      {t("settingsSync.step2")}
                      {encState !== "unlocked" && <span className="pv-chain-chip">{t("settingsSync.step2Optional")}</span>}
                    </span>
                    <span className="pv-chain-extra">
                      {encState === "none" && (
                        <Button variant="secondary" onClick={() => setEncModal("create")} data-testid="encryption-set">
                          {t("encryption.setPassphrase")}
                        </Button>
                      )}
                      {encState === "locked" && (
                        <Button variant="primary" onClick={() => setEncModal("unlock")} data-testid="encryption-unlock-open">
                          {t("encryption.enterPassphrase")}
                        </Button>
                      )}
                      {encState === "unlocked" && (
                        <Button variant="ghost" onClick={() => void doLock()} data-testid="encryption-lock">{t("encryption.lock")}</Button>
                      )}
                    </span>
                  </div>
                  <p className="pv-chain-desc">
                    {encState === "unlocked" ? t("encryption.statusUnlocked") : t("settingsSync.step2Desc")}
                  </p>
                  {encState !== "none" && (
                    <span className="pv-chain-extra">
                      <Switch checked={everyStart} onChange={(on) => void toggleEveryStart(on)} label={t("encryption.everyStart")} />
                      <span className="pv-chain-desc">{t("encryption.everyStart")}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* E3: locked, not uselessly switchable. It needs BOTH — the accounts
                from step 1 (a password can only reach an account this device
                knows) and the key from step 2 (the bundle is sealed with it). */}
            <div className={`pv-chain-step ${secretsSyncOn && settingsSyncOn ? "is-done" : !settingsSyncOn || encState !== "unlocked" ? "is-locked" : ""}`}>
              <div className="pv-chain-node">{secretsSyncOn && settingsSyncOn ? "✓" : "3"}</div>
              <div className="pv-chain-body">
                <div className="pv-chain-head">
                  <span className="pv-chain-title">
                    {t("settingsSync.step3")}
                    {!settingsSyncOn && <span className="pv-chain-chip is-excluded">{t("settingsSync.needsStep1")}</span>}
                    {settingsSyncOn && encState !== "unlocked" && <span className="pv-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>}
                  </span>
                  <Switch
                    checked={secretsSyncOn && settingsSyncOn}
                    disabled={!settingsSyncOn}
                    onChange={(on) => void toggleSecretsSync(on)}
                    label={t("settingsSync.step3")}
                  />
                </div>
                <p className="pv-chain-desc">
                  {!settingsSyncOn ? t("settingsSync.needsStep1Body") : t("settingsSync.step3Desc")}
                </p>
                {settingsSyncOn && <p className="pv-chain-desc">{t("settingsSync.oauthNote")}</p>}
              </div>
            </div>
          </div>

          {settingsSyncOn && p.isActiveVault && (
            <SettingRow label={t("settingsSync.pullNow")} desc={t("settingsSync.pullNowDesc")}>
              <Button
                variant="secondary"
                onClick={() => {
                  toast.info(t("settingsSync.pullStarted"));
                  window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
                }}
                data-testid="chain-pull-now"
              >
                {t("mobile.syncNow")}
              </Button>
            </SettingRow>
          )}
        </SettingCard>
      )}

      {/* What the sync actually did (P1/S11). The finding was never "settings
          do not arrive" but "nobody can tell whether they did" — three states
          look identical from the outside, and the locked one used to be a toast
          that appeared once per session and was gone. */}
      {connected && (
        <SettingCard label={t("settingsSync.diagTitle")}>
          {(() => {
            const state = diagnosticsState(diag, {
              enabled: settingsSyncOn,
              encrypted: encState !== "none",
              unlocked: encState === "unlocked",
            });
            const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : t("settingsSync.diagNever"));
            return (
              <>
                <Banner
                  kind={state === "running" ? "success" : state === "locked" ? "warning" : "info"}
                  data-testid="sync-diag-state"
                >
                  {t(deviceStateKey(state))}
                </Banner>
                {/* The field NAMES below the count: "12 fields" cannot tell a
                    working sync from one that re-publishes the same setting on
                    every cycle, and the import line names what changed. */}
                <SettingRow label={t("settingsSync.diagLastCheck")}>
                  <span className="pv-chain-desc" data-testid="sync-diag-check">
                    {when(diag.lastCheck?.at)}
                    {diag.lastCheck ? ` · ${t("settingsSync.diagFields")}: ${diag.lastCheck.fields}` : ""}
                    {diag.lastCheck?.names?.length ? <><br />{diag.lastCheck.names.join(", ")}</> : null}
                  </span>
                </SettingRow>
                <SettingRow label={t("settingsSync.diagLastDownload")}>
                  <span className="pv-chain-desc" data-testid="sync-diag-download">
                    {when(diag.lastDownload?.at)}
                    {diag.lastDownload ? ` · ${t("settingsSync.diagFields")}: ${diag.lastDownload.fields}` : ""}
                    {diag.lastDownload?.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastDownload.deviceId })}` : ""}
                    {diag.lastDownload?.names?.length ? <><br />{diag.lastDownload.names.join(", ")}</> : null}
                  </span>
                </SettingRow>
                <SettingRow label={t("settingsSync.diagLastApply")}>
                  <span className="pv-chain-desc" data-testid="sync-diag-apply">
                    {when(diag.lastApply?.at)}
                    {diag.lastApply ? ` · ${t("settingsSync.diagFields")}: ${diag.lastApply.fields}` : ""}
                    {diag.lastApply?.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastApply.deviceId })}` : ""}
                    {diag.lastApply?.names?.length ? <><br />{t("settingsSync.diagChanged")}: {diag.lastApply.names.join(", ")}</> : null}
                  </span>
                </SettingRow>
                <SettingRow label={t("settingsSync.diagLastUpload")}>
                  <span className="pv-chain-desc" data-testid="sync-diag-upload">
                    {when(diag.lastUpload?.at)}
                    {diag.lastUpload ? ` · ${t("settingsSync.diagFields")}: ${diag.lastUpload.fields}` : ""}
                    {diag.lastUpload?.names?.length ? <><br />{diag.lastUpload.names.join(", ")}</> : null}
                  </span>
                </SettingRow>
                <SettingRow label={t("settingsSync.diagSecretResult")}>
                  <span className="pv-chain-desc" data-testid="sync-diag-secrets">
                    {when(diag.lastSecrets?.at)}
                    {diag.lastSecrets ? (
                      <>
                        <br />
                        {t("settingsSync.diagSecretImported")}: {diag.lastSecrets.imported}
                        {" · "}{t("settingsSync.diagSecretUnchanged")}: {diag.lastSecrets.unchanged}
                        {" · "}{t("settingsSync.diagSecretRejected")}: {diag.lastSecrets.rejected}
                        {" · "}{t("settingsSync.diagSecretStale")}: {diag.lastSecrets.stale}
                        {" · "}{t("settingsSync.diagSecretErrors")}: {diag.lastSecrets.errors}
                        {" · "}{t("settingsSync.diagSecretWaiting")}: {diag.lastSecrets.waiting}
                        {diag.lastSecrets.reasons.length > 0 ? (
                          <><br />{t("settingsSync.diagReasons")}: {diag.lastSecrets.reasons.map((item) => `${item.reason} (${item.count})`).join(", ")}</>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                </SettingRow>
                {diag.previousClientActivity && (
                  <Banner kind="info" data-testid="sync-diag-previous-client">
                    {t("settingsSync.diagPreviousActivity")}
                  </Banner>
                )}
                {/* One banner per finding, and only the removable one offers a
                    way out. Until P7 all three findings shared the sentence
                    "an older Plainva version is still publishing…", including
                    the case where the document in question is this device's
                    own — nobody to update, and no way to make it stop. */}
                {diag.legacyClient?.reasons.includes("legacy-google-client-entry") && (
                  <Banner kind="warning" data-testid="sync-diag-legacy-client">
                    <div>{t("settingsSync.legacyEntriesCleanupDesc")}</div>
                    <div style={{ marginTop: "0.4rem" }}>
                      <Button variant="secondary" size="sm" onClick={() => void requestCleanup()}>
                        {t("settingsSync.legacyEntriesCleanup")}
                      </Button>
                    </div>
                  </Banner>
                )}
                {diag.legacyClient?.reasons.includes("legacy-profile-capability-remote") && (
                  <Banner kind="info" data-testid="sync-diag-legacy-profile-remote">
                    {t("settingsSync.legacyProfileRemote")}
                  </Banner>
                )}
                {diag.skipped && (
                  <Banner kind="warning" data-testid="sync-diag-refused">
                    {t("settingsSync.diagRefused")}: {diag.skipped.reasons.join("; ")}
                  </Banner>
                )}
                {diag.lastError && (
                  <Banner kind="error" data-testid="sync-diag-error">
                    {t("settingsSync.diagError", { error: diag.lastError.message })}
                  </Banner>
                )}
                <SettingCardNote>{t("settingsSync.diagStays")}</SettingCardNote>
              </>
            );
          })()}
        </SettingCard>
      )}

      {encModal && p.isActiveVault && backupAdapter && (
        <EncryptionSetupModal
          vaultPath={p.selectedVault}
          raw={backupAdapter}
          mode={encModal}
          onDone={() => {
            setEncModal(null);
            if (pendingSecretsEnable) {
              setPendingSecretsEnable(false);
              setSecretsSyncOn(true);
              void getSettingsStore().then(async (s) => {
                await s.set(secretsSyncEnabledKey(p.selectedVault), true);
                await s.save();
                window.dispatchEvent(new CustomEvent("plainva-settings-sync-toggled"));
              });
            }
          }}
          onCancel={() => { setEncModal(null); setPendingSecretsEnable(false); }}
        />
      )}

      {/* Deliberately outside the `connected` gate: leftovers are exactly the
          entries whose vault no longer has a connection, and they are the ones
          worth finding (E2). */}
      <StoredCredentialsCard />

      {showPicker && provider !== "none" && provider !== "webdav" && (
        <SyncFolderPickerModal
          listFolders={(path) => listSyncFoldersFromSlots(p.selectedVault, provider, path)}
          rootLabel={accountName || provider}
          allowRoot={provider === "s3"}
          onSelect={(picked) => {
            setShowPicker(false);
            void saveSyncRootFolder(p.selectedVault, provider, picked).then(() => reload());
          }}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

/** Gating helper for the settings nav: does any account carry files? */
export function vaultHasFilesService(records: readonly CloudAccountRecord[]): boolean {
  return hasCloudService(records, "files");
}
