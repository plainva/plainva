import React, { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Banner, Button, ICON, Modal, SettingCard, SettingCardNote, SettingRow, TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { AreaHead } from "../settings/AppPages";
import { ChevronRight, KeyRound, Laptop, Layers, Share2, ShieldCheck, Users, UsersRound } from "lucide-react";
import { parseSliceForm, type Diagnostics, type Governance, type GovernanceForm } from "./securityForms";
import { WorkspaceGovernanceDialog } from "./WorkspaceGovernanceDialog";
import { WorkspaceSetupWizard } from "./WorkspaceSetupWizard";
import { WorkspaceJoinDialog } from "./WorkspaceJoinDialog";
import { encodeWorkspaceInvite } from "../../services/workspaceSecurity/workspacePairing";

interface SecuritySharingPageProps {
  selectedVault: string;
  isActiveVault: boolean;
  hasSyncConnection: boolean;
}

type AdminArea = "members" | "groups" | "slices" | "devices" | "publications";
const ADMIN_AREAS: readonly AdminArea[] = ["members", "groups", "slices", "devices", "publications"];
const ADMIN_AREA_ICONS: Record<AdminArea, React.ComponentType<{ size?: number }>> = {
  members: Users,
  groups: UsersRound,
  slices: Layers,
  devices: Laptop,
  publications: Share2,
};

function phaseLabel(t: ReturnType<typeof useTranslation>["t"], phase: string): string {
  return t(`workspaceSecurity.phase.${phase}`, { defaultValue: phase });
}

/** Desktop P3-P11 security centre for personal and team encrypted workspaces. */
export const SecuritySharingPage: React.FC<SecuritySharingPageProps> = ({ selectedVault, isActiveVault, hasSyncConnection }) => {
  const { t } = useTranslation();
  const {
    workspaceSecurityStatus,
    preparePersonalWorkspace,
    activatePersonalWorkspace,
    unlockPersonalWorkspace,
    lockPersonalWorkspace,
    removeRemotePlaintext,
    decommissionWorkspace,
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
  const [inviteFor, setInviteFor] = useState<{ memberId: string; displayName: string; role?: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [dialog, setDialog] = useState<"pair" | "invite" | "group" | "slice" | "recovery" | "rotate" | "owner" | null>(null);
  const [slicePreview, setSlicePreview] = useState<Array<{ objectId: string; path: string }> | null>(null);
  const [pairPreview, setPairPreview] = useState<Awaited<ReturnType<typeof inspectWorkspacePairingRequest>> | null>(null);
  const [rotatedRecoveryCode, setRotatedRecoveryCode] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<"members" | "groups" | "slices" | "devices" | "publications">("members");
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

  const openSliceWizard = (publication: boolean): void => {
    setSlicePreview(null);
    setForm((current) => ({ ...current, name: "", definition: "", sliceKind: "folder", publicationMode: publication ? "sanitized" : "private" }));
    setDialog("slice");
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

  const submitGovernanceDialog = (): Promise<void> => {
    if (dialog === "pair") return pairPreview ? runGovernance(() => approveWorkspaceDevice(pairPreview.token), t("workspaceSecurity.deviceApproved", { defaultValue: "Device approved" })) : inspectPairing();
    if (dialog === "invite") return runGovernance(() => inviteWorkspaceMember(form.name, form.role as "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor", form.scopeKind as "workspace" | "slice" | "object", form.scopeKind === "workspace" ? null : form.scopeId), t("workspaceSecurity.memberInvited", { defaultValue: "Member created; pair their device next." }));
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
    <div>
      <AreaHead areaId="security" />
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

      <div className="pv-security-summary-grid">
        <article className="pv-security-summary-card"><KeyRound size={ICON.touch} /><div><strong>{t("workspaceSecurity.recoveryCard")}</strong><span>{status?.recoveryConfirmedAt ? t("workspaceSecurity.recoverySaved") : t("workspaceSecurity.recoverySetupHint")}</span></div><Button variant="secondary" onClick={() => void requireWorkspace(() => { setRotatedRecoveryCode(null); setDialog(status ? "rotate" : "recovery"); }, !status)}>{status ? t("workspaceSecurity.renew", { defaultValue: "Renew" }) : t("workspaceSecurity.restore", { defaultValue: "Restore" })}<ChevronRight size={ICON.ui} /></Button></article>
        <article className="pv-security-summary-card"><Laptop size={ICON.touch} /><div><strong>{t("workspaceSecurity.devicesCard")}</strong><span>{governance ? `${governance.devices.filter((entry) => entry.state === "active").length} ${t("workspaceSecurity.trusted", { defaultValue: "trusted" })}` : t("workspaceSecurity.unlockToManage", { defaultValue: "Open to manage" })}</span></div><Button variant="secondary" onClick={() => void requireWorkspace(() => setAdminTab("devices"))}>{t("workspaceSecurity.manage", { defaultValue: "Manage" })}<ChevronRight size={ICON.ui} /></Button></article>
        <article className="pv-security-summary-card"><Users size={ICON.touch} /><div><strong>{t("workspaceSecurity.teamsCard")}</strong><span>{governance ? `${governance.members.filter((entry) => entry.state === "active").length} ${t("workspaceSecurity.members")} · ${governance.slices.length} ${t("workspaceSecurity.slices")}` : t("workspaceSecurity.unlockToManage", { defaultValue: "Open to manage" })}</span></div><Button variant="primary" onClick={() => void requireWorkspace(() => setAdminTab("members"))}>{t("workspaceSecurity.permissions", { defaultValue: "Permissions" })}<ChevronRight size={ICON.ui} /></Button></article>
      </div>

      <SettingCard label={t("workspaceSecurity.statusCard")}>
        <SettingRow label={t("workspaceSecurity.currentStatus")} desc={status ? t("workspaceSecurity.workspaceProtected") : t("workspaceSecurity.notConfigured")}>
          {status ? (
            <strong>{phaseLabel(t, status.phase)}</strong>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => setShowSetup(true), true)} data-testid="workspace-security-setup">
              {t("workspaceSecurity.setup")}
            </Button>
          )}
        </SettingRow>
        {status && (
          <>
            <SettingRow label={t("workspaceSecurity.device")} desc={status.keyStorage === "native" ? t("workspaceSecurity.nativeKeychain") : t("workspaceSecurity.passphraseProtected")}>
              <span>{status.deviceName}</span>
              {status.phase === "locked" ? (
                <Button variant="primary" onClick={() => setShowUnlock(true)}>{t("workspaceSecurity.unlock")}</Button>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => void lockPersonalWorkspace()}>{t("workspaceSecurity.lock")}</Button>
              )}
            </SettingRow>
            {status.lastError && <Banner kind="error" rounded>{status.lastError}</Banner>}
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
        )}
      </SettingCard>

      <SettingCard label={t("workspaceSecurity.recoveryCard")}>
        <SettingRow label={t("workspaceSecurity.recoveryPackage")} desc={status ? t("workspaceSecurity.recoveryProtected") : t("workspaceSecurity.recoverySetupHint")}>
          <span>{status?.recoveryConfirmedAt ? t("workspaceSecurity.recoverySaved") : "—"}</span>
        </SettingRow>
        <SettingRow label={t("workspaceSecurity.restore", { defaultValue: "Restore access" })} desc={t("workspaceSecurity.restoreDesc", { defaultValue: "Use the recovery file and its separate code when all devices are unavailable." })}>
          <Button variant="danger-soft" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("recovery"), true)}>{t("workspaceSecurity.restore", { defaultValue: "Restore" })}</Button>
        </SettingRow>
        <SettingCardNote>{t("workspaceSecurity.restoreVsJoin", { defaultValue: "Restore is a last resort: it creates a new owner device and revokes all other devices. To add a second or returning device normally, use the join flow — it keeps the other devices." })}</SettingCardNote>
        <SettingRow label={t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })} desc={t("workspaceSecurity.rotateRecoveryDesc", { defaultValue: "Invalidate the old recovery identity by creating and anchoring a new two-piece recovery set." })}>
          <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => { setRotatedRecoveryCode(null); setDialog("rotate"); })}>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</Button>
        </SettingRow>
        <SettingCardNote>{t("workspaceSecurity.recoverySeparation")}</SettingCardNote>
        {status && (
          <>
            <SettingRow label={t("workspaceSecurity.decommission", { defaultValue: "Decommission workspace" })} desc={t("workspaceSecurity.decommissionDesc", { defaultValue: "Remove the encrypted workspace from this device. Do this BEFORE deleting the vault in the cloud." })}>
              <Button variant="danger" disabled={busy} onClick={() => void decommission()} data-testid="workspace-decommission">{t("workspaceSecurity.decommissionAction", { defaultValue: "Decommission" })}</Button>
            </SettingRow>
            <SettingCardNote>{t("workspaceSecurity.decommissionNote", { defaultValue: "This clears the local keys and workspace data and reopens the vault as a normal vault. Encrypted files already in the cloud are not deleted — remove the cloud folder yourself afterwards." })}</SettingCardNote>
          </>
        )}
      </SettingCard>

      <section className="pv-security-admin">
        <nav className="pv-security-nav" aria-label={t("workspaceSecurity.teamsCard")}>
          {ADMIN_AREAS.map((area) => {
            const Icon = ADMIN_AREA_ICONS[area];
            return (
              <button key={area} type="button" className={`pv-navlink${adminTab === area ? " is-active" : ""}`} aria-current={adminTab === area ? "page" : undefined} onClick={() => void requireWorkspace(() => setAdminTab(area))}>
                <Icon size={ICON.ui} />{t(`workspaceSecurity.${area}`, { defaultValue: area[0].toUpperCase() + area.slice(1) })}
              </button>
            );
          })}
        </nav>
        <div className="pv-security-detail">
          {adminTab === "members" && (
            <SettingCard label={t("workspaceSecurity.members", { defaultValue: "Members" })}>
              <SettingRow label={t("workspaceSecurity.members", { defaultValue: "Members" })} desc={t("workspaceSecurity.membersDesc", { defaultValue: "People with encrypted access. Inviting reserves a place — pairing their device hands over the key." })}>
                <span>{governance?.members.filter((member) => member.state === "active").length ?? 0}</span>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("invite"))}>{t("workspaceSecurity.invite", { defaultValue: "Invite" })}</Button>
              </SettingRow>
              <Banner kind="info" rounded>{t("workspaceSecurity.membersModel", { defaultValue: "Inviting reserves a place. The invited person opens Security & Sharing on their device, pastes the invitation code and requests to join; an existing device approves it, which hands over the key." })}</Banner>
              {governance?.members.map((member) => <SettingRow key={member.memberId} label={member.displayName} desc={`${member.memberId.slice(0, 8)} · ${member.state}`}><span>{governance.assignments.filter((assignment) => (assignment.subjectKind === "member" && assignment.subjectId === member.memberId) || governance.groups.some((group) => group.groupId === assignment.subjectId && group.memberIds?.includes(member.memberId))).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span>{member.state === "active" && member.memberId !== governance.memberId && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => setInviteFor({ memberId: member.memberId, displayName: member.displayName, role: governance.assignments.find((a) => a.subjectKind === "member" && a.subjectId === member.memberId)?.role })}>{t("workspaceSecurity.showInvite", { defaultValue: "Show invitation" })}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setForm((current) => ({ ...current, scopeId: member.memberId })); setRotatedRecoveryCode(null); setDialog("owner"); }}>{t("workspaceSecurity.transferOwner", { defaultValue: "Transfer ownership" })}</Button><Button variant="danger-soft" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeMember", { defaultValue: "Remove member?" }), message: t("workspaceSecurity.revokeFutureQuestion", { defaultValue: "Future-only rotation is fast: access to new keys ends now, but encrypted history is not rewritten." }), kind: "danger", confirmLabel: t("workspaceSecurity.futureOnly", { defaultValue: "Future only" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceMember(member.memberId, "Removed in Security Center", "future"), t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed; future keys rotated" })); })}>{t("workspaceSecurity.futureOnly", { defaultValue: "Future only" })}</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeMember", { defaultValue: "Remove member?" }), message: t("workspaceSecurity.revokeFullQuestion", { defaultValue: "Access is removed immediately and all current encrypted content is queued for a resumable full rekey. Previously downloaded plaintext cannot be taken back." }), kind: "danger", confirmLabel: t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceMember(member.memberId, "Removed in Security Center", "full"), t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed; full rekey started" })); })}>{t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" })}</Button></>}</SettingRow>)}
            </SettingCard>
          )}
          {adminTab === "groups" && (
            <SettingCard label={t("workspaceSecurity.groups", { defaultValue: "Groups" })}>
              <SettingRow label={t("workspaceSecurity.groups", { defaultValue: "Groups" })} desc={t("workspaceSecurity.groupsDesc", { defaultValue: "Encryption groups and their effective role." })}>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("group"))}>{t("workspaceSecurity.addGroup", { defaultValue: "Add group" })}</Button>
              </SettingRow>
              {governance?.groups.map((group) => <SettingRow key={group.groupId} label={group.name} desc={`${group.memberIds?.length ?? 0} · key epoch ${group.keyEpoch}`}><span>{governance.assignments.filter((assignment) => assignment.subjectKind === "group" && assignment.subjectId === group.groupId).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span></SettingRow>)}
            </SettingCard>
          )}
          {adminTab === "slices" && (
            <SettingCard label={t("workspaceSecurity.slices", { defaultValue: "Slices" })}>
              <SettingRow label={t("workspaceSecurity.slices", { defaultValue: "Slices" })} desc={t("workspaceSecurity.slicesDesc", { defaultValue: "Folder, explicit selection or dynamic rule." })}>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => openSliceWizard(false))}>{t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })}</Button>
              </SettingRow>
              {governance?.slices.map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.kind} · ${slice.materializedObjectIds.length} objects${slice.publication ? ` · ${slice.publication.mode}/${slice.publication.access}` : ""}`}><code>{slice.definition.slice(0, 64)}</code></SettingRow>)}
            </SettingCard>
          )}
          {adminTab === "devices" && (
            <SettingCard label={t("workspaceSecurity.devicesCard")}>
              <SettingRow label={t("workspaceSecurity.pairDevice", { defaultValue: "Approve device" })} desc={t("workspaceSecurity.pairHelp")}>
                <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("pair"))}>{t("workspaceSecurity.approve", { defaultValue: "Enter code" })}</Button>
              </SettingRow>
              {governance?.devices.map((device) => (
                <SettingRow key={device.deviceId} label={device.displayName} desc={`${device.platform} · ${device.deviceId.slice(0, 16)} · ${device.state}`}>
                  {device.deviceId === governance.deviceId ? <strong>{t("workspaceSecurity.thisDevice", { defaultValue: "This device" })}</strong> : device.state === "active" ? (
                    <><Button variant="danger-soft" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeDevice", { defaultValue: "Remove device?" }), message: t("workspaceSecurity.revokeFutureQuestion", { defaultValue: "Future-only rotation is fast: the device loses new keys immediately, but already encrypted history is not rewritten." }), kind: "danger", confirmLabel: t("workspaceSecurity.futureOnly", { defaultValue: "Future only" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceDevice(device.deviceId, "Removed in Security Center", "future"), t("workspaceSecurity.deviceRevoked", { defaultValue: "Device removed; future keys rotated" })); })}>{t("workspaceSecurity.futureOnly", { defaultValue: "Future only" })}</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeDevice", { defaultValue: "Remove device?" }), message: t("workspaceSecurity.revokeFullQuestion", { defaultValue: "Access is removed immediately and all current encrypted content is queued for a resumable full rekey. Previously downloaded plaintext cannot be taken back." }), kind: "danger", confirmLabel: t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceDevice(device.deviceId, "Removed in Security Center", "full"), t("workspaceSecurity.deviceRevoked", { defaultValue: "Device removed; full rekey started" })); })}>{t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" })}</Button></>
                  ) : <span>{t("workspaceSecurity.revoked", { defaultValue: "Revoked" })}</span>}
                </SettingRow>
              ))}
            </SettingCard>
          )}
          {adminTab === "publications" && (
            <SettingCard label={t("workspaceSecurity.publications", { defaultValue: "Publications" })}>
              <Banner kind="info" rounded>{t("workspaceSecurity.publicationIsolation", { defaultValue: "Published slices use a separate encrypted workspace namespace. Provider permissions add defense in depth; they never replace encryption." })}</Banner>
              <SettingRow label={t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })} desc={t("workspaceSecurity.publishDesc", { defaultValue: "Choose exact or sanitized content, read/comment/suggestion access and a provider." })}>
                <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => openSliceWizard(true))}>{t("workspaceSecurity.createPublication", { defaultValue: "Create publication" })}</Button>
              </SettingRow>
              {governance?.slices.filter((slice) => slice.publication).map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.publication!.mode} · ${slice.publication!.access} · ${slice.publication!.provider}`}><code>.pvws/publications/{slice.sliceId}/</code></SettingRow>)}
            </SettingCard>
          )}
        </div>
      </section>

      {governance && (governance.quarantine.length > 0 || governance.localForks.length > 0) && (
        <SettingCard label={t("workspaceSecurity.integrityCard", { defaultValue: "Integrity & local forks" })}>
          {governance.quarantine.map((entry) => <SettingRow key={entry.quarantineId} label={`${entry.artifactKind} · ${entry.status}`} desc={`${entry.reason} · ${entry.remoteKey}`}><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "retry"), t("workspaceSecurity.retryQueued", { defaultValue: "Retry queued" }))}>{t("workspaceSecurity.retry")}</Button><Button variant="ghost" size="sm" onClick={() => void exportQuarantine(entry.quarantineId)}>{t("workspaceSecurity.export")}</Button><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "repaired"), t("workspaceSecurity.repaired", { defaultValue: "Marked as repaired" }))}>{t("workspaceSecurity.markRepaired", { defaultValue: "Repaired" })}</Button><Button variant="ghost" size="sm" onClick={() => void runGovernance(() => updateWorkspaceQuarantine(entry.quarantineId, "ignore"), t("workspaceSecurity.ignored", { defaultValue: "Ignored" }))}>{t("workspaceSecurity.ignore", { defaultValue: "Ignore" })}</Button></SettingRow>)}
          {governance.localForks.map((fork) => <SettingRow key={fork.forkId} label={fork.originalPath} desc={fork.reason}><code>{fork.forkPath}</code></SettingRow>)}
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
      {dialog && (
        <WorkspaceGovernanceDialog
          kind={dialog}
          busy={busy}
          form={form}
          governance={governance}
          pairPreview={pairPreview}
          slicePreview={slicePreview}
          rotatedRecoveryCode={rotatedRecoveryCode}
          setForm={setForm}
          onClose={() => { setDialog(null); setPairPreview(null); setSlicePreview(null); setRotatedRecoveryCode(null); }}
          onPreview={() => void previewSlice()}
          onSubmit={() => void submitGovernanceDialog()}
        />
      )}
      {showJoin && <WorkspaceJoinDialog onClose={() => setShowJoin(false)} />}
      {inviteFor && status && (
        <Modal title={t("workspaceSecurity.inviteArtifactTitle", { defaultValue: "Invitation for {{name}}", name: inviteFor.displayName })} onClose={() => setInviteFor(null)} size="md">
          <div className="pv-security-wizard">
            <Banner kind="info" rounded>{t("workspaceSecurity.inviteArtifactHint", { defaultValue: "Send this code to the invited person through a secure channel. On their device they open Security & Sharing, paste it and request to join; approving their device here hands over the key." })}</Banner>
            <div className="pv-security-field"><span>{t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}</span><code className="pv-security-code">{encodeWorkspaceInvite({ memberId: inviteFor.memberId, workspaceId: status.workspaceId, fingerprint: status.fingerprint, role: inviteFor.role })}</code></div>
            <div className="pv-security-field"><span>{t("workspaceSecurity.memberIdFull", { defaultValue: "Member ID" })}</span><code className="pv-security-code">{inviteFor.memberId}</code></div>
            <div className="pv-security-actions">
              <Button variant="ghost" onClick={() => setInviteFor(null)}>{t("common.close", { defaultValue: "Close" })}</Button>
              <Button variant="primary" onClick={() => void navigator.clipboard.writeText(encodeWorkspaceInvite({ memberId: inviteFor.memberId, workspaceId: status.workspaceId, fingerprint: status.fingerprint, role: inviteFor.role })).then(() => toast.info(t("workspaceSecurity.copied")))}>{t("workspaceSecurity.copyInvite", { defaultValue: "Copy invitation" })}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
