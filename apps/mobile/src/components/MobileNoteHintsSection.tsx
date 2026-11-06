import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GroupCard, Row, RowList, SectionLabel, Switch, useLocalEmbeddings, type AiSession } from "@plainva/ui";

/**
 * Settings → AI → "Next to the open note" on the phone (plan KI-Oberflächen
 * K5, KI-Harness P8-3): the desktop card in rows — related notes (once search
 * by meaning is ready) and the calm hints, each on or off for this device,
 * and what of the open vault rests, each with the way back.
 */
export function MobileNoteHintsSection({ session }: { session: AiSession }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { settings, hints } = state;
  const { controller, state: embeddings } = useLocalEmbeddings();
  const relatedReady = embeddings?.engine?.kind === "ready";
  const pausedNotes = hints.available ? hints.prefs.pausedNotes.length : 0;
  const hidden = hints.available ? hints.prefs.dismissed.length : 0;
  return (
    <>
      <SectionLabel>{t("ai.settings.nextToNote")}</SectionLabel>
      <GroupCard>
        <RowList>
          {relatedReady && (
            <Row
              wrap
              title={t("ai.related.show")}
              info={t("ai.related.showDesc")}
              end={<Switch checked={settings.relatedNotes} label={t("ai.related.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, relatedNotes: on }))} />}
            />
          )}
          {relatedReady && embeddings?.related.vaultPaused && <Row title={t("ai.related.vaultPausedRow")} />}
          {relatedReady && embeddings?.related.vaultPaused && <Row title={t("ai.related.resume")} onClick={() => void controller?.setRelatedVaultPaused(false)} data-testid="related-resume-vault" />}
          {relatedReady && Boolean(embeddings?.related.paused.length) && <Row title={t("ai.related.pausedNotes", { count: embeddings?.related.paused.length ?? 0 })} />}
          {relatedReady && Boolean(embeddings?.related.paused.length) && <Row title={t("ai.related.resumeAll")} onClick={() => void controller?.resumeRelated()} data-testid="related-resume-all" />}
          {relatedReady && Boolean(embeddings?.related.dismissed) && <Row title={t("ai.related.hidden", { count: embeddings?.related.dismissed ?? 0 })} />}
          {relatedReady && Boolean(embeddings?.related.dismissed) && <Row title={t("ai.related.restore")} onClick={() => void controller?.restoreRelated()} data-testid="related-restore" />}
          <Row
            wrap
            title={t("ai.hints.show")}
            info={t("ai.hints.showDesc")}
            end={<Switch checked={settings.noteHints} label={t("ai.hints.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, noteHints: on }))} testId="hints-show" />}
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
