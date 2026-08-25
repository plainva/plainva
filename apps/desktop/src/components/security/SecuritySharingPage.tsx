import React, { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Banner, Button, ICON, Modal, QrImage, SettingCard, SettingCardNote, SettingRow, TextInput, toast, type SecurityAreaId } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import type { WorkspaceSliceObject } from "@plainva/core";
import { appConfirm } from "../../services/appDialogs";
import { AreaHead } from "../settings/AppPages";
import { ChevronRight, Laptop, ShieldCheck, Users } from "lucide-react";
import { parseSliceForm, roleName, type Diagnostics, type Governance, type GovernanceForm, type WorkspaceRole } from "./securityForms";
import { RekeyProgressCard, RevokeDialog, RoleMatrix, TechDetails, type RevokeSubject } from "./securityPanels";
import { WorkspaceGovernanceDialog } from "./WorkspaceGovernanceDialog";
import { WorkspaceSetupWizard } from "./WorkspaceSetupWizard";
import { WorkspaceJoinDialog } from "./WorkspaceJoinDialog";
import { encodeWorkspaceInvite } from "../../services/workspaceSecurity/workspacePairing";

interface SecuritySharingPageProps {
  selectedVault: string;
  isActiveVault: boolean;
  hasSyncConnection: boolean;
  /** The active management area (IA v2, P1) — null = the overview (first
   * level). Owned by the settings modal; the left-column SecurityNav sets it. */
  securityArea?: SecurityAreaId | null;
  onOpenSecurityArea?: (area: SecurityAreaId) => void;
}

type AdminArea = SecurityAreaId;

function phaseLabel(t: ReturnType<typeof useTranslation>["t"], phase: string): string {
  return t(`workspaceSecurity.phase.${phase}`, { defaultValue: phase });
}

/** Desktop P3-P11 security centre for personal and team encrypted workspaces. */
export const SecuritySharingPage: React.FC<SecuritySharingPageProps> = ({ selectedVault, isActiveVault, hasSyncConnection, securityArea, onOpenSecurityArea }) => {
  const { t } = useTranslation();
  const {
    workspaceSecurityStatus,
    preparePersonalWorkspace,
    activatePersonalWorkspace,
    unlockPersonalWorkspace,
    lockPersonalWorkspace,
    changeWorkspacePassphrase,
    removeRemotePlaintext,
    resumePersonalWorkspaceSetup,
    decommissionWorkspace,
    liftWorkspaceEncryption,
    getWorkspaceDiagnostics,
    getWorkspaceGovernance,
    inspectWorkspacePairingRequest,
    approveWorkspaceDevice,
    revokeWorkspaceDevice,
    revokeWorkspaceMember,
    inviteWorkspaceMember,
    createWorkspaceGroup,
    createWorkspaceSlice,
    previewWorkspaceSlice,
    listWorkspaceSliceObjects,
    restoreWorkspaceRecovery,
    rotateWorkspaceRecovery,
    activateWorkspaceRecovery,
    prepareWorkspaceOwnerTransfer,
    activateWorkspaceOwnerTransfer,
    updateWorkspaceQuarantine,
    exportWorkspaceQuarantine,
    detectJoinableWorkspace,
    openVault,
  } = useVault();
  const status = isActiveVault ? workspaceSecurityStatus : null;
  const [joinable, setJoinable] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ memberId: string; displayName: string; role?: string; self?: boolean } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  /**
   * Changing the local key passphrase (decision E6).
   *
   * A workspace whose keys are sealed by a passphrase rather than the system
   * keychain could set that passphrase three times - during setup, when joining
   * and when recovering - and never change it afterwards. The control plane has
   * been able to do it since the keychain service was written; nothing called
   * it. Content encryption offered the change all along, so the asymmetry was
   * an oversight, not a decision.
   */
  const [showPassphraseChange, setShowPassphraseChange] = useState(false);
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [nextPassphrase, setNextPassphrase] = useState("");
  const [nextPassphraseConfirm, setNextPassphraseConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [dialog, setDialog] = useState<"pair" | "invite" | "group" | "slice" | "recovery" | "rotate" | "owner" | null>(null);
  const [slicePreview, setSlicePreview] = useState<Array<{ objectId: string; path: string }> | null>(null);
  // Candidates the slice pickers choose FROM. Loaded when the wizard opens, not
  // with the page: the list walks the whole encrypted object index, and most
  // visits to this page never build a slice. `null` means "still loading".
  const [sliceObjects, setSliceObjects] = useState<WorkspaceSliceObject[] | null>(null);
  const [pairPreview, setPairPreview] = useState<Awaited<ReturnType<typeof inspectWorkspacePairingRequest>> | null>(null);
  // Removing a member or a device asks HOW in one dialog (P5, B9) instead of
  // offering two danger buttons whose difference only the confirmation explained.
  const [revokeFor, setRevokeFor] = useState<RevokeSubject | null>(null);
  const [rotatedRecoveryCode, setRotatedRecoveryCode] = useState<string | null>(null);
  // The security area is owned by the settings modal now (IA v2, P1): the left
  // column (SecurityNav) selects it and drives this via the prop. null = the
  // overview (first level); a value renders exactly that management area.
  const area: AdminArea | null = securityArea ?? null;
  const [form, setForm] = useState<GovernanceForm>({ code: "", name: "", role: "Reader", members: "", scopeKind: "workspace", scopeId: "", sliceKind: "folder", definition: "", publicationMode: "private", publicationAccess: "read", publicationProvider: "google-drive", recoveryCode: "", deviceName: navigator.platform || "Desktop", recoveryFile: "", fallbackPassphrase: "" });

  const refreshDiagnostics = useCallback(async () => {
    if (!isActiveVault || !hasSyncConnection) return setDiagnostics(null);
    try { setDiagnostics(await getWorkspaceDiagnostics()); }
    catch (error) { console.warn("[SecuritySharingPage] diagnostics failed", error); }
  }, [getWorkspaceDiagnostics, hasSyncConnection, isActiveVault]);

  const refreshGovernance = useCallback(async () => {
    if (!status || status.phase === "locked") return setGovernance(null);
    try { setGovernance(await getWorkspaceGovernance()); }
    catch (error) { console.warn("[SecuritySharingPage] governance failed", error); }
  }, [getWorkspaceGovernance, status]);

  useEffect(() => { void refreshDiagnostics(); void refreshGovernance(); }, [refreshDiagnostics, refreshGovernance, status?.phase]);
  // A vault that syncs a remote which already carries an encrypted workspace, but
  // has no local workspace status, is a join candidate (package C1): offer "join"
  // instead of only "set up".
  useEffect(() => {
    if (status || !isActiveVault || !hasSyncConnection) { setJoinable(false); return; }
    let cancelled = false;
    void detectJoinableWorkspace().then((remote) => { if (!cancelled) setJoinable(!!remote); });
    return () => { cancelled = true; };
  }, [detectJoinableWorkspace, status, isActiveVault, hasSyncConnection]);
  useEffect(() => {
    const refresh = () => void refreshGovernance();
    window.addEventListener("plainva-workspace-governance-changed", refresh);
    return () => window.removeEventListener("plainva-workspace-governance-changed", refresh);
  }, [refreshGovernance]);

  const runGovernance = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); setDialog(null); toast.info(success); await refreshGovernance(); await refreshDiagnostics(); }
    catch (error) { console.error("[SecuritySharingPage] governance action failed", error); toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const previewSlice = async () => {
    setBusy(true);
    try { setSlicePreview(await previewWorkspaceSlice(parseSliceForm(form))); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  /**
   * Opens the slice wizard. The publication mode is PINNED to "private" until
   * Stufe B builds the publishing path: `createWorkspaceSlice` would otherwise
   * persist a publication whose four core primitives have no caller, and the
   * success toast would report a share that never happens (B1, P1 2026-08-25).
   * Stufe B restores the caller-chosen mode here.
   */
  const openSliceWizard = (): void => {
    setSlicePreview(null);
    setSliceObjects(null);
    void listWorkspaceSliceObjects()
      .then(setSliceObjects)
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    setForm((current) => ({ ...current, name: "", definition: "", sliceKind: "folder", publicationMode: "private" }));
    setDialog("slice");
  };

  const closePassphraseChange = () => {
    setShowPassphraseChange(false);
    setCurrentPassphrase("");
    setNextPassphrase("");
    setNextPassphraseConfirm("");
  };

  const applyPassphraseChange = async () => {
    setBusy(true);
    try {
      await changeWorkspacePassphrase(currentPassphrase, nextPassphrase);
      closePassphraseChange();
      toast.info(t("workspaceSecurity.passphraseChanged"));
    } catch (error) {
      console.error("[SecuritySharingPage] passphrase change failed", error);
      toast.error(t("workspaceSecurity.passphraseChangeFailed"));
    } finally { setBusy(false); }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      await unlockPersonalWorkspace(passphrase || undefined);
      setPassphrase("");
      setShowUnlock(false);
    } catch (error) {
      console.error("[SecuritySharingPage] unlock failed", error);
      toast.error(t("workspaceSecurity.unlockFailed"));
    } finally { setBusy(false); }
  };

  /**
   * Picks the conversion back up where it stopped (finding 2026-08-25, B7).
   *
   * The key bundle is already on this device — this is the one state that must NOT offer
   * decommissioning, which is what the old `error` phase led people to.
   */
  const resumeSetup = async () => {
    setBusy(true);
    try {
      const result = await resumePersonalWorkspaceSetup();
      toast.info(t("workspaceSecurity.migrationStarted", { n: result.queued }));
      await refreshDiagnostics();
    } catch (error) {
      console.error("[SecuritySharingPage] resuming setup failed", error);
      toast.error(t("workspaceSecurity.setupFailed"));
    } finally { setBusy(false); }
  };

  const cleanupPlaintext = async () => {
    const ok = await appConfirm({
      title: t("workspaceSecurity.cleanupTitle"),
      message: t("workspaceSecurity.cleanupBody", { n: diagnostics?.legacyPlaintextPaths ?? 0 }),
      kind: "danger",
      confirmLabel: t("workspaceSecurity.cleanupAction"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const removed = await removeRemotePlaintext();
      toast.info(t("workspaceSecurity.cleanupDone", { n: removed }));
      await refreshDiagnostics();
    } catch (error) {
      console.error("[SecuritySharingPage] plaintext cleanup failed", error);
      toast.error(t("workspaceSecurity.cleanupFailed"));
    } finally { setBusy(false); }
  };

  const decommission = async () => {
    const ok = await appConfirm({
      title: t("workspaceSecurity.decommissionTitle"),
      message: t("workspaceSecurity.decommissionConfirm"),
      kind: "danger",
      confirmLabel: t("workspaceSecurity.decommissionAction"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await decommissionWorkspace();
      toast.info(t("workspaceSecurity.decommissionDone"));
    } catch (error) {
      console.error("[SecuritySharingPage] workspace decommission failed", error);
      toast.error(t("workspaceSecurity.decommissionFailed"));
    } finally { setBusy(false); }
  };

  const lift = async () => {
    const ok = await appConfirm({
      title: t("workspaceSecurity.liftEncryption"),
      message: t("workspaceSecurity.liftEncryptionConfirm"),
      kind: "danger",
      confirmLabel: t("workspaceSecurity.liftEncryptionAction"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await liftWorkspaceEncryption();
      toast.info(t("workspaceSecurity.liftEncryptionDone"));
    } catch (error) {
      console.error("[SecuritySharingPage] lift encryption failed", error);
      toast.error(t("workspaceSecurity.liftEncryptionFailed"));
    } finally { setBusy(false); }
  };

  /** Invite a NEW member, then jump straight to their invitation code (E5). */
  const submitInvite = async (): Promise<void> => {
    setBusy(true);
    try {
      const memberId = await inviteWorkspaceMember(
        form.name,
        form.role as "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor",
        form.scopeKind as "workspace" | "slice" | "object",
        form.scopeKind === "workspace" ? null : form.scopeId,
      );
      setDialog(null);
      await refreshGovernance();
      await refreshDiagnostics();
      setInviteFor({ memberId, displayName: form.name, role: form.role });
    } catch (error) {
      console.error("[SecuritySharingPage] invite failed", error);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitGovernanceDialog = (): Promise<void> => {
    if (dialog === "pair") return pairPreview ? runGovernance(() => approveWorkspaceDevice(pairPreview.token), t("workspaceSecurity.deviceApproved", { defaultValue: "Device approved" })) : inspectPairing();
    if (dialog === "invite") return submitInvite();
    if (dialog === "group") return runGovernance(() => createWorkspaceGroup({ name: form.name, memberIds: form.members.split(",").map((value) => value.trim()).filter(Boolean), role: form.role as "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor", scopeKind: form.scopeKind as "workspace" | "slice" | "object", scopeId: form.scopeKind === "workspace" ? null : form.scopeId }), t("workspaceSecurity.groupCreated", { defaultValue: "Group created" }));
    if (dialog === "slice") return runGovernance(async () => {
      const definition = parseSliceForm(form);
      const preview = await previewWorkspaceSlice(definition);
      await createWorkspaceSlice({ name: form.name, definition, materializedObjectIds: preview.map((entry) => entry.objectId), ...(form.publicationMode === "private" ? {} : { publication: { mode: form.publicationMode as "exact" | "sanitized", access: form.publicationAccess as "read" | "comment" | "suggest", provider: form.publicationProvider as "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3", propertyAllowlist: null, privateProperties: ["apiKey", "password", "private", "secret", "token"] } }) });
    }, form.publicationMode === "private" ? t("workspaceSecurity.sliceCreated", { defaultValue: "Slice created" }) : t("workspaceSecurity.publicationCreated", { defaultValue: "Encrypted publication configured" }));
    if (dialog === "rotate") return rotateRecovery();
    if (dialog === "owner") return transferOwner();
    return runGovernance(async () => {
      if (!form.recoveryFile) throw new Error("Select a recovery file");
      await restoreWorkspaceRecovery({ bytes: await readFile(form.recoveryFile), recoveryCode: form.recoveryCode, deviceDisplayName: form.deviceName, fallbackPassphrase: form.fallbackPassphrase || undefined, revokeOtherDevices: true });
    }, t("workspaceSecurity.recovered", { defaultValue: "Workspace access restored" }));
  };

  const inspectPairing = async (): Promise<void> => {
    setBusy(true);
    try { setPairPreview(await inspectWorkspacePairingRequest(form.code)); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const rotateRecovery = async (): Promise<void> => {
    if (!form.recoveryFile) throw new Error("Select a recovery file");
    setBusy(true);
    try {
      const rotated = await rotateWorkspaceRecovery({ bytes: await readFile(form.recoveryFile), recoveryCode: form.recoveryCode });
      const target = await save({ defaultPath: "Plainva-Recovery-Renewed.pvrecovery", filters: [{ name: "Plainva Recovery", extensions: ["pvrecovery"] }] });
      if (!target) throw new Error(t("workspaceSecurity.saveRequired", { defaultValue: "Save the renewed recovery file to finish." }));
      await writeFile(target, rotated.bytes);
      await activateWorkspaceRecovery(rotated.activation);
      setRotatedRecoveryCode(rotated.recoveryCode);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const transferOwner = async (): Promise<void> => {
    if (!form.recoveryFile || !form.scopeId) throw new Error(t("workspaceSecurity.ownerTransferRequirements", { defaultValue: "Choose the new owner and current recovery file." }));
    setBusy(true);
    try {
      const prepared = await prepareWorkspaceOwnerTransfer({ targetMemberId: form.scopeId, bytes: await readFile(form.recoveryFile), recoveryCode: form.recoveryCode });
      const target = await save({ defaultPath: "Plainva-Recovery-New-Owner.pvrecovery", filters: [{ name: "Plainva Recovery", extensions: ["pvrecovery"] }] });
      if (!target) throw new Error(t("workspaceSecurity.saveRequired", { defaultValue: "Save the replacement recovery file to finish." }));
      await writeFile(target, prepared.bytes);
      await activateWorkspaceOwnerTransfer(prepared.activation);
      setRotatedRecoveryCode(prepared.recoveryCode);
      await refreshGovernance();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const exportQuarantine = async (quarantineId: string): Promise<void> => {
    const bytes = await exportWorkspaceQuarantine(quarantineId);
    if (!bytes) return;
    const target = await save({ defaultPath: `Plainva-Quarantine-${quarantineId.slice(0, 12)}.bin` });
    if (target) await writeFile(target, bytes);
  };

  const requireWorkspace = async (action: () => void | Promise<void>, allowUnconfigured = false): Promise<void> => {
    if (!isActiveVault) {
      await openVault(selectedVault);
      toast.info(t("workspaceSecurity.vaultOpenedContinue", { defaultValue: "Vault opened. Choose the action again to continue." }));
      return;
    }
    if (!hasSyncConnection) {
      window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "cloudAccounts" } }));
      toast.info(t("workspaceSecurity.connectionOpened", { defaultValue: "Connect a file provider, then return to Security & Sharing." }));
      return;
    }
    if (!status && !allowUnconfigured) { setShowSetup(true); return; }
    if (status?.phase === "locked") { setShowUnlock(true); return; }
    await action();
  };

  return (
    // Plain <div> until now: banners, the hero and the cards sat flush against
    // each other because nothing owned the spacing between them.
    <div className="pv-security-page">
      <AreaHead areaId="security" />
      {/* Honesty gate (H6): the "experimental, not independently reviewed"
          caveat lived only in the What's-New text and the handbook — not where
          a workspace is actually created or joined. Shown in every sub-area. */}
      <Banner kind="warning" rounded>{t("workspaceSecurity.experimentalNotice")}</Banner>
      {area === null && (<>
      {!isActiveVault && <Banner kind="info" rounded>{t("workspaceSecurity.openVaultFirst")}</Banner>}
      {isActiveVault && !hasSyncConnection && <Banner kind="warning" rounded>{t("workspaceSecurity.connectionRequired")}</Banner>}

      <section className="pv-security-hero" aria-label={t("workspaceSecurity.currentStatus")}>
        <div className="pv-security-hero-icon"><ShieldCheck size={ICON.empty} /></div>
        <div className="pv-security-hero-copy">
          <strong>{status ? t("workspaceSecurity.workspaceProtected") : t("workspaceSecurity.notConfigured")}</strong>
          <span>{status ? `${phaseLabel(t, status.phase)} · ${status.deviceName}` : selectedVault}</span>
        </div>
        {status
          ? <Button variant="secondary" onClick={() => { setShowDetails((value) => !value); void refreshDiagnostics(); }}>{showDetails ? t("workspaceSecurity.hideDetails") : t("workspaceSecurity.showDetails")}</Button>
          : joinable
            ? <Button variant="primary" disabled={busy} onClick={() => setShowJoin(true)} data-testid="workspace-security-join">{t("workspaceSecurity.joinCta", { defaultValue: "Join" })}</Button>
            : <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => setShowSetup(true), true)} data-testid="workspace-security-hero-setup">{t("workspaceSecurity.setup")}</Button>}
      </section>
      {!status && joinable && <Banner kind="info" rounded>{t("workspaceSecurity.joinDetected", { defaultValue: "This vault is protected by an encrypted workspace. If you were invited, join it here — pairing this device hands over the key." })}</Banner>}

      {/* Two named entry cards (IA v2, P2) open the second level: "your access"
          (devices + recovery) and "sharing" (members, groups, slices,
          publications). They replace the three navigating summary cards. */}
      <div className="pv-security-summary-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button type="button" className="pv-security-summary-card" style={{ flexDirection: "row", alignItems: "center", textAlign: "left", cursor: "pointer" }} onClick={() => void requireWorkspace(() => onOpenSecurityArea?.("devices"))}>
          <Laptop size={ICON.touch} aria-hidden />
          <div><strong>{t("workspaceSecurity.manageAccess")}</strong><span>{t("workspaceSecurity.manageAccessDesc")}</span></div>
          <ChevronRight size={ICON.ui} aria-hidden />
        </button>
        <button type="button" className="pv-security-summary-card" style={{ flexDirection: "row", alignItems: "center", textAlign: "left", cursor: "pointer" }} onClick={() => void requireWorkspace(() => onOpenSecurityArea?.("members"))}>
          <Users size={ICON.touch} aria-hidden />
          <div><strong>{t("workspaceSecurity.manageSharing")}</strong><span>{t("workspaceSecurity.manageSharingDesc")}</span></div>
          <ChevronRight size={ICON.ui} aria-hidden />
        </button>
      </div>

      {/* Only render the status card once there IS a workspace. Without one it
          held a single row that repeated the hero word for word — same label,
          same "not configured yet", same button. The hero is the status. */}
      {status && (
        <SettingCard label={t("workspaceSecurity.statusCard")}>
          <SettingRow label={t("workspaceSecurity.currentStatus")} desc={t("workspaceSecurity.workspaceProtected")}>
            <strong>{phaseLabel(t, status.phase)}</strong>
          </SettingRow>
          <>
            <SettingRow label={t("workspaceSecurity.device")} desc={status.keyStorage === "native" ? t("workspaceSecurity.nativeKeychain") : t("workspaceSecurity.passphraseProtected")}>
              <span>{status.deviceName}</span>
              {status.phase === "locked" ? (
                <Button variant="primary" onClick={() => setShowUnlock(true)}>{t("workspaceSecurity.unlock")}</Button>
              ) : (
                <>
                  {status.keyStorage === "passphrase" && (
                    <Button variant="secondary" disabled={busy} onClick={() => setShowPassphraseChange(true)} data-testid="workspace-change-passphrase">
                      {t("workspaceSecurity.changePassphrase")}
                    </Button>
                  )}
                  <Button variant="ghost" disabled={busy} onClick={() => void lockPersonalWorkspace()}>{t("workspaceSecurity.lock")}</Button>
                </>
              )}
            </SettingRow>
            {status.lastError && <Banner kind="error" rounded>{status.lastError}</Banner>}
            {status.phase === "setup-incomplete" && (
              <SettingRow
                label={t("workspaceSecurity.resumeSetup")}
                desc={t("workspaceSecurity.resumeSetupDesc")}
              >
                <Button variant="primary" disabled={busy} onClick={() => void resumeSetup()}>
                  {t("workspaceSecurity.resumeSetup")}
                </Button>
              </SettingRow>
            )}
            {status.phase === "error" && (
              <Banner kind="warning" rounded>{t("workspaceSecurity.orphanRecovery", { defaultValue: "If the encrypted workspace was deleted or damaged in the cloud, sync stays stopped to protect your data. Decommission the workspace on this device below to reset it." })}</Banner>
            )}
            <SettingRow label={t("workspaceSecurity.details")}>
              <Button variant="secondary" size="sm" onClick={() => { setShowDetails((value) => !value); void refreshDiagnostics(); }}>
                {showDetails ? t("workspaceSecurity.hideDetails") : t("workspaceSecurity.showDetails")}
              </Button>
            </SettingRow>
            {showDetails && (
              <SettingCardNote>
                <dl className="pv-security-details">
                  <dt>{t("workspaceSecurity.fingerprint")}</dt><dd>{status.fingerprint}</dd>
                  <dt>{t("workspaceSecurity.workspaceId")}</dt><dd>{status.workspaceId}</dd>
                  <dt>{t("workspaceSecurity.progress")}</dt><dd>{diagnostics?.meta ? `${diagnostics.meta.migrationCompleted}/${diagnostics.meta.migrationTotal}` : "—"}</dd>
                  <dt>{t("workspaceSecurity.lastSync")}</dt><dd>{diagnostics?.meta?.lastSyncAt ?? "—"}</dd>
                  <dt>{t("workspaceSecurity.queued")}</dt><dd>{diagnostics?.queuedMutations ?? "—"}</dd>
                  <dt>{t("workspaceSecurity.legacyPlaintext")}</dt><dd>{diagnostics?.legacyPlaintextPaths ?? "—"}</dd>
                  <dt>{t("workspaceSecurity.rekey", { defaultValue: "Rekey" })}</dt><dd>{diagnostics?.meta?.rekeyJob ? `${diagnostics.meta.rekeyJob.phase} · ${diagnostics.meta.rekeyJob.completed}/${diagnostics.meta.rekeyJob.total}` : t("workspaceSecurity.noRekey", { defaultValue: "No active rekey" })}</dd>
                </dl>
                <Button variant="ghost" size="sm" onClick={() => void refreshDiagnostics()}>{t("workspaceSecurity.refresh")}</Button>
              </SettingCardNote>
            )}
          </>
        </SettingCard>
      )}

      <RekeyProgressCard t={t} diagnostics={diagnostics} />

      {/* Recovery restore/renew moved to its own second-level area (P2); the
          overview keeps only the device-local "disconnect" action (E8). The
          global "lift encryption" action lands in its own package (new .pvws
          delete path) — see the plan E8. */}
      {status && (
        <SettingCard label={t("workspaceSecurity.encryptionCard", { defaultValue: "Encryption" })}>
          <SettingRow label={t("workspaceSecurity.cloudDisconnect")} desc={t("workspaceSecurity.cloudDisconnectDesc")}>
            <Button variant="danger-soft" disabled={busy} onClick={() => void decommission()} data-testid="workspace-decommission">{t("workspaceSecurity.cloudDisconnectAction")}</Button>
          </SettingRow>
          <SettingRow label={t("workspaceSecurity.liftEncryption", { defaultValue: "Lift encryption" })} desc={t("workspaceSecurity.liftEncryptionDesc", { defaultValue: "Turns this vault back into a normal, unencrypted cloud vault: your notes are uploaded to the same cloud as plain files." })}>
            <Button variant="danger-soft" disabled={busy} onClick={() => void lift()} data-testid="workspace-lift-encryption">{t("workspaceSecurity.liftEncryptionAction", { defaultValue: "Lift encryption …" })}</Button>
          </SettingRow>
          <SettingCardNote>{t("workspaceSecurity.decommissionNote", { defaultValue: "This clears the local keys and workspace data and reopens the vault as a normal vault. Encrypted files already in the cloud are not deleted — remove the cloud folder yourself afterwards." })}</SettingCardNote>
        </SettingCard>
      )}
      </>)}

      {area !== null && (
        <div className="pv-security-detail">
          {area === "recovery" && (
            <>
              <SettingCard label={t("workspaceSecurity.recoveryStatus", { defaultValue: "Current status" })}>
                <SettingRow label={t("workspaceSecurity.recoveryPackage")} desc={status ? t("workspaceSecurity.recoveryProtected") : t("workspaceSecurity.recoverySetupHint")}>
                  <span>{status?.recoveryConfirmedAt ? t("workspaceSecurity.recoverySaved") : "—"}</span>
                </SettingRow>
                {status && (
                  <SettingRow label={t("workspaceSecurity.fingerprint")}>
                    <code className="pv-security-code">{status.fingerprint}</code>
                  </SettingRow>
                )}
              </SettingCard>
              <SettingCard label={t("workspaceSecurity.recoveryWorkflow", { defaultValue: "Recovery workflow" })}>
                <SettingRow label={t("workspaceSecurity.restore", { defaultValue: "Restore access" })} desc={t("workspaceSecurity.restoreDesc", { defaultValue: "Use the recovery file and its separate code when all devices are unavailable." })}>
                  <Button variant="danger-soft" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("recovery"), true)}>{t("workspaceSecurity.restore", { defaultValue: "Restore" })}</Button>
                </SettingRow>
                <SettingRow label={t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })} desc={t("workspaceSecurity.rotateRecoveryDesc", { defaultValue: "Invalidate the old recovery identity by creating and anchoring a new two-piece recovery set." })}>
                  <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => { setRotatedRecoveryCode(null); setDialog("rotate"); })}>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</Button>
                </SettingRow>
                <SettingCardNote>{t("workspaceSecurity.restoreVsJoin", { defaultValue: "Restore is a last resort: it creates a new owner device and revokes all other devices. To add a second or returning device normally, use the join flow — it keeps the other devices." })}</SettingCardNote>
                <SettingCardNote>{t("workspaceSecurity.recoverySeparation")}</SettingCardNote>
              </SettingCard>
            </>
          )}
          {area === "members" && (
            <SettingCard label={t("workspaceSecurity.members", { defaultValue: "Members" })}>
              <SettingRow label={t("workspaceSecurity.members", { defaultValue: "Members" })} desc={t("workspaceSecurity.membersDesc", { defaultValue: "People with encrypted access. Inviting reserves a place — pairing their device hands over the key." })}>
                <span>{governance?.members.filter((member) => member.state === "active").length ?? 0}</span>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("invite"))}>{t("workspaceSecurity.invite", { defaultValue: "Invite" })}</Button>
              </SettingRow>
              <Banner kind="info" rounded>{t("workspaceSecurity.membersModel", { defaultValue: "Inviting reserves a place. The invited person opens Security & Sharing on their device, pastes the invitation code and requests to join; an existing device approves it, which hands over the key." })}</Banner>
              {governance?.members.map((member) => <SettingRow key={member.memberId} label={member.displayName} desc={member.state === "active" ? t("workspaceSecurity.active", { defaultValue: "Active" }) : t("workspaceSecurity.revoked", { defaultValue: "Revoked" })}><span>{governance.assignments.filter((assignment) => (assignment.subjectKind === "member" && assignment.subjectId === member.memberId) || governance.groups.some((group) => group.groupId === assignment.subjectId && group.memberIds?.includes(member.memberId))).map((assignment) => `${roleName(t, assignment.role as WorkspaceRole)}/${assignment.scopeKind}`).join(", ") || "—"}</span>{member.state === "active" && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => setInviteFor({ memberId: member.memberId, displayName: member.displayName, role: governance.assignments.find((a) => a.subjectKind === "member" && a.subjectId === member.memberId)?.role, self: member.memberId === governance.memberId })}>{t("workspaceSecurity.showInvite", { defaultValue: "Show invitation" })}</Button>{member.memberId !== governance.memberId && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setForm((current) => ({ ...current, scopeId: member.memberId })); setRotatedRecoveryCode(null); setDialog("owner"); }}>{t("workspaceSecurity.transferOwner", { defaultValue: "Transfer ownership" })}</Button><Button variant="danger-soft" size="sm" disabled={busy} onClick={() => setRevokeFor({ kind: "member", id: member.memberId, displayName: member.displayName })} data-testid="workspace-revoke-member">{t("workspaceSecurity.revokeConfirm", { defaultValue: "Remove" })}</Button></>}</>}</SettingRow>)}
              <RoleMatrix t={t} />
              <RekeyProgressCard t={t} diagnostics={diagnostics} />
              <TechDetails t={t} entries={(governance?.members ?? []).map((member) => [member.displayName, member.memberId] as const)} />
            </SettingCard>
          )}
          {area === "groups" && (
            <SettingCard label={t("workspaceSecurity.groups", { defaultValue: "Groups" })}>
              <SettingRow label={t("workspaceSecurity.groups", { defaultValue: "Groups" })} desc={t("workspaceSecurity.groupsDesc", { defaultValue: "Encryption groups and their effective role." })}>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("group"))}>{t("workspaceSecurity.addGroup", { defaultValue: "Add group" })}</Button>
              </SettingRow>
              {governance?.groups.map((group) => <SettingRow key={group.groupId} label={group.name} desc={t("workspaceSecurity.memberCount", { count: group.memberIds?.length ?? 0, defaultValue: "{{count}} members" })}><span>{governance.assignments.filter((assignment) => assignment.subjectKind === "group" && assignment.subjectId === group.groupId).map((assignment) => `${roleName(t, assignment.role as WorkspaceRole)}/${assignment.scopeKind}`).join(", ") || "—"}</span></SettingRow>)}
              <TechDetails t={t} entries={(governance?.groups ?? []).map((group) => [group.name, `${group.groupId} · ${t("workspaceSecurity.keyEpoch", { defaultValue: "key epoch" })} ${group.keyEpoch}`] as const)} />
            </SettingCard>
          )}
          {area === "slices" && (
            <SettingCard label={t("workspaceSecurity.slices", { defaultValue: "Slices" })}>
              <SettingRow label={t("workspaceSecurity.slices", { defaultValue: "Slices" })} desc={t("workspaceSecurity.slicesDesc", { defaultValue: "Folder, explicit selection or dynamic rule." })}>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => openSliceWizard())}>{t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })}</Button>
              </SettingRow>
              {/* A slice whose definition cannot be read grants nothing (fail-closed, P3). It says
                  so here, because "0 objects" reads like an empty share rather than a broken one. */}
              {governance?.slices.map((slice) => {
                const broken = governance.brokenSlices.find((entry) => entry.sliceId === slice.sliceId);
                return <SettingRow key={slice.sliceId} label={slice.name} desc={broken ? t("workspaceSecurity.sliceBroken") : `${slice.kind} · ${slice.materializedObjectIds.length} objects${slice.publication ? ` · ${slice.publication.mode}/${slice.publication.access}` : ""}`}><code>{slice.definition.slice(0, 64)}</code></SettingRow>;
              })}
            </SettingCard>
          )}
          {area === "devices" && (
            <SettingCard label={t("workspaceSecurity.devicesCard")}>
              <SettingRow label={t("workspaceSecurity.addDevice")} desc={t("workspaceSecurity.addDeviceDesc")}>
                <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => { if (governance) setInviteFor({ memberId: governance.memberId, displayName: governance.members.find((m) => m.memberId === governance.memberId)?.displayName ?? t("workspaceSecurity.thisDevice", { defaultValue: "This device" }), role: governance.assignments.find((a) => a.subjectKind === "member" && a.subjectId === governance.memberId)?.role, self: true }); })}>{t("workspaceSecurity.addDevice")}</Button>
              </SettingRow>
              <SettingRow label={t("workspaceSecurity.pairDevice", { defaultValue: "Approve device" })} desc={t("workspaceSecurity.pairHelp")}>
                <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("pair"))}>{t("workspaceSecurity.approve", { defaultValue: "Enter code" })}</Button>
              </SettingRow>
              {governance?.devices.map((device) => (
                <SettingRow key={device.deviceId} label={device.displayName} desc={`${device.platform} · ${device.state === "active" ? t("workspaceSecurity.active", { defaultValue: "Active" }) : t("workspaceSecurity.revoked", { defaultValue: "Revoked" })}`}>
                  {device.deviceId === governance.deviceId ? <strong>{t("workspaceSecurity.thisDevice", { defaultValue: "This device" })}</strong> : device.state === "active" ? (
                    <><Button variant="danger-soft" size="sm" disabled={busy} onClick={() => setRevokeFor({ kind: "device", id: device.deviceId, displayName: device.displayName })} data-testid="workspace-revoke-device">{t("workspaceSecurity.revokeConfirm", { defaultValue: "Remove" })}</Button></>
                  ) : <span>{t("workspaceSecurity.revoked", { defaultValue: "Revoked" })}</span>}
                </SettingRow>
              ))}
              <RekeyProgressCard t={t} diagnostics={diagnostics} />
              <TechDetails t={t} entries={(governance?.devices ?? []).map((device) => [device.displayName, device.deviceId] as const)} />
            </SettingCard>
          )}
          {area === "publications" && (
            <SettingCard label={t("workspaceSecurity.publications", { defaultValue: "Publications" })}>
              {/* Publishing does not exist yet (B1): `projectPublishedMarkdown`,
                  `PublishedSliceObjectStore`, `publishedSliceAccessCapabilities` and
                  `publishedSliceProviderInstructions` are tested and have no caller.
                  Until Stufe B wires them, this surface says so and the action is
                  disabled — it used to print `.pvws/publications/<id>/` as a fact
                  about a directory nothing writes to. */}
              <Banner kind="warning" rounded>{t("workspaceSecurity.publicationPreviewOnly", { defaultValue: "Preview only: you can see how publishing will work, but nothing is shared yet." })}</Banner>
              <Banner kind="info" rounded>{t("workspaceSecurity.publicationIsolation", { defaultValue: "Published slices use a separate encrypted workspace namespace. Provider permissions add defense in depth; they never replace encryption." })}</Banner>
              <SettingRow label={t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })} desc={t("workspaceSecurity.publishDesc", { defaultValue: "Choose exact or sanitized content, read/comment/suggestion access and a provider." })}>
                <Button variant="primary" disabled>{t("workspaceSecurity.createPublication", { defaultValue: "Create publication" })}</Button>
              </SettingRow>
              {governance?.slices.filter((slice) => slice.publication).map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.publication!.mode} · ${slice.publication!.access} · ${slice.publication!.provider}`} />)}
            </SettingCard>
          )}
        </div>
      )}

      {area === null && (<>
      {governance && (governance.quarantine.length > 0 || governance.localForks.length > 0) && (
        <SettingCard label={t("workspaceSecurity.integrityCard", { defaultValue: "Integrity & local forks" })}>
          {governance.quarantine.map((entry) => <SettingRow key={entry.quarantineId} label={`${entry.artifactKind} · ${entry.status}`} desc={entry.reason}><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "retry"), t("workspaceSecurity.retryQueued", { defaultValue: "Retry queued" }))}>{t("workspaceSecurity.retry")}</Button><Button variant="ghost" size="sm" onClick={() => void exportQuarantine(entry.quarantineId)}>{t("workspaceSecurity.export")}</Button><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "repaired"), t("workspaceSecurity.repaired", { defaultValue: "Marked as repaired" }))}>{t("workspaceSecurity.markRepaired", { defaultValue: "Repaired" })}</Button><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "ignore"), t("workspaceSecurity.ignored", { defaultValue: "Ignored" }))}>{t("workspaceSecurity.ignore", { defaultValue: "Ignore" })}</Button></SettingRow>)}
          {governance.localForks.map((fork) => <SettingRow key={fork.forkId} label={fork.originalPath} desc={fork.reason}><code>{fork.forkPath}</code></SettingRow>)}
          <TechDetails t={t} entries={governance.quarantine.map((entry) => [entry.artifactKind, entry.remoteKey] as const)} />
        </SettingCard>
      )}

      {status && diagnostics && diagnostics.legacyPlaintextPaths > 0 && (
        <SettingCard label={t("workspaceSecurity.cleanupCard")}>
          <Banner kind="warning" rounded>{t("workspaceSecurity.cleanupWarning", { n: diagnostics.legacyPlaintextPaths })}</Banner>
          <SettingRow label={t("workspaceSecurity.cleanupLabel")} desc={t("workspaceSecurity.cleanupDesc")}>
            <Button variant="danger" disabled={busy || status.phase !== "active"} onClick={() => void cleanupPlaintext()}>{t("workspaceSecurity.cleanupAction")}</Button>
          </SettingRow>
        </SettingCard>
      )}
      </>)}

      {showSetup && (
        <WorkspaceSetupWizard
          vaultPath={selectedVault}
          onClose={() => setShowSetup(false)}
          prepare={preparePersonalWorkspace}
          activate={activatePersonalWorkspace}
        />
      )}

      {showUnlock && status && (
        <Modal title={t("workspaceSecurity.unlockTitle")} onClose={() => { if (!busy) setShowUnlock(false); }} size="sm">
          <div className="pv-security-wizard">
            {status.keyStorage === "passphrase" && (
              <label className="pv-security-field">
                <span>{t("workspaceSecurity.passphrase")}</span>
                <TextInput type="password" autoFocus value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
              </label>
            )}
            <div className="pv-security-actions">
              <Button variant="ghost" disabled={busy} onClick={() => setShowUnlock(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={busy || (status.keyStorage === "passphrase" && !passphrase)} onClick={() => void unlock()}>{t("workspaceSecurity.unlock")}</Button>
            </div>
          </div>
        </Modal>
      )}
      {showPassphraseChange && (
        <Modal title={t("workspaceSecurity.changePassphrase")} onClose={() => { if (!busy) closePassphraseChange(); }} size="sm" testId="workspace-passphrase-dialog">
          <div className="pv-security-wizard">
            {/* The old passphrase is asked for, not assumed from the unlocked
                session: an unlocked machine left alone is exactly the case where
                a silent change would lock its owner out. */}
            <label className="pv-security-field">
              <span>{t("workspaceSecurity.currentPassphrase")}</span>
              <TextInput type="password" autoFocus value={currentPassphrase} onChange={(event) => setCurrentPassphrase(event.target.value)} />
            </label>
            <label className="pv-security-field">
              <span>{t("workspaceSecurity.newPassphrase")}</span>
              <TextInput type="password" value={nextPassphrase} onChange={(event) => setNextPassphrase(event.target.value)} />
            </label>
            <label className="pv-security-field">
              <span>{t("workspaceSecurity.confirmPassphrase")}</span>
              <TextInput type="password" value={nextPassphraseConfirm} onChange={(event) => setNextPassphraseConfirm(event.target.value)} />
            </label>
            <SettingCardNote>{t("workspaceSecurity.passphraseChangeNote")}</SettingCardNote>
            <div className="pv-security-actions">
              <Button variant="ghost" disabled={busy} onClick={closePassphraseChange}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                data-testid="workspace-passphrase-confirm"
                disabled={busy || !currentPassphrase || nextPassphrase.length < 10 || nextPassphrase !== nextPassphraseConfirm}
                onClick={() => void applyPassphraseChange()}
              >
                {t("workspaceSecurity.changePassphrase")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {dialog && (
        <WorkspaceGovernanceDialog
          kind={dialog}
          busy={busy}
          form={form}
          governance={governance}
          pairPreview={pairPreview}
          slicePreview={slicePreview}
          sliceObjects={sliceObjects}
          rotatedRecoveryCode={rotatedRecoveryCode}
          setForm={setForm}
          onClose={() => { setDialog(null); setPairPreview(null); setSlicePreview(null); setSliceObjects(null); setRotatedRecoveryCode(null); }}
          onPreview={() => void previewSlice()}
          onSubmit={() => void submitGovernanceDialog()}
        />
      )}
      {showJoin && <WorkspaceJoinDialog onClose={() => setShowJoin(false)} />}

      {revokeFor && (
        <RevokeDialog
          t={t}
          subject={revokeFor}
          busy={busy}
          onCancel={() => setRevokeFor(null)}
          onConfirm={(mode) => {
            const subject = revokeFor;
            setRevokeFor(null);
            void runGovernance(
              () => subject.kind === "member"
                ? revokeWorkspaceMember(subject.id, "Removed in Security Center", mode)
                : revokeWorkspaceDevice(subject.id, "Removed in Security Center", mode),
              subject.kind === "member"
                ? t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed" })
                : t("workspaceSecurity.deviceRevoked", { defaultValue: "Device removed" }),
            );
          }}
        />
      )}
      {inviteFor && status && (() => {
        const inviteCode = encodeWorkspaceInvite({ memberId: inviteFor.memberId, workspaceId: status.workspaceId, fingerprint: status.fingerprint, role: inviteFor.role });
        return (
        <Modal title={inviteFor.self ? t("workspaceSecurity.addDevice") : t("workspaceSecurity.inviteArtifactTitle", { defaultValue: "Invitation for {{name}}", name: inviteFor.displayName })} onClose={() => setInviteFor(null)} size="md">
          <div className="pv-security-wizard">
            <Banner kind="info" rounded>{inviteFor.self ? t("workspaceSecurity.addDeviceHint") : t("workspaceSecurity.inviteArtifactHint", { defaultValue: "Send this code to the invited person through a secure channel. On their device they open Security & Sharing, paste it and request to join; approving their device here hands over the key." })}</Banner>
            <div className="pv-security-field"><span>{t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}</span><code className="pv-security-code">{inviteCode}</code></div>
            <div className="pv-security-field"><span>{t("workspaceSecurity.inviteQrCaption", { defaultValue: "Or scan this code with the Plainva app on your other device" })}</span><QrImage value={inviteCode} label={t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })} /></div>
            {!inviteFor.self && <div className="pv-security-field"><span>{t("workspaceSecurity.memberIdFull", { defaultValue: "Member ID" })}</span><code className="pv-security-code">{inviteFor.memberId}</code></div>}
            <div className="pv-security-actions">
              <Button variant="ghost" onClick={() => setInviteFor(null)}>{t("common.close", { defaultValue: "Close" })}</Button>
              <Button variant="primary" onClick={() => void navigator.clipboard.writeText(inviteCode).then(() => toast.info(t("workspaceSecurity.copied")))}>{t("workspaceSecurity.copyInvite", { defaultValue: "Copy invitation" })}</Button>
            </div>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
};
