import React, { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
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

function phaseLabel(t: ReturnType<typeof useTranslation>["t"], phase: string): string {
  return t(`workspaceSecurity.phase.${phase}`, { defaultValue: phase });
}

/** Desktop P3 control surface for personal encrypted workspaces. */
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
  } = useVault();
  const status = isActiveVault ? workspaceSecurityStatus : null;
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  const refreshDiagnostics = useCallback(async () => {
    if (!isActiveVault || !hasSyncConnection) return setDiagnostics(null);
    try { setDiagnostics(await getWorkspaceDiagnostics()); }
    catch (error) { console.warn("[SecuritySharingPage] diagnostics failed", error); }
  }, [getWorkspaceDiagnostics, hasSyncConnection, isActiveVault]);

  useEffect(() => { void refreshDiagnostics(); }, [refreshDiagnostics, status?.phase]);

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
        <SettingCardNote>{t("workspaceSecurity.recoverySeparation")}</SettingCardNote>
      </SettingCard>

      <SettingCard label={t("workspaceSecurity.devicesCard")}>
        <SettingRow label={t("workspaceSecurity.currentDevice")} desc={t("workspaceSecurity.devicesP4")}>
          <span>{status?.deviceName ?? "—"}</span>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("workspaceSecurity.teamsCard")}>
        <SettingRow label={t("workspaceSecurity.teamsComing")} desc={t("workspaceSecurity.teamsP4")}>
          <Button variant="secondary" disabled>{t("workspaceSecurity.manageTeams")}</Button>
        </SettingRow>
      </SettingCard>

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
    </div>
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
