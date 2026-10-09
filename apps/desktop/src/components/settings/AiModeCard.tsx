import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button, ICON, modeFacts, SettingCard, SettingCardNote, SettingRow, Switch, type AiSession, type AiState } from "@plainva/ui";

/**
 * Settings → AI & automation → "Mode" (plan KI-Harness P7, ADR 0030, mockup
 * chapter 23): one line that says what holds now, the switch "Fully local",
 * and — while it is on — what of the user's own set-up rests.
 *
 * Cloud and Hybrid are a state, not a choice: they follow from the providers
 * and helpers the user set up. Only "Fully local" is a switch, because only
 * it promises something. The card draws the shared view model; the phone's
 * group draws the same one.
 */
export function AiModeCard({ session, state, onSetUp }: { session: AiSession; state: AiState; onSetUp: () => void }) {
  const { t, i18n } = useTranslation();
  const facts = modeFacts(t, state, i18n.language);
  return (
    <SettingCard label={t("ai.mode.title")}>
      <SettingRow label={facts.title} desc={facts.body}>
        {facts.empty ? (
          <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={onSetUp} data-testid="ai-mode-setup">
            {t("ai.mode.setUp")}
          </Button>
        ) : null}
      </SettingRow>
      <SettingRow label={t("ai.mode.switch")} desc={t("ai.mode.switchDesc")}>
        <Switch checked={facts.localOnly} label={t("ai.mode.switch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, localOnly: on }))} data-testid="ai-local-only" />
      </SettingRow>
      {facts.localOnly ? (
        <>
          {/* Only what is set up is listed: a row per thing that rests, each with what resting means for it. */}
          <SettingCardNote>{facts.rests.length ? t("ai.mode.rests.title") : t("ai.mode.rests.none")}</SettingCardNote>
          {facts.rests.map((rest) => (
            <SettingRow key={rest.kind} label={rest.label} desc={rest.desc} />
          ))}
          <SettingCardNote>{t("ai.mode.notThis")}</SettingCardNote>
        </>
      ) : (
        <SettingCardNote>{t("ai.mode.note")}</SettingCardNote>
      )}
    </SettingCard>
  );
}
