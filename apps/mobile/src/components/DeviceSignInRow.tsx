import { useTranslation } from "react-i18next";
import { AlertCircle, Check } from "lucide-react";
import type { DeviceSignInState } from "../services/deviceSignIn";

/**
 * Shared "signed in on this device?" pieces (plan P7 / E8). Calendar accounts
 * use them today; the mobile mail client — which comes directly after this
 * plan — renders the exact same two, so the two features cannot end up
 * explaining the same situation in two different ways.
 */

/** Compact status pill for an account row. */
export function DeviceSignInBadge({ state }: { state: DeviceSignInState }) {
  const { t } = useTranslation();
  return state === "active" ? (
    <span className="m-state m-state--ok">
      <Check size={12} />
      {t("deviceSignIn.active", { defaultValue: "aktiv" })}
    </span>
  ) : (
    <span className="m-state m-state--warn">{t("deviceSignIn.signIn", { defaultValue: "anmelden" })}</span>
  );
}

/**
 * The card shown where the missing sign-in actually HURTS (an empty calendar,
 * an empty mailbox). Names the account, says why the sign-in did not travel,
 * and offers the one action that fixes it.
 */
export function DeviceSignInCard({
  accountLabel,
  providerLabel,
  oauth,
  onSignIn,
}: {
  accountLabel: string;
  providerLabel: string;
  /** OAuth accounts can never sync their sign-in; static ones only did not. */
  oauth: boolean;
  onSignIn: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-card" data-testid="device-signin-card">
      <span className="m-state m-state--warn">
        <AlertCircle size={12} />
        {t("deviceSignIn.notSignedIn", { defaultValue: "Nicht angemeldet" })}
      </span>
      <p>
        <b>{t("deviceSignIn.cardTitle", { defaultValue: "{{account}} ({{provider}}) ist auf diesem Gerät nicht angemeldet.", account: accountLabel, provider: providerLabel })}</b>
      </p>
      <p>
        {oauth
          ? t("deviceSignIn.cardBodyOauth", { defaultValue: "Das Konto kam über die Einstellungs-Synchronisation. Anmeldungen werden aus Sicherheitsgründen nie mit synchronisiert — jedes Gerät meldet sich selbst an. Einmal anmelden reicht." })
          : t("deviceSignIn.cardBodyStatic", { defaultValue: "Das Konto kam über die Einstellungs-Synchronisation, sein Passwort aber nicht. Melde Dich einmal auf diesem Gerät an." })}
      </p>
      <button className="m-btn m-btn--filled" data-testid="device-signin-action" onClick={onSignIn}>
        {t("deviceSignIn.action", { defaultValue: "Auf diesem Gerät anmelden" })}
      </button>
    </div>
  );
}
