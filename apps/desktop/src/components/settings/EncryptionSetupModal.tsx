import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button } from "@plainva/ui";
import {
  createEncryptionSession,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  type RawFileAccess,
} from "../../services/encryptionSession";

/**
 * Sync passphrase setup / unlock (settings-sync plan §3.4, P3). Creates the
 * vault's keyfile for a new passphrase (showing a one-time recovery code),
 * unlocks the master key with the passphrase, or recovers with the code. The
 * unlocked master key is cached per device (see encryptionSession); the local
 * plaintext vault is never affected. No passphrase/code is logged.
 */
export interface EncryptionSetupModalProps {
  vaultPath: string;
  raw: RawFileAccess;
  /** "create" = no keyfile yet on any device; "unlock" = a keyfile exists. */
  mode: "create" | "unlock";
  onDone: () => void;
  onCancel: () => void;
}

const MIN_PASSPHRASE = 8;

export const EncryptionSetupModal: React.FC<EncryptionSetupModalProps> = ({ vaultPath, raw, mode, onDone, onCancel }) => {
  const { t } = useTranslation();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const fireChanged = () => window.dispatchEvent(new CustomEvent("plainva-encryption-changed"));

  const doCreate = async () => {
    if (pass.length < MIN_PASSPHRASE) return setError(t("encryption.tooShort", { min: MIN_PASSPHRASE }));
    if (pass !== confirm) return setError(t("encryption.mismatch"));
    setBusy(true);
    setError(null);
    try {
      const { recoveryCode: code } = await createEncryptionSession(vaultPath, raw, pass);
      setRecoveryCode(code);
      fireChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      if (useRecovery) await unlockWithRecoveryCode(vaultPath, raw, recovery);
      else await unlockWithPassphrase(vaultPath, raw, pass);
      fireChanged();
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/WrongPassphrase|wrong/i.test(msg) ? t("encryption.wrongPassphrase") : msg);
    } finally {
      setBusy(false);
    }
  };

  // After a successful create, show the one-time recovery code.
  if (recoveryCode) {
    return (
      <Modal title={t("encryption.recoveryTitle")} onClose={onDone} size="sm">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ color: "var(--text-muted)" }}>{t("encryption.recoveryBody")}</div>
          <code
            style={{
              display: "block",
              padding: "var(--space-3)",
              background: "var(--surface-container-low)",
              border: "1px solid var(--border-color-light)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-mono, monospace)",
              wordBreak: "break-all",
              userSelect: "all",
            }}
            data-testid="encryption-recovery-code"
          >
            {recoveryCode}
          </code>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(recoveryCode)}>
              {t("contextMenu.copy")}
            </Button>
            <Button variant="primary" onClick={onDone}>
              {t("encryption.done")}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const isCreate = mode === "create";
  return (
    <Modal title={isCreate ? t("encryption.modalCreateTitle") : t("encryption.modalUnlockTitle")} onClose={onCancel} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {!useRecovery && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("encryption.passphrase")}</span>
            <input
              type="password"
              className="pv-field"
              value={pass}
              autoFocus
              onChange={(e) => setPass(e.target.value)}
              data-testid="encryption-passphrase"
            />
          </label>
        )}
        {isCreate && !useRecovery && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("encryption.passphraseConfirm")}</span>
            <input type="password" className="pv-field" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="encryption-passphrase-confirm" />
          </label>
        )}
        {!isCreate && useRecovery && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("encryption.recoveryCode")}</span>
            <input className="pv-field" value={recovery} autoFocus onChange={(e) => setRecovery(e.target.value)} data-testid="encryption-recovery-input" />
          </label>
        )}
        {error && <div style={{ color: "var(--error-text)", fontSize: "var(--text-sm)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
          {!isCreate ? (
            <Button variant="ghost" size="sm" onClick={() => { setUseRecovery((v) => !v); setError(null); }}>
              {useRecovery ? t("encryption.usePassphraseInstead", { defaultValue: "Passphrase verwenden" }) : t("encryption.useRecovery")}
            </Button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t("common.cancel", { defaultValue: "Abbrechen" })}
            </Button>
            <Button variant="primary" onClick={() => void (isCreate ? doCreate() : doUnlock())} disabled={busy} data-testid="encryption-submit">
              {isCreate ? t("encryption.create") : t("encryption.unlock")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
