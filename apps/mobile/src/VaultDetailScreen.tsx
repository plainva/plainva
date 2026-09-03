import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Archive, Check, ChevronRight, Cloud, FolderOpen, KeyRound, Layers, Pencil, Play, RefreshCw, Stethoscope, Trash2, Unplug, Upload } from "lucide-react";
import { mConfirm, mPrompt, mSelect } from "./services/mobileDialogs";
import {
  canChangeRemoteFolder,
  changeRemoteFolder,
  getStoredProvider,
  getSyncStatus,
  listProviderFolders,
  pauseProvider,
  resumeProvider,
  restartSync,
  subscribeSyncStatus,
  syncNow,
  type MobileSyncProvider,
  createProviderFolder,
} from "./services/syncService";
import { SYNC_DIAGNOSTICS_EVENT, loadSyncDiagnostics, isMobileSettingsSyncEnabled, mobileEncryptionStatus } from "./services/mobileSettingsSync";
import { reconnectVault } from "./services/oauthService";
import { getVaultEntry, updateVault, LOCAL_VAULT_ID, isExternalVault, type VaultEntry } from "./services/vaultRegistry";
import { currentVaultFolderPlatform, getVaultFolderPlugin, type VaultFolderAccess } from "./platform/vaultFolder";
import { deleteVault, reloadActiveMobileVault, switchVault, type MobileVault } from "./services/vaultService";
import { exportVault } from "./services/vaultExport";
import { backupState, listBackups, runVaultBackup } from "./services/vaultBackup";
import { readSyncRootFolder } from "./services/syncRootFolder";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { getMobileSettings, applyVaultSettings } from "./services/mobileSettings";
import { MIN_SYNC_INTERVAL_SECONDS } from "./services/mobileSettingsScope";
import { Banner, Button, emptyDiagnostics, familyLabel, familyOfSyncProvider, GroupCard, ICON, Row, RowList, SectionLabel, Switch, type SyncDiagnostics, type SyncProviderId, toast } from "@plainva/ui";
import { AppBar } from "./components/AppBar";
import { syncStateLabel } from "./components/syncSubtitle";

/* The provider NAME comes from the shared family table (N5.1). This file kept
   its own map, which is how the phone ended up with two spellings of the same
   cloud on two of its surfaces. */
const providerNameOf = (provider: string) => familyLabel(familyOfSyncProvider(provider as SyncProviderId));

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
  onOpenSyncChain,
  onOpenSyncDiagnostics,
}: {
  vaultId: string;
  activeVault: MobileVault;
  onBack: () => void;
  /** The three-step chain, its own destination since N4.3 (E3). */
  onOpenSyncChain: () => void;
  /** What the settings sync last did here — its own destination (E3). */
  onOpenSyncDiagnostics: () => void;
}) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const isLocal = vaultId === LOCAL_VAULT_ID;
  const isActive = activeVault.vaultId === vaultId;
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");
  /** H2a: cycle interval, per vault and syncable (was hard-coded to 30 s). */
  const [interval, setIntervalSeconds] = useState(() => getMobileSettings().syncIntervalSeconds);
  /** Waiting operations — part of the one state line (S36), null until read. */
  const [pending, setPending] = useState<number | null>(null);
  /** Scheduled archive (S36): how many exist, and its two settings. */
  const [archives, setArchives] = useState<string[] | null>(null);
  const [zipOn, setZipOn] = useState(() => backupState(vaultId).enabled);
  const [zipKeep, setZipKeep] = useState(() => backupState(vaultId).keep);
  const [zipLast, setZipLast] = useState(() => backupState(vaultId).lastRun);
  /** H2d: change the remote folder of an existing connection. */
  const [folderPick, setFolderPick] = useState<MobileSyncProvider | null>(null);
  // The folder as it is CONFIGURED, for the confirmation text. Since the
  // finding of 2026-08-19 it lives in the settings, not the credential blob.
  const [pickStart, setPickStart] = useState("");
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

  // The two numbers the state line and the contents group show. Re-read when a
  // cycle settles, so "0 waiting" is a reading rather than a claim.
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

  useEffect(() => {
    let alive = true;
    void listBackups(entry?.name || "").then((list) => {
      if (alive) setArchives(list);
    });
    return () => {
      alive = false;
    };
  }, [entry?.name, busy]);

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

  const reconnectFolder = () => {
    void (async () => {
      const platform = currentVaultFolderPlatform();
      if (!platform || !externalRef) return;
      const picked = await getVaultFolderPlugin().pickFolder();
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

  const statusLabel =
    status.status === "syncing" && status.progress
      ? t("sync.syncingCount", { current: status.progress.current, total: status.progress.total })
      : syncStateLabel(status, t);

  /**
   * One line that answers "is it healthy?": when it last ran, how much is
   * waiting, how often it runs. Those three readings were a hint, a sub-list
   * and a settings row before — three places for one question.
   */
  const hasConnectionRows =
    !isLocal ||
    (isActive && !!entry.provider) ||
    (isActive && canChangeRemoteFolder(entry.provider)) ||
    !!(entry.provider && entry.paused) ||
    entry.provider === "drive" ||
    entry.provider === "onedrive" ||
    entry.provider === "dropbox";

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

  return (
    <div className="m-page">
      <AppBar onBack={onBack} subtitle={entry.provider ? providerName : ""} title={name} />

      <div className="m-settings">
        {/* State first (S36). The screen used to open with a provider row, a
            status row and a "last sync" hint scattered among nine controls; the
            one question someone opens this page with — is it running? — took
            three separate readings to answer. */}
        <div className="m-statcard">
          {/* The headline is the STATE (N4.3). It used to name the provider —
              "Google Drive" — and put "Synchron" a line below it, which answers
              the question nobody asks first: the vault detail is opened to find
              out whether the thing is running. Which cloud it is has not
              changed since it was connected, so it reports itself in the meta
              line together with the rest of the reading. */}
          <span className="m-statcard-head">
            {isActive && entry.provider && !entry.paused ? (
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
              // The STATE, not the action. Both the title and the badge below
              // it read `syncDisconnect` ("Trennen"), so a paused vault
              // announced itself as "Trennen Trennen" — and the action it
              // seemed to offer is a danger row further down. The badge goes
              // with it: the title now says the same thing once.
              t("mobile.syncDisconnected")
            ) : externalRef ? (
              <>
                {folderAccess?.state === "expired" ? <AlertTriangle className="m-error" size={ICON.ui} /> : <FolderOpen className="m-accent" size={ICON.ui} />}
                {t("mobile.vaultExternalTitle")}
              </>
            ) : (
              t("mobile.vaultNoCloudTitle")
            )}
          </span>
          {externalRef && (
            <>
              <p className="m-statcard-meta" data-testid="vault-external-state">
                {folderAccess?.state === "expired"
                  ? t("mobile.vaultExternalExpired", { label: externalRef.label })
                  : t("mobile.vaultExternalOk", { label: folderAccess?.state === "ok" && folderAccess.label ? folderAccess.label : externalRef.label })}
              </p>
              {/* E4, in words: no cloud sync for a folder another program keeps. */}
              <p className="m-statcard-meta">{t("mobile.vaultExternalNoCloud")}</p>
              {folderAccess?.state === "expired" && (
                <Button variant="tonal" disabled={busy} onClick={reconnectFolder} data-testid="vault-external-reconnect">
                  {t("mobile.vaultExternalReconnect")}
                </Button>
              )}
            </>
          )}
          {isActive && entry.provider ? (
            <p className="m-statcard-meta">{providerLine}</p>
          ) : !entry.provider && !externalRef ? (
            // Without a provider there is no state to report — say that rather
            // than leave a card that only repeats the title.
            <p className="m-statcard-meta">{t("mobile.vaultNoCloud")}</p>
          ) : !entry.provider ? null : (
            <p className="m-statcard-meta">{providerName}</p>
          )}
          {isActive && connected && (
            <Button variant="ghost" disabled={busy} onClick={() => syncNow()}>
              {t("mobile.syncNow")}
            </Button>
          )}
        </div>
        {isActive && status.message && <Banner kind="error" rounded>{status.message}</Banner>}
        {isActive && status.collisions.length > 0 && (
          // A decision, not a failure: the sync keeps running for every other
          // file. It used to arrive as one English sentence inside the error
          // status, which German users read in English and nobody could act on
          // (finding 2026-08-21).
          <Banner kind="warning" rounded>
            <strong>{t("sync.collisionTitle")}</strong>
            <p className="m-hint">{t("sync.collisionBody")}</p>
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
        {isActive && status.errorKind === "pair-required" && (
          <Button variant="tonal" onClick={() => window.dispatchEvent(new CustomEvent("m-open-security"))}>
            {t("workspaceSecurity.openSecurity", { defaultValue: "Open Security & Sharing" })}
          </Button>
        )}
        {/* The interval, the chain and the diagnostics used to stand here in
            full — some 280 lines between the status card and the vault's own
            actions, on a screen someone opens to ask one question. They are
            named rows with their own destinations now (E3); the queue moved
            with the diagnostics, where a list of waiting operations belongs. */}

        {/* N3.1 — the grammar, not a stack of buttons.
            Nine identical full-width buttons used to end this screen, seven of
            them visible at once for a cloud vault, putting the mildest action
            beside the most destructive one and rendering them alike. They are
            grouped rows now, under the name of what they are FOR, and the
            arrangement follows one rule: a chevron means the row LEADS
            somewhere, a row without one ACTS, and a button remains only for the
            single call to action a state asks for. The danger group outlines
            itself and carries the destructive colour, so "Vault löschen" can no
            longer look like "Umbenennen".
            S39 moved the index actions to the maintenance area — this screen is
            the vault's connection and identity, that one is its contents. */}
        {!isActive && (
          <div className="m-sync-actions m-sync-actions--column">
            <Button variant="primary" disabled={busy} onClick={() => void switchVault(vaultId)}>
              <Check size={ICON.ui} /> {t("mobile.vaultUse")}
            </Button>
          </div>
        )}
        {/* A paused sync has exactly one thing to say, so it says it as the
            call to action rather than as the fourth row of a list. */}
        {entry.provider && entry.paused && (
          <div className="m-sync-actions m-sync-actions--column">
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
          </div>
        )}

        {/* A heading over an empty group is a promise the page does not keep:
            the on-device vault has no provider and cannot be renamed, so this
            whole block has nothing to show for it. */}
        {hasConnectionRows && (
          <>
            <SectionLabel>{t("mobile.vaultGroupConnection")}</SectionLabel>
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
                {/* H2d: the folder was only choosable while connecting; the
                    desktop has had this on its sync page. Not offered for
                    WebDAV, where the folder is baked into the base URL. */}
                {isActive && canChangeRemoteFolder(entry.provider) && (
                  <Row
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Cloud size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void getStoredProvider(vaultId)
                        .then(async (stored) => {
                          if (!stored) return;
                          setPickStart(await readSyncRootFolder(vaultId, stored.provider, stored));
                          setFolderPick(stored);
                        })
                        .finally(() => setBusy(false));
                    }}
                    title={t("mobile.changeCloudFolder")}
                  />
                )}
                {entry.provider && (entry.provider === "drive" || entry.provider === "onedrive" || entry.provider === "dropbox") && (
                  <Row
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<Cloud size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void reconnectVault(vaultId).finally(() => setBusy(false));
                    }}
                    title={t("mobile.reconnectAction")}
                  />
                )}
                {/* H2a: the cycle interval was hard-coded to 30 s on mobile
                    while the desktop exposed it AND synced it in the profile —
                    a value set there never arrived here. Same field, same lower
                    bound, applied live. It picks from a list, so it acts. */}
                {isActive && entry.provider && (
                  <Row
                    disabled={busy}
                    icon={<RefreshCw size={ICON.ui} />}
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
                    subtitle={t("mobile.syncIntervalValue", { seconds: interval })}
                    title={t("settings.syncInterval")}
                  />
                )}
                {/* E3: the chain and the report each get their own destination.
                    Both used to stand open on this screen — a stepper and a
                    five-reading table between the status card and the vault's
                    own actions. A row can say what state they are in; only the
                    destination has room to say why. */}
                {isActive && entry.provider && (
                  <Row
                    data-testid="vault-sync-chain"
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    icon={<KeyRound size={ICON.ui} />}
                    onClick={onOpenSyncChain}
                    subtitle={
                      settingsSyncOn
                        ? encryption === "locked"
                          ? t("settingsSync.needsPassphrase")
                          : t("common.on")
                        : t("common.off")
                    }
                    title={t("settingsSync.chainLabel")}
                  />
                )}
                {isActive && entry.provider && (
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
                    title={t("settingsSync.diagTitle")}
                  />
                )}
              </RowList>
            </GroupCard>
          </>
        )}

        {isActive && (
          <>
            <SectionLabel>{t("mobile.vaultGroupContents")}</SectionLabel>
            <GroupCard>
              <RowList>
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
                {/* The scheduled archive (S36). The desktop has had a daily ZIP
                    with retention since its backup package; the phone had the
                    on-demand export above and nothing else — so a vault nobody
                    thought to export by hand had no archive at all. */}
                <Row
                  /* The title breaks rather than clips. A settings title
                     normally may clip because the VALUE beside it carries the
                     meaning — but the value here is a switch, which carries
                     none, and what got cut was "(ZIP)": the part that says what
                     kind of backup this is. By the rule's own reasoning this is
                     a content title. */
                  wrap
                  end={
                    <Switch
                      label={t("settings.backupZipEnabled")}
                      checked={zipOn}
                      onChange={(on) => {
                        setZipOn(on);
                        void applyVaultSettings(vaultId, { backupZipEnabled: on });
                      }}
                    />
                  }
                  icon={<Archive size={ICON.ui} />}
                  /* The count of retained backups has its own editable row
                     below; repeating it here would be the same number twice.
                     What that row cannot say is whether the schedule has ever
                     actually run — which is the only way an archive that
                     silently never happens becomes visible. */
                  subtitle={
                    !zipOn
                      ? t("mobile.backupZipOff")
                      : zipLast
                        ? t("mobile.backupZipOn", {
                            count: archives?.length ?? 0,
                            when: new Date(zipLast).toLocaleDateString(),
                          })
                        : t("mobile.backupZipNever")
                  }
                  title={t("settings.backupZipEnabled")}
                />
                {zipOn && (
                  <Row
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    /* These two rows belong to the schedule above, and until now
                       they said so with an indent (N9.2). On a phone that read as
                       a mistake rather than as belonging: it was the only indent
                       on this screen, and an indent that appears once has no
                       sibling to be read against. What carries the dependency
                       instead is the thing that was already true — both rows
                       exist ONLY while the switch is on (E2). */
                    icon={<Layers size={ICON.ui} />}
                    onClick={() => {
                      void mSelect({
                        title: t("settings.backupZipKeep"),
                        options: [3, 7, 14, 30].map((n) => ({ value: String(n), label: String(n) })),
                        value: String(zipKeep),
                      }).then(async (picked) => {
                        if (picked === null) return;
                        const keep = Math.max(1, Number(picked));
                        setZipKeep(keep);
                        await applyVaultSettings(vaultId, { backupZipKeep: keep });
                      });
                    }}
                    subtitle={String(zipKeep)}
                    title={t("settings.backupZipKeep")}
                  />
                )}
                {zipOn && (
                  <Row
                    icon={<Play size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void runVaultBackup(activeVault, entry.name)
                        .then((file) => {
                          // The sub-line reports the last run; leaving it stale
                          // right after a manual one would be the one moment it
                          // is provably wrong.
                          setZipLast(backupState(vaultId).lastRun);
                          toast.info(file ? t("mobile.backupZipDone", { name: file }) : t("mobile.vaultExportFailed"));
                        })
                        .catch(() => toast.warning(t("mobile.vaultExportFailed")))
                        .finally(() => setBusy(false));
                    }}
                    title={t("settings.backupNowButton")}
                  />
                )}
              </RowList>
            </GroupCard>
          </>
        )}

        {/* Everything that cannot be undone by tapping again, behind its own
            outline and in the destructive colour — not the fourth tonal button
            of the same run. */}
        {(!isLocal || (entry.provider && !entry.paused)) && (
          <>
            <SectionLabel className="m-danger">{t("mobile.vaultGroupDanger")}</SectionLabel>
            <GroupCard tone="danger">
              <RowList>
                {entry.provider && !entry.paused && (
                  <Row
                    icon={<Unplug className="m-danger" size={ICON.ui} />}
                    onClick={() => {
                      setBusy(true);
                      void pauseProvider(vaultId).finally(() => setBusy(false));
                    }}
                    title={<span className="m-danger">{t("mobile.syncDisconnect")}</span>}
                  />
                )}
                {!isLocal && (
                  <Row
                    icon={<Trash2 className="m-danger" size={ICON.ui} />}
                    onClick={remove}
                    title={<span className="m-danger">{t("mobile.vaultDelete")}</span>}
                  />
                )}
              </RowList>
            </GroupCard>
          </>
        )}
      </div>
      {folderPick && (
        <CloudFolderPickerSheet
          title={t("mobile.changeCloudFolder")}
          listFolders={(path) => listProviderFolders(folderPick, path)}
          createFolder={(path) => createProviderFolder(folderPick, path)}
          onClose={() => setFolderPick(null)}
          onPick={(path) => {
            const target = path || pickStart;
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
    </div>
  );
}
