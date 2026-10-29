import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronRight, Cloud, FolderOpen, KeyRound, Pencil, RefreshCw, Stethoscope, Trash2, Unplug, Upload } from "lucide-react";
import { mConfirm, mPrompt } from "./services/mobileDialogs";
import {
  getSyncStatus,
  pauseSyncHere,
  resumeSyncHere,
  subscribeSyncStatus,
  syncNow,
} from "./services/syncService";
import { SYNC_DIAGNOSTICS_EVENT, loadSyncDiagnostics, isMobileSettingsSyncEnabled, mobileEncryptionStatus } from "./services/mobileSettingsSync";
import { reconnectVault } from "./services/oauthService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, isExternalVault, type VaultEntry } from "./services/vaultRegistry";
import { currentVaultFolderPlatform, getVaultFolderPlugin, pickVaultFolder, type VaultFolderAccess } from "./platform/vaultFolder";
import { deleteVault, reloadActiveMobileVault, switchVault, type MobileVault } from "./services/vaultService";
import { exportVault } from "./services/vaultExport";
import { getMobileSettings } from "./services/mobileSettings";
import { Banner, Button, emptyDiagnostics, familyLabel, familyOfSyncProvider, GroupCard, ICON, InfoTip, Row, RowList, SectionLabel, type SyncDiagnostics, type SyncProviderId, toast } from "@plainva/ui";
import { AppBar } from "./components/AppBar";
import { syncStateLabel } from "./components/syncSubtitle";

/* The provider NAME comes from the shared family table (N5.1). This file kept
   its own map, which is how the phone ended up with two spellings of the same
   cloud on two of its surfaces. */
const providerNameOf = (provider: string) => familyLabel(familyOfSyncProvider(provider as SyncProviderId));

/** The vault record, re-read whenever the registry changes. */
function useVaultEntry(vaultId: string): VaultEntry | null {
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  useEffect(() => {
    void getVaultEntry(vaultId).then(setEntry);
    const reload = () => void getVaultEntry(vaultId).then(setEntry);
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [vaultId]);
  return entry;
}

/**
 * Synchronisation of one vault (settings plan 2026-10-29, E11/B5): the
 * settings area "Sync" carries the sync and nothing else. Until then this
 * screen was "vault details" with four topics — state, connection, a ZIP
 * archive and the vault's own name, export and deletion. The ZIP archive went
 * to Backup & versioning (move 21), rename, export and delete to the vault's
 * own page below (moves 22, 23); the cloud folder and the interval live on the
 * account's files page, as on the desktop, and are one row away (move 26).
 *
 * N3.1 — the grammar, not a stack of buttons: a chevron means the row LEADS
 * somewhere, a row without one ACTS, and a button remains only for the single
 * call to action a state asks for. The danger group outlines itself.
 */
export function VaultSyncScreen({
  vaultId,
  activeVault,
  onBack,
  onOpenSyncChain,
  onOpenSyncDiagnostics,
  onOpenFilesAccount,
  onOpenFilesSettings,
}: {
  vaultId: string;
  activeVault: MobileVault;
  onBack: () => void;
  /** The three-step chain, its own destination since N4.3 (E3). */
  onOpenSyncChain: () => void;
  /** What the settings sync last did here — its own destination (E3). */
  onOpenSyncDiagnostics: () => void;
  /** The account that carries this vault's files, where it signs in on this phone (third review, finding 3). */
  onOpenFilesAccount: () => void;
  /** That account's files page: cloud folder and interval (move 26). */
  onOpenFilesSettings: () => void;
}) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const entry = useVaultEntry(vaultId);
  const [busy, setBusy] = useState(false);
  const isActive = activeVault.vaultId === vaultId;
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");
  const [interval, setIntervalSeconds] = useState(() => getMobileSettings().syncIntervalSeconds);
  /** Waiting operations — part of the one state line (S36), null until read. */
  const [pending, setPending] = useState<number | null>(null);
  /** What the settings sync last did here (P1/S10) — a report, not a control. */
  const [diag, setDiag] = useState<SyncDiagnostics>(emptyDiagnostics());

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
      void mobileEncryptionStatus(activeVault).then(setEncryption);
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

  // The number the state line shows. Re-read when a cycle settles, so
  // "0 waiting" is a reading rather than a claim.
  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    void activeVault.syncQueue?.getPendingOperations().then((list) => {
      if (alive) setPending(list.length);
    });
    return () => {
      alive = false;
    };
  }, [activeVault, isActive, status.status, status.lastSyncAt]);

  if (!entry) return <div className="m-page" />;

  const providerName = entry.provider ? providerNameOf(entry.provider) : "";
  const connected = isActive && status.status !== "off";
  const externalRef = isExternalVault(entry) ? entry.external : null;

  const statusLabel =
    status.status === "syncing" && status.progress
      ? t("sync.syncingCount", { current: status.progress.current, total: status.progress.total })
      : syncStateLabel(status, t);

  /** The one reading: which cloud, when it last ran, how much waits, how often
   *  it runs. Four answers that used to be a headline, a hint, a sub-list and
   *  a settings row — four places for one question. */
  const providerLine = [
    entry.provider ? providerName : null,
    status.lastSyncAt
      ? t("mobile.lastSync", {
          time: new Date(status.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        })
      : null,
    pending === null ? null : t("mobile.pendingCount", { count: pending }),
    t("mobile.syncIntervalValue", { seconds: interval }),
  ]
    .filter(Boolean)
    .join(" · ");

  /** The chain in one word, the same words as the desktop's row. */
  const chainState = !settingsSyncOn
    ? t("common.off")
    : encryption === "locked"
      ? t("settingsSync.needsPassphrase")
      : encryption === "unlocked"
        ? t("settingsSync.chainStateEncrypted")
        : t("common.on");

  return (
    <div className="m-page">
      <AppBar onBack={onBack} subtitle={entry.provider ? providerName : ""} title={t("settings.syncSection")} testId="appbar-area-sync" />

      <div className="m-settings">
        {/* State first (S36). The headline is the STATE (N4.3) — the one
            question someone opens this page with: is it running? Which cloud
            it is reports itself in the meta line with the rest of the reading. */}
        <div className="m-statcard">
          <span className="m-statcard-head">
            {isActive && entry.provider && !entry.pausedHere ? (
              <>
                {status.status === "error" ? (
                  <AlertTriangle className="m-error" size={ICON.ui} />
                ) : (
                  // `retrying` keeps the cloud and only dims it: it is not a
                  // problem yet, and red is reserved for one that is.
                  <Cloud
                    className={status.status === "retrying" || !connected ? "m-chevron" : "m-accent"}
                    size={ICON.ui}
                  />
                )}
                {statusLabel}
              </>
            ) : entry.provider ? (
              // The STATE, not the action: "Trennen" is the danger row below.
              t("mobile.syncDisconnected")
            ) : (
              t("mobile.vaultNoCloudTitle")
            )}
          </span>
          {isActive && entry.provider ? (
            <p className="m-statcard-meta">{providerLine}</p>
          ) : !entry.provider ? (
            // Without a provider there is no state to report — say why.
            <p className="m-statcard-meta">{externalRef ? t("mobile.vaultExternalNoCloud") : t("mobile.vaultNoCloud")}</p>
          ) : (
            <p className="m-statcard-meta">{providerName}</p>
          )}
          {isActive && connected && (
            <Button variant="ghost" disabled={busy} onClick={() => syncNow()}>
              {t("mobile.syncNow")}
            </Button>
          )}
        </div>
        {/* A listing its own files contradict (finding 2026-09-20): said with
            the numbers behind the info, as a state — nothing was deleted, nobody
            is asked, and the way on is to list again. */}
        {isActive && status.listingIncomplete && (
          <Banner kind="warning" rounded>
            <strong data-testid="sync-listing-incomplete">{t("sync.listingIncompleteTitle")}</strong>
            <InfoTip
              label={t("sync.listingIncompleteTitle")}
              info={t(status.listingIncomplete.empty ? "sync.listingIncompleteEmpty" : "sync.listingIncompleteBody", {
                missing: status.listingIncomplete.missing,
                total: status.listingIncomplete.confirmed,
                present: status.listingIncomplete.present,
                probed: status.listingIncomplete.probed,
              })}
            />
            <Button variant="tonal" disabled={busy} onClick={() => syncNow()}>{t("sync.listingIncompleteRetry")}</Button>
          </Banner>
        )}
        {/* The cloud folder of a vault that has synced before is gone: Plainva
            created no replacement (plan A4); the account's files page picks it. */}
        {isActive && status.rootMissing && !status.listingIncomplete && (
          <Banner kind="error" rounded>{t("sync.rootMissingBody")}</Banner>
        )}
        {isActive && status.message && !status.listingIncomplete && !status.rootMissing && <Banner kind={status.status === "retrying" ? "info" : "error"} rounded>{status.message}</Banner>}
        {isActive && status.collisions.length > 0 && (
          // A decision, not a failure: the sync keeps running for every other
          // file (finding 2026-08-21).
          <Banner kind="warning" rounded>
            <strong>{t("sync.collisionTitle")}</strong>
            <InfoTip label={t("sync.collisionTitle")} info={t("sync.collisionBody")} />
            <p className="m-hint">{t("sync.collisionHint")}</p>
            <ul className="m-collide">
              {status.collisions.map((c) => (
                <li key={`${c.path}|${c.twin}`}>
                  {c.path}
                  <span aria-hidden="true"> ↔ </span>
                  {c.twin}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        {/* Signed out on this phone: the status says "Sign-in needed" and leads
            to the account, where the sign-in is - as the desktop's sync dialog
            does (third review, finding 3). */}
        {isActive && status.errorKind === "signed-out" && (
          <Button variant="tonal" onClick={onOpenFilesAccount} data-testid="vault-files-signin">
            {t("deviceSignIn.submit")}
          </Button>
        )}
        {isActive && (status.errorKind === "pair-required" || status.errorKind === "workspace-integrity") && (
          <Button variant="tonal" onClick={() => window.dispatchEvent(new CustomEvent("m-open-security"))}>
            {t("workspaceSecurity.openSecurity", { defaultValue: "Open Security & Sharing" })}
          </Button>
        )}
        {/* A paused sync has exactly one thing to say, so it says it as the
            call to action rather than as the fourth row of a list. */}
        {entry.provider && entry.pausedHere && (
          <div className="m-sync-actions m-sync-actions--column">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void resumeSyncHere(vaultId).finally(() => setBusy(false));
              }}
            >
              {t("mobile.syncResume")}
            </Button>
          </div>
        )}

        {entry.provider && (
          <>
            <SectionLabel>{t("mobile.vaultGroupConnection")}</SectionLabel>
            <GroupCard>
              <RowList>
                {(entry.provider === "drive" || entry.provider === "onedrive" || entry.provider === "dropbox") && (
                  <Row
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Cloud size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void reconnectVault(vaultId).finally(() => setBusy(false));
                    }}
                    title={t("cloudAccounts.reconnect")}
                  />
                )}
                {/* The folder and the cadence used to stand here AND on the
                    account's files page; they live there, as on the desktop. */}
                {isActive && (
                  <Row
                    data-testid="vault-sync-files-settings"
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<RefreshCw size={ICON.ui} />}
                    onClick={onOpenFilesSettings}
                    subtitle={t("mobile.syncIntervalValue", { seconds: interval })}
                    title={t("cloudAccounts.openAccountFiles")}
                  />
                )}
                {/* E3: the chain and the report each get their own destination.
                    A row can say what state they are in; only the destination
                    has room to say why. */}
                {isActive && (
                  <Row
                    data-testid="vault-sync-chain"
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<KeyRound size={ICON.ui} />}
                    onClick={onOpenSyncChain}
                    subtitle={chainState}
                    title={t("settingsSync.chainLabel")}
                  />
                )}
                {isActive && (
                  <Row
                    data-testid="vault-sync-diagnostics"
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Stethoscope size={ICON.ui} />}
                    onClick={onOpenSyncDiagnostics}
                    subtitle={
                      diag.lastCheck
                        ? new Date(diag.lastCheck.at).toLocaleString()
                        : t("settingsSync.diagNever")
                    }
                    title={t("settings.groupDiagnostics")}
                  />
                )}
              </RowList>
            </GroupCard>
          </>
        )}

        {/* Pausing concerns the sync, so it ends THIS page (B6). */}
        {entry.provider && !entry.pausedHere && (
          <>
            <SectionLabel className="m-danger">{t("mobile.vaultGroupDanger")}</SectionLabel>
            <GroupCard tone="danger">
              <RowList>
                <Row
                  icon={<Unplug className="m-danger" size={ICON.ui} />}
                  onClick={() => {
                    setBusy(true);
                    void pauseSyncHere(vaultId).finally(() => setBusy(false));
                  }}
                  title={<span className="m-danger">{t("cloudAccounts.pauseSync")}</span>}
                />
              </RowList>
            </GroupCard>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The vault itself (settings plan 2026-10-29, § 4.2): reached through
 * "Active vault" → Vaults → a vault's row. Its head says what it is and where
 * it lives; then using it, renaming, exporting, the way to its sync, and at the
 * end deleting it. Deleting removes the device-local container, database and
 * credentials — never the cloud storage.
 */
export function VaultDetailScreen({
  vaultId,
  activeVault,
  onBack,
  onOpenSync,
}: {
  vaultId: string;
  activeVault: MobileVault;
  onBack: () => void;
  /** This vault's sync page. */
  onOpenSync: () => void;
}) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const entry = useVaultEntry(vaultId);
  const [busy, setBusy] = useState(false);
  const isLocal = vaultId === LOCAL_VAULT_ID;
  const isActive = activeVault.vaultId === vaultId;

  // External folder (P7): what the platform says about the grant right now.
  // Asked on every open of this page — a grant can go away between two looks.
  const [folderAccess, setFolderAccess] = useState<VaultFolderAccess | null>(null);
  const externalRef = isExternalVault(entry) ? entry.external : null;
  useEffect(() => {
    if (!externalRef) return;
    let alive = true;
    void getVaultFolderPlugin()
      .resolve({ handle: externalRef.handle })
      .then((a) => { if (alive) setFolderAccess(a); })
      .catch(() => { if (alive) setFolderAccess({ state: "expired", label: externalRef.label }); });
    return () => { alive = false; };
  }, [externalRef]);

  if (!entry) return <div className="m-page" />;

  const name = entry.name || t("mobile.vaultLocal");
  const providerName = entry.provider ? providerNameOf(entry.provider) : "";

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

  const reconnectFolder = () => {
    void (async () => {
      const platform = currentVaultFolderPlatform();
      if (!platform || !externalRef) return;
      const picked = await pickVaultFolder();
      if (!picked.picked) return;
      setBusy(true);
      try {
        await getVaultFolderPlugin().release({ handle: externalRef.handle }).catch(() => {});
        await updateVault(vaultId, { external: { handle: picked.handle, label: picked.label, platform } });
        if (isActive) await reloadActiveMobileVault();
        setFolderAccess({ state: "ok", label: picked.label });
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = () => {
    void (async () => {
      const ok = await mConfirm({
        title: t("mobile.vaultDelete"),
        // A picked folder: the connection goes, the files stay — said in words (P7).
        message: externalRef ? t("mobile.vaultExternalRemoveConfirm", { name, label: externalRef.label }) : t("mobile.vaultDeleteConfirm", { name }),
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

  /** Where it lives and how it is: the head line of the vault. */
  const stateLine = entry.provider
    ? [providerName, isActive ? syncStateLabel(status, t) : entry.pausedHere ? t("mobile.syncDisconnected") : null].filter(Boolean).join(" · ")
    : externalRef
      ? t("mobile.vaultExternalTitle")
      : t("mobile.vaultNoCloudTitle");

  return (
    <div className="m-page">
      <AppBar onBack={onBack} subtitle={entry.provider ? providerName : ""} title={name} />

      <div className="m-settings">
        <div className="m-statcard">
          <span className="m-statcard-head">
            {externalRef && folderAccess?.state === "expired" ? <AlertTriangle className="m-error" size={ICON.ui} /> : externalRef ? <FolderOpen className="m-accent" size={ICON.ui} /> : null}
            {name}
          </span>
          <p className="m-statcard-meta" data-testid="vault-detail-state">{stateLine}</p>
          {externalRef && (
            <>
              <p className="m-statcard-meta" data-testid="vault-external-state">
                {folderAccess?.state === "expired"
                  ? t("mobile.vaultExternalExpired", { label: externalRef.label })
                  : t("mobile.vaultExternalOk", { label: folderAccess?.state === "ok" && folderAccess.label ? folderAccess.label : externalRef.label })}
              </p>
              {folderAccess?.state === "expired" && (
                <Button variant="tonal" disabled={busy} onClick={reconnectFolder} data-testid="vault-external-reconnect">
                  {t("mobile.vaultExternalReconnect")}
                </Button>
              )}
            </>
          )}
        </div>

        {!isActive && (
          <div className="m-sync-actions m-sync-actions--column">
            <Button variant="primary" disabled={busy} onClick={() => void switchVault(vaultId)}>
              <Check size={ICON.ui} /> {t("mobile.vaultUse")}
            </Button>
          </div>
        )}

        {(!isLocal || isActive || entry.provider) && (
          <>
            <SectionLabel>{t("settings.sectionVault")}</SectionLabel>
            <GroupCard>
              <RowList>
                {!isLocal && (
                  <Row
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Pencil size={ICON.ui} />}
                    onClick={rename}
                    title={t("mobile.vaultRename")}
                  />
                )}
                {isActive && (
                  <Row
                    icon={<Upload size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void exportVault(activeVault, entry.name)
                        .catch(() => toast.warning(t("mobile.vaultExportFailed")))
                        .finally(() => setBusy(false));
                    }}
                    title={t("mobile.vaultExport")}
                  />
                )}
                {entry.provider && (
                  <Row
                    data-testid="vault-open-sync"
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Cloud size={ICON.ui} />}
                    onClick={onOpenSync}
                    title={t("settings.syncSection")}
                  />
                )}
              </RowList>
            </GroupCard>
          </>
        )}

        {/* Everything that cannot be undone by tapping again, behind its own
            outline and in the destructive colour (B1). */}
        {!isLocal && (
          <>
            <SectionLabel className="m-danger">{t("mobile.vaultGroupDanger")}</SectionLabel>
            <GroupCard tone="danger">
              <RowList>
                <Row
                  icon={<Trash2 className="m-danger" size={ICON.ui} />}
                  onClick={remove}
                  title={<span className="m-danger">{t("mobile.vaultDelete")}</span>}
                />
              </RowList>
            </GroupCard>
          </>
        )}
      </div>
    </div>
  );
}
