import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { History, SquarePen } from "lucide-react";
import { AiConversation, AiSessionContext, GroupCard, ICON, IconButton, openWritesCount, Row, RowList, SectionLabel, useOpenProposals, waitingCount } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { getMobileAiSession, openAiLink, openAiNotePick } from "../services/ai/mobileAi";

/** The views of the AI's second screen (plan KI-Oberflächen K11): its segments, as the desktop's AI tab has them. */
export type AiHistoryView = "chats" | "open" | "skills" | "memory";

/**
 * The KI screen (plan KI-Harness §19.1, dress C on the phone): the ninth area
 * of the pool, outside the bar by default. The conversation fills the
 * surface; the history is one tap away in the bar's actions. Without an open
 * conversation, a start page lists what waits for the user, the last
 * conversations and the way to skills and memory (plan KI-Oberflächen K11) —
 * the rows a thumb reaches, above the quick start and the field.
 */
export function AiScreen({
  onBack,
  onMenu,
  onHistory,
  onOpenNote,
  onOpenSettings,
}: {
  onBack?: () => void;
  onMenu?: () => void;
  onHistory: (view?: AiHistoryView) => void;
  onOpenNote: (target: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  return (
    <AiSessionContext.Provider value={session}>
      <div className="m-page m-ai-page" data-testid="ai-screen">
        <AppBar
          large={!onBack}
          onBack={onBack}
          onMenu={onMenu}
          title={t("ai.title")}
          actions={
            <>
              <IconButton label={t("ai.history.title")} onClick={() => onHistory()} data-testid="ai-history-open">
                <History size={ICON.head} />
              </IconButton>
              <IconButton label={t("ai.newConversation")} onClick={() => session.newConversation()} data-testid="ai-new">
                <SquarePen size={ICON.head} />
              </IconButton>
            </>
          }
        />
        <AiConversation
          dress="screen"
          activeNote={null}
          onOpenNote={onOpenNote}
          onOpenUrl={openAiLink}
          onOpenSettings={onOpenSettings}
          onPickNote={() => openAiNotePick("pin")}
          start={<AiStartPage onHistory={onHistory} />}
        />
      </div>
    </AiSessionContext.Provider>
  );
}

/** What waits, the last conversations and the way to skills and memory — the empty AI screen's start page. */
function AiStartPage({ onHistory }: { onHistory: (view?: AiHistoryView) => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const proposals = useOpenProposals(session);
  const waiting = openWritesCount(state.drafts, proposals) + waitingCount(state.skills.entries);
  const recent = state.summaries.slice(0, 3);
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  if (!state.hasVault) return null;
  return (
    <div className="m-ai-start" data-testid="ai-start">
      {waiting > 0 && (
        <GroupCard>
          <RowList>
            <Row title={t("ai.write.open.segment")} end={<span className="m-row-note">{waiting}</span>} onClick={() => onHistory("open")} data-testid="ai-start-waiting" />
          </RowList>
        </GroupCard>
      )}
      {recent.length > 0 && (
        <>
          <SectionLabel>{t("ai.start.recent")}</SectionLabel>
          <GroupCard>
            <RowList>
              {recent.map((summary) => (
                <Row key={summary.id} title={summary.title || t("ai.history.untitled")} subtitle={when.format(new Date(summary.updatedAt))} onClick={() => void session.open(summary.id)} data-testid="ai-start-recent" />
              ))}
              <Row title={t("ai.start.allConversations")} onClick={() => onHistory()} />
            </RowList>
          </GroupCard>
        </>
      )}
      <GroupCard>
        <RowList>
          <Row title={t("ai.start.skillsAndMemory")} onClick={() => onHistory("skills")} data-testid="ai-start-skills" />
        </RowList>
      </GroupCard>
    </div>
  );
}
