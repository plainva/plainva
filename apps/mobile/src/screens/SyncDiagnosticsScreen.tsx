import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner, deviceStateKey, diagnosticsState, emptyDiagnostics, SectionLabel, type SyncDiagnostics } from "@plainva/ui";
import { getSyncStatus, subscribeSyncStatus } from "../services/syncService";
import {
  SYNC_DIAGNOSTICS_EVENT,
  isMobileSettingsSyncEnabled,
  loadSyncDiagnostics,
  mobileEncryptionStatus,
} from "../services/mobileSettingsSync";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * What the settings sync last did on THIS device (mobile rework N4.3,
 * decision E3) — a report, not a control.
 *
 * Nearly a hundred lines of it stood inline on the vault detail, between the
 * chain and the vault's own actions, on a screen someone opens to answer "is
 * my vault syncing". The answer to that is the status card; this is the answer
 * to "and what exactly moved", which is a different question and now has its
 * own place. The waiting queue moved with it for the same reason.
 */
export function SyncDiagnosticsScreen({
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
  const [diag, setDiag] = useState<SyncDiagnostics>(emptyDiagnostics());
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");

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
    // Only to phrase the device-state line: which of the three silent states
    // this device is in depends on the chain, which lives one screen away.
    void isMobileSettingsSyncEnabled(vaultId).then(setSettingsSyncOn);
    void mobileEncryptionStatus(activeVault).then(setEncryption);
  }, [activeVault, vaultId]);

  return (
    <div className="m-page" data-testid="sync-diagnostics">
      <AppBar onBack={onBack} title={t("settingsSync.diagTitle")} />
      <div className="m-settings">
        <QueuePeek vault={activeVault} />
        {/* The same statement as on the desktop: which of the three silent
            states this device is in, and what actually moved. */}
        <div className="pv-card m-card">
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
      {status.errorHistory.length > 0 && (
        <>
          <SectionLabel>{t("settings.syncErrorHistory")}</SectionLabel>
          {status.errorHistory.map((e) => (
            <p className="m-hint" key={e.at}>
              {new Date(e.at).toLocaleTimeString()} · {e.message}
            </p>
          ))}
        </>
      )}
      </div>
    </div>
  );
}

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
