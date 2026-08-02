import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, ChevronLeft, Cloud, Copy, QrCode, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Upload } from "lucide-react";
import { QrScanner } from "../components/QrScanner";
import { QrImage, TextInput, toast } from "@plainva/ui";
import { decodeWorkspaceInvite, SqlWorkspaceStateStore } from "@plainva/core";
import { saveRecoveryFile } from "../services/recoveryFile";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import type { MobileVault } from "../services/vaultService";
import { reloadActiveMobileVault } from "../services/vaultService";
import { getMobileRemoteWorkspaceInfo, getMobileWorkspaceObjectStore, getStoredProvider, stopSyncAndDrain } from "../services/syncService";
import { activateMobileWorkspaceRecovery, activatePreparedMobileWorkspace, approveMobileWorkspacePairing, beginMobileWorkspacePairing, completeMobileWorkspacePairing, discardPreparedMobileWorkspace, getMobileWorkspaceStatus, inspectMobileWorkspacePairing, lockMobileWorkspace, prepareMobileWorkspace, recoverMobileWorkspace, rotateMobileWorkspaceRecovery, unlockMobileWorkspace, type MobileWorkspaceStatus, type PreparedMobileWorkspace } from "../services/mobileWorkspaceSecurity";

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

/**
 * What this vault's sync connection actually is — the screen must never claim
 * encryption that is not there (maintainer 2026-07-25). Mirrors the desktop's
 * `detectJoinableWorkspace` gate: a remote `.pvws/genesis.pvgen` makes a
 * connection an encrypted workspace, everything else is a plain cloud vault.
 */
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

export function SecurityAreaScreen({ vault, onBack, onConnectCloud }: { vault: MobileVault; onBack: () => void; onConnectCloud?: () => void }) {
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

  const [connection, setConnection] = useState<ConnectionState>({ kind: "checking" });
  // First setup (2026-07-25): identity → recovery backup → activation. Inline in
  // this screen instead of a modal — a phone wizard with three tasks and a code
  // grid needs the full height, and Back must stay the way out.
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [prepared, setPrepared] = useState<PreparedMobileWorkspace | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [challenge, setChallenge] = useState<[number, number]>([0, 1]);
  const [challengeAnswers, setChallengeAnswers] = useState<[string, string]>(["", ""]);
  const [migration, setMigration] = useState<{ done: number; total: number } | null>(null);

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

  // A draft that never reached activation holds private keys in memory only —
  // leaving the screen must zero them.
  useEffect(() => () => { if (prepared) discardPreparedMobileWorkspace(prepared.draftId); }, [prepared]);
  /**
   * The stakes here are the highest of any surface: leaving destroys the
   * workspace draft AND zeroes its in-memory keys (the cleanup above). Until
   * now a tap on the navigation bar did that without a word.
   */
  useLeaveGuard(
    "workspace-wizard",
    prepared !== null,
    t("mobile.leaveWizard", { defaultValue: "Die Einrichtung wird abgebrochen und der vorbereitete Schlüssel verworfen." }),
  );

  const cancelSetup = () => {
    if (prepared) discardPreparedMobileWorkspace(prepared.draftId);
    setPrepared(null); setSetupStep(null); setRecoverySaved(false); setCodeCopied(false);
    setChallengeAnswers(["", ""]); setMigration(null);
  };

  const prepareSetup = async () => {
    setBusyAction("prepare");
    try {
      const result = await prepareMobileWorkspace({ vaultId: vault.vaultId, ownerDisplayName: ownerName, deviceDisplayName: deviceName });
      // Ask for two RANDOM groups of the code — proves the backup is readable
      // instead of just clicked away (same check as the desktop wizard).
      const groups = result.recoveryCode.split("-").slice(1);
      const random = crypto.getRandomValues(new Uint32Array(2));
      const first = random[0] % groups.length;
      let second = random[1] % groups.length;
      if (second === first) second = (second + 1) % groups.length;
      setChallenge([first, second]); setChallengeAnswers(["", ""]);
      setRecoverySaved(false); setCodeCopied(false);
      setPrepared(result); setSetupStep(2);
    } catch (error) {
      console.error("[SecurityAreaScreen] workspace preparation failed", error);
      toast.error(t("workspaceSecurity.setupFailed"));
    } finally { setBusyAction(null); }
  };

  const saveRecovery = async () => {
    if (!prepared) return;
    setBusyAction("saveRecovery");
    try {
      await saveRecoveryFile(prepared.recoveryPackage);
      setRecoverySaved(true);
      toast.success(t("workspaceSecurity.recoverySavedToast"));
    } catch (error) {
      console.error("[SecurityAreaScreen] recovery save failed", error);
      toast.error(t("workspaceSecurity.saveFailed"));
    } finally { setBusyAction(null); }
  };

  const copyRecoveryCode = async () => {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.recoveryCode);
      setCodeCopied(true);
      toast.success(t("workspaceSecurity.codeCopied"));
    } catch { toast.error(t("workspaceSecurity.recoveryCopyFailed")); }
  };

  const activateSetup = async () => {
    if (!prepared) return;
    if (!vault.db) { toast.error(t("workspaceSecurity.setupFailed")); return; }
    setBusyAction("activate"); setSetupStep(3); setMigration(null);
    try {
      // Park the plaintext worker first: from the moment genesis is published,
      // its own fail-closed guard would refuse the next cycle anyway, and a
      // half-finished plaintext push during the sweep only adds noise.
      await stopSyncAndDrain();
      const result = await activatePreparedMobileWorkspace({
        vaultId: vault.vaultId,
        draftId: prepared.draftId,
        store: await getMobileWorkspaceObjectStore(vault.vaultId),
        // The RAW/backup adapter: the sweep reads local files as they are — the
        // permissioned + workspace-queueing chain only exists after the reload.
        vault: vault.backup ?? vault.adapter,
        state: new SqlWorkspaceStateStore(vault.db),
        onProgress: (done, total) => setMigration({ done, total }),
      });
      toast.success(t("workspaceSecurity.migrationStarted", { n: result.queued, total: result.total }));
      setPrepared(null); setSetupStep(null);
      // Brings up the workspace state store, the permissioned adapter and the
      // encrypted sync worker; it also re-runs the (now skipping) sweep.
      await reloadActiveMobileVault();
      await refresh(); await probeConnection();
    } catch (error) {
      console.error("[SecurityAreaScreen] activation failed", error);
      toast.error(t("workspaceSecurity.activationFailed"));
      setSetupStep(2); setMigration(null);
    } finally { setBusyAction(null); }
  };

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
  /** Status row text for a device that has NOT joined a workspace. */
  const connectionLabel = () =>
    connection.kind === "checking" ? t("workspaceSecurity.stateChecking", { defaultValue: "Checking this connection …" })
      : connection.kind === "local" ? t("workspaceSecurity.stateLocalTitle", { defaultValue: "On this device only" })
        : connection.kind === "plain" ? t("workspaceSecurity.statePlainTitle", { defaultValue: "This connection is not encrypted" })
          : connection.kind === "unknown" ? t("workspaceSecurity.stateUnknownTitle", { defaultValue: "Encryption status unknown" })
            : t("workspaceSecurity.notConfigured");
  const ConnectionIcon = connection.kind === "local" ? Smartphone : connection.kind === "plain" ? ShieldOff : ShieldCheck;

  const recoveryGroups = prepared?.recoveryCode.split("-").slice(1) ?? [];
  const recoveryPrefix = prepared?.recoveryCode.split("-")[0] ?? "PVR1";
  const challengeConfirmed = recoveryGroups.length > 1 && challenge.every((groupIndex, answerIndex) =>
    challengeAnswers[answerIndex].trim().toUpperCase() === recoveryGroups[groupIndex]?.toUpperCase());
  const setupWizard = setupStep !== null && <div className="m-onramp">
    <div className="m-setupsteps" aria-label={t("workspaceSecurity.setupProgress", { step: setupStep })}>
      <span data-active={setupStep === 1}>{t("workspaceSecurity.stepIdentity")}</span>
      <span data-active={setupStep === 2}>{t("workspaceSecurity.stepRecovery")}</span>
      <span data-active={setupStep === 3}>{t("workspaceSecurity.stepActivate")}</span>
    </div>
    {setupStep === 1 && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={20} style={{ flexShrink: 0 }} />
        <div><p className="m-onramp-sub">{t("workspaceSecurity.setupIntro")}</p></div>
      </div>
      <label className="m-field"><span>{t("workspaceSecurity.ownerName")}</span><TextInput value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <button className="m-btn m-btn--filled m-onramp-action" disabled={busy || !ownerName.trim() || !deviceName.trim()} onClick={() => void prepareSetup()}>
        {busyAction === "prepare" ? <span className="m-actionspin" aria-hidden /> : null}{t("splash.continue")}
      </button>
    </>}
    {setupStep === 2 && prepared && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={20} style={{ flexShrink: 0 }} />
        <div><p className="title">{t("workspaceSecurity.recoverySetupTitle")}</p><p className="m-onramp-sub">{t("workspaceSecurity.recoverySetupIntro")}</p></div>
      </div>
      <div className="m-setuptask">
        <span className="m-step-num">{recoverySaved ? <Check size={16} /> : "1"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskFileTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryShareHint", { defaultValue: "Plainva saves it in your documents and opens the share sheet — put a copy somewhere you can reach without this phone." })}</small>
          <button className="m-btn m-onramp-action" disabled={busy} onClick={() => void saveRecovery()}>
            {busyAction === "saveRecovery" ? <span className="m-actionspin" aria-hidden /> : <Upload size={16} />}
            {recoverySaved ? t("workspaceSecurity.saved") : t("workspaceSecurity.saveRecovery")}
          </button>
        </div>
      </div>
      <div className="m-setuptask">
        <span className="m-step-num">{codeCopied ? <Check size={16} /> : "2"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskCodeTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryTaskCodeDesc")}</small>
          <div className="m-codegroups" role="list" aria-label={t("workspaceSecurity.recoveryCodeGroupsLabel")}>
            <code className="m-codegroup" role="listitem"><small>{t("workspaceSecurity.recoveryPrefix")}</small>{recoveryPrefix}</code>
            {recoveryGroups.map((group, groupIndex) => <code className="m-codegroup" data-requested={challenge.includes(groupIndex)} role="listitem" key={`${groupIndex}-${group}`}>
              <small>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}</small>{group}
            </code>)}
          </div>
          <button className="m-btn m-onramp-action" disabled={busy} onClick={() => void copyRecoveryCode()}>
            <Copy size={16} />{codeCopied ? t("workspaceSecurity.copied") : t("workspaceSecurity.copyCode")}
          </button>
        </div>
      </div>
      <div className="m-setuptask">
        <span className="m-step-num">{challengeConfirmed ? <Check size={16} /> : "3"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskCheckTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })}</small>
          {challenge.map((groupIndex, answerIndex) => {
            const answer = challengeAnswers[answerIndex];
            const matches = answer.trim().toUpperCase() === recoveryGroups[groupIndex]?.toUpperCase();
            const state = answer ? (matches ? "correct" : "mismatch") : "pending";
            return <label className="m-field" key={groupIndex}>
              <span>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}</span>
              <TextInput
                autoCapitalize="characters"
                autoComplete="off"
                aria-invalid={state === "mismatch"}
                maxLength={recoveryGroups[groupIndex]?.length}
                spellCheck={false}
                value={answer}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
                  setChallengeAnswers((current) => answerIndex === 0 ? [value, current[1]] : [current[0], value]);
                }}
              />
              <span className="m-fieldstatus" data-state={state} aria-live="polite">{state === "correct" ? t("workspaceSecurity.recoveryCorrect") : state === "mismatch" ? t("workspaceSecurity.recoveryMismatch") : t("workspaceSecurity.recoveryEnterHighlighted")}</span>
            </label>;
          })}
        </div>
      </div>
      <div className="m-setupnext" data-ready={recoverySaved && challengeConfirmed} role="status">
        {!recoverySaved ? t("workspaceSecurity.recoveryNextSave") : !challengeConfirmed ? t("workspaceSecurity.recoveryNextCheck") : t("workspaceSecurity.recoveryReady")}
      </div>
      <button className="m-btn m-btn--filled m-onramp-action" disabled={busy || !recoverySaved || !challengeConfirmed} onClick={() => void activateSetup()}>
        <ShieldCheck size={16} />{t("workspaceSecurity.activate")}
      </button>
      <p className="m-hint">{t("workspaceSecurity.fingerprintValue", { value: prepared.fingerprint })}</p>
    </>}
    {setupStep === 3 && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={20} style={{ flexShrink: 0 }} />
        <div><p className="m-onramp-sub">{t("workspaceSecurity.activating")}</p></div>
      </div>
      <div className="m-progress" role="progressbar" aria-valuemin={0} aria-valuemax={migration?.total} aria-valuenow={migration?.done}>
        <div className="m-progress-bar" data-indeterminate={!migration || migration.total === 0} style={migration && migration.total > 0 ? { width: `${(migration.done / migration.total) * 100}%` } : undefined} />
      </div>
      {migration && migration.total > 0 && <p className="m-hint">{t("workspaceSecurity.activatingProgress", { done: migration.done, total: migration.total })}</p>}
    </>}
    {setupStep !== 3 && <button className="m-btn m-onramp-action" disabled={busy} onClick={cancelSetup}>{t("common.cancel")}</button>}
  </div>;

  return <div className="m-page">
    <header className="m-header"><button aria-label={t("common.back", { defaultValue: "Back" })} className="m-iconbtn" onClick={onBack}><ChevronLeft size={20} /></button><h1>{t("settings.sectionSecurity")}</h1></header>
    {/* Honesty gate (H6): the "experimental, not independently reviewed" caveat
        used to live only in the desktop What's-New text and the handbook — not
        on the screen where a device actually joins a workspace. */}
    <p className="m-hint m-hint--warn">{t("workspaceSecurity.experimentalNotice")}</p>
    <p className="m-sectionlabel">{t("workspaceSecurity.currentStatus")}</p>
    {/* The state card below IS the status for a device that has not joined a
        plain/local vault — only the joined and joinable cases add this row. */}
    {(status || connection.kind === "encrypted") && <div className="m-row m-row--static">{status ? <ShieldCheck className="m-accent" size={18} /> : <ConnectionIcon size={18} />}<span>{status ? `${status.phase} · ${status.deviceName}` : t("workspaceSecurity.notConfigured")}</span></div>}
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
    </> : status?.phase === "locked" ? null : connection.kind === "encrypted" ? <>
      {/* On-ramp (F2, Punkt 12): make the "connect → join here" order obvious,
          and state that creating a new workspace is a desktop action (E4).
          Only reachable once the remote probe FOUND an encrypted workspace —
          otherwise the branch below explains the real state instead. */}
      <div className="m-onramp">
        <div className="m-onramp-status">
          <ShieldCheck size={20} style={{ flexShrink: 0 }} />
          <div><p>{t("workspaceSecurity.onRampTitle", { defaultValue: "This vault is end-to-end encrypted" })}</p><p className="m-onramp-sub">{t("workspaceSecurity.onRampBody", { defaultValue: "Your notes stay locked on this device until it joins the workspace." })}</p></div>
        </div>
        <ol className="m-onramp-steps">
          <li className="done"><span className="m-step-num"><Check size={14} /></span><div><p>{t("workspaceSecurity.onRampStep1", { defaultValue: "Cloud connected" })}</p></div></li>
          <li className="now"><span className="m-step-num">2</span><div><p>{t("workspaceSecurity.onRampStep2", { defaultValue: "Join this workspace" })}</p><p className="m-step-sub">{t("workspaceSecurity.onRampStep2Body", { defaultValue: "Pair with a device that is already in, or restore from your recovery file." })}</p></div></li>
        </ol>
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
    </> : setupWizard ? setupWizard : <>
      {/* No encrypted workspace on this vault: say what IS true and what is
          possible — never the on-ramp's "this vault is end-to-end encrypted"
          (maintainer 2026-07-25). Joining/recovery need a remote workspace, so
          both forms stay hidden here; the recheck picks up a workspace that
          was just created elsewhere. A plain cloud connection can be encrypted
          right here since 2026-07-25 (setup used to be desktop-only). */}
      <div className="m-onramp">
        <div className="m-onramp-status m-onramp-status--neutral">
          <ConnectionIcon size={20} style={{ flexShrink: 0 }} />
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
        {connection.kind === "plain" && <button className="m-btn m-btn--filled m-onramp-action" disabled={busy} onClick={() => setSetupStep(1)}><ShieldCheck size={16} /> {t("workspaceSecurity.setup")}</button>}
        {connection.kind === "local" && onConnectCloud && <button className="m-btn m-btn--filled m-onramp-action" onClick={onConnectCloud}><Cloud size={16} /> {t("mobile.vaultAdd")}</button>}
        {(connection.kind === "plain" || connection.kind === "unknown") && <button className="m-btn m-onramp-action" onClick={() => void probeConnection()}><RefreshCw size={16} /> {t("workspaceSecurity.recheck", { defaultValue: "Check again" })}</button>}
      </div>
    </>}
    {quarantine.length > 0 && <><p className="m-sectionlabel">{t("workspaceSecurity.quarantine", { defaultValue: "Quarantine" })}</p>{quarantine.map((entry) => <div className="m-row m-row--static" key={entry.quarantineId}><span className="m-linestack">{entry.artifactKind}<small>{entry.reason} · {entry.status}</small></span></div>)}</>}
    {scan === "invite" && <QrScanner onDecode={(value) => { setInviteCode(value); setScan(null); }} onClose={() => setScan(null)} />}
    {scan === "approve" && <QrScanner onDecode={(value) => void approveFromScan(value)} onClose={() => setScan(null)} />}
  </div>;
}
