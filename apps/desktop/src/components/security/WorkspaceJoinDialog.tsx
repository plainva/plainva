import React, { useEffect, useRef, useState } from "react";
import { Banner, Button, Modal, TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { credentialManager } from "../../services/CredentialManager";
import { decodeWorkspaceInvite } from "../../services/workspaceSecurity/workspacePairing";

/**
 * Desktop device-join flow (package C1): paste the invitation code the owner
 * gave you, publish a pairing request, then poll until an existing device
 * approves it. The three-step model (invite → pair → active) is stated in the
 * UI so "how do I log in?" is answerable without reading the docs.
 */
export const WorkspaceJoinDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { beginWorkspaceJoin, pollWorkspaceJoin, getPendingWorkspaceJoin, cancelPendingWorkspaceJoin } = useVault();
  const [invite, setInvite] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Desktop");
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const [fallbackPassphrase, setFallbackPassphrase] = useState("");
  const [pending, setPending] = useState<{ shortCode: string; fingerprint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void credentialManager.checkKeychainStatus().then((mode) => setFallbackRequired(mode === "fallback"));
    void getPendingWorkspaceJoin().then((existing) => { if (existing) setPending(existing); });
  }, [getPendingWorkspaceJoin]);

  const poll = React.useCallback(async () => {
    try {
      const joined = await pollWorkspaceJoin(fallbackPassphrase || undefined);
      if (joined) { toast.info(t("workspaceSecurity.joinDone", { defaultValue: "Joined. Opening the vault…" })); onClose(); }
    } catch (cause) {
      console.error("[WorkspaceJoinDialog] poll failed", cause);
    }
  }, [pollWorkspaceJoin, fallbackPassphrase, t, onClose]);

  // Auto-poll every few seconds while waiting for approval.
  useEffect(() => {
    if (!pending) return;
    pollTimer.current = setInterval(() => void poll(), 5000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [pending, poll]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const parsed = decodeWorkspaceInvite(invite);
      const result = await beginWorkspaceJoin(parsed, deviceName.trim() || "Desktop");
      setPending(result);
    } catch (cause) {
      console.error("[WorkspaceJoinDialog] begin failed", cause);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message === "join-invite-mismatch"
        ? t("workspaceSecurity.joinMismatch", { defaultValue: "This invitation is for a different workspace than the one on this remote." })
        : t("workspaceSecurity.joinFailed", { defaultValue: "Join failed. Check the invitation code." }));
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (pending) { await cancelPendingWorkspaceJoin().catch(() => undefined); }
    onClose();
  };

  return (
    <Modal title={t("workspaceSecurity.joinTitle", { defaultValue: "Join this encrypted workspace" })} onClose={() => { if (!busy) void cancel(); }} size="md">
      <div className="pv-security-wizard">
        <ol className="pv-security-model" aria-label={t("workspaceSecurity.joinModelLabel", { defaultValue: "How joining works" })}>
          <li>{t("workspaceSecurity.model1", { defaultValue: "The owner invites you — this reserves your place." })}</li>
          <li>{t("workspaceSecurity.model2", { defaultValue: "You send a join request; an existing device approves it — this hands over the key." })}</li>
          <li>{t("workspaceSecurity.model3", { defaultValue: "Your device becomes active and the vault decrypts." })}</li>
        </ol>
        {!pending ? (
          <>
            <label className="pv-security-field"><span>{t("workspaceSecurity.joinInviteLabel", { defaultValue: "Invitation code" })}</span><TextInput autoFocus value={invite} onChange={(event) => setInvite(event.target.value)} /></label>
            <label className="pv-security-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
            {fallbackRequired && <label className="pv-security-field"><span>{t("workspaceSecurity.fallbackPassphrase")}</span><TextInput type="password" value={fallbackPassphrase} onChange={(event) => setFallbackPassphrase(event.target.value)} /></label>}
            <Banner kind="info" rounded>{t("workspaceSecurity.joinInviteHint", { defaultValue: "Paste the invitation code the workspace owner gave you." })}</Banner>
          </>
        ) : (
          <>
            <Banner kind="info" rounded>{t("workspaceSecurity.joinWaiting", { defaultValue: "Waiting for an existing device to approve this join. Keep Plainva open." })}</Banner>
            <div className="pv-security-field"><span>{t("workspaceSecurity.joinShortCodeHint", { defaultValue: "Give this code to the approving device" })}</span><code className="pv-security-code">{pending.shortCode}</code></div>
            <div className="pv-security-field"><span>{t("workspaceSecurity.fingerprint", { defaultValue: "Fingerprint" })}</span><code className="pv-security-code">{pending.fingerprint}</code></div>
          </>
        )}
        {error && <Banner kind="error" rounded>{error}</Banner>}
        <div className="pv-security-actions">
          <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>{t("common.cancel")}</Button>
          {!pending
            ? <Button variant="primary" disabled={busy || !invite.trim() || (fallbackRequired && fallbackPassphrase.length < 10)} onClick={() => void start()}>{t("workspaceSecurity.joinCta", { defaultValue: "Request to join" })}</Button>
            : <Button variant="primary" disabled={busy} onClick={() => void poll()}>{t("workspaceSecurity.joinPoll", { defaultValue: "Check for approval" })}</Button>}
        </div>
      </div>
    </Modal>
  );
};
