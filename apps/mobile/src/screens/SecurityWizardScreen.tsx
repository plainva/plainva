import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, ShieldCheck, Upload } from "lucide-react";
import { Button, ICON, TextInput, toast } from "@plainva/ui";
import { SqlWorkspaceStateStore } from "@plainva/core";
import { AppBar } from "../components/AppBar";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { saveRecoveryFile } from "../services/recoveryFile";
import { getMobileWorkspaceObjectStore, remoteSidebandFileExists, stopSyncAndDrain } from "../services/syncService";
import {
  activatePreparedMobileWorkspace,
  discardPreparedMobileWorkspace,
  prepareMobileWorkspace,
  type PreparedMobileWorkspace,
} from "../services/mobileWorkspaceSecurity";
import {
  KeyfileAlreadyExistsError,
  KeyfileProbeFailedError,
  activatePreparedMobileEncryption,
  discardPreparedMobileEncryption,
  prepareMobileEncryption,
} from "../services/mobileSettingsSync";
import { reloadActiveMobileVault, type MobileVault } from "../services/vaultService";

/**
 * The two security wizards, as one flow and one destination (S37).
 *
 * Both create key material that exists only in memory until the last step, and
 * both destroy it the moment they are left. They used to answer that
 * differently: the workspace setup lived inside the security area and asked
 * before leaving; the settings-sync key lived in a BOTTOM SHEET and asked
 * nothing at all — a tap on the navigation bar zeroed a prepared key without a
 * word. A sheet is for one decision (§ 2.2 of the plan); a three-step flow with
 * a recovery code is not one decision.
 *
 * So: an own destination with the bar hidden (`securitywizard` is an input
 * kind), the leave guard armed for as long as a draft exists, and Back as the
 * one way out — which asks.
 *
 * The two flows differ in exactly one honest way. Activating a workspace
 * re-encrypts every file and reports counts, so its progress bar is real.
 * Activating the settings key is two writes with nothing to count, so its bar
 * is indeterminate. A percentage invented for the second would be a lie told by
 * a progress bar.
 */

export type SecurityWizardFlow = "workspace" | "encryption";

const MIN_PASSPHRASE = 8;

/** Two random groups of the recovery code, never the same one twice. */
function pickChallenge(groupCount: number): [number, number] {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const first = random[0] % groupCount;
  let second = random[1] % groupCount;
  if (second === first) second = (second + 1) % groupCount;
  return [first, second];
}

export function SecurityWizardScreen({ flow, vault, onBack, onDone }: {
  flow: SecurityWizardFlow;
  vault: MobileVault;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;

  // Step 1 — identity (workspace) or passphrase (settings key).
  const [ownerName, setOwnerName] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Mobile");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");

  // Step 2 — the recovery code, in both flows.
  const [workspaceDraft, setWorkspaceDraft] = useState<PreparedMobileWorkspace | null>(null);
  const [encryptionDraft, setEncryptionDraft] = useState<{ draftId: string; recoveryCode: string } | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [challenge, setChallenge] = useState<[number, number]>([0, 1]);
  const [answers, setAnswers] = useState<[string, string]>(["", ""]);

  // Step 3 — the sweep, where there is one to measure.
  const [migration, setMigration] = useState<{ done: number; total: number } | null>(null);

  const draftId = workspaceDraft?.draftId ?? encryptionDraft?.draftId ?? null;
  const recoveryCode = workspaceDraft?.recoveryCode ?? encryptionDraft?.recoveryCode ?? "";
  // The workspace code carries a `PVR1` prefix group that is shown but never
  // asked for; the settings code does not.
  const groups = recoveryCode ? (flow === "workspace" ? recoveryCode.split("-").slice(1) : recoveryCode.split("-")) : [];
  const prefix = flow === "workspace" ? recoveryCode.split("-")[0] : null;

  const verified = groups.length > 1 && challenge.every(
    (group, index) => answers[index].trim().toUpperCase() === groups[group]?.toUpperCase(),
  );
  // The workspace flow additionally requires the recovery FILE to be saved —
  // it is the one artefact that cannot be regenerated later.
  const readyToActivate = verified && (flow === "encryption" || recoverySaved);

  /* A draft that never reached activation holds private keys in memory only —
     leaving must zero them. */
  useEffect(() => () => {
    if (workspaceDraft) discardPreparedMobileWorkspace(workspaceDraft.draftId);
    if (encryptionDraft) discardPreparedMobileEncryption(encryptionDraft.draftId);
  }, [workspaceDraft, encryptionDraft]);

  useLeaveGuard("security-wizard", draftId !== null, t("mobile.leaveWizard"));

  const prepare = async () => {
    setBusyAction("prepare");
    try {
      if (flow === "workspace") {
        const result = await prepareMobileWorkspace({
          vaultId: vault.vaultId,
          ownerDisplayName: ownerName,
          deviceDisplayName: deviceName,
        });
        setChallenge(pickChallenge(result.recoveryCode.split("-").slice(1).length));
        setWorkspaceDraft(result);
      } else {
        if (pass.length < MIN_PASSPHRASE) { toast.warning(t("encryption.tooShort", { min: MIN_PASSPHRASE })); return; }
        if (pass !== confirm) { toast.warning(t("encryption.mismatch")); return; }
        const result = await prepareMobileEncryption(vault, pass, (path) => remoteSidebandFileExists(vault.vaultId, path));
        setChallenge(pickChallenge(result.recoveryCode.split("-").length));
        setEncryptionDraft({ draftId: result.draftId, recoveryCode: result.recoveryCode });
      }
      setAnswers(["", ""]);
      setRecoverySaved(false);
      setCodeCopied(false);
      setStep(2);
    } catch (error) {
      if (error instanceof KeyfileAlreadyExistsError) toast.warning(t("encryption.mobileAlreadySetUp"));
      else if (error instanceof KeyfileProbeFailedError) toast.warning(t("encryption.mobileProbeFailed"));
      else {
        console.error("[SecurityWizardScreen] preparation failed", error);
        toast.error(t("workspaceSecurity.setupFailed"));
      }
    } finally { setBusyAction(null); }
  };

  const saveRecovery = async () => {
    if (!workspaceDraft) return;
    setBusyAction("saveRecovery");
    try {
      await saveRecoveryFile(workspaceDraft.recoveryPackage);
      setRecoverySaved(true);
      toast.success(t("workspaceSecurity.recoverySavedToast"));
    } catch (error) {
      console.error("[SecurityWizardScreen] recovery save failed", error);
      toast.error(t("workspaceSecurity.saveFailed"));
    } finally { setBusyAction(null); }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCodeCopied(true);
      toast.success(t("workspaceSecurity.codeCopied"));
    } catch { toast.error(t("workspaceSecurity.recoveryCopyFailed")); }
  };

  const activate = async () => {
    setBusyAction("activate");
    setStep(3);
    setMigration(null);
    try {
      if (flow === "workspace") {
        if (!workspaceDraft || !vault.db) { toast.error(t("workspaceSecurity.setupFailed")); setStep(2); return; }
        // Park the plaintext worker first: from the moment genesis is
        // published its own fail-closed guard would refuse the next cycle
        // anyway, and a half-finished plaintext push only adds noise.
        await stopSyncAndDrain();
        const result = await activatePreparedMobileWorkspace({
          vaultId: vault.vaultId,
          draftId: workspaceDraft.draftId,
          store: await getMobileWorkspaceObjectStore(vault.vaultId),
          // The RAW/backup adapter: the sweep reads local files as they are —
          // the permissioned + workspace-queueing chain exists after reload.
          vault: vault.backup ?? vault.adapter,
          state: new SqlWorkspaceStateStore(vault.db),
          onProgress: (done, total) => setMigration({ done, total }),
        });
        toast.success(t("workspaceSecurity.migrationStarted", { n: result.queued, total: result.total }));
        setWorkspaceDraft(null); // activated: the keys belong to the keystore now
        await reloadActiveMobileVault();
      } else {
        if (!encryptionDraft) { setStep(2); return; }
        await activatePreparedMobileEncryption(vault, encryptionDraft.draftId);
        setEncryptionDraft(null); // activated: the bundle belongs to the keyring
        toast.success(t("encryption.mobileCreated"));
      }
      onDone();
    } catch (error) {
      console.error("[SecurityWizardScreen] activation failed", error);
      toast.error(t(flow === "workspace" ? "workspaceSecurity.activationFailed" : "workspaceSecurity.setupFailed"));
      setStep(2);
      setMigration(null);
    } finally { setBusyAction(null); }
  };

  const title = flow === "workspace" ? t("workspaceSecurity.setupTitle") : t("encryption.modalCreateTitle");
  const stepOneLabel = flow === "workspace" ? t("workspaceSecurity.stepIdentity") : t("encryption.passphrase");

  return <div className="m-page m-page--wizard">
    <AppBar onBack={onBack} title={title} />
    <div className="m-setupsteps" aria-label={t("workspaceSecurity.setupProgress", { step })}>
      <span data-active={step === 1}>{stepOneLabel}</span>
      <span data-active={step === 2}>{t("workspaceSecurity.stepRecovery")}</span>
      <span data-active={step === 3}>{t("workspaceSecurity.stepActivate")}</span>
    </div>

    {step === 1 && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={ICON.head} style={{ flexShrink: 0 }} />
        <div><p className="m-onramp-sub">{flow === "workspace" ? t("workspaceSecurity.setupIntro") : t("settingsSync.explainer")}</p></div>
      </div>
      {flow === "workspace" ? <>
        <label className="m-field"><span>{t("workspaceSecurity.ownerName")}</span>
          <TextInput value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
        <label className="m-field"><span>{t("workspaceSecurity.deviceName")}</span>
          <TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      </> : <>
        <label className="m-field"><span>{t("encryption.passphrase")}</span>
          <TextInput type="password" value={pass} data-testid="encryption-passphrase" onChange={(event) => setPass(event.target.value)} /></label>
        <label className="m-field"><span>{t("encryption.passphraseConfirm")}</span>
          <TextInput type="password" value={confirm} data-testid="encryption-passphrase-confirm" onChange={(event) => setConfirm(event.target.value)} /></label>
      </>}
      <Button
        variant="primary"
        className="m-onramp-action"
        data-testid="wizard-prepare"
        disabled={busy || (flow === "workspace" && (!ownerName.trim() || !deviceName.trim()))}
        onClick={() => void prepare()}
      >
        {busyAction === "prepare" ? <span className="m-actionspin" aria-hidden /> : null}{t("splash.continue")}
      </Button>
    </>}

    {step === 2 && draftId && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={ICON.head} style={{ flexShrink: 0 }} />
        <div>
          <p className="title">{t("workspaceSecurity.recoverySetupTitle")}</p>
          <p className="m-onramp-sub">{flow === "workspace" ? t("workspaceSecurity.recoverySetupIntro") : t("encryption.recoveryBody")}</p>
        </div>
      </div>

      {/* The recovery FILE exists only for the workspace: the settings key's
          sole artefact is the code itself. */}
      {flow === "workspace" && <div className="m-setuptask">
        <span className="m-step-num">{recoverySaved ? <Check size={ICON.ui} /> : "1"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskFileTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryShareHint")}</small>
          <Button variant="ghost" className="m-onramp-action" disabled={busy} onClick={() => void saveRecovery()}>
            {busyAction === "saveRecovery" ? <span className="m-actionspin" aria-hidden /> : <Upload size={ICON.ui} />}
            {recoverySaved ? t("workspaceSecurity.saved") : t("workspaceSecurity.saveRecovery")}
          </Button>
        </div>
      </div>}

      <div className="m-setuptask">
        <span className="m-step-num">{codeCopied ? <Check size={ICON.ui} /> : flow === "workspace" ? "2" : "1"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskCodeTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryTaskCodeDesc")}</small>
          <div className="m-codegroups" role="list" aria-label={t("workspaceSecurity.recoveryCodeGroupsLabel")}>
            {prefix && <code className="m-codegroup" role="listitem"><small>{t("workspaceSecurity.recoveryPrefix")}</small>{prefix}</code>}
            {groups.map((group, index) => <code className="m-codegroup" data-requested={challenge.includes(index)} role="listitem" key={`${index}-${group}`}>
              <small>{t("workspaceSecurity.recoveryGroup", { number: index + 1 })}</small>{group}
            </code>)}
          </div>
          <Button variant="ghost" className="m-onramp-action" disabled={busy} onClick={() => void copyCode()}>
            <Copy size={ICON.ui} />{codeCopied ? t("workspaceSecurity.copied") : t("workspaceSecurity.copyCode")}
          </Button>
        </div>
      </div>

      <div className="m-setuptask">
        <span className="m-step-num">{verified ? <Check size={ICON.ui} /> : flow === "workspace" ? "3" : "2"}</span>
        <div className="m-setuptask-body">
          <strong>{t("workspaceSecurity.recoveryTaskCheckTitle")}</strong>
          <small>{t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })}</small>
          {challenge.map((groupIndex, answerIndex) => {
            const answer = answers[answerIndex];
            const matches = answer.trim().toUpperCase() === groups[groupIndex]?.toUpperCase();
            const state = answer ? (matches ? "correct" : "mismatch") : "pending";
            return <label className="m-field" key={groupIndex}>
              <span>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}</span>
              <TextInput
                autoCapitalize="characters"
                autoComplete="off"
                aria-invalid={state === "mismatch"}
                data-testid={`wizard-verify-${answerIndex}`}
                maxLength={groups[groupIndex]?.length}
                spellCheck={false}
                value={answer}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
                  setAnswers((current) => answerIndex === 0 ? [value, current[1]] : [current[0], value]);
                }}
              />
              <span className="m-fieldstatus" data-state={state} aria-live="polite">
                {state === "correct" ? t("workspaceSecurity.recoveryCorrect")
                  : state === "mismatch" ? t("workspaceSecurity.recoveryMismatch")
                    : t("workspaceSecurity.recoveryEnterHighlighted")}
              </span>
            </label>;
          })}
        </div>
      </div>

      <div className="m-setupnext" data-ready={readyToActivate} role="status">
        {flow === "workspace" && !recoverySaved ? t("workspaceSecurity.recoveryNextSave")
          : !verified ? t("workspaceSecurity.recoveryNextCheck")
            : t("workspaceSecurity.recoveryReady")}
      </div>
      <Button
        variant="primary"
        className="m-onramp-action"
        data-testid="wizard-activate"
        disabled={busy || !readyToActivate}
        onClick={() => void activate()}
      >
        <ShieldCheck size={ICON.ui} />{flow === "workspace" ? t("workspaceSecurity.activate") : t("encryption.create")}
      </Button>
      {workspaceDraft && <p className="m-hint">{t("workspaceSecurity.fingerprintValue", { value: workspaceDraft.fingerprint })}</p>}
    </>}

    {step === 3 && <>
      <div className="m-onramp-status m-onramp-status--neutral">
        <ShieldCheck size={ICON.head} style={{ flexShrink: 0 }} />
        <div><p className="m-onramp-sub">{t("workspaceSecurity.activating")}</p></div>
      </div>
      {/* Determinate only where something is actually counted: the workspace
          sweep re-encrypts every file, the settings key is two writes. */}
      <div className="m-progress" role="progressbar" aria-valuemin={0} aria-valuemax={migration?.total} aria-valuenow={migration?.done}>
        <div
          className="m-progress-bar"
          data-indeterminate={!migration || migration.total === 0}
          style={migration && migration.total > 0 ? { width: `${(migration.done / migration.total) * 100}%` } : undefined}
        />
      </div>
      {migration && migration.total > 0 && <p className="m-hint">{t("workspaceSecurity.activatingProgress", { done: migration.done, total: migration.total })}</p>}
    </>}

    {/* No cancel button on the activation step: there is nothing left to cancel
        once the key material has been written. Everywhere else Back is the way
        out, and the leave guard asks. */}
    {step !== 3 && <Button variant="ghost" className="m-onramp-action" disabled={busy} onClick={onBack}>
      {t("common.cancel")}
    </Button>}
  </div>;
}
