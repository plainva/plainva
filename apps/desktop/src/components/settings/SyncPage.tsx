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
  type CloudAccountRecord,
} from "@plainva/ui";
import { AreaHead } from "./AppPages";
import { MIN_SYNC_INTERVAL_SECONDS, useVault } from "../../contexts/VaultContext";
import { syncStatusStore } from "../../services/syncStatusStore";
import { getSettingsStore } from "../../services/settingsStore";
import { settingsSyncEnabledKey, getActiveConnectionId } from "../../services/settingsProfile";
import { loadConnectionState } from "../../services/encryptionManifest";
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
  const { backupAdapter, activateEncryption, completeEncryptionMigration } = useVault();
  const [records, setRecords] = useState<CloudAccountRecord[]>([]);
  const [rootFolder, setRootFolder] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [encState, setEncState] = useState<"none" | "locked" | "unlocked">("none");
  const [everyStart, setEveryStart] = useState(false);
  const [encModal, setEncModal] = useState<null | "create" | "unlock">(null);
  const [contentEnc, setContentEnc] = useState<"off" | "on">("off");
  const [encBusy, setEncBusy] = useState(false);
  const provider = p.activeProvider;

  // Encryption state for this vault (only meaningful for the active, open vault).
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
      const connId = await getActiveConnectionId(p.selectedVault);
      const known = connId ? (await loadConnectionState(connId)).knownEncrypted : false;
      if (!alive) return;
      setEveryStart(every);
      setEncState(mk ? "unlocked" : hasKf ? "locked" : "none");
      setContentEnc(known ? "on" : "off");
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

  const doActivateEncryption = useCallback(async () => {
    if (encBusy) return;
    const ok = await appConfirm({
      title: t("encryption.activateTitle"),
      message: t("encryption.activateConfirm"),
      kind: "danger",
      confirmLabel: t("encryption.activate"),
    });
    if (!ok) return;
    setEncBusy(true);
    try {
      const { queued } = await activateEncryption();
      // activateEncryption reopens the vault itself (rewrap); no encryption-changed
      // event here or the vault would reload twice.
      toast.info(t("encryption.activateStarted", { n: queued }));
    } catch (e) {
      console.error("[SyncPage] activate content encryption failed", e);
      toast.error(t("encryption.activateFailed"));
    } finally {
      setEncBusy(false);
    }
  }, [encBusy, t, activateEncryption]);

  const doCompleteMigration = useCallback(async () => {
    if (encBusy) return;
    const ok = await appConfirm({
      title: t("encryption.completeTitle"),
      message: t("encryption.completeConfirm"),
      confirmLabel: t("encryption.complete"),
    });
    if (!ok) return;
    setEncBusy(true);
    try {
      await completeEncryptionMigration();
      // completeEncryptionMigration reopens the vault itself; no event here.
      toast.info(t("encryption.completeDone"));
    } catch (e) {
      console.error("[SyncPage] complete content-encryption migration failed", e);
      toast.error(t("encryption.completeFailed"));
    } finally {
      setEncBusy(false);
    }
  }, [encBusy, t, completeEncryptionMigration]);

  useEffect(() => {
    void getSettingsStore().then((s) =>
      s.get<boolean>(settingsSyncEnabledKey(p.selectedVault)).then((v) => setSettingsSyncOn(v === true))
    );
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

      {connected && (
        <SettingCard label={t("settingsSync.cardLabel")}>
          <SettingRow label={t("settingsSync.toggleLabel")} desc={t("settingsSync.toggleDesc")}>
            <Switch
              checked={settingsSyncOn}
              onChange={(on) => void toggleSettingsSync(on)}
              label={t("settingsSync.toggleLabel")}
            />
          </SettingRow>
          <SettingCardNote>{t("settingsSync.explainer")}</SettingCardNote>
        </SettingCard>
      )}

      {connected && p.isActiveVault && backupAdapter && (
        <SettingCard label={t("encryption.cardLabel")}>
          <SettingCardNote>
            {encState === "unlocked"
              ? t("encryption.statusUnlocked")
              : encState === "locked"
                ? t("encryption.statusLocked")
                : t("encryption.statusNone")}
          </SettingCardNote>
          <SettingRow label={t("encryption.passphraseRow")} desc={t("encryption.passphraseRowDesc")}>
            {encState === "none" && (
              <Button variant="primary" onClick={() => setEncModal("create")} data-testid="encryption-set">
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
          </SettingRow>
          {encState !== "none" && (
            <SettingRow label={t("encryption.everyStart")} desc={t("encryption.everyStartDesc")}>
              <Switch checked={everyStart} onChange={(on) => void toggleEveryStart(on)} label={t("encryption.everyStart")} />
            </SettingRow>
          )}
          {encState === "unlocked" && (
            <SettingRow label={t("encryption.contentRow")} desc={t("encryption.contentRowDesc")}>
              {contentEnc === "off" ? (
                <Button
                  variant="primary"
                  disabled={encBusy}
                  onClick={() => void doActivateEncryption()}
                  data-testid="encryption-activate"
                >
                  {t("encryption.activate")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={encBusy}
                  onClick={() => void doCompleteMigration()}
                  data-testid="encryption-complete"
                >
                  {t("encryption.complete")}
                </Button>
              )}
            </SettingRow>
          )}
          {encState === "unlocked" && (
            <SettingCardNote>
              {contentEnc === "on" ? t("encryption.contentActiveNote") : t("encryption.contentWarning")}
            </SettingCardNote>
          )}
        </SettingCard>
      )}

      {encModal && p.isActiveVault && backupAdapter && (
        <EncryptionSetupModal
          vaultPath={p.selectedVault}
          raw={backupAdapter}
          mode={encModal}
          onDone={() => setEncModal(null)}
          onCancel={() => setEncModal(null)}
        />
      )}

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
