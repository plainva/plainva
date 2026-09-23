import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupCard, Row, RowList, SectionLabel, Switch, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";
import { resetMobileWhatsNew } from "../services/mobileWhatsNew";

/**
 * Start & behaviour (S39, P10).
 *
 * The desktop page also offers "open the last vault on start" and the
 * compatibility warning. Neither applies here: the phone always opens its
 * active vault (there is no second window and no file-open dialog), and the
 * compatibility hint is a desktop toast. What DOES apply — and only the phone
 * had no way to reach — are the two explainers a user sees exactly once.
 *
 * Since the widgets (plan Widgets, W6) it also carries what a home screen
 * may show. That belongs HERE and not with the appearance: it is not about
 * how Plainva looks but about what leaves it.
 */
export function BehaviorAreaScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());
  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };
  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionBehavior")} testId="appbar-area-behavior" />
      <div className="m-settings">
        <SectionLabel>{t("settings.groupHints")}</SectionLabel>
        {/* Two cards, each a bold line and a "Show" button, are two rows. The
            shared description explains the DESKTOP's splash ("lands on the start
            screen, cannot appear over an open vault"); the phone has no such
            screen, so repeating it here would state something untrue. The title
            says enough. */}
        <GroupCard>
          <RowList>
            <Row
              onClick={() => {
                // Clearing the flag arms the welcome for the next start; showing
                // it over the settings the user is standing in would be a jump
                // scare.
                void updateMobileSettings({ onboarded: false }).then(() =>
                  toast.success(t("settings.showWelcomeAction"))
                );
              }}
              title={t("settings.showWelcome")}
            />
            <Row
              onClick={() => {
                void resetMobileWhatsNew()
                  .then(() => toast.success(t("settings.showWelcomeAction")))
                  .catch(() => toast.warning(t("settings.showWhatsNew")));
              }}
              title={t("settings.showWhatsNew")}
            />
          </RowList>
        </GroupCard>

        {/* What the home-screen widgets may show (plan Widgets, E4).

            Device-local, and that is the point: a home screen is a place other
            people look at, and which people those are is a fact about THIS
            phone, not about the vault. Titles on by default, because a widget
            that only counts is barely a widget; off keeps the rows, so the
            counter still works.

            A sealed workspace is not covered by these two - it shows nothing
            either way, because the app empties the snapshot when it locks. */}
        <SectionLabel>{t("settings.widgetsSection")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={settings.widgetShowTitles !== false}
                label={t("settings.widgetShowTitles")}
                onChange={(next) => update({ widgetShowTitles: next })}
              />}
              title={t("settings.widgetShowTitles")}
            />
            <Row
              end={<Switch
                checked={settings.widgetShowEvents !== false}
                label={t("settings.widgetShowEvents")}
                onChange={(next) => update({ widgetShowEvents: next })}
              />}
              title={t("settings.widgetShowEvents")}
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("settings.widgetsDesc")}</p>
      </div>
    </div>
  );
}
