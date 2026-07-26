import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { TextInput, toast } from "@plainva/ui";
import {
  KeyfileAlreadyExistsError,
  KeyfileProbeFailedError,
  activatePreparedMobileEncryption,
  discardPreparedMobileEncryption,
  prepareMobileEncryption,
} from "../services/mobileSettingsSync";
import { remoteSidebandFileExists } from "../services/syncService";
import type { MobileVault } from "../services/vaultService";
import { SheetGrip } from "./SheetGrip";

/**
 * Setting up the settings-sync encryption ON THE PHONE (H2e).
 *
 * The phone could only ever unlock what a desktop had created, although it has
 * been able to set up an encrypted workspace since 0.4.10 — the same shape is
 * used here, for the same reason: the recovery code is the one thing that
 * cannot be regenerated, so it is shown and VERIFIED before anything is
 * written. Two randomly chosen groups have to be typed back, which proves the
 * code was actually saved rather than clicked past.
 *
 * Nothing exists on disk until "Activate": the draft lives in memory and is
 * zeroed when this sheet closes.
 */
const MIN_PASSPHRASE = 8;

export function EncryptionSetupSheet({ vault, onClose, onDone }: { vault: MobileVault; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [challenge, setChallenge] = useState<[number, number]>([0, 1]);
  const [answers, setAnswers] = useState<[string, string]>(["", ""]);

  // A draft that never reached activation holds a master key in memory only —
  // leaving must zero it.
  useEffect(() => () => { if (draftId) discardPreparedMobileEncryption(draftId); }, [draftId]);

  const groups = code ? code.split("-") : [];
  const verified = groups.length > 1 && challenge.every((g, i) => answers[i].trim().toUpperCase() === groups[g]?.toUpperCase());

  const prepare = async () => {
    if (pass.length < MIN_PASSPHRASE) { toast.warning(t("encryption.tooShort", { min: MIN_PASSPHRASE })); return; }
    if (pass !== confirm) { toast.warning(t("encryption.mismatch")); return; }
    setBusy(true);
    try {
      const result = await prepareMobileEncryption(vault, pass, (path) => remoteSidebandFileExists(vault.vaultId, path));
      const parts = result.recoveryCode.split("-");
      const random = crypto.getRandomValues(new Uint32Array(2));
      const first = random[0] % parts.length;
      let second = random[1] % parts.length;
      if (second === first) second = (second + 1) % parts.length;
      setChallenge([first, second]);
      setAnswers(["", ""]);
      setCopied(false);
      setDraftId(result.draftId);
      setCode(result.recoveryCode);
      setStep(2);
    } catch (error) {
      if (error instanceof KeyfileAlreadyExistsError) toast.warning(t("encryption.mobileAlreadySetUp"));
      else if (error instanceof KeyfileProbeFailedError) toast.warning(t("encryption.mobileProbeFailed"));
      else toast.error(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!draftId) return;
    setBusy(true);
    setStep(3);
    try {
      await activatePreparedMobileEncryption(vault, draftId);
      setDraftId(null); // activated: the key belongs to the keyring now, not the draft
      toast.success(t("encryption.mobileCreated"));
      onDone();
    } catch (error) {
      console.error("[EncryptionSetupSheet] activation failed", error);
      toast.error(String(error instanceof Error ? error.message : error));
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" data-testid="encryption-setup-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("encryption.modalCreateTitle")}</p>
        <div className="m-setupsteps" aria-label={t("workspaceSecurity.setupProgress", { step })}>
          <span data-active={step === 1}>{t("encryption.passphrase")}</span>
          <span data-active={step === 2}>{t("encryption.recoveryTitle")}</span>
          <span data-active={step === 3}>{t("workspaceSecurity.stepActivate")}</span>
        </div>

        {step === 1 && (
          <>
            <p className="m-hint">{t("settingsSync.explainer")}</p>
            <label className="m-field">
              <span>{t("encryption.passphrase")}</span>
              <TextInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} data-testid="encryption-passphrase" />
            </label>
            <label className="m-field">
              <span>{t("encryption.passphraseConfirm")}</span>
              <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="encryption-passphrase-confirm" />
            </label>
            <button className="m-btn m-btn--filled" disabled={busy} onClick={() => void prepare()} data-testid="encryption-prepare">
              {t("splash.continue")}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <p className="m-hint">{t("encryption.recoveryBody")}</p>
            <div className="m-codegroups" role="list" aria-label={t("workspaceSecurity.recoveryCodeGroupsLabel")}>
              {groups.map((group, index) => (
                <code className="m-codegroup" data-requested={challenge.includes(index)} role="listitem" key={`${index}-${group}`}>
                  <small>{t("workspaceSecurity.recoveryGroup", { number: index + 1 })}</small>
                  {group}
                </code>
              ))}
            </div>
            <button
              className="m-btn m-btn--tonal"
              onClick={() => {
                void navigator.clipboard.writeText(code).then(
                  () => { setCopied(true); toast.success(t("workspaceSecurity.codeCopied")); },
                  () => toast.error(t("workspaceSecurity.recoveryCopyFailed")),
                );
              }}
            >
              {copied ? <Check size={16} /> : null} {t("contextMenu.copy")}
            </button>
            <p className="m-hint">{t("encryption.mobileVerifyHint")}</p>
            {challenge.map((groupIndex, answerIndex) => (
              <label className="m-field" key={groupIndex}>
                <span>{t("workspaceSecurity.recoveryGroup", { number: groupIndex + 1 })}</span>
                <TextInput
                  value={answers[answerIndex]}
                  maxLength={groups[groupIndex]?.length}
                  data-testid={`encryption-verify-${answerIndex}`}
                  onChange={(e) => setAnswers((prev) => (answerIndex === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
                />
              </label>
            ))}
            <button className="m-btn m-btn--filled" disabled={busy || !verified} onClick={() => void activate()} data-testid="encryption-activate">
              {t("encryption.create")}
            </button>
          </>
        )}

        {step === 3 && <p className="m-hint">{t("workspaceSecurity.stepActivate")}…</p>}
      </div>
    </div>
  );
}
