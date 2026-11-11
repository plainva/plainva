import { useTranslation } from "react-i18next";
import { Cloud, FileText } from "lucide-react";
import { ICON } from "@plainva/ui";

/**
 * The first screen of a new install: start with a vault on this device, or
 * connect the cloud first. The shell decides what either choice does
 * (`finishOnboarding`); this is only the question.
 *
 * Lifted out of `App.tsx` when the shell's surfaces got their area boundaries
 * and the bar its marks (wave 1 of the review of 2026-11-10): the shell stays
 * within its line budget by owning one line per surface.
 */
export function OnboardingChoice({ onChoose }: { onChoose: (connectCloud: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-onboarding">
      <h1>{t("mobile.onboardingTitle")}</h1>
      <p className="m-hint">{t("mobile.onboardingBody")}</p>
      <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => onChoose(false)}>
        <FileText className="m-accent" size={ICON.touch} />
        <span className="m-onboarding-label">{t("mobile.onboardingLocal")}</span>
        <span className="m-onboarding-desc">{t("mobile.onboardingLocalDesc")}</span>
      </button>
      <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => onChoose(true)}>
        <Cloud className="m-accent" size={ICON.touch} />
        <span className="m-onboarding-label">{t("mobile.onboardingCloud")}</span>
        <span className="m-onboarding-desc">{t("mobile.onboardingCloudDesc")}</span>
      </button>
    </div>
  );
}
