import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { beginPasswordChange, resumePasswordChange, readPasswordChangeStatus, PasswordChangeError, type PasswordChangePorts, type PasswordChangeStatus } from "../../lib/accountPasswordChange";
import { serviceLabel } from "../../lib/cloudAccountsLabels";
import type { CloudServiceId } from "../../lib/cloudAccounts";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Field";
import { SettingCard, SettingRow } from "../ui/SettingsSurface";

/** The same durable completion surface in both shells. Ports carry the
 * captured vault and account; UI state contains only non-secret progress. */
export function AccountPasswordChangePanel({ ports }: { ports: PasswordChangePorts }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const currentPorts = useRef(ports);
  const generation = useRef(0);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<PasswordChangeStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replacePending, setReplacePending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => { currentPorts.current = ports; }, [ports]);
  const reload = useCallback(async () => {
    const turn = ++generation.current;
    setChecked(false); setErrorKey(null);
    try {
      const saved = await readPasswordChangeStatus(currentPorts.current);
      if (turn !== generation.current) return;
      setStatus(saved); setPending(saved !== null); setChecked(true);
    } catch {
      if (turn === generation.current) setErrorKey("cloudAccounts.passwordStorageError");
    }
  }, []);
  useEffect(() => {
    const token = generation;
    setPassword(""); setStatus(null); setPending(false); setBusy(false); setReplacePending(false);
    void reload();
    return () => { token.current++; };
  }, [ports.key, ports.binding, reload]);

  const run = async (resume: boolean) => {
    const captured = currentPorts.current, turn = ++generation.current;
    const nextPassword = password;
    setPassword(""); setBusy(true); setErrorKey(null);
    if (!resume) setStatus({ phase: "verifying", services: {} });
    const running: PasswordChangePorts = { ...captured, onStatus: (next) => {
      captured.onStatus?.(next);
      if (turn === generation.current) setStatus(next);
    } };
    try {
      if (resume) await resumePasswordChange(running);
      else await beginPasswordChange(running, nextPassword, { replacePending });
      if (turn === generation.current) { setPending(false); setReplacePending(false); }
    } catch (error) {
      if (turn === generation.current) {
        const phase = error instanceof PasswordChangeError ? error.phase : "storage";
        const key = phase === "verification" ? "cloudAccounts.passwordVerificationFailed" : phase === "changed" ? "cloudAccounts.passwordBindingChanged"
          : phase === "pending" ? "cloudAccounts.passwordRepairBody" : phase === "missing" ? "cloudAccounts.passwordMissing" : "cloudAccounts.passwordStorageError";
        setErrorKey(key);
        try {
          const saved = await readPasswordChangeStatus(captured);
          if (turn === generation.current) { setPending(saved !== null); setStatus(saved); setChecked(true); }
        } catch { if (turn === generation.current) setChecked(false); }
      }
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  };

  return <SettingCard label={t("cloudAccounts.credentialsGroup")}>
    <div data-testid="account-password-change" style={{ display: "grid", gap: "var(--space-3)", padding: "var(--space-3)" }}>
      {busy && <Banner kind="info" rounded>{t(status?.phase === "verifying" ? "cloudAccounts.passwordVerifying" : "cloudAccounts.passwordSaving")}</Banner>}
      {pending && !busy && <Banner kind="warning" rounded actions={checked && !status?.bindingChanged ? <Button size="sm" variant="secondary" onClick={() => void run(true)} data-testid="password-change-resume">{t("cloudAccounts.passwordResume")}</Button> : undefined}>
        {t(status?.bindingChanged ? "cloudAccounts.passwordBindingChanged" : "cloudAccounts.passwordRepairBody")}
      </Banner>}
      {errorKey && <Banner kind="error" rounded actions={!checked && !busy ? <Button size="sm" variant="secondary" onClick={() => void reload()}>{t("cloudAccounts.passwordRetryRead")}</Button> : undefined}>{t(errorKey)}</Banner>}
      {status?.phase === "complete" && !errorKey && <Banner kind="success" rounded>{t("cloudAccounts.passwordUpdated")}</Banner>}
      {status && <div aria-live="polite" style={{ display: "grid", gap: "var(--space-2)" }}>
        {(Object.keys(status.services) as CloudServiceId[]).map((service) => <div key={service}>
          <strong>{serviceLabel(service)}</strong>{" · "}
          {t(status.services[service] === "confirmed" ? "cloudAccounts.passwordStored" : "cloudAccounts.passwordPending")}
        </div>)}
      </div>}
      {pending && !replacePending && !busy && checked && <Button variant="secondary" onClick={() => setReplacePending(true)}>{t("cloudAccounts.passwordRecheck")}</Button>}
      {(!pending || replacePending) && <SettingRow label={t("cloudAccounts.newPassword")} desc={t("cloudAccounts.newPasswordDesc")} wide>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", width: "100%" }}>
          <TextInput id={fieldId} aria-label={t("cloudAccounts.newPassword")} placeholder={t("settings.password")} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || !checked} style={{ flex: "1 1 auto", minWidth: 0 }} data-testid="cloudacct-new-password" />
          <Button variant="secondary" disabled={busy || !checked || !password.trim()} onClick={() => void run(false)} data-testid="cloudacct-update-password">{t(replacePending ? "cloudAccounts.passwordRecheck" : "cloudAccounts.updatePassword")}</Button>
        </div>
      </SettingRow>}
    </div>
  </SettingCard>;
}
