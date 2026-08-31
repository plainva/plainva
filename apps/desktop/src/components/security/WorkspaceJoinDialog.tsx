import React, { useEffect, useRef, useState } from "react";
import { Banner, Button, ICON, Modal, QrScanner, TextInput, toast } from "@plainva/ui";
import { QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVault } from "../../contexts/VaultContext";
import { credentialManager } from "../../services/CredentialManager";
import { decodeWorkspaceInvite, type PendingJoin } from "../../services/workspaceSecurity/workspacePairing";

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
  /*
   * Scanning the code off the phone that shows it (parity gap qr-pairing-scan).
   * Joining from a desktop next to a phone meant retyping a long token; the
   * decoder and the scanner are shared, so this is a webcam surface and a
   * button. Pasting stays the fallback and the only path on a machine
   * without a camera — the scanner says so itself when the stream fails.
   */
  const [scanning, setScanning] = useState(false);
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Desktop");
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const [fallbackPassphrase, setFallbackPassphrase] = useState("");
  const [pending, setPending] = useState<PendingJoin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void credentialManager.checkKeychainStatus().then((mode) => setFallbackRequired(mode === "fallback"));
    void getPendingWorkspaceJoin().then((existing) => { if (existing) setPending(existing); });
  }, [getPendingWorkspaceJoin]);

  /*
   * Asking whether the join was approved can fail - no network, a remote that
   * rejects, a wrong fallback passphrase - and every failure used to end in the
   * console. On screen nothing moved, so a broken connection looked exactly
   * like "nobody has approved yet". The reason is now shown, and a later
   * successful check clears it again: the auto-poll runs every few seconds, so
   * a stale error would otherwise outlive the problem it describes.
   */
  const poll = React.useCallback(async () => {
    try {
      const joined = await pollWorkspaceJoin(fallbackPassphrase || undefined);
      if (joined) { toast.info(t("workspaceSecurity.joinDone", { defaultValue: "Joined. Opening the vault…" })); onClose(); return; }
      setError(null);
    } catch (cause) {
      console.error("[WorkspaceJoinDialog] poll failed", cause);
      setError(t("workspaceSecurity.joinPollFailed", { reason: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [pollWorkspaceJoin, fallbackPassphrase, t, onClose]);

  /*
   * A pairing request dies at a fixed time. A screen that still says "waiting"
   * afterwards states something untrue, and the person has no way to see it -
   * the approving side has shown that deadline all along. It is scheduled, not
   * polled: one timeout that fires exactly when the request becomes worthless.
   */
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const deadline = pending?.expiresAt ? Date.parse(pending.expiresAt) : Number.NaN;
    if (!Number.isFinite(deadline)) { setExpired(false); return; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [pending]);

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
            <Button variant="ghost" onClick={() => setScanning(true)}>
              <QrCode size={ICON.ui} /> {t("workspaceSecurity.scanInvite")}
            </Button>
            <label className="pv-security-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
            {fallbackRequired && <label className="pv-security-field"><span>{t("workspaceSecurity.fallbackPassphrase")}</span><TextInput type="password" value={fallbackPassphrase} onChange={(event) => setFallbackPassphrase(event.target.value)} /></label>}
            {/* One door, two reasons to walk through it (Stufe B, S7).

                A publication is a workspace of its own, so a recipient joins it
                with exactly this code and this dialog - the core writes no
                special "publication format". Both shells carry the same
                sentence from the same key on purpose: two copies is how the
                desktop and the phone come to describe the same door
                differently. */}
            <Banner kind="info" rounded>{t("workspaceSecurity.joinInviteHint", { defaultValue: "Paste the invitation code the workspace owner gave you." })} {t("workspaceSecurity.joinPublicationHint", { defaultValue: "A code for a shared publication works here too: connect this vault to the folder you were given, then paste the code. You only see what was published - not the rest of that vault." })}</Banner>
          </>
        ) : (
          <>
            <Banner kind="info" rounded>{t("workspaceSecurity.joinWaiting", { defaultValue: "Waiting for an existing device to approve this join. Keep Plainva open." })}</Banner>
            <div className="pv-security-field"><span>{t("workspaceSecurity.joinShortCodeHint", { defaultValue: "Give this code to the approving device" })}</span><code className="pv-security-code">{pending.shortCode}</code></div>
            {pending.expiresAt && (
              <div className="pv-security-field"><span>{t("workspaceSecurity.joinExpires")}</span><span>{new Date(pending.expiresAt).toLocaleString()}</span></div>
            )}
            {expired && <Banner kind="warning" rounded>{t("workspaceSecurity.joinExpired")}</Banner>}
            <div className="pv-security-field"><span>{t("workspaceSecurity.fingerprint", { defaultValue: "Fingerprint" })}</span><code className="pv-security-code">{pending.fingerprint}</code></div>
            {/* Both sides of a pairing carry the same instruction - that is what
                makes comparing the fingerprint worth anything. The approving
                side says "approve only if it matches"; from here the same check
                reads the other way round. */}
            <Banner kind="warning" rounded>{t("workspaceSecurity.joinCompareFingerprint")}</Banner>
          </>
        )}
        {scanning && (
          <QrScanner
            classes={{ root: "pv-qr-scanner", video: "pv-qr-video", frame: "pv-qr-frame", fallback: "pv-qr-fallback", bar: "pv-qr-bar" }}
            onClose={() => setScanning(false)}
            onDecode={(value) => { setInvite(value); setScanning(false); }}
          />
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
