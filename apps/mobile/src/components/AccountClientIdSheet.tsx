import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, GroupCard, RowList, SettingField, TextInput } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Asks for the OAuth client this device should sign an account in with
 * (Befund 2026-08-20).
 *
 * The answer to "no client id for this account" is a question, not an error.
 * Client ids are device-local by design — the settings sync strips them — so an
 * account that reached this phone through the profile has none here, and until
 * now the only response was a red toast in English with nothing behind it: the
 * one action the card offered could never succeed.
 *
 * Google needs its own registration by decision (its Drive/Calendar scopes are
 * BYO), Microsoft only lands here when even the shipped registration is absent.
 * The secret is Google-only and optional — Android OAuth clients have none.
 */
export function AccountClientIdSheet({
  busy,
  family,
  onCancel,
  onSubmit,
}: {
  busy?: boolean;
  family: "google" | "microsoft";
  onCancel: () => void;
  onSubmit: (client: { clientId: string; clientSecret?: string }) => void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  return (
    <div className="m-sheet-backdrop" onClick={onCancel}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{t("cloudAccounts.reconnect")}</p>
        <p className="m-hint">
          {family === "google" ? t("cloudAccounts.byoAccountHintGoogle") : t("cloudAccounts.byoAccountHint")}
        </p>
        <GroupCard>
          <RowList>
            <SettingField label={t("settings.clientId")}>
              <TextInput
                data-testid="acct-clientid"
                onChange={(e) => setClientId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                value={clientId}
              />
            </SettingField>
            {family === "google" && (
              <SettingField label={t("pim.googleClientSecret")}>
                <TextInput
                  data-testid="acct-clientsecret"
                  onChange={(e) => setClientSecret(e.target.value)}
                  value={clientSecret}
                />
              </SettingField>
            )}
          </RowList>
        </GroupCard>
        <Button
          data-testid="acct-clientid-save"
          disabled={busy || !clientId.trim()}
          onClick={() => onSubmit({ clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined })}
          variant="primary"
        >
          {t("pim.connect")}
        </Button>
      </div>
    </div>
  );
}
