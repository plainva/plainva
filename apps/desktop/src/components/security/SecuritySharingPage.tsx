import React, { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Banner, Button, Modal, SettingCard, SettingCardNote, SettingRow, TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { credentialManager } from "../../services/CredentialManager";
import { appConfirm } from "../../services/appDialogs";
import { discardPreparedPersonalWorkspace, type PreparedPersonalWorkspace } from "../../services/workspaceSecurity/workspaceLifecycle";
import { AreaHead } from "../settings/AppPages";

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

/** Desktop P3–P7 control surface for personal and team encrypted workspaces. */
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
    updateWorkspaceQuarantine,
    exportWorkspaceQuarantine,
  } = useVault();
  const status = isActiveVault ? workspaceSecurityStatus : null;
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [dialog, setDialog] = useState<"pair" | "invite" | "group" | "slice" | "recovery" | "rotate" | null>(null);
  const [slicePreview, setSlicePreview] = useState<Array<{ objectId: string; path: string }> | null>(null);
  const [pairPreview, setPairPreview] = useState<Awaited<ReturnType<typeof inspectWorkspacePairingRequest>> | null>(null);
  const [rotatedRecoveryCode, setRotatedRecoveryCode] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", role: "Reader", members: "", scopeKind: "workspace", scopeId: "", sliceKind: "folder", definition: "", recoveryCode: "", deviceName: navigator.platform || "Desktop", recoveryFile: "", fallbackPassphrase: "" });

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
      await createWorkspaceSlice({ name: form.name, definition, materializedObjectIds: preview.map((entry) => entry.objectId) });
    }, t("workspaceSecurity.sliceCreated", { defaultValue: "Slice created" }));
    if (dialog === "rotate") return rotateRecovery();
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

  const exportQuarantine = async (quarantineId: string): Promise<void> => {
    const bytes = await exportWorkspaceQuarantine(quarantineId);
    if (!bytes) return;
    const target = await save({ defaultPath: `Plainva-Quarantine-${quarantineId.slice(0, 12)}.bin` });
    if (target) await writeFile(target, bytes);
  };

  return (
    <div>
      <AreaHead areaId="security" />
      {!isActiveVault && <Banner kind="info" rounded>{t("workspaceSecurity.openVaultFirst")}</Banner>}
      {isActiveVault && !hasSyncConnection && <Banner kind="warning" rounded>{t("workspaceSecurity.connectionRequired")}</Banner>}

      <SettingCard label={t("workspaceSecurity.statusCard")}>
        <SettingRow label={t("workspaceSecurity.currentStatus")} desc={status ? t("workspaceSecurity.workspaceProtected") : t("workspaceSecurity.notConfigured")}>
          {status ? (
            <strong>{phaseLabel(t, status.phase)}</strong>
          ) : (
            <Button variant="primary" disabled={!isActiveVault || !hasSyncConnection} onClick={() => setShowSetup(true)} data-testid="workspace-security-setup">
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
          <Button variant="secondary" disabled={!hasSyncConnection || busy} onClick={() => setDialog("recovery")}>{t("workspaceSecurity.restore", { defaultValue: "Restore" })}</Button>
        </SettingRow>
        <SettingRow label={t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })} desc={t("workspaceSecurity.rotateRecoveryDesc", { defaultValue: "Invalidate the old recovery identity by creating and anchoring a new two-piece recovery set." })}>
          <Button variant="secondary" disabled={!governance || busy} onClick={() => { setRotatedRecoveryCode(null); setDialog("rotate"); }}>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</Button>
        </SettingRow>
        <SettingCardNote>{t("workspaceSecurity.recoverySeparation")}</SettingCardNote>
      </SettingCard>

      <SettingCard label={t("workspaceSecurity.devicesCard")}>
        <SettingRow label={t("workspaceSecurity.pairDevice", { defaultValue: "Approve device" })} desc={t("workspaceSecurity.pairHelp")}>
          <Button variant="secondary" disabled={!governance || busy} onClick={() => setDialog("pair")}>{t("workspaceSecurity.approve", { defaultValue: "Enter code" })}</Button>
        </SettingRow>
        {governance?.devices.map((device) => (
          <SettingRow key={device.deviceId} label={device.displayName} desc={`${device.platform} · ${device.deviceId.slice(0, 16)} · ${device.state}`}>
            {device.deviceId === governance.deviceId ? <strong>{t("workspaceSecurity.thisDevice", { defaultValue: "This device" })}</strong> : device.state === "active" ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeDevice", { defaultValue: "Remove device?" }), message: t("workspaceSecurity.revokeDeviceDesc", { defaultValue: "The device loses future sync access immediately." }), kind: "danger", confirmLabel: t("workspaceSecurity.remove") }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceDevice(device.deviceId, "Removed in Security Center"), t("workspaceSecurity.deviceRevoked", { defaultValue: "Device removed" })); })}>{t("workspaceSecurity.remove")}</Button>
            ) : <span>{t("workspaceSecurity.revoked", { defaultValue: "Revoked" })}</span>}
          </SettingRow>
        ))}
      </SettingCard>

      <SettingCard label={t("workspaceSecurity.teamsCard")}>
        <SettingRow label={t("workspaceSecurity.members", { defaultValue: "Members" })} desc={t("workspaceSecurity.groupsDesc")}>
          <span>{governance?.members.filter((member) => member.state === "active").length ?? 0}</span>
          <Button variant="secondary" size="sm" disabled={!governance || busy} onClick={() => setDialog("invite")}>{t("workspaceSecurity.invite", { defaultValue: "Invite" })}</Button>
        </SettingRow>
        {governance?.members.map((member) => <SettingRow key={member.memberId} label={member.displayName} desc={`${member.memberId.slice(0, 8)} · ${member.state}`}><span>{governance.assignments.filter((assignment) => (assignment.subjectKind === "member" && assignment.subjectId === member.memberId) || governance.groups.some((group) => group.groupId === assignment.subjectId && group.memberIds?.includes(member.memberId))).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span>{member.state === "active" && member.memberId !== governance.memberId && <Button variant="danger" size="sm" disabled={busy} onClick={() => void appConfirm({ title: t("workspaceSecurity.revokeMember", { defaultValue: "Remove member?" }), message: t("workspaceSecurity.revokeMemberDesc", { defaultValue: "Their devices are revoked and affected encryption groups are rotated. Previously downloaded content cannot be taken back." }), kind: "danger", confirmLabel: t("workspaceSecurity.remove") }).then((ok) => { if (ok) return runGovernance(() => revokeWorkspaceMember(member.memberId, "Removed in Security Center"), t("workspaceSecurity.memberRevoked", { defaultValue: "Member removed and keys rotated" })); })}>{t("workspaceSecurity.remove")}</Button>}</SettingRow>)}
        <SettingRow label={t("workspaceSecurity.groups", { defaultValue: "Groups" })} desc={t("workspaceSecurity.groupsDesc", { defaultValue: "Encryption groups and their effective role." })}>
          <Button variant="secondary" size="sm" disabled={!governance || busy} onClick={() => setDialog("group")}>{t("workspaceSecurity.addGroup", { defaultValue: "Add group" })}</Button>
        </SettingRow>
        {governance?.groups.map((group) => <SettingRow key={group.groupId} label={group.name} desc={`${group.memberIds?.length ?? 0} · key epoch ${group.keyEpoch}`}><span>{governance.assignments.filter((assignment) => assignment.subjectKind === "group" && assignment.subjectId === group.groupId).map((assignment) => `${assignment.role}/${assignment.scopeKind}`).join(", ") || "—"}</span></SettingRow>)}
        <SettingRow label={t("workspaceSecurity.slices", { defaultValue: "Slices" })} desc={t("workspaceSecurity.slicesDesc", { defaultValue: "Folder, explicit selection or dynamic rule." })}>
          <Button variant="secondary" size="sm" disabled={!governance || busy} onClick={() => setDialog("slice")}>{t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })}</Button>
        </SettingRow>
        {governance?.slices.map((slice) => <SettingRow key={slice.sliceId} label={slice.name} desc={`${slice.kind} · ${slice.materializedObjectIds.length} objects`}><code>{slice.definition.slice(0, 64)}</code></SettingRow>)}
      </SettingCard>

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
  kind: "pair" | "invite" | "group" | "slice" | "recovery" | "rotate";
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
  const update = (patch: Partial<GovernanceForm>) => setForm((current) => ({ ...current, ...patch }));
  const title = kind === "pair" ? t("workspaceSecurity.pairDevice", { defaultValue: "Approve device" })
    : kind === "invite" ? t("workspaceSecurity.invite", { defaultValue: "Invite member" })
      : kind === "group" ? t("workspaceSecurity.addGroup", { defaultValue: "Add group" })
        : kind === "slice" ? t("workspaceSecurity.addSlice", { defaultValue: "Add slice" })
          : kind === "rotate" ? t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })
            : t("workspaceSecurity.restore", { defaultValue: "Restore access" });
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }} size="md">
      <div className="pv-security-wizard">
        {kind === "pair" && <><Banner kind="info" rounded>{t("workspaceSecurity.pairHelp", { defaultValue: "Paste the QR token or enter the manual code shown on the new device. Verify its fingerprint before approving." })}</Banner>{pairPreview ? <><SettingRow label={pairPreview.deviceName} desc={`${pairPreview.platform} · ${pairPreview.memberId}`}><span>{new Date(pairPreview.expiresAt).toLocaleString()}</span></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.fingerprint", { defaultValue: "Fingerprint" })}</span><code className="pv-security-code">{pairPreview.fingerprint}</code></label><Banner kind="warning" rounded>{t("workspaceSecurity.compareFingerprint", { defaultValue: "Approve only if this fingerprint exactly matches the one displayed on the new device." })}</Banner></> : <label className="pv-security-field"><span>{t("workspaceSecurity.pairCode", { defaultValue: "Token or manual code" })}</span><TextInput autoFocus value={form.code} onChange={(event) => update({ code: event.target.value })} /></label>}</>}
        {(kind === "invite" || kind === "group" || kind === "slice") && <label className="pv-security-field"><span>{t("workspaceSecurity.name")}</span><TextInput autoFocus value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>}
        {(kind === "invite" || kind === "group") && <label className="pv-security-field"><span>{t("workspaceSecurity.role", { defaultValue: "Role" })}</span><select className="pv-field pv-field--select" value={form.role} onChange={(event) => update({ role: event.target.value })}>{["Owner", "Admin", "Editor", "Commenter", "Reader", "Contributor"].map((role) => <option key={role}>{role}</option>)}</select></label>}
        {(kind === "invite" || kind === "group") && <><label className="pv-security-field"><span>{t("workspaceSecurity.scope", { defaultValue: "Scope" })}</span><select className="pv-field pv-field--select" value={form.scopeKind} onChange={(event) => update({ scopeKind: event.target.value, scopeId: "" })}><option value="workspace">{t("workspaceSecurity.wholeWorkspace", { defaultValue: "Whole workspace" })}</option><option value="slice">{t("workspaceSecurity.slice", { defaultValue: "Slice" })}</option><option value="object">{t("workspaceSecurity.singleObject", { defaultValue: "Single object" })}</option></select></label>{form.scopeKind !== "workspace" && <label className="pv-security-field"><span>{form.scopeKind === "slice" ? t("workspaceSecurity.slice", { defaultValue: "Slice" }) : t("workspaceSecurity.objectId", { defaultValue: "Object ID" })}</span>{form.scopeKind === "slice" ? <select className="pv-field pv-field--select" value={form.scopeId} onChange={(event) => update({ scopeId: event.target.value })}><option value="">—</option>{governance?.slices.map((slice) => <option key={slice.sliceId} value={slice.sliceId}>{slice.name}</option>)}</select> : <TextInput value={form.scopeId} onChange={(event) => update({ scopeId: event.target.value })} />}</label>}</>}
        {kind === "group" && <><label className="pv-security-field"><span>{t("workspaceSecurity.memberIds", { defaultValue: "Member IDs (comma-separated)" })}</span><TextInput value={form.members} onChange={(event) => update({ members: event.target.value })} /></label><SettingCardNote>{governance?.members.map((member) => `${member.displayName}: ${member.memberId}`).join(" · ")}</SettingCardNote></>}
        {kind === "slice" && <><label className="pv-security-field"><span>{t("workspaceSecurity.sliceKind", { defaultValue: "Slice type" })}</span><select className="pv-field pv-field--select" value={form.sliceKind} onChange={(event) => update({ sliceKind: event.target.value })}><option value="folder">{t("workspaceSecurity.sliceFolder")}</option><option value="selection">{t("workspaceSecurity.sliceSelection")}</option><option value="dynamic">{t("workspaceSecurity.sliceDynamic")}</option></select></label><label className="pv-security-field"><span>{form.sliceKind === "folder" ? t("workspaceSecurity.sliceFolderPath") : form.sliceKind === "selection" ? t("workspaceSecurity.sliceObjectIds") : t("workspaceSecurity.sliceRuleJson")}</span><TextInput value={form.definition} onChange={(event) => update({ definition: event.target.value })} /></label><SettingCardNote>{t("workspaceSecurity.slicePreview", { defaultValue: "The preview is calculated against the encrypted local object index before the policy is published." })}</SettingCardNote><Button variant="secondary" disabled={busy || !form.definition.trim()} onClick={onPreview}>{t("workspaceSecurity.preview", { defaultValue: "Preview" })}</Button>{slicePreview && <div className="pv-security-preview"><strong>{t("workspaceSecurity.previewCount", { defaultValue: "{{count}} matching objects", count: slicePreview.length })}</strong>{slicePreview.slice(0, 20).map((entry) => <code key={entry.objectId}>{entry.path}</code>)}</div>}</>}
        {kind === "recovery" && <><Banner kind="warning" rounded>{t("workspaceSecurity.restoreWarning", { defaultValue: "Recovery creates a new owner device and revokes the lost devices. Encrypted content and revision IDs are not rewritten." })}</Banner><SettingRow label={t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}><Button variant="secondary" onClick={() => void open({ multiple: false, filters: [{ name: "Plainva recovery", extensions: ["pvrecovery"] }] }).then((path) => { if (typeof path === "string") update({ recoveryFile: path }); })}>{form.recoveryFile || t("workspaceSecurity.choose")}</Button></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={form.recoveryCode} onChange={(event) => update({ recoveryCode: event.target.value })} /></label><label className="pv-security-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={form.deviceName} onChange={(event) => update({ deviceName: event.target.value })} /></label><label className="pv-security-field"><span>{t("workspaceSecurity.fallbackPassphrase")}</span><TextInput type="password" value={form.fallbackPassphrase} onChange={(event) => update({ fallbackPassphrase: event.target.value })} /></label></>}
        {kind === "rotate" && (rotatedRecoveryCode ? <><Banner kind="success" rounded>{t("workspaceSecurity.rotateRecoveryDone", { defaultValue: "The new recovery identity is anchored and the renewed file was saved. Store this new code separately; the old recovery set is no longer accepted." })}</Banner><code className="pv-security-code">{rotatedRecoveryCode}</code><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(rotatedRecoveryCode)}>{t("workspaceSecurity.copyCode")}</Button></> : <><Banner kind="warning" rounded>{t("workspaceSecurity.rotateRecoveryWarning", { defaultValue: "You need the current recovery file and code. A new identity, file and separate code will replace them." })}</Banner><SettingRow label={t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}><Button variant="secondary" onClick={() => void open({ multiple: false, filters: [{ name: "Plainva recovery", extensions: ["pvrecovery"] }] }).then((path) => { if (typeof path === "string") update({ recoveryFile: path }); })}>{form.recoveryFile || t("workspaceSecurity.choose")}</Button></SettingRow><label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={form.recoveryCode} onChange={(event) => update({ recoveryCode: event.target.value })} /></label></>)}
        <div className="pv-security-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>{rotatedRecoveryCode ? t("common.close", { defaultValue: "Close" }) : t("common.cancel")}</Button>{!rotatedRecoveryCode && <Button variant="primary" disabled={busy || (kind === "pair" ? !form.code.trim() : (kind === "recovery" || kind === "rotate") ? !form.recoveryFile || !form.recoveryCode || (kind === "recovery" && !form.deviceName) : !form.name.trim()) || ((kind === "invite" || kind === "group") && form.scopeKind !== "workspace" && !form.scopeId)} onClick={onSubmit}>{kind === "pair" && !pairPreview ? t("workspaceSecurity.verify", { defaultValue: "Verify" }) : t("common.confirm", { defaultValue: "Confirm" })}</Button>}</div>
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
  const [challenge, setChallenge] = useState<[number, number]>([0, 1]);
  const [challengeAnswers, setChallengeAnswers] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setBusy(true); setError(null); setStep(3);
    try {
      const result = await activate(prepared.draftId);
      toast.info(t("workspaceSecurity.migrationStarted", { n: result.queued, total: result.total }));
      onClose();
    } catch (cause) {
      console.error("[WorkspaceSetupWizard] activation failed", cause);
      setError(t("workspaceSecurity.activationFailed"));
      setStep(2);
    } finally { setBusy(false); }
  };

  const recoveryGroups = prepared?.recoveryCode.split("-").slice(1) ?? [];
  const challengeConfirmed = recoveryGroups.length > 1 && challenge.every((groupIndex, answerIndex) =>
    challengeAnswers[answerIndex].trim().toUpperCase() === recoveryGroups[groupIndex]?.toUpperCase()
  );

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
            <Banner kind="warning" rounded>{t("workspaceSecurity.recoveryWarning")}</Banner>
            <SettingRow label={t("workspaceSecurity.recoveryFile")} desc={t("workspaceSecurity.recoveryFileDesc")}>
              <Button variant="secondary" onClick={() => void saveRecovery()}>{saved ? t("workspaceSecurity.saved") : t("workspaceSecurity.saveRecovery")}</Button>
            </SettingRow>
            <label className="pv-security-field"><span>{t("workspaceSecurity.recoveryCode")}</span><code className="pv-security-code">{prepared.recoveryCode}</code></label>
            <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(prepared.recoveryCode).then(() => toast.info(t("workspaceSecurity.codeCopied")))}>{t("workspaceSecurity.copyCode")}</Button>
            <span className="pv-security-confirm">{t("settings.securityRecoveryChallenge")}</span>
            <div className="pv-security-steps">
              {challenge.map((groupIndex, answerIndex) => (
                <label className="pv-security-field" key={groupIndex}>
                  <span>{t("workspaceSecurity.recoveryCode")} · {groupIndex + 1}</span>
                  <TextInput
                    value={challengeAnswers[answerIndex]}
                    onChange={(event) => setChallengeAnswers((current) => answerIndex === 0 ? [event.target.value, current[1]] : [current[0], event.target.value])}
                  />
                </label>
              ))}
            </div>
            <SettingCardNote>{t("workspaceSecurity.fingerprintValue", { value: prepared.fingerprint })}</SettingCardNote>
          </>
        )}
        {step === 3 && <Banner kind="info" rounded>{t("workspaceSecurity.activating")}</Banner>}
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
