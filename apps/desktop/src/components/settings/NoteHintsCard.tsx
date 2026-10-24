import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button, SettingCard, SettingRow, Switch, type AiSession } from "@plainva/ui";

/**
 * The calm hints at the open note in the AI settings (plan KI-Harness P8-3,
 * mockup chapter 25, step 3): on or off for this device, and what of the open
 * vault rests — a paused vault, paused notes, hidden hints — to bring back.
 * The phone shows the same in its AI settings.
 */
export function NoteHintsCard({ session }: { session: AiSession }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { settings, hints } = state;
  return (
    <SettingCard label={t("rightPanel.hints")}>
      <SettingRow label={t("ai.hints.show")} desc={t("ai.hints.showDesc")}>
        <Switch checked={settings.noteHints} label={t("ai.hints.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, noteHints: on }))} data-testid="hints-show" />
      </SettingRow>
      {hints.available && hints.prefs.vaultPaused && (
        <SettingRow label={t("ai.hints.vaultPausedRow")}>
          <Button variant="ghost" size="sm" onClick={() => void session.setNoteHintsVaultPaused(false)} data-testid="hints-settings-resume-vault">
            {t("ai.hints.resume")}
          </Button>
        </SettingRow>
      )}
      {hints.available && hints.prefs.pausedNotes.length > 0 && (
        <SettingRow label={t("ai.hints.pausedNotes", { count: hints.prefs.pausedNotes.length })}>
          <Button variant="ghost" size="sm" onClick={() => void session.resumeAllNoteHints()} data-testid="hints-settings-resume-all">
            {t("ai.hints.resumeAll")}
          </Button>
        </SettingRow>
      )}
      {hints.available && hints.prefs.dismissed.length > 0 && (
        <SettingRow label={t("ai.hints.hidden", { count: hints.prefs.dismissed.length })}>
          <Button variant="ghost" size="sm" onClick={() => void session.restoreNoteHints()} data-testid="hints-settings-restore">
            {t("ai.hints.restore")}
          </Button>
        </SettingRow>
      )}
    </SettingCard>
  );
}
