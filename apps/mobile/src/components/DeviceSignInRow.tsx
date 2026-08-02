import { useTranslation } from "react-i18next";
import { AlertCircle, Check } from "lucide-react";
import type { DeviceSignInState } from "../services/deviceSignIn";
import { Button } from "@plainva/ui";

/**
 * Shared "signed in on this device?" pieces (plan P7 / E8). Calendar accounts
 * use them today; the mobile mail client — which comes directly after this
 * plan — renders the exact same two, so the two features cannot end up
 * explaining the same situation in two different ways.
 */

/** Compact status pill for an account row. */
export function DeviceSignInBadge({ state }: { state: DeviceSignInState }) {
  const { t } = useTranslation();
  if (state === "active") {
    return (
      <span className="m-state m-state--ok">
        <Check size={12} />
        {t("deviceSignIn.active", { defaultValue: "aktiv" })}
      </span>
    );
  }
  // "expired" is its own wording on purpose: "anmelden" reads as "you have not
  // got round to it", while an account that WAS working and stopped is a
  // different fact — and the only one that arrives without the user doing
  // anything (findings §2.9).
  if (state === "expired") {
    return (
      <span className="m-state m-state--warn" data-testid="device-signin-expired">
        <AlertCircle size={12} />
        {t("deviceSignIn.expired", { defaultValue: "Anmeldung abgelaufen" })}
      </span>
    );
  }
  return <span className="m-state m-state--warn">{t("deviceSignIn.signIn", { defaultValue: "anmelden" })}</span>;
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
  state = "signin",
  reason,
  onSignIn,
}: {
  accountLabel: string;
  providerLabel: string;
  /** OAuth accounts can never sync their sign-in; static ones only did not. */
  oauth: boolean;
  /** "signin" = never signed in here, "expired" = it worked and stopped. */
  state?: DeviceSignInState;
  /** The provider's own words, when there are any. Shown below the advice, not
   * as the headline — "400 Bad Request" answered nothing (desktop precedent). */
  reason?: string;
  onSignIn: () => void;
}) {
  const { t } = useTranslation();
  const expired = state === "expired";
  return (
    <div className="m-card" data-testid="device-signin-card">
      <span className="m-state m-state--warn">
        <AlertCircle size={12} />
        {expired
          ? t("deviceSignIn.expired", { defaultValue: "Anmeldung abgelaufen" })
          : t("deviceSignIn.notSignedIn", { defaultValue: "Nicht angemeldet" })}
      </span>
      <p>
        <b>
          {expired
            ? t("deviceSignIn.cardTitleExpired", { defaultValue: "Die Anmeldung von {{account}} ({{provider}}) gilt nicht mehr.", account: accountLabel, provider: providerLabel })
            : t("deviceSignIn.cardTitle", { defaultValue: "{{account}} ({{provider}}) ist auf diesem Gerät nicht angemeldet.", account: accountLabel, provider: providerLabel })}
        </b>
      </p>
      <p>
        {expired
          ? providerLabel === "google"
            ? t("pim.authExpiredGoogle")
            : t("pim.authExpired")
          : oauth
            ? t("deviceSignIn.cardBodyOauth", { defaultValue: "Das Konto kam über die Einstellungs-Synchronisation. Anmeldungen werden aus Sicherheitsgründen nie mit synchronisiert — jedes Gerät meldet sich selbst an. Einmal anmelden reicht." })
            : t("deviceSignIn.cardBodyStatic", { defaultValue: "Das Konto kam über die Einstellungs-Synchronisation, sein Passwort aber nicht. Melde Dich einmal auf diesem Gerät an." })}
      </p>
      {reason && (
        <p className="m-hint" data-testid="device-signin-reason">
          {reason}
        </p>
      )}
      <Button variant="primary" data-testid="device-signin-action" onClick={onSignIn}>
        {expired
          ? t("pim.signInAgain", { defaultValue: "Neu anmelden" })
          : t("deviceSignIn.action", { defaultValue: "Auf diesem Gerät anmelden" })}
      </Button>
    </div>
  );
}
