import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GroupCard, Row, RowList, SectionLabel, Switch, type AiSession } from "@plainva/ui";

/**
 * Settings → AI & automation → "Hints" on the phone (plan KI-Harness P8-3,
 * mockup chapter 25, step 3): the desktop card in rows — on or off for this
 * device, and what of the open vault rests: a paused vault, paused notes,
 * hidden hints, each with the way back.
 */
export function MobileNoteHintsSection({ session }: { session: AiSession }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { settings, hints } = state;
  const pausedNotes = hints.available ? hints.prefs.pausedNotes.length : 0;
  const hidden = hints.available ? hints.prefs.dismissed.length : 0;
  return (
    <>
      <SectionLabel>{t("rightPanel.hints")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            wrap
            title={t("ai.hints.show")}
            subtitle={t("ai.hints.showDesc")}
            end={<Switch checked={settings.noteHints} label={t("ai.hints.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, noteHints: on }))} data-testid="hints-show" />}
          />
          {hints.available && hints.prefs.vaultPaused && <Row title={t("ai.hints.vaultPausedRow")} />}
          {hints.available && hints.prefs.vaultPaused && <Row title={t("ai.hints.resume")} onClick={() => void session.setNoteHintsVaultPaused(false)} data-testid="hints-settings-resume-vault" />}
          {pausedNotes > 0 && <Row title={t("ai.hints.pausedNotes", { count: pausedNotes })} />}
          {pausedNotes > 0 && <Row title={t("ai.hints.resumeAll")} onClick={() => void session.resumeAllNoteHints()} data-testid="hints-settings-resume-all" />}
          {hidden > 0 && <Row title={t("ai.hints.hidden", { count: hidden })} />}
          {hidden > 0 && <Row title={t("ai.hints.restore")} onClick={() => void session.restoreNoteHints()} data-testid="hints-settings-restore" />}
        </RowList>
      </GroupCard>
    </>
  );
}
