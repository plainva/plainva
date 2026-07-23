import React, { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Banner, Button, Modal, SettingCardNote, TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { credentialManager } from "../../services/CredentialManager";
import { discardPreparedPersonalWorkspace, type PreparedPersonalWorkspace } from "../../services/workspaceSecurity/workspaceLifecycle";

interface WorkspaceSetupWizardProps {
  vaultPath: string;
  onClose: () => void;
  prepare: ReturnType<typeof useVault>["preparePersonalWorkspace"];
  activate: ReturnType<typeof useVault>["activatePersonalWorkspace"];
}

/** Three-step first-run setup for a personal encrypted workspace. Split out of
 * SecuritySharingPage (package B3); behaviour unchanged. */
export const WorkspaceSetupWizard: React.FC<WorkspaceSetupWizardProps> = ({ vaultPath, onClose, prepare, activate }) => {
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
              className="pv-security-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress?.total}
              aria-valuenow={progress?.done}
            >
              {progress && progress.total > 0 ? (
                <div className="pv-security-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              ) : (
                <div className="indeterminate-progress pv-security-progress-bar" />
              )}
            </div>
            {progress && progress.total > 0 && (
              <div className="pv-security-progress-label">{t("workspaceSecurity.activatingProgress", { done: progress.done, total: progress.total })}</div>
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
