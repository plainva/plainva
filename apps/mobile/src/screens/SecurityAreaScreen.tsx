import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, ChevronLeft, Copy, QrCode, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { QrScanner } from "../components/QrScanner";
import { QrImage, TextInput, toast } from "@plainva/ui";
import { decodeWorkspaceInvite } from "@plainva/core";
import { useTranslation } from "react-i18next";
import type { MobileVault } from "../services/vaultService";
import { reloadActiveMobileVault } from "../services/vaultService";
import { getMobileRemoteWorkspaceInfo, getMobileWorkspaceObjectStore } from "../services/syncService";
import { activateMobileWorkspaceRecovery, approveMobileWorkspacePairing, beginMobileWorkspacePairing, completeMobileWorkspacePairing, getMobileWorkspaceStatus, inspectMobileWorkspacePairing, lockMobileWorkspace, recoverMobileWorkspace, rotateMobileWorkspaceRecovery, unlockMobileWorkspace, type MobileWorkspaceStatus } from "../services/mobileWorkspaceSecurity";

/** File chooser with an app-styled trigger (Punkt 16.8 / F5): the raw
 *  <input type=file> shows browser chrome in the OS language; the button here
 *  is app-language and shows the chosen filename. The OS picker dialog itself
 *  stays native (unavoidable for file selection). */
function FilePickButton({ chooseLabel, fileName, disabled, onPick }: {
  chooseLabel: string;
  fileName: string | null;
  disabled?: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="m-btn m-filepick" disabled={disabled} onClick={() => ref.current?.click()}>
      <Upload size={16} /> {fileName ?? chooseLabel}
    </button>
    <input ref={ref} accept=".pvrecovery" type="file" hidden onChange={onPick} />
  </>;
}

export function SecurityAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MobileWorkspaceStatus | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Mobile");
  const [request, setRequest] = useState<{ token: string; shortCode: string; fingerprint: string } | null>(null);
  const [recoveryBytes, setRecoveryBytes] = useState<Uint8Array | null>(null);
  const [recoveryFileName, setRecoveryFileName] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [renewedRecoveryCode, setRenewedRecoveryCode] = useState<string | null>(null);
  // A single action runs at a time; the id drives a per-button spinner (F1) so
  // long pairing/recovery steps show progress instead of only a disabled state.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [quarantine, setQuarantine] = useState<Array<{ quarantineId: string; artifactKind: string; reason: string; status: string }>>([]);
  const [area, setArea] = useState<"overview" | "devices" | "team" | "slices" | "recovery">("overview");
  const [pairPreview, setPairPreview] = useState<{ token: string; deviceName: string; platform: string; memberId: string; fingerprint: string; expiresAt: string } | null>(null);
  const [scan, setScan] = useState<"invite" | "approve" | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getMobileWorkspaceStatus(vault.vaultId));
    setQuarantine(vault.workspaceState ? await vault.workspaceState.listQuarantine() : []);
  }, [vault.vaultId, vault.workspaceState]);
  useEffect(() => { void refresh(); }, [refresh]);

  const startPairing = async () => {
    setBusyAction("pair");
    try {
      const info = await getMobileRemoteWorkspaceInfo(vault.vaultId);
      if (!info) throw new Error(t("workspaceSecurity.noRemoteWorkspace", { defaultValue: "No encrypted workspace was found on this connection." }));
      // Paste the invitation code an admin created on their device (Security &
      // Sharing → Members → Show invitation) — it carries the member id reserved
      // for this device, so nobody has to find/type a raw member id.
      let invite;
      try { invite = decodeWorkspaceInvite(inviteCode); }
      catch { throw new Error(t("workspaceSecurity.inviteInvalid", { defaultValue: "That is not a valid invitation code. Copy it from Security & Sharing on the inviting device." })); }
      if (invite.workspaceId !== info.workspaceId || invite.fingerprint !== info.fingerprint) {
        throw new Error(t("workspaceSecurity.inviteMismatch", { defaultValue: "This invitation is for a different workspace than the one synced here." }));
      }
      const created = await beginMobileWorkspacePairing({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), workspaceId: info.workspaceId, fingerprint: info.fingerprint, memberId: invite.memberId, deviceName: deviceName.trim() });
      setRequest(created); await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const complete = async () => {
    setBusyAction("complete");
    try {
      const runtime = await completeMobileWorkspacePairing(vault.vaultId, await getMobileWorkspaceObjectStore(vault.vaultId));
      if (!runtime) { toast.info(t("workspaceSecurity.waitingApproval", { defaultValue: "Approval has not arrived yet." })); return; }
      toast.success(t("workspaceSecurity.paired", { defaultValue: "Device paired" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const approveFromScan = async (value: string) => {
    setScan(null);
    setBusyAction("approveScan");
    try {
      if (!vault.workspaceRuntime) throw new Error(t("workspaceSecurity.unlockToApprove", { defaultValue: "Unlock an existing workspace device to approve this request." }));
      setPairPreview(await inspectMobileWorkspacePairing(await getMobileWorkspaceObjectStore(vault.vaultId), vault.workspaceRuntime, value));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const chooseRecovery = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setRecoveryFileName(file.name);
    setRecoveryBytes(new Uint8Array(await file.arrayBuffer()));
  };

  const recover = async () => {
    if (!recoveryBytes) return;
    setBusyAction("recover");
    try {
      await recoverMobileWorkspace({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), bytes: recoveryBytes, code: recoveryCode, deviceName });
      toast.success(t("workspaceSecurity.recovered", { defaultValue: "Workspace access restored" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const renewRecovery = async () => {
    if (!recoveryBytes || !vault.workspaceRuntime) return;
    setBusyAction("renew");
    try {
      const store = await getMobileWorkspaceObjectStore(vault.vaultId);
      const renewed = await rotateMobileWorkspaceRecovery({ store, runtime: vault.workspaceRuntime, bytes: recoveryBytes, code: recoveryCode });
      const file = new File([renewed.bytes.buffer as ArrayBuffer], "Plainva-Recovery-Renewed.pvrecovery", { type: "application/octet-stream" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Plainva Recovery" });
      else {
        const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url);
      }
      await activateMobileWorkspaceRecovery({ store, runtime: vault.workspaceRuntime, activation: renewed.activation });
      setRenewedRecoveryCode(renewed.recoveryCode);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const approveScanned = async () => {
    if (!pairPreview || !vault.workspaceRuntime) return;
    setBusyAction("approve");
    try {
      await approveMobileWorkspacePairing(vault.vaultId, await getMobileWorkspaceObjectStore(vault.vaultId), vault.workspaceRuntime, pairPreview.token);
      setPairPreview(null);
      toast.success(t("workspaceSecurity.deviceApproved", { defaultValue: "Device approved" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const unlock = async () => {
    setBusyAction("unlock");
    try {
      const unlocked = await unlockMobileWorkspace(vault.vaultId);
      if (!unlocked) throw new Error(t("workspaceSecurity.unlockFailed"));
      await reloadActiveMobileVault();
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const lock = async () => {
    setBusyAction("lock");
    try { await lockMobileWorkspace(vault.vaultId); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const runtime = status?.phase === "locked" ? null : vault.workspaceRuntime;
  return <div className="m-page">
    <header className="m-header"><button aria-label={t("common.back", { defaultValue: "Back" })} className="m-iconbtn" onClick={onBack}><ChevronLeft size={20} /></button><h1>{t("settings.sectionSecurity")}</h1></header>
    <p className="m-sectionlabel">{t("workspaceSecurity.currentStatus")}</p>
    <div className="m-row m-row--static"><ShieldCheck className="m-accent" size={18} /><span>{status ? `${status.phase} · ${status.deviceName}` : t("workspaceSecurity.notConfigured")}</span></div>
    {runtime && <div className="m-security-tabs" role="tablist" aria-label={t("settings.sectionSecurity")}>{(["overview", "devices", "team", "slices", "recovery"] as const).map((value) => <button role="tab" aria-selected={area === value} key={value} onClick={() => setArea(value)}>{t(`workspaceSecurity.mobile.${value}`, { defaultValue: value[0].toUpperCase() + value.slice(1) })}</button>)}</div>}
    {status?.phase === "locked" && <button className="m-row" disabled={busy} onClick={() => void unlock()}>{busyAction === "unlock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={18} />}<span>{t("workspaceSecurity.unlock")}</span></button>}
    {runtime ? <>
      {(area === "overview" || area === "devices") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.devicesCard")}</p>
      {runtime.policy.payload.devices.map((device) => <div className="m-row m-row--static" key={device.deviceId}><span className="m-linestack">{device.displayName}<small>{device.platform} · {device.state}</small></span></div>)}
      <button className="m-row" disabled={busy} onClick={() => setScan("approve")}><QrCode className="m-accent" size={18} /><span>{t("workspaceSecurity.scanQr", { defaultValue: "Scan and approve a device" })}</span></button>
      {pairPreview && <div className="m-security-approval">
        <div className="m-row m-row--static"><span className="m-linestack"><strong>{pairPreview.deviceName}</strong><small>{pairPreview.platform} · {pairPreview.memberId}</small></span></div>
        <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{pairPreview.fingerprint}</code></div>
        <button className="m-row" disabled={busy} onClick={() => void approveScanned()}>{busyAction === "approve" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={18} />}<span>{t("workspaceSecurity.approve", { defaultValue: "Approve after fingerprint check" })}</span></button>
      </div>}
      </>}
      {(area === "overview" || area === "team" || area === "slices") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.teamsCard")}</p>
      <div className="m-row m-row--static"><span>{runtime.policy.payload.members.filter((member) => member.state === "active").length} {t("workspaceSecurity.members")} · {runtime.policy.payload.groups.length} {t("workspaceSecurity.groups")} · {runtime.policy.payload.slices.length} {t("workspaceSecurity.slices")}</span></div>
      {area === "team" && <>{runtime.policy.payload.members.map((member) => <div className="m-row m-row--static" key={member.memberId}><span className="m-linestack">{member.displayName}<small>{member.state} · {member.memberId.slice(0, 12)}</small></span></div>)}{runtime.policy.payload.groups.length > 0 && <p className="m-sectionlabel">{t("workspaceSecurity.groups")}</p>}{runtime.policy.payload.groups.map((group) => <div className="m-row m-row--static" key={group.groupId}><span className="m-linestack">{group.name}<small>{(group.memberIds?.length ?? 0)} {t("workspaceSecurity.members")}</small></span></div>)}</>}
      {area === "slices" && <>{runtime.policy.payload.slices.map((slice) => <div className="m-row m-row--static" key={slice.sliceId}><span className="m-linestack">{slice.name}<small>{slice.kind} · {slice.materializedObjectIds.length}</small></span></div>)}<p className="m-sectionlabel">{t("workspaceSecurity.publications")}</p><div className="m-row m-row--static"><span><small>{t("workspaceSecurity.mobileManageOnDesktop", { defaultValue: "Manage on the desktop app." })}</small></span></div>{runtime.policy.payload.slices.filter((slice) => slice.publication).map((slice) => <div className="m-row m-row--static" key={`pub-${slice.sliceId}`}><span className="m-linestack">{slice.name}<small>{slice.publication?.mode} · {slice.publication?.access}</small></span></div>)}</>}
      </>}
      {(area === "overview" || area === "recovery") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Current recovery file" })}</span><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void renewRecovery()}>{busyAction === "renew" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={18} />}<span>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</span></button>
      {renewedRecoveryCode && <div className="m-row m-row--static"><span className="m-linestack"><strong>{renewedRecoveryCode}</strong><small>{t("workspaceSecurity.storeCodeSeparately", { defaultValue: "Store this new code separately from the renewed file." })}</small></span><button className="m-iconbtn" aria-label={t("common.copy", { defaultValue: "Copy" })} onClick={() => void navigator.clipboard.writeText(renewedRecoveryCode)}><Copy size={18} /></button></div>}
      <button className="m-row" disabled={busy} onClick={() => void lock()}>{busyAction === "lock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={18} />}<span>{t("workspaceSecurity.lock")}</span></button>
      </>}
    </> : status?.phase === "locked" ? null : <>
      {/* On-ramp (F2, Punkt 12): make the "connect → join here" order obvious,
          and state that creating a new workspace is a desktop action (E4). */}
      <div className="m-onramp">
        <div className="m-onramp-status">
          <ShieldCheck size={20} style={{ flexShrink: 0 }} />
          <div><p>{t("workspaceSecurity.onRampTitle", { defaultValue: "This vault is end-to-end encrypted" })}</p><p className="m-onramp-sub">{t("workspaceSecurity.onRampBody", { defaultValue: "Your notes stay locked on this device until it joins the workspace." })}</p></div>
        </div>
        <ol className="m-onramp-steps">
          <li className="done"><span className="m-step-num"><Check size={14} /></span><div><p>{t("workspaceSecurity.onRampStep1", { defaultValue: "Cloud connected" })}</p></div></li>
          <li className="now"><span className="m-step-num">2</span><div><p>{t("workspaceSecurity.onRampStep2", { defaultValue: "Join this workspace" })}</p><p className="m-step-sub">{t("workspaceSecurity.onRampStep2Body", { defaultValue: "Pair with a device that is already in, or restore from your recovery file." })}</p></div></li>
        </ol>
        <p className="m-hint">{t("workspaceSecurity.createOnDesktop", { defaultValue: "New encrypted workspaces are created in Plainva on desktop." })}</p>
      </div>

      <p className="m-sectionlabel">{t("workspaceSecurity.joinTitle", { defaultValue: "Join this workspace" })}</p>
      <div className="m-row m-row--static"><span><small>{t("workspaceSecurity.joinHelp", { defaultValue: "On the inviting device open Security & Sharing, go to the team's members, choose \"Show invitation\" and copy the code. Paste it here." })}</small></span></div>
      <label className="m-field"><span>{t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}</span><TextInput value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy} onClick={() => setScan("invite")}><QrCode className="m-accent" size={18} /><span>{t("workspaceSecurity.scanInvite", { defaultValue: "Scan invitation" })}</span></button>
      <label className="m-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !inviteCode.trim()} onClick={() => void startPairing()}>{busyAction === "pair" ? <span className="m-actionspin" aria-hidden /> : <QrCode className="m-accent" size={18} />}<span>{t("workspaceSecurity.requestJoin", { defaultValue: "Request to join" })}</span></button>

      {request && <div className="m-pairing">
        <div className="m-pairing-qr">
          <QrImage value={request.token} size={232} label={t("workspaceSecurity.pairingQrCaption", { defaultValue: "Pairing request code" })} />
          <p className="m-onramp-sub">{t("workspaceSecurity.pairingScanCaption", { defaultValue: "On a device that is already in, open Security & Sharing and scan this to approve." })}</p>
        </div>
        <div className="m-codefield">
          <span className="m-codefield-label">{t("workspaceSecurity.pairingCodeLabel", { defaultValue: "Pairing code" })}</span>
          <div className="m-codefield-row">
            <code className="m-code">{request.shortCode}</code>
            <button className="m-iconbtn" aria-label={t("common.copy", { defaultValue: "Copy" })} onClick={() => void navigator.clipboard.writeText(request.shortCode)}><Copy size={18} /></button>
          </div>
        </div>
        <p className="m-hint">{t("workspaceSecurity.pairingShareExplain", { defaultValue: "Send this code to the approver. Once they confirm it, this device joins and unlocks." })}</p>
        <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{request.fingerprint}</code></div>
        <button className="m-row" disabled={busy} onClick={() => void complete()}>{busyAction === "complete" ? <span className="m-actionspin" aria-hidden /> : <RefreshCw className="m-accent" size={18} />}<span>{t("workspaceSecurity.checkApproval", { defaultValue: "Check approval" })}</span></button>
      </div>}

      <p className="m-sectionlabel">{t("workspaceSecurity.restore", { defaultValue: "Recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}</span><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void recover()}>{busyAction === "recover" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={18} />}<span>{t("workspaceSecurity.restore", { defaultValue: "Restore access" })}</span></button>
    </>}
    {quarantine.length > 0 && <><p className="m-sectionlabel">{t("workspaceSecurity.quarantine", { defaultValue: "Quarantine" })}</p>{quarantine.map((entry) => <div className="m-row m-row--static" key={entry.quarantineId}><span className="m-linestack">{entry.artifactKind}<small>{entry.reason} · {entry.status}</small></span></div>)}</>}
    {scan === "invite" && <QrScanner onDecode={(value) => { setInviteCode(value); setScan(null); }} onClose={() => setScan(null)} />}
    {scan === "approve" && <QrScanner onDecode={(value) => void approveFromScan(value)} onClose={() => setScan(null)} />}
  </div>;
}
