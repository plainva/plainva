import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button, SettingCard, SettingRow, Switch, useLocalEmbeddings, type AiSession } from "@plainva/ui";

/**
 * "Next to the open note" in the AI settings (plan KI-Oberflächen K5): the two
 * things that fill the same place beside a note — related notes, from the
 * vectors of search by meaning, and the calm hints (plan KI-Harness P8-3) —
 * each on or off for this device, with what of the open vault rests to bring
 * back. Neither needs a model. The phone shows the same group.
 */
export function NoteHintsCard({ session }: { session: AiSession }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { controller, state: embeddings } = useLocalEmbeddings();
  const { settings, hints } = state;
  // Related notes come from the vectors of search by meaning: offered once it is ready on this device.
  const relatedReady = embeddings?.engine?.kind === "ready";
  return (
    <SettingCard label={t("ai.settings.nextToNote")}>
      {relatedReady && (
        <>
          <SettingRow label={t("ai.related.show")} info={t("ai.related.showDesc")}>
            <Switch checked={settings.relatedNotes} label={t("ai.related.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, relatedNotes: on }))} testId="related-show" />
          </SettingRow>
          {embeddings?.related.vaultPaused && (
            <SettingRow label={t("ai.related.vaultPausedRow")}>
              <Button variant="ghost" size="sm" onClick={() => void controller?.setRelatedVaultPaused(false)} data-testid="related-resume-vault">
                {t("ai.related.resume")}
              </Button>
            </SettingRow>
          )}
          {Boolean(embeddings?.related.paused.length) && (
            <SettingRow label={t("ai.related.pausedNotes", { count: embeddings?.related.paused.length ?? 0 })}>
              <Button variant="ghost" size="sm" onClick={() => void controller?.resumeRelated()} data-testid="related-resume-all">
                {t("ai.related.resumeAll")}
              </Button>
            </SettingRow>
          )}
          {Boolean(embeddings?.related.dismissed) && (
            <SettingRow label={t("ai.related.hidden", { count: embeddings?.related.dismissed ?? 0 })}>
              <Button variant="ghost" size="sm" onClick={() => void controller?.restoreRelated()} data-testid="related-restore">
                {t("ai.related.restore")}
              </Button>
            </SettingRow>
          )}
        </>
      )}
      <SettingRow label={t("ai.hints.show")} info={t("ai.hints.showDesc")}>
        <Switch checked={settings.noteHints} label={t("ai.hints.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, noteHints: on }))} testId="hints-show" />
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
