import { useTranslation } from "react-i18next";
import { Cloud, FileText, FolderOpen } from "lucide-react";
import { ICON } from "@plainva/ui";

/** The three ways in: a vault on this device, the cloud, or one the user already has. */
export type OnboardingWay = "local" | "cloud" | "existing";

/**
 * The first screen of a new install: start with a vault on this device,
 * connect the cloud first, or bring the vault one already has (plan
 * Oberfläche, O8 / T11: the third choice, with a guide per platform behind
 * it). The shell decides what each choice does (`finishOnboarding`); this is
 * only the question.
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
    </div>
  );
}
