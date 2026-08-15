import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, deviceStateKey, diagnosticsState, emptyDiagnostics, GroupCard, Row, RowList, SectionLabel, type SyncDiagnostics } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";
import { getSyncStatus, subscribeSyncStatus, syncNow } from "../services/syncService";
import {
  SYNC_DIAGNOSTICS_EVENT,
  isMobileSettingsSyncEnabled,
  loadSyncDiagnostics,
  mobileEncryptionStatus,
  requestMobileLegacyCleanup,
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
        <Row
          subtitle={<>
            <small>
              {diag.lastCheck
                ? `${new Date(diag.lastCheck.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastCheck.fields}`
                : t("settingsSync.diagNever")}
            </small>
            {diag.lastCheck?.names?.length ? <small>{diag.lastCheck.names.join(", ")}</small> : null}
          </>}
          title={t("settingsSync.diagLastCheck")}
          wrap
        />
        <Row
          subtitle={<>
            <small>
              {diag.lastDownload
                ? `${new Date(diag.lastDownload.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastDownload.fields}`
                  + (diag.lastDownload.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastDownload.deviceId })}` : "")
                : t("settingsSync.diagNever")}
            </small>
            {diag.lastDownload?.names?.length ? <small>{diag.lastDownload.names.join(", ")}</small> : null}
          </>}
          title={t("settingsSync.diagLastDownload")}
          wrap
        />
        <Row
          subtitle={<>
            <small>
              {diag.lastApply
                ? `${new Date(diag.lastApply.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastApply.fields}`
                  + (diag.lastApply.deviceId ? ` · ${t("settingsSync.diagFromDevice", { device: diag.lastApply.deviceId })}` : "")
                : t("settingsSync.diagNever")}
            </small>
            {diag.lastApply?.names?.length ? (
              <small>{t("settingsSync.diagChanged")}: {diag.lastApply.names.join(", ")}</small>
            ) : null}
          </>}
          title={t("settingsSync.diagLastApply")}
          wrap
        />
        <Row
          subtitle={<>
            <small>
              {diag.lastUpload
                ? `${new Date(diag.lastUpload.at).toLocaleString()} · ${t("settingsSync.diagFields")}: ${diag.lastUpload.fields}`
                : t("settingsSync.diagNever")}
            </small>
            {diag.lastUpload?.names?.length ? <small>{diag.lastUpload.names.join(", ")}</small> : null}
          </>}
          title={t("settingsSync.diagLastUpload")}
          wrap
        />
        <Row
          subtitle={<>
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
          </>}
          title={t("settingsSync.diagSecretResult")}
          wrap
        />
        {diag.previousClientActivity && (
          <p className="m-hint">{t("settingsSync.diagPreviousActivity")}</p>
        )}
        {/* The one finding with a way out gets the way out, same as the
            desktop: a warning a phone can only read, never act on, is a
            warning that repeats forever. */}
        {diag.legacyClient?.reasons.includes("legacy-google-client-entry") && (
          <Banner kind="warning" rounded>
            <div>{t("settingsSync.legacyEntriesCleanupDesc")}</div>
            <Button
              data-testid="legacy-cleanup"
              onClick={() => {
                void mConfirm({
                  title: t("settingsSync.legacyEntriesCleanup"),
                  message: t("settingsSync.legacyEntriesCleanupConfirm"),
                  confirmLabel: t("settingsSync.legacyEntriesCleanup"),
                }).then(async (ok) => {
                  if (!ok) return;
                  await requestMobileLegacyCleanup(vaultId);
                  void syncNow();
                });
              }}
              size="sm"
              variant="tonal"
            >
              {t("settingsSync.legacyEntriesCleanup")}
            </Button>
          </Banner>
        )}
        {diag.legacyClient?.reasons.includes("legacy-profile-capability-remote") && (
          <Banner kind="info" rounded>{t("settingsSync.legacyProfileRemote")}</Banner>
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
          <GroupCard>
            <RowList>
              {status.errorHistory.map((e) => (
                <Row key={e.at} subtitle={e.message} title={new Date(e.at).toLocaleTimeString()} wrap />
              ))}
            </RowList>
          </GroupCard>
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
      <SectionLabel>{t("settings.syncQueue")}</SectionLabel>
      {ops.length === 0 ? (
        <p className="m-hint">{t("settings.syncQueueEmpty")}</p>
      ) : (
        // Pending operations are a LIST, so they are rows in a card — as loose
        // hints they carried a left edge of their own beside every card above.
        <GroupCard>
          <RowList>
            {ops.map((op) => (
              <Row key={op.id} subtitle={op.path} title={op.op_type} />
            ))}
          </RowList>
        </GroupCard>
      )}
    </>
  );
}
