import { useTranslation } from "react-i18next";

/**
 * "On this device only" (settings plan 2026-10-29, decision E3): the one
 * wording for a setting on a vault page that does not travel with the vault.
 * Nine settings used to say it in nine sentences of their own.
 *
 * Whether a setting travels is not decided per row by hand: `travelsWithVault`
 * (lib/profileFields) derives it from the catalog of fields the settings
 * profile carries (E14). On an app page the badge has no place: every app
 * setting stays on the device, which is said once for the whole section.
 */
export function DeviceOnlyBadge({ testId = "device-only-badge" }: { testId?: string }) {
  const { t } = useTranslation();
  return (
    <span className="pv-badge pv-badge--accent pv-badge--text" data-testid={testId}>
      {t("settings.deviceOnlyBadge")}
    </span>
  );
}
