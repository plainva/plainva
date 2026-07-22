import React, { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Banner, Button, ICON, Modal, SettingCard, SettingCardNote, SettingRow, TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { credentialManager } from "../../services/CredentialManager";
import { appConfirm } from "../../services/appDialogs";
import { discardPreparedPersonalWorkspace, type PreparedPersonalWorkspace } from "../../services/workspaceSecurity/workspaceLifecycle";
import { AreaHead } from "../settings/AppPages";
import { ChevronRight, KeyRound, Laptop, ShieldCheck, Users } from "lucide-react";

interface SecuritySharingPageProps {
  selectedVault: string;
  isActiveVault: boolean;
  hasSyncConnection: boolean;
}

type Diagnostics = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceDiagnostics"]>>;
type Governance = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceGovernance"]>>;

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
    openVault,
  } = useVault();
  const status = isActiveVault ? workspaceSecurityStatus : null;
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
  const [form, setForm] = useState({ code: "", name: "", role: "Reader", members: "", scopeKind: "workspace", scopeId: "", sliceKind: "folder", definition: "", publicationMode: "private", publicationAccess: "read", publicationProvider: "google-drive", recoveryCode: "", deviceName: navigator.platform || "Desktop", recoveryFile: "", fallbackPassphrase: "" });

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
          : <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => setShowSetup(true), true)} data-testid="workspace-security-hero-setup">{t("workspaceSecurity.setup")}</Button>}
      </section>

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
          <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("recovery"), true)}>{t("workspaceSecurity.restore", { defaultValue: "Restore" })}</Button>
        </SettingRow>
        <SettingRow label={t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })} desc={t("workspaceSecurity.rotateRecoveryDesc", { defaultValue: "Invalidate the old recovery identity by creating and anchoring a new two-piece recovery set." })}>
          <Button variant="secondary" disabled={busy} onClick={() => void requireWorkspace(() => { setRotatedRecoveryCode(null); setDialog("rotate"); })}>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</Button>
        </SettingRow>
        <SettingCardNote>{t("workspaceSecurity.recoverySeparation")}</SettingCardNote>
      </SettingCard>

      <section className="pv-security-admin" data-tab={adminTab}>
        <div className="pv-security-tabs" role="tablist" aria-label={t("workspaceSecurity.teamsCard")}>
          {(["members", "groups", "slices", "devices", "publications"] as const).map((tab) => <button key={tab} role="tab" aria-selected={adminTab === tab} onClick={() => void requireWorkspace(() => setAdminTab(tab))}>{t(`workspaceSecurity.${tab}`, { defaultValue: tab[0].toUpperCase() + tab.slice(1) })}</button>)}
        </div>
      <div className="pv-security-panel" data-panel="devices">
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
      </div>

      <div className="pv-security-panel" data-panel="members groups slices">
      <SettingCard label={t("workspaceSecurity.teamsCard")}>
        <SettingRow label={t("workspaceSecurity.members", { defaultValue: "Members" })} desc={t("workspaceSecurity.groupsDesc")}>
          <span>{governance?.members.filter((member) => member.state === "active").length ?? 0}</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("invite"))}>{t("workspaceSecurity.invite", { defaultValue: "Invite" })}</Button>
        </SettingRow>
        {governance?.members.map((member) => <SettingRow key={member.memberId} label={member.displayName} desc={`${member.memberId.slice(0, 8)} · ${member.state}`}><span>{governance.assignments.filter((assignment) => (assignment.subjectKind === "member" && assignment.subjectId === member.memberId) || governance.groups.some((group) => group.groupId === assignment.subjectId && group.memberIds?.includes(member.memberId))).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span>{member.state === "active" && member.memberId !== governance.memberId && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setForm((current) => ({ ...current, scopeId: member.memberId })); setRotatedRecoveryCode(null); setDialog("owner"); }}>{t("workspaceSecurity.transferOwner", { defaultValue: "Transfer ownership" })}</Button><Button variant="danger-soft" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeMember", { defaultValue: "Remove member?" }), message: t("workspaceSecurity.revokeFutureQuestion", { defaultValue: "Future-only rotation is fast: access to new keys ends now, but encrypted history is not rewritten." }), kind: "danger", confirmLabel: t("workspaceSecurity.futureOnly", { defaultValue: "Future only" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceMember(member.memberId, "Removed in Security Center", "future"), t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed; future keys rotated" })); })}>{t("workspaceSecurity.futureOnly", { defaultValue: "Future only" })}</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeMember", { defaultValue: "Remove member?" }), message: t("workspaceSecurity.revokeFullQuestion", { defaultValue: "Access is removed immediately and all current encrypted content is queued for a resumable full rekey. Previously downloaded plaintext cannot be taken back." }), kind: "danger", confirmLabel: t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" }) }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceMember(member.memberId, "Removed in Security Center", "full"), t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed; full rekey started" })); })}>{t("workspaceSecurity.fullRekey", { defaultValue: "Full rekey" })}</Button></>}</SettingRow>)}
        <SettingRow label={t("workspaceSecurity.groups", { defaultValue: "Groups" })} desc={t("workspaceSecurity.groupsDesc", { defaultValue: "Encryption groups and their effective role." })}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => setDialog("group"))}>{t("workspaceSecurity.addGroup", { defaultValue: "Add group" })}</Button>
        </SettingRow>
        {governance?.groups.map((group) => <SettingRow key={group.groupId} label={group.name} desc={`${group.memberIds?.length ?? 0} · key epoch ${group.keyEpoch}`}><span>{governance.assignments.filter((assignment) => assignment.subjectKind === "group" && assignment.subjectId === group.groupId).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span></SettingRow>)}
        <SettingRow label={t("workspaceSecurity.slices", { defaultValue: "Slices" })} desc={t("workspaceSecurity.slicesDesc", { defaultValue: "Folder, explicit selection or dynamic rule." })}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void requireWorkspace(() => openSliceWizard(false))}>{t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })}</Button>
        </SettingRow>
        {governance?.slices.map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.kind} · ${slice.materializedObjectIds.length} objects${slice.publication ? ` · ${slice.publication.mode}/${slice.publication.access}` : ""}`}><code>{slice.definition.slice(0, 64)}</code></SettingRow>)}
      </SettingCard>
      </div>
      <div className="pv-security-panel" data-panel="publications">
        <SettingCard label={t("workspaceSecurity.publications", { defaultValue: "Publications" })}>
          <Banner kind="info" rounded>{t("workspaceSecurity.publicationIsolation", { defaultValue: "Published slices use a separate encrypted workspace namespace. Provider permissions add defense in depth; they never replace encryption." })}</Banner>
          <SettingRow label={t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })} desc={t("workspaceSecurity.publishDesc", { defaultValue: "Choose exact or sanitized content, read/comment/suggestion access and a provider." })}>
            <Button variant="primary" disabled={busy} onClick={() => void requireWorkspace(() => openSliceWizard(true))}>{t("workspaceSecurity.createPublication", { defaultValue: "Create publication" })}</Button>
          </SettingRow>
          {governance?.slices.filter((slice) => slice.publication).map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.publication!.mode} · ${slice.publication!.access} · ${slice.publication!.provider}`}><code>.pvws/publications/{slice.sliceId}/</code></SettingRow>)}
        </SettingCard>
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
    </div>
  );
};

type GovernanceForm = {
  code: string; name: string; role: string; members: string; scopeKind: string; scopeId: string; sliceKind: string; definition: string;
  publicationMode: string; publicationAccess: string; publicationProvider: string;
  recoveryCode: string; deviceName: string; recoveryFile: string; fallbackPassphrase: string;
};

function parseSliceForm(form: GovernanceForm) {
  return form.sliceKind === "folder"
    ? { kind: "folder" as const, folder: form.definition }
    : form.sliceKind === "selection"
      ? { kind: "selection" as const, objectIds: form.definition.split(",").map((value) => value.trim()).filter(Boolean) }
      : { kind: "dynamic" as const, definition: JSON.parse(form.definition) as { all: Array<{ field: "path"; operator: "startsWith"; value: string }> } };
}

const WorkspaceGovernanceDialog: React.FC<{
  kind: "pair" | "invite" | "group" | "slice" | "recovery" | "rotate" | "owner";
  busy: boolean;
  form: GovernanceForm;
  governance: Governance | null;
  pairPreview: { token: string; deviceName: string; platform: string; memberId: string; fingerprint: string; expiresAt: string } | null;
  slicePreview: Array<{ objectId: string; path: string }> | null;
  rotatedRecoveryCode: string | null;
  setForm: React.Dispatch<React.SetStateAction<GovernanceForm>>;
  onClose: () => void;
  onPreview: () => void;
  onSubmit: () => void;
}> = ({ kind, busy, form, governance, pairPreview, slicePreview, rotatedRecoveryCode, setForm, onClose, onPreview, onSubmit }) => {
  const { t } = useTranslation();
  const [sliceStep, setSliceStep] = useState<1 | 2 | 3 | 4>(1);
  const update = (patch: Partial<GovernanceForm>) => setForm((current) => ({ ...current, ...patch }));
  const title = kind === "pair" ? t("workspaceSecurity.pairDevice", { defaultValue: "Approve device" })
    : kind === "invite" ? t("workspaceSecurity.invite", { defaultValue: "Invite member" })
      : kind === "group" ? t("workspaceSecurity.addGroup", { defaultValue: "Add group" })
        : kind === "slice" ? t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })
          : kind === "rotate" ? t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })
            : kind === "owner" ? t("workspaceSecurity.transferOwner", { defaultValue: "Transfer ownership" })
            : t("workspaceSecurity.restore", { defaultValue: "Restore access" });
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }} size="md">
      <div className="pv-security-wizard">
        {kind === "pair" && <><Banner kind="info" rounded>{t("workspaceSecurity.pairHelp", { defaultValue: "Paste the QR token or enter the manual code shown on the new device. Verify its fingerprint before approving." })}</Banner>{pairPreview ? <><SettingRow label={pairPreview.deviceName} desc={`${pairPreview.platform} · ${pairPreview.memberId}`}><span>{new Date(pairPreview.expiresAt).toLocaleString()}</span></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.fingerprint", { defaultValue: "Fingerprint" })}</span><code className="pv-security-code">{pairPreview.fingerprint}</code></label><Banner kind="warning" rounded>{t("workspaceSecurity.compareFingerprint", { defaultValue: "Approve only if this fingerprint exactly matches the one displayed on the new device." })}</Banner></> : <label className="pv-security-field"><span>{t("workspaceSecurity.pairCode", { defaultValue: "Token or manual code" })}</span><TextInput autoFocus value={form.code} onChange={(event) => update({ code: event.target.value })} /></label>}</>}
        {(kind === "invite" || kind === "group") && <label className="pv-security-field"><span>{t("workspaceSecurity.name")}</span><TextInput autoFocus value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>}
        {(kind === "invite" || kind === "group") && <label className="pv-security-field"><span>{t("workspaceSecurity.role", { defaultValue: "Role" })}</span><select className="pv-field pv-field--select" value={form.role} onChange={(event) => update({ role: event.target.value })}>{["Owner", "Admin", "Editor", "Commenter", "Reader", "Contributor"].map((role) => <option key={role}>{role}</option>)}</select></label>}
        {(kind === "invite" || kind === "group") && <><label className="pv-security-field"><span>{t("workspaceSecurity.scope", { defaultValue: "Scope" })}</span><select className="pv-field pv-field--select" value={form.scopeKind} onChange={(event) => update({ scopeKind: event.target.value, scopeId: "" })}><option value="workspace">{t("workspaceSecurity.wholeWorkspace", { defaultValue: "Whole workspace" })}</option><option value="slice">{t("workspaceSecurity.slice", { defaultValue: "Slice" })}</option><option value="object">{t("workspaceSecurity.singleObject", { defaultValue: "Single object" })}</option></select></label>{form.scopeKind !== "workspace" && <label className="pv-security-field"><span>{form.scopeKind === "slice" ? t("workspaceSecurity.slice", { defaultValue: "Slice" }) : t("workspaceSecurity.objectId", { defaultValue: "Object ID" })}</span>{form.scopeKind === "slice" ? <select className="pv-field pv-field--select" value={form.scopeId} onChange={(event) => update({ scopeId: event.target.value })}><option value="">—</option>{governance?.slices.map((slice) => <option key={slice.sliceId} value={slice.sliceId}>{slice.name}</option>)}</select> : <TextInput value={form.scopeId} onChange={(event) => update({ scopeId: event.target.value })} />}</label>}</>}
        {kind === "group" && <><label className="pv-security-field"><span>{t("workspaceSecurity.memberIds", { defaultValue: "Member IDs (comma-separated)" })}</span><TextInput value={form.members} onChange={(event) => update({ members: event.target.value })} /></label><SettingCardNote>{governance?.members.map((member) => `${member.displayName}: ${member.memberId}`).join(" · ")}</SettingCardNote></>}
        {kind === "slice" && <div className="pv-security-slice-wizard">
          <div className="pv-security-steps" aria-label={t("workspaceSecurity.sliceProgress", { defaultValue: "Vault Slice creation progress" })}>{["details", "content", "permissions", "review"].map((value, index) => <span key={value} data-active={sliceStep === index + 1}>{t(`workspaceSecurity.sliceStep.${value}`, { defaultValue: value[0].toUpperCase() + value.slice(1) })}</span>)}</div>
          {sliceStep === 1 && <><label className="pv-security-field"><span>{t("workspaceSecurity.name")}</span><TextInput autoFocus value={form.name} onChange={(event) => update({ name: event.target.value })} /></label><SettingCardNote>{t("workspaceSecurity.sliceDetailsHint", { defaultValue: "Use a name recipients will recognize. The definition can be changed later without changing the slice ID." })}</SettingCardNote></>}
          {sliceStep === 2 && <><div className="pv-security-choice-grid">{(["folder", "selection", "dynamic"] as const).map((value) => <button type="button" className={`pv-security-choice${form.sliceKind === value ? " is-active" : ""}`} key={value} onClick={() => update({ sliceKind: value, definition: "" })}><strong>{t(`workspaceSecurity.slice${value[0].toUpperCase() + value.slice(1)}`)}</strong><span>{t(`workspaceSecurity.sliceKindHint.${value}`, { defaultValue: value === "folder" ? "A folder and optional descendants" : value === "selection" ? "Explicit notes and attachments" : "A materialized rule result" })}</span></button>)}</div><label className="pv-security-field"><span>{form.sliceKind === "folder" ? t("workspaceSecurity.sliceFolderPath") : form.sliceKind === "selection" ? t("workspaceSecurity.sliceObjectIds") : t("workspaceSecurity.sliceRuleJson")}</span><TextInput value={form.definition} onChange={(event) => update({ definition: event.target.value })} /></label><SettingCardNote>{t("workspaceSecurity.slicePreview", { defaultValue: "The preview is calculated against the encrypted local object index before the policy is published." })}</SettingCardNote><Button variant="secondary" disabled={busy || !form.definition.trim()} onClick={onPreview}>{t("workspaceSecurity.preview", { defaultValue: "Preview" })}</Button>{slicePreview && <div className="pv-security-preview"><strong>{t("workspaceSecurity.previewCount", { defaultValue: "{{count}} matching objects", count: slicePreview.length })}</strong>{slicePreview.slice(0, 20).map((entry) => <code key={entry.objectId}>{entry.path}</code>)}</div>}</>}
          {sliceStep === 3 && <><label className="pv-security-field"><span>{t("workspaceSecurity.publicationMode", { defaultValue: "Publication" })}</span><select className="pv-field pv-field--select" value={form.publicationMode} onChange={(event) => update({ publicationMode: event.target.value })}><option value="private">{t("workspaceSecurity.privateSlice", { defaultValue: "Internal Vault Slice" })}</option><option value="exact">{t("workspaceSecurity.exactPublication", { defaultValue: "Separate exact encrypted publication" })}</option><option value="sanitized">{t("workspaceSecurity.sanitizedPublication", { defaultValue: "Separate sanitized encrypted publication" })}</option></select></label>{form.publicationMode !== "private" && <><label className="pv-security-field"><span>{t("workspaceSecurity.access", { defaultValue: "Access" })}</span><select className="pv-field pv-field--select" value={form.publicationAccess} onChange={(event) => update({ publicationAccess: event.target.value })}><option value="read">{t("workspaceSecurity.read", { defaultValue: "Read" })}</option><option value="comment">{t("workspaceSecurity.comment", { defaultValue: "Comment" })}</option><option value="suggest">{t("workspaceSecurity.suggest", { defaultValue: "Suggest changes" })}</option></select></label><label className="pv-security-field"><span>{t("workspaceSecurity.provider", { defaultValue: "Provider" })}</span><select className="pv-field pv-field--select" value={form.publicationProvider} onChange={(event) => update({ publicationProvider: event.target.value })}>{["google-drive", "onedrive", "nextcloud", "dropbox", "webdav", "s3"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Banner kind="info" rounded>{t("workspaceSecurity.providerAclHint", { defaultValue: "Provider permissions are applied as defense in depth. The publication remains a separate encrypted workspace even if the provider ACL fails." })}</Banner></>}</>}
          {sliceStep === 4 && <><Banner kind="info" rounded>{t("workspaceSecurity.sliceReviewHint", { defaultValue: "Review the materialized scope before publishing the signed policy. Excluded links and private properties are scrubbed from sanitized projections." })}</Banner><dl className="pv-security-details"><dt>{t("workspaceSecurity.name")}</dt><dd>{form.name}</dd><dt>{t("workspaceSecurity.sliceKind")}</dt><dd>{form.sliceKind}</dd><dt>{t("workspaceSecurity.preview", { defaultValue: "Preview" })}</dt><dd>{slicePreview?.length ?? 0} objects</dd><dt>{t("workspaceSecurity.publicationMode", { defaultValue: "Publication" })}</dt><dd>{form.publicationMode}{form.publicationMode !== "private" ? ` · ${form.publicationAccess} · ${form.publicationProvider}` : ""}</dd></dl></>}
        </div>}
        {kind === "recovery" && <><Banner kind="warning" rounded>{t("workspaceSecurity.restoreWarning", { defaultValue: "Recovery creates a new owner device and revokes the lost devices. Encrypted content and revision IDs are not rewritten." })}</Banner><SettingRow label={t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}><Button variant="secondary" onClick={() => void open({ multiple: false, filters: [{ name: "Plainva recovery", extensions: ["pvrecovery"] }] }).then((path) => { if (typeof path === "string") update({ recoveryFile: path }); })}>{form.recoveryFile || t("workspaceSecurity.choose")}</Button></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={form.recoveryCode} onChange={(event) => update({ recoveryCode: event.target.value })} /></label><label className="pv-security-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={form.deviceName} onChange={(event) => update({ deviceName: event.target.value })} /></label><label className="pv-security-field"><span>{t("workspaceSecurity.fallbackPassphrase")}</span><TextInput type="password" value={form.fallbackPassphrase} onChange={(event) => update({ fallbackPassphrase: event.target.value })} /></label></>}
        {kind === "rotate" && (rotatedRecoveryCode ? <><Banner kind="success" rounded>{t("workspaceSecurity.rotateRecoveryDone", { defaultValue: "The new recovery identity is anchored and the renewed file was saved. Store this new code separately; the old recovery set is no longer accepted." })}</Banner><code className="pv-security-code">{rotatedRecoveryCode}</code><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(rotatedRecoveryCode)}>{t("workspaceSecurity.copyCode")}</Button></> : <><Banner kind="warning" rounded>{t("workspaceSecurity.rotateRecoveryWarning", { defaultValue: "You need the current recovery file and code. A new identity, file and separate code will replace them." })}</Banner><SettingRow label={t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}><Button variant="secondary" onClick={() => void open({ multiple: false, filters: [{ name: "Plainva recovery", extensions: ["pvrecovery"] }] }).then((path) => { if (typeof path === "string") update({ recoveryFile: path }); })}>{form.recoveryFile || t("workspaceSecurity.choose")}</Button></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={form.recoveryCode} onChange={(event) => update({ recoveryCode: event.target.value })} /></label></>)}
        {kind === "owner" && (rotatedRecoveryCode ? <><Banner kind="success" rounded>{t("workspaceSecurity.ownerTransferDone", { defaultValue: "Ownership and recovery were transferred. Give the new recovery file and this code to the new owner through separate secure channels." })}</Banner><code className="pv-security-code">{rotatedRecoveryCode}</code><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(rotatedRecoveryCode)}>{t("workspaceSecurity.copyCode")}</Button></> : <><Banner kind="warning" rounded>{t("workspaceSecurity.ownerTransferWarning", { defaultValue: "The new recovery file is saved before the recovery anchor and owner policy activate. You become Admin; the target becomes the only Owner." })}</Banner><label className="pv-security-field"><span>{t("workspaceSecurity.newOwner", { defaultValue: "New owner" })}</span><select className="pv-field pv-field--select" value={form.scopeId} onChange={(event) => update({ scopeId: event.target.value })}><option value="">—</option>{governance?.members.filter((member) => member.state === "active" && member.memberId !== governance.memberId).map((member) => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}</select></label><SettingRow label={t("workspaceSecurity.recoveryFile")}><Button variant="secondary" onClick={() => void open({ multiple: false, filters: [{ name: "Plainva recovery", extensions: ["pvrecovery"] }] }).then((path) => { if (typeof path === "string") update({ recoveryFile: path }); })}>{form.recoveryFile || t("workspaceSecurity.choose")}</Button></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={form.recoveryCode} onChange={(event) => update({ recoveryCode: event.target.value })} /></label></>)}
        <div className="pv-security-actions"><Button variant="ghost" disabled={busy} onClick={sliceStep > 1 && kind === "slice" ? () => setSliceStep((sliceStep - 1) as 1 | 2 | 3) : onClose}>{sliceStep > 1 && kind === "slice" ? t("cloudAccounts.back", { defaultValue: "Back" }) : rotatedRecoveryCode ? t("common.close", { defaultValue: "Close" }) : t("common.cancel")}</Button>{!rotatedRecoveryCode && <Button variant="primary" disabled={busy || (kind === "pair" ? !form.code.trim() : (kind === "recovery" || kind === "rotate" || kind === "owner") ? !form.recoveryFile || !form.recoveryCode || (kind === "recovery" && !form.deviceName) || (kind === "owner" && !form.scopeId) : !form.name.trim()) || ((kind === "invite" || kind === "group") && form.scopeKind !== "workspace" && !form.scopeId) || (kind === "slice" && sliceStep >= 2 && !form.definition.trim())} onClick={kind === "slice" && sliceStep < 4 ? () => { if (sliceStep === 2) onPreview(); setSliceStep((sliceStep + 1) as 2 | 3 | 4); } : onSubmit}>{kind === "pair" && !pairPreview ? t("workspaceSecurity.verify", { defaultValue: "Verify" }) : kind === "slice" && sliceStep < 4 ? t("splash.continue", { defaultValue: "Continue" }) : t("common.confirm", { defaultValue: "Confirm" })}</Button>}</div>
      </div>
    </Modal>
  );
};

interface WorkspaceSetupWizardProps {
  vaultPath: string;
  onClose: () => void;
  prepare: ReturnType<typeof useVault>["preparePersonalWorkspace"];
  activate: ReturnType<typeof useVault>["activatePersonalWorkspace"];
}

const WorkspaceSetupWizard: React.FC<WorkspaceSetupWizardProps> = ({ vaultPath, onClose, prepare, activate }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ownerName, setOwnerName] = useState("");
  const [deviceName, setDeviceName] = useState(() => (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || t("workspaceSecurity.thisDevice"));
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const [fallbackPassphrase, setFallbackPassphrase] = useState("");
  const [fallbackPassphraseConfirm, setFallbackPassphraseConfirm] = useState("");
  const [prepared, setPrepared] = useState<PreparedPersonalWorkspace | null>(null);
  const [saved, setSaved] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [challenge, setChallenge] = useState<[number, number]>([0, 1]);
  const [challengeAnswers, setChallengeAnswers] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void credentialManager.checkKeychainStatus().then((mode) => setFallbackRequired(mode === "fallback"));
  }, []);

  useEffect(() => () => {
    if (prepared) discardPreparedPersonalWorkspace(prepared.draftId);
  }, [prepared]);

  const createRecovery = async () => {
    setBusy(true); setError(null);
    try {
      const result = await prepare({ ownerDisplayName: ownerName, deviceDisplayName: deviceName, fallbackPassphrase: fallbackPassphrase || undefined });
      const groups = result.recoveryCode.split("-").slice(1);
      const random = crypto.getRandomValues(new Uint32Array(2));
      const first = random[0] % groups.length;
      let second = random[1] % groups.length;
      if (second === first) second = (second + 1) % groups.length;
      setChallenge([first, second]);
      setChallengeAnswers(["", ""]);
      setCodeCopied(false);
      setPrepared(result); setStep(2);
    } catch (cause) {
      console.error("[WorkspaceSetupWizard] preparation failed", cause);
      setError(t("workspaceSecurity.setupFailed"));
    } finally { setBusy(false); }
  };

  const saveRecovery = async () => {
    if (!prepared) return;
    const target = await save({ defaultPath: "Plainva-Recovery.pvrecovery", filters: [{ name: "Plainva Recovery", extensions: ["pvrecovery"] }] });
    if (!target) return;
    try {
      await writeFile(target, prepared.recoveryPackage);
      setSaved(true);
      toast.info(t("workspaceSecurity.recoverySavedToast"));
    } catch (cause) {
      console.error("[WorkspaceSetupWizard] recovery save failed", cause);
      setError(t("workspaceSecurity.saveFailed"));
    }
  };

  const activateNow = async () => {
    if (!prepared) return;
    setBusy(true); setError(null); setProgress(null); setStep(3);
    try {
      const result = await activate(prepared.draftId, (done, total) => setProgress({ done, total }));
      toast.info(t("workspaceSecurity.migrationStarted", { n: result.queued, total: result.total }));
      onClose();
    } catch (cause) {
      console.error("[WorkspaceSetupWizard] activation failed", cause);
      setError(t("workspaceSecurity.activationFailed"));
      setProgress(null);
      setStep(2);
    } finally { setBusy(false); }
  };

  const copyRecoveryCode = async () => {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.recoveryCode);
      setCodeCopied(true);
      toast.info(t("workspaceSecurity.codeCopied"));
    } catch (cause) {
      console.error("[WorkspaceSetupWizard] recovery code copy failed", cause);
      setError(t("workspaceSecurity.recoveryCopyFailed"));
    }
  };

  const recoveryGroups = prepared?.recoveryCode.split("-").slice(1) ?? [];
  const recoveryPrefix = prepared?.recoveryCode.split("-")[0] ?? "PVR1";
  const challengeConfirmed = recoveryGroups.length > 1 && challenge.every((groupIndex, answerIndex) =>
    challengeAnswers[answerIndex].trim().toUpperCase() === recoveryGroups[groupIndex]?.toUpperCase()
  );
  const recoveryNext = !saved
    ? t("workspaceSecurity.recoveryNextSave")
    : !challengeConfirmed
      ? t("workspaceSecurity.recoveryNextCheck")
      : t("workspaceSecurity.recoveryReady");

  return (
    <Modal title={t("workspaceSecurity.setupTitle")} onClose={() => { if (!busy) onClose(); }} size="md">
      <div className="pv-security-wizard">
        <div className="pv-security-steps" aria-label={t("workspaceSecurity.setupProgress", { step })}>
          <span data-active={step === 1}>{t("workspaceSecurity.stepIdentity")}</span>
          <span data-active={step === 2}>{t("workspaceSecurity.stepRecovery")}</span>
          <span data-active={step === 3}>{t("workspaceSecurity.stepActivate")}</span>
        </div>
        {step === 1 && (
          <>
            <Banner kind="info" rounded>{t("workspaceSecurity.setupIntro")}</Banner>
            <label className="pv-security-field"><span>{t("workspaceSecurity.ownerName")}</span><TextInput autoFocus value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
            <label className="pv-security-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
            {fallbackRequired && (
              <>
                <label className="pv-security-field"><span>{t("workspaceSecurity.fallbackPassphrase")}</span><TextInput type="password" value={fallbackPassphrase} onChange={(event) => setFallbackPassphrase(event.target.value)} /></label>
                <label className="pv-security-field"><span>{t("encryption.passphraseConfirm")}</span><TextInput type="password" value={fallbackPassphraseConfirm} onChange={(event) => setFallbackPassphraseConfirm(event.target.value)} /></label>
                {fallbackPassphraseConfirm && fallbackPassphrase !== fallbackPassphraseConfirm && <Banner kind="warning" rounded>{t("encryption.mismatch")}</Banner>}
              </>
            )}
          </>
        )}
        {step === 2 && prepared && (
          <>
            <Banner kind="warning" rounded><strong>{t("workspaceSecurity.recoverySetupTitle")}</strong><br />{t("workspaceSecurity.recoverySetupIntro")}</Banner>
            <section className="pv-security-recovery-task" data-complete={saved}>
              <span className="pv-security-task-number" aria-hidden="true">1</span>
              <div className="pv-security-task-body">
                <div className="pv-security-task-head">
                  <div><strong>{t("workspaceSecurity.recoveryTaskFileTitle")}</strong><span>{t("workspaceSecurity.recoveryTaskFileDesc")}</span></div>
                  <Button variant="secondary" onClick={() => void saveRecovery()}>{saved ? t("workspaceSecurity.saved") : t("workspaceSecurity.saveRecovery")}</Button>
                </div>
                {saved && <span className="pv-security-task-status" data-state="correct">{t("workspaceSecurity.recoveryFileSavedStatus")}</span>}
              </div>
            </section>
            <section className="pv-security-recovery-task">
              <span className="pv-security-task-number" aria-hidden="true">2</span>
              <div className="pv-security-task-body">
                <div className="pv-security-task-head">
                  <div><strong>{t("workspaceSecurity.recoveryTaskCodeTitle")}</strong><span>{t("workspaceSecurity.recoveryTaskCodeDesc")}</span></div>
                  <Button variant="ghost" size="sm" onClick={() => void copyRecoveryCode()}>{codeCopied ? t("workspaceSecurity.copied") : t("workspaceSecurity.copyCode")}</Button>
                </div>
                <div className="pv-security-code-groups" role="list" aria-label={t("workspaceSecurity.recoveryCodeGroupsLabel")}>
                  <code className="pv-security-code-group pv-security-code-prefix" role="listitem"><small>{t("workspaceSecurity.recoveryPrefix")}</small><span>{recoveryPrefix}</span></code>
                  {recoveryGroups.map((group, groupIndex) => {
                    const requested = challenge.includes(groupIndex);
                    return <code className="pv-security-code-group" data-requested={requested} role="listitem" key={`${groupIndex}-${group}`}><small>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}{requested ? ` · ${t("workspaceSecurity.recoveryRequested")}` : ""}</small><span>{group}</span></code>;
                  })}
                </div>
              </div>
            </section>
            <section className="pv-security-recovery-task" data-complete={challengeConfirmed}>
              <span className="pv-security-task-number" aria-hidden="true">3</span>
              <div className="pv-security-task-body">
                <div><strong>{t("workspaceSecurity.recoveryTaskCheckTitle")}</strong><span>{t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })}</span></div>
                <div className="pv-security-challenge-grid">
                  {challenge.map((groupIndex, answerIndex) => {
                    const answer = challengeAnswers[answerIndex];
                    const matches = answer.trim().toUpperCase() === recoveryGroups[groupIndex]?.toUpperCase();
                    const state = answer ? (matches ? "correct" : "mismatch") : "pending";
                    const statusId = `recovery-group-${groupIndex}-status`;
                    return (
                      <label className="pv-security-field" key={groupIndex}>
                        <span>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}</span>
                        <TextInput
                          autoComplete="off"
                          aria-describedby={statusId}
                          aria-invalid={state === "mismatch"}
                          maxLength={recoveryGroups[groupIndex]?.length}
                          spellCheck={false}
                          value={answer}
                          onChange={(event) => {
                            const value = event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
                            setChallengeAnswers((current) => answerIndex === 0 ? [value, current[1]] : [current[0], value]);
                          }}
                        />
                        <span className="pv-security-field-status" data-state={state} id={statusId} aria-live="polite">{state === "correct" ? t("workspaceSecurity.recoveryCorrect") : state === "mismatch" ? t("workspaceSecurity.recoveryMismatch") : t("workspaceSecurity.recoveryEnterHighlighted")}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>
            <div className="pv-security-next" data-ready={saved && challengeConfirmed} role="status">{recoveryNext}</div>
            <details className="pv-security-tech"><summary>{t("workspaceSecurity.details")}</summary><SettingCardNote>{t("workspaceSecurity.fingerprintValue", { value: prepared.fingerprint })}</SettingCardNote></details>
          </>
        )}
        {step === 3 && (
          <>
            <Banner kind="info" rounded>{t("workspaceSecurity.activating")}</Banner>
            <div
              style={{ height: 6, background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", margin: "0.6rem 0", overflow: "hidden" }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress?.total}
              aria-valuenow={progress?.done}
            >
              {progress && progress.total > 0 ? (
                <div style={{ height: "100%", width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent-color)", borderRadius: "var(--radius-xs)", transition: "width var(--dur-1) var(--ease-1)" }} />
              ) : (
                <div className="indeterminate-progress" style={{ height: "100%", background: "var(--accent-color)", borderRadius: "var(--radius-xs)" }} />
              )}
            </div>
            {progress && progress.total > 0 && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("workspaceSecurity.activatingProgress", { done: progress.done, total: progress.total })}</div>
            )}
          </>
        )}
        {error && <Banner kind="error" rounded>{error}</Banner>}
        <div className="pv-security-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
          {step === 1 && <Button variant="primary" disabled={busy || !ownerName.trim() || !deviceName.trim() || (fallbackRequired && (fallbackPassphrase.length < 10 || fallbackPassphrase !== fallbackPassphraseConfirm))} onClick={() => void createRecovery()}>{t("splash.continue")}</Button>}
          {step === 2 && <Button variant="primary" disabled={busy || !saved || !challengeConfirmed} onClick={() => void activateNow()}>{t("workspaceSecurity.activate")}</Button>}
        </div>
        <span className="pv-security-vault">{vaultPath}</span>
      </div>
    </Modal>
  );
};
