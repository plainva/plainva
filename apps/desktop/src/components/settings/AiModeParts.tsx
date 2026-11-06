import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button, ICON, modeFacts, SettingCard, SettingCardNote, SettingRow, Switch, type AiSession, type AiState } from "@plainva/ui";

/**
 * The mode line at the top of Settings → AI → Models (plan KI-Harness P7,
 * plan KI-Oberflächen K2): what holds now — and, while "Fully local" is on
 * and no profile names a model on this device, the way to set one up. The
 * phone's models group draws the same view model (`modeFacts`).
 */
export function AiModeRow({ state, onSetUp }: { state: AiState; onSetUp: () => void }) {
  const { t, i18n } = useTranslation();
  const facts = modeFacts(t, state, i18n.language);
  return (
    <SettingRow label={facts.title} desc={facts.body}>
      {facts.empty ? (
        <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={onSetUp} data-testid="ai-mode-setup">
          {t("ai.mode.setUp")}
        </Button>
      ) : null}
    </SettingRow>
  );
}

/**
 * Settings → AI → "Privacy" (plan KI-Oberflächen K2): what may leave this
 * device, in one place — the one switch that promises something, "Fully
 * local" (ADR 0030), with what of the user's set-up rests while it is on, and
 * the question before each request. What a vault allows stands in "AI in this
 * vault"; the note says so.
 */
export function AiPrivacyCard({ session, state }: { session: AiSession; state: AiState }) {
  const { t, i18n } = useTranslation();
  const facts = modeFacts(t, state, i18n.language);
  const settings = state.settings;
  return (
    <SettingCard label={t("ai.settings.privacy")} info={facts.localOnly ? t("ai.mode.notThis") : t("ai.mode.note")}>
      <SettingRow label={t("ai.mode.switch")} info={t("ai.mode.switchDesc")}>
        <Switch checked={facts.localOnly} label={t("ai.mode.switch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, localOnly: on }))} testId="ai-local-only" />
      </SettingRow>
      {facts.localOnly && (
        <>
          {/* Only what is set up is listed: a row per thing that rests, each with what resting means for it. */}
          <SettingCardNote>{facts.rests.length ? t("ai.mode.rests.title") : t("ai.mode.rests.none")}</SettingCardNote>
          {facts.rests.map((rest) => (
            <SettingRow key={rest.kind} label={rest.label} desc={rest.desc} />
          ))}
        </>
      )}
      <SettingRow label={t("ai.settings.confirmEvery")} info={t("ai.settings.confirmEveryDesc")}>
        <Switch checked={settings.confirmEveryRequest} label={t("ai.settings.confirmEvery")} onChange={(on) => void session.updateSettings((s) => ({ ...s, confirmEveryRequest: on }))} testId="ai-confirm-every" />
      </SettingRow>
      <SettingCardNote>{t("ai.settings.privacyVaultNote")}</SettingCardNote>
    </SettingCard>
  );
}
