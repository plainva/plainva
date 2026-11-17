import { useTranslation } from "react-i18next";
import { Cloud, FileText, FolderOpen } from "lucide-react";
import { ICON, getPlatformServices, userGuideUrl } from "@plainva/ui";

/** The ways in: a vault on this device, the cloud, one the user already has, or an import. */
export type OnboardingWay = "local" | "cloud" | "existing" | "import";

const WEBSITE_URL = "https://plainva.com";

/**
 * The first screen of a new install: start with a vault on this device,
 * connect the cloud first, or bring the vault one already has (plan
 * Oberfläche, O8 / T11: the third choice, with a guide per platform behind
 * it). The shell decides what each choice does (`finishOnboarding`); this is
 * only the question.
 *
 * Below the cards, as on the desktop's welcome: the import from another app
 * as a link (a real way in, not the first suggestion), and the website and
 * the guide for whoever wants to read first (review of O8, 2026-11-17 — the
 * phone offered neither).
 *
 * Lifted out of `App.tsx` when the shell's surfaces got their area boundaries
 * and the bar its marks (wave 1 of the review of 2026-11-10): the shell stays
 * within its line budget by owning one line per surface.
 */
export function OnboardingChoice({ onChoose }: { onChoose: (way: OnboardingWay) => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-onboarding">
      <h1>{t("mobile.onboardingTitle")}</h1>
      <p className="m-hint">{t("mobile.onboardingBody")}</p>
      <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => onChoose("local")} data-testid="onboarding-local">
        <FileText className="m-accent" size={ICON.touch} />
        <span className="m-onboarding-label">{t("mobile.onboardingLocal")}</span>
        <span className="m-onboarding-desc">{t("mobile.onboardingLocalDesc")}</span>
      </button>
      <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => onChoose("cloud")} data-testid="onboarding-cloud">
        <Cloud className="m-accent" size={ICON.touch} />
        <span className="m-onboarding-label">{t("mobile.onboardingCloud")}</span>
        <span className="m-onboarding-desc">{t("mobile.onboardingCloudDesc")}</span>
      </button>
      <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => onChoose("existing")} data-testid="onboarding-existing">
        <FolderOpen className="m-accent" size={ICON.touch} />
        <span className="m-onboarding-label">{t("mobile.onboardingExisting")}</span>
        <span className="m-onboarding-desc">{t("mobile.onboardingExistingDesc")}</span>
      </button>
      <p className="m-onboarding-more">
        <button type="button" className="pv-linkbtn" onClick={() => onChoose("import")} data-testid="onboarding-import">
          {t("firstRun.importLink")}
        </button>
      </p>
      <p className="m-onboarding-more" data-testid="onboarding-more">
        {t("firstRun.moreAt")}{" "}
        <button type="button" className="pv-linkbtn" onClick={() => void getPlatformServices().openExternal(WEBSITE_URL).catch(() => undefined)}>
          plainva.com
        </button>
        {" · "}
        <button type="button" className="pv-linkbtn" onClick={() => void getPlatformServices().openExternal(userGuideUrl("Getting_Started.md")).catch(() => undefined)}>
          {t("firstRun.guideLink")}
        </button>
      </p>
    </div>
  );
}
