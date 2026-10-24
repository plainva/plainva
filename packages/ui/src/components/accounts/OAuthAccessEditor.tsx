import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { Radio } from "../ui/Radio";
import { TextInput } from "../ui/Field";
import { SettingCard, SettingCardNote, SettingRow } from "../ui/SettingsSurface";
import {
  ownAccessRequirements,
  validClientId,
  type AccessPlatform,
  type AccessProblem,
  type StoredOAuthAccess,
} from "../../lib/oauthAccess";
import type { OAuthFamily } from "../../lib/oauthScopes";

/**
 * Which client this device signs in with (account sign-in plan E3, mockup
 * view 6). One surface for both shells: Plainva's access is the default, the
 * own access asks exactly what this device type needs - a Desktop-type Google
 * client with its secret on a computer, an iOS-type client without one on a
 * phone, a client id for Microsoft.
 */
export function OAuthAccessEditor({
  family,
  platform,
  value,
  plainvaAvailable,
  onSave,
  onCancel,
}: {
  family: OAuthFamily;
  platform: AccessPlatform;
  value: StoredOAuthAccess | null;
  /** Whether this build ships Plainva's client for this family and platform. */
  plainvaAvailable: boolean;
  onSave(next: StoredOAuthAccess): Promise<void>;
  onCancel?(): void;
}) {
  const { t } = useTranslation();
  const needs = ownAccessRequirements(family, platform);
  const [source, setSource] = useState<"plainva" | "own">(value?.source === "own" || !plainvaAvailable ? "own" : "plainva");
  const [clientId, setClientId] = useState(value?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(value?.clientSecret ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idInvalid = source === "own" && clientId.trim() !== "" && !validClientId(family, clientId);
  const incomplete = source === "own" && (!clientId.trim() || idInvalid || (needs.secret && !clientSecret.trim()));
  const name = `oauth-access-${family}`;
  const typeHint = t(`accountAccess.ownType.${needs.clientType}`);

  return (
    <div data-testid={`oauth-access-${family}`}>
    <SettingCard>
      <SettingCardNote>{t("accountAccess.deviceOnly")}</SettingCardNote>
      <div role="radiogroup" style={{ display: "grid", gap: "var(--space-2)" }} aria-label={t(`accountAccess.title.${family}`)}>
        <Radio
          name={name}
          checked={source === "plainva"}
          disabled={!plainvaAvailable}
          onChange={() => setSource("plainva")}
          data-testid={`oauth-access-${family}-plainva`}
          label={<span><b>{t("accountAccess.plainva")}</b><br />{plainvaAvailable ? t("accountAccess.plainvaDesc") : t("accountAccess.plainvaMissing")}</span>}
        />
        <Radio
          name={name}
          checked={source === "own"}
          onChange={() => setSource("own")}
          data-testid={`oauth-access-${family}-own`}
          label={<span><b>{t("accountAccess.own")}</b><br />{t(`accountAccess.ownDesc.${family}`)}</span>}
        />
      </div>
      {source === "own" && (
        <>
          <SettingRow label={t("settings.clientId")} wide>
            <TextInput value={clientId} onChange={(event) => setClientId(event.target.value)} data-testid={`oauth-access-${family}-client-id`} aria-invalid={idInvalid || undefined} />
          </SettingRow>
          {needs.secret && (
            <SettingRow label={t("settings.clientSecret")} wide>
              <TextInput type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} data-testid={`oauth-access-${family}-client-secret`} />
            </SettingRow>
          )}
          <SettingCardNote>{typeHint}</SettingCardNote>
          {idInvalid && <Banner kind="warning" rounded>{t("accountAccess.problem.ownClientInvalid")}</Banner>}
        </>
      )}
      <SettingCardNote>{t("accountAccess.signInAgainHint")}</SettingCardNote>
      {error && <Banner kind="error" rounded>{error}</Banner>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        {onCancel && <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>}
        <Button
          variant="primary"
          disabled={busy || incomplete}
          data-testid={`oauth-access-${family}-save`}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(source === "plainva"
                ? { source: "plainva" }
                : { source: "own", clientId: clientId.trim(), ...(needs.secret ? { clientSecret: clientSecret.trim() } : {}) });
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("common.save")}
        </Button>
      </div>
    </SettingCard>
    </div>
  );
}

const ACCESS_PROBLEM_KEYS: Record<AccessProblem, string> = {
  noPlainvaClient: "accountAccess.problem.noPlainvaClient",
  ownClientMissing: "accountAccess.problem.ownClientMissing",
  ownClientInvalid: "accountAccess.problem.ownClientInvalid",
  ownSecretMissing: "accountAccess.problem.ownSecretMissing",
};

/** The sentence for an access the device cannot use. */
export function accessProblemKey(problem: AccessProblem): string {
  return ACCESS_PROBLEM_KEYS[problem];
}
