import { useTranslation } from "react-i18next";
import { Button, gistsStatusLine, SettingCard, SettingCardNote, SettingRow, Switch, useAiState, useLocalGists, type AiSession } from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";

/**
 * Settings → AI & automation → "Gists" (plan KI-Harness P2b-3, mockup
 * chapter 11): written only by the model of the profile "Local" on this
 * computer, off until chosen. Below the switch, what is written and by which
 * model — or why nothing is —, pause, and removing every gist of the vault.
 * The same choice as the phone's AI screen.
 */
export function GistsCard({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const settings = useAiState()?.settings;
  const { controller, state } = useLocalGists();
  if (!settings) return null;
  const line = gistsStatusLine(t, state, i18n.language);
  const clear = async () => {
    const ok = await appConfirm({ title: t("ai.gists.clear"), message: t("ai.gists.clearConfirm"), confirmLabel: t("ai.gists.clear"), kind: "danger" });
    if (ok) await controller?.clear();
  };
  return (
    <SettingCard label={t("ai.gists.title")}>
      <SettingRow label={t("ai.gists.show")} desc={t("ai.gists.showDesc")}>
        <Switch checked={settings.gists} label={t("ai.gists.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, gists: on }))} data-testid="gists-show" />
      </SettingRow>
      {state?.kind === "on" && line && (
        <SettingRow label={line}>
          <Button variant="ghost" size="sm" onClick={() => (state.paused ? controller?.resume() : controller?.pause())} data-testid="gists-pause">
            {state.paused ? t("ai.semantic.resume") : t("ai.semantic.pause")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void clear()} data-testid="gists-clear">
            {t("ai.gists.clear")}
          </Button>
        </SettingRow>
      )}
      {state?.kind === "no-model" && line && <SettingCardNote>{line}</SettingCardNote>}
    </SettingCard>
  );
}
