import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, Cloud, Copy, QrCode, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Upload } from "lucide-react";
import { QrScanner } from "../components/QrScanner";
import { Banner, Button, ICON, IconButton, QrImage, Segmented, TextInput, toast } from "@plainva/ui";
import { decodeWorkspaceInvite, type PersonalWorkspaceRuntime, type WorkspaceObjectStore, type WorkspaceRole } from "@plainva/core";
import { useTranslation } from "react-i18next";
import type { MobileVault } from "../services/vaultService";
import { reloadActiveMobileVault } from "../services/vaultService";
import { getMobileRemoteWorkspaceInfo, getMobileWorkspaceObjectStore, getStoredProvider } from "../services/syncService";
import { activateMobileWorkspaceRecovery, approveMobileWorkspacePairing, assignMobileWorkspaceRole, createMobileWorkspaceGroup, createMobileWorkspaceSlice, inviteMobileWorkspaceMember, beginMobileWorkspacePairing, completeMobileWorkspacePairing, getMobileWorkspaceStatus, inspectMobileWorkspacePairing, lockMobileWorkspace, recoverMobileWorkspace, rotateMobileWorkspaceRecovery, unlockMobileWorkspace, type MobileWorkspaceStatus } from "../services/mobileWorkspaceSecurity";
import { AppBar } from "../components/AppBar";

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
    <Button variant="ghost" className="m-filepick" disabled={disabled} onClick={() => ref.current?.click()}>
      <Upload size={ICON.ui} /> {fileName ?? chooseLabel}
    </Button>
    <input ref={ref} accept=".pvrecovery" type="file" hidden onChange={onPick} />
  </>;
}

/**
 * What this vault's sync connection actually is — the screen must never claim
 * encryption that is not there (maintainer 2026-07-25). Mirrors the desktop's
 * `detectJoinableWorkspace` gate: a remote `.pvws/genesis.pvgen` makes a
 * connection an encrypted workspace, everything else is a plain cloud vault.
 */
const ROLE_OPTIONS: WorkspaceRole[] = ["Reader", "Commenter", "Contributor", "Editor", "Admin"];

type ConnectionState =
  | { kind: "checking" }
  /** No provider at all — encryption has no remote to protect. */
  | { kind: "local" }
  /** Cloud connected, remote carries NO workspace: encryption is possible. */
  | { kind: "plain" }
  /** Cloud connected and encrypted: this device can join. */
  | { kind: "encrypted"; workspaceId: string; fingerprint: string }
  /** Probe failed (offline / expired sign-in) — stay honest, offer a recheck. */
  | { kind: "unknown" };

export function SecurityAreaScreen({ vault, onBack, onConnectCloud, onSetupWorkspace }: {
  vault: MobileVault;
  onBack: () => void;
  onConnectCloud?: () => void;
  /** Opens the setup wizard, which is its own destination since S37. */
  onSetupWorkspace: () => void;
}) {
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
  /* Managing shares from here (S38 / E8). Each form is one field plus a role,
     because that is what the operation needs — the desktop's wider dialogs
     exist for slice kinds this screen deliberately does not offer. */
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("Reader");
  const [groupName, setGroupName] = useState("");
  const [sliceName, setSliceName] = useState("");
  const [sliceFolder, setSliceFolder] = useState("");

  const [connection, setConnection] = useState<ConnectionState>({ kind: "checking" });

  const refresh = useCallback(async () => {
    setStatus(await getMobileWorkspaceStatus(vault.vaultId));
    setQuarantine(vault.workspaceState ? await vault.workspaceState.listQuarantine() : []);
  }, [vault.vaultId, vault.workspaceState]);
  useEffect(() => { void refresh(); }, [refresh]);

  /** One remote probe decides what this screen may claim. */
  const probeConnection = useCallback(async () => {
    setConnection({ kind: "checking" });
    const provider = await getStoredProvider(vault.vaultId);
    if (!provider) { setConnection({ kind: "local" }); return; }
    try {
      const info = await getMobileRemoteWorkspaceInfo(vault.vaultId);
      setConnection(info ? { kind: "encrypted", ...info } : { kind: "plain" });
    } catch {
      setConnection({ kind: "unknown" });
    }
  }, [vault.vaultId]);
  useEffect(() => { void probeConnection(); }, [probeConnection]);

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

  /* One helper for all three: they differ only in which core call they make,
     and every one of them needs the same store + runtime + refresh. */
  const runGovernance = async (id: string, run: (store: WorkspaceObjectStore, rt: PersonalWorkspaceRuntime) => Promise<unknown>, done: string) => {
    const rt = vault.workspaceRuntime;
    if (!rt) return;
    setBusyAction(id);
    try {
      await run(await getMobileWorkspaceObjectStore(vault.vaultId), rt);
      toast.success(done);
      await refresh();
    } catch (error) {
      console.error("[SecurityAreaScreen] governance failed", error);
      toast.error(t("workspaceSecurity.setupFailed"));
    } finally { setBusyAction(null); }
  };

  const inviteMember = () => void runGovernance("invite", (store, rt) =>
    inviteMobileWorkspaceMember({ vaultId: vault.vaultId, store, runtime: rt, displayName: memberName.trim(), role: memberRole })
      .then(() => setMemberName("")), t("workspaceSecurity.memberInvited"));

  const addGroup = () => void runGovernance("group", (store, rt) =>
    createMobileWorkspaceGroup({ vaultId: vault.vaultId, store, runtime: rt, name: groupName.trim(), memberIds: [], role: "Reader" })
      .then(() => setGroupName("")), t("workspaceSecurity.groupCreated"));

  const addSlice = () => void runGovernance("slice", (store, rt) =>
    createMobileWorkspaceSlice({ vaultId: vault.vaultId, store, runtime: rt, name: sliceName.trim(), folder: sliceFolder.trim() })
      .then(() => { setSliceName(""); setSliceFolder(""); }), t("workspaceSecurity.sliceCreated"));

  const runtime = status?.phase === "locked" ? null : vault.workspaceRuntime;
  /** Status row text for a device that has NOT joined a workspace. */
  const connectionLabel = () =>
    connection.kind === "checking" ? t("workspaceSecurity.stateChecking", { defaultValue: "Checking this connection …" })
      : connection.kind === "local" ? t("workspaceSecurity.stateLocalTitle", { defaultValue: "On this device only" })
        : connection.kind === "plain" ? t("workspaceSecurity.statePlainTitle", { defaultValue: "This connection is not encrypted" })
          : connection.kind === "unknown" ? t("workspaceSecurity.stateUnknownTitle", { defaultValue: "Encryption status unknown" })
            : t("workspaceSecurity.notConfigured");
  const ConnectionIcon = connection.kind === "local" ? Smartphone : connection.kind === "plain" ? ShieldOff : ShieldCheck;

  return <div className="m-page">
    <AppBar onBack={onBack} title={t("settings.sectionSecurity")} />
    {/* Honesty gate (H6): the "experimental, not independently reviewed" caveat
        used to live only in the desktop What's-New text and the handbook — not
        on the screen where a device actually joins a workspace. */}
    <Banner kind="warning" rounded>{t("workspaceSecurity.experimentalNotice")}</Banner>
    <p className="m-sectionlabel">{t("workspaceSecurity.currentStatus")}</p>
    {/* The state card below IS the status for a device that has not joined a
        plain/local vault — only the joined and joinable cases add this row. */}
    {(status || connection.kind === "encrypted") && <div className="m-row m-row--static">{status ? <ShieldCheck className="m-accent" size={ICON.head} /> : <ConnectionIcon size={ICON.head} />}<span>{status ? `${status.phase} · ${status.deviceName}` : t("workspaceSecurity.notConfigured")}</span></div>}
    {runtime && (
      <Segmented
        ariaLabel={t("settings.sectionSecurity")}
        className="m-security-tabs"
        options={(["overview", "devices", "team", "slices", "recovery"] as const).map((value) => ({
          value,
          label: t(`workspaceSecurity.mobile.${value}`, { defaultValue: value[0].toUpperCase() + value.slice(1) }),
        }))}
        value={area}
        onChange={(v) => setArea(v as typeof area)}
      />
    )}
    {status?.phase === "locked" && <button className="m-row" disabled={busy} onClick={() => void unlock()}>{busyAction === "unlock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.unlock")}</span></button>}
    {runtime ? <>
      {(area === "overview" || area === "devices") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.devicesCard")}</p>
      {runtime.policy.payload.devices.map((device) => <div className="m-row m-row--static" key={device.deviceId}><span className="m-linestack">{device.displayName}<small>{device.platform} · {device.state}</small></span></div>)}
      <button className="m-row" disabled={busy} onClick={() => setScan("approve")}><QrCode className="m-accent" size={ICON.head} /><span>{t("workspaceSecurity.scanQr", { defaultValue: "Scan and approve a device" })}</span></button>
      {pairPreview && <div className="m-security-approval">
        <div className="m-row m-row--static"><span className="m-linestack"><strong>{pairPreview.deviceName}</strong><small>{pairPreview.platform} · {pairPreview.memberId}</small></span></div>
        <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{pairPreview.fingerprint}</code></div>
        <button className="m-row" disabled={busy} onClick={() => void approveScanned()}>{busyAction === "approve" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.approve", { defaultValue: "Approve after fingerprint check" })}</span></button>
      </div>}
      </>}
      {(area === "overview" || area === "team" || area === "slices") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.teamsCard")}</p>
      <div className="m-row m-row--static"><span>{runtime.policy.payload.members.filter((member) => member.state === "active").length} {t("workspaceSecurity.members")} · {runtime.policy.payload.groups.length} {t("workspaceSecurity.groups")} · {runtime.policy.payload.slices.length} {t("workspaceSecurity.slices")}</span></div>
      {area === "team" && <>
        {runtime.policy.payload.members.map((member) => <div className="m-row m-row--static" key={member.memberId}><span className="m-linestack">{member.displayName}<small>{member.state} · {member.memberId.slice(0, 12)}</small></span></div>)}
        {/* Inviting creates the member and its personal key group; the DEVICE
            is paired afterwards, which is what the toast says. */}
        <label className="m-field"><span>{t("workspaceSecurity.name")}</span>
          <TextInput value={memberName} onChange={(event) => setMemberName(event.target.value)} /></label>
        <label className="m-field"><span>{t("workspaceSecurity.role")}</span>
          <Segmented
            options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
            value={memberRole}
            onChange={(value) => setMemberRole(value as WorkspaceRole)}
          /></label>
        <Button variant="tonal" disabled={busy || !memberName.trim()} onClick={inviteMember}>
          {busyAction === "invite" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.invite")}
        </Button>
        <p className="m-sectionlabel">{t("workspaceSecurity.groups")}</p>
        {/* A group's role is the one thing about it that changes over time, so
            it is editable in place rather than behind a dialog. The role shown
            is the workspace-wide assignment; a narrower scope stays desktop. */}
        {runtime.policy.payload.groups.map((group) => {
          const current = runtime.policy.payload.assignments.find(
            (a) => a.subjectKind === "group" && a.subjectId === group.groupId && a.scopeKind === "workspace",
          )?.role;
          return <div className="m-row m-row--static" key={group.groupId}>
            <span className="m-linestack">{group.name}<small>{(group.memberIds?.length ?? 0)} {t("workspaceSecurity.members")}</small></span>
            <Segmented
              options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
              value={current ?? "Reader"}
              onChange={(value) => void runGovernance("role", (store, rt) =>
                assignMobileWorkspaceRole({ vaultId: vault.vaultId, store, runtime: rt, subjectKind: "group", subjectId: group.groupId, role: value as WorkspaceRole }),
                t("workspaceSecurity.groupCreated"))}
            />
          </div>;
        })}
        {/* A new group starts empty: adding members to it needs a picker over
            the member list, and an empty group with a role is the shape people
            fill in afterwards on either device. */}
        <label className="m-field"><span>{t("workspaceSecurity.name")}</span>
          <TextInput value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label>
        <Button variant="tonal" disabled={busy || !groupName.trim()} onClick={addGroup}>
          {busyAction === "group" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.addGroup")}
        </Button>
      </>}
      {area === "slices" && <>
        {runtime.policy.payload.slices.map((slice) => <div className="m-row m-row--static" key={slice.sliceId}><span className="m-linestack">{slice.name}<small>{slice.kind} · {slice.materializedObjectIds.length}</small></span></div>)}
        {/* Folder slices only here (S38): a selection slice needs a multi-select
            over objects and a dynamic one the query builder — neither surface
            exists on the phone, and a half-built one would be worse than the
            desktop link this replaces. */}
        <label className="m-field"><span>{t("workspaceSecurity.name")}</span>
          <TextInput value={sliceName} onChange={(event) => setSliceName(event.target.value)} /></label>
        <label className="m-field"><span>{t("database.folder")}</span>
          <TextInput value={sliceFolder} onChange={(event) => setSliceFolder(event.target.value)} /></label>
        <Button variant="tonal" disabled={busy || !sliceName.trim() || !sliceFolder.trim()} onClick={addSlice}>
          {busyAction === "slice" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.addSlice")}
        </Button>
        <p className="m-sectionlabel">{t("workspaceSecurity.publications")}</p>
        {runtime.policy.payload.slices.filter((slice) => slice.publication).map((slice) => <div className="m-row m-row--static" key={`pub-${slice.sliceId}`}><span className="m-linestack">{slice.name}<small>{slice.publication?.mode} · {slice.publication?.access}</small></span></div>)}
      </>}
      </>}
      {(area === "overview" || area === "recovery") && <>
      <p className="m-sectionlabel">{t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Current recovery file" })}</span><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void renewRecovery()}>{busyAction === "renew" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</span></button>
      {renewedRecoveryCode && <div className="m-row m-row--static"><span className="m-linestack"><strong>{renewedRecoveryCode}</strong><small>{t("workspaceSecurity.storeCodeSeparately", { defaultValue: "Store this new code separately from the renewed file." })}</small></span><IconButton
                                                                                                                                                                                                                                                                                      label={t("common.copy", { defaultValue: "Copy" })}
                                                                                                                                                                                                                                                                                      onClick={() => void navigator.clipboard.writeText(renewedRecoveryCode)}
                                                                                                                                                                                                                                                                                    ><Copy size={ICON.head} /></IconButton></div>}
      <button className="m-row" disabled={busy} onClick={() => void lock()}>{busyAction === "lock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.lock")}</span></button>
      </>}
    </> : status?.phase === "locked" ? null : connection.kind === "encrypted" ? <>
      {/* On-ramp (F2, Punkt 12): make the "connect → join here" order obvious,
          and state that creating a new workspace is a desktop action (E4).
          Only reachable once the remote probe FOUND an encrypted workspace —
          otherwise the branch below explains the real state instead. */}
      <div className="m-onramp">
        <div className="m-onramp-status">
          <ShieldCheck size={ICON.head} style={{ flexShrink: 0 }} />
          <div><p>{t("workspaceSecurity.onRampTitle", { defaultValue: "This vault is end-to-end encrypted" })}</p><p className="m-onramp-sub">{t("workspaceSecurity.onRampBody", { defaultValue: "Your notes stay locked on this device until it joins the workspace." })}</p></div>
        </div>
        <ol className="m-onramp-steps">
          <li className="done"><span className="m-step-num"><Check size={ICON.meta} /></span><div><p>{t("workspaceSecurity.onRampStep1", { defaultValue: "Cloud connected" })}</p></div></li>
          <li className="now"><span className="m-step-num">2</span><div><p>{t("workspaceSecurity.onRampStep2", { defaultValue: "Join this workspace" })}</p><p className="m-step-sub">{t("workspaceSecurity.onRampStep2Body", { defaultValue: "Pair with a device that is already in, or restore from your recovery file." })}</p></div></li>
        </ol>
      </div>

      <p className="m-sectionlabel">{t("workspaceSecurity.joinTitle", { defaultValue: "Join this workspace" })}</p>
      <div className="m-row m-row--static"><span><small>{t("workspaceSecurity.joinHelp", { defaultValue: "On the inviting device open Security & Sharing, go to the team's members, choose \"Show invitation\" and copy the code. Paste it here." })}</small></span></div>
      <label className="m-field"><span>{t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}</span><TextInput value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy} onClick={() => setScan("invite")}><QrCode className="m-accent" size={ICON.head} /><span>{t("workspaceSecurity.scanInvite", { defaultValue: "Scan invitation" })}</span></button>
      <label className="m-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !inviteCode.trim()} onClick={() => void startPairing()}>{busyAction === "pair" ? <span className="m-actionspin" aria-hidden /> : <QrCode className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.requestJoin", { defaultValue: "Request to join" })}</span></button>

      {request && <div className="m-pairing">
        <div className="m-pairing-qr">
          <QrImage value={request.token} size={232} label={t("workspaceSecurity.pairingQrCaption", { defaultValue: "Pairing request code" })} />
          <p className="m-onramp-sub">{t("workspaceSecurity.pairingScanCaption", { defaultValue: "On a device that is already in, open Security & Sharing and scan this to approve." })}</p>
        </div>
        <div className="m-codefield">
          <span className="m-codefield-label">{t("workspaceSecurity.pairingCodeLabel", { defaultValue: "Pairing code" })}</span>
          <div className="m-codefield-row">
            <code className="m-code">{request.shortCode}</code>
            <IconButton
              label={t("common.copy", { defaultValue: "Copy" })}
              onClick={() => void navigator.clipboard.writeText(request.shortCode)}
            ><Copy size={ICON.head} /></IconButton>
          </div>
        </div>
        <p className="m-hint">{t("workspaceSecurity.pairingShareExplain", { defaultValue: "Send this code to the approver. Once they confirm it, this device joins and unlocks." })}</p>
        <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{request.fingerprint}</code></div>
        <button className="m-row" disabled={busy} onClick={() => void complete()}>{busyAction === "complete" ? <span className="m-actionspin" aria-hidden /> : <RefreshCw className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.checkApproval", { defaultValue: "Check approval" })}</span></button>
      </div>}

      <p className="m-sectionlabel">{t("workspaceSecurity.restore", { defaultValue: "Recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}</span><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void recover()}>{busyAction === "recover" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.head} />}<span>{t("workspaceSecurity.restore", { defaultValue: "Restore access" })}</span></button>
    </> : <>
      {/* No encrypted workspace on this vault: say what IS true and what is
          possible — never the on-ramp's "this vault is end-to-end encrypted"
          (maintainer 2026-07-25). Joining/recovery need a remote workspace, so
          both forms stay hidden here; the recheck picks up a workspace that
          was just created elsewhere. A plain cloud connection can be encrypted
          from here since 2026-07-25 (setup used to be desktop-only); since S37
          the setup itself is its own destination rather than a state of this
          screen — a wizard holding an in-memory key must not sit under a bar
          that discards it on a tap. */}
      <div className="m-onramp">
        <div className="m-onramp-status m-onramp-status--neutral">
          <ConnectionIcon size={ICON.head} style={{ flexShrink: 0 }} />
          <div>
            <p>{connectionLabel()}</p>
            <p className="m-onramp-sub">{
              connection.kind === "local" ? t("workspaceSecurity.stateLocalBody", { defaultValue: "Encryption protects notes on their way into the cloud. This vault has no cloud connection, so there is nothing to encrypt — the notes stay in the app's private storage on this device." })
                : connection.kind === "plain" ? t("workspaceSecurity.statePlainBody", { defaultValue: "Your notes sync to the cloud as ordinary Markdown files. Encryption is possible for this connection." })
                  : connection.kind === "unknown" ? t("workspaceSecurity.stateUnknownBody", { defaultValue: "Could not check this connection (offline, or the sign-in expired). The encryption status stays unknown until the next check." })
                    : t("workspaceSecurity.stateCheckingBody", { defaultValue: "Looking for an encrypted workspace on this cloud connection." })
            }</p>
          </div>
        </div>
        {connection.kind === "plain" && <Button
                                          variant="primary"
                                          className="m-onramp-action"
                                          disabled={busy}
                                          onClick={onSetupWorkspace}
                                        ><ShieldCheck size={ICON.ui} /> {t("workspaceSecurity.setup")}</Button>}
        {connection.kind === "local" && onConnectCloud && <Button
                                                            variant="primary"
                                                            className="m-onramp-action"
                                                            onClick={onConnectCloud}
                                                          ><Cloud size={ICON.ui} /> {t("mobile.vaultAdd")}</Button>}
        {(connection.kind === "plain" || connection.kind === "unknown") && <Button
                                                                             variant="ghost"
                                                                             className="m-onramp-action"
                                                                             onClick={() => void probeConnection()}
                                                                           ><RefreshCw size={ICON.ui} /> {t("workspaceSecurity.recheck", { defaultValue: "Check again" })}</Button>}
      </div>
    </>}
    {quarantine.length > 0 && <><p className="m-sectionlabel">{t("workspaceSecurity.quarantine", { defaultValue: "Quarantine" })}</p>{quarantine.map((entry) => <div className="m-row m-row--static" key={entry.quarantineId}><span className="m-linestack">{entry.artifactKind}<small>{entry.reason} · {entry.status}</small></span></div>)}</>}
    {scan === "invite" && <QrScanner onDecode={(value) => { setInviteCode(value); setScan(null); }} onClose={() => setScan(null)} />}
    {scan === "approve" && <QrScanner onDecode={(value) => void approveFromScan(value)} onClose={() => setScan(null)} />}
  </div>;
}
