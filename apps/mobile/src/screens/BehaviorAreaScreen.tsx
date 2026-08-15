import { useTranslation } from "react-i18next";
import { GroupCard, Row, RowList, SectionLabel, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { updateMobileSettings } from "../services/mobileSettings";
import { resetMobileWhatsNew } from "../services/mobileWhatsNew";

/**
 * Start & behaviour (S39, P10).
 *
 * The desktop page also offers "open the last vault on start" and the
 * compatibility warning. Neither applies here: the phone always opens its
 * active vault (there is no second window and no file-open dialog), and the
 * compatibility hint is a desktop toast. What DOES apply — and only the phone
 * had no way to reach — are the two explainers a user sees exactly once.
 */
export function BehaviorAreaScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionBehavior")} />
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
      </div>
    </div>
  );
}
