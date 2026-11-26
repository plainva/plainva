import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { History, SquarePen } from "lucide-react";
import { GroupCard, ICON, IconButton, Row, RowList, SectionLabel } from "@plainva/ui";
import { AiConversation, AiSessionContext, openWriteLines, openWritesCount, startAiConversation, useOpenProposals, type OpenWriteLine } from "@plainva/ui/ai";
import type { ConversationSummary } from "@plainva/core/ai";
import { AppBar } from "../components/AppBar";
import { useAiSetupDoor } from "../hooks/useAiSetupDoor";
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
  onOpenNote: (target: string, kind?: "wiki" | "markdown") => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  // "Set up" opens the three-step setup while a step is missing (plan Oberfläche O7, T9).
  const setup = useAiSetupDoor(onOpenSettings);
  // The start page stands only where it has something to list (F71 of release 0.9.0): otherwise the conversation's own
  // greeting stands at the top, never both.
  const startRows = useAiStartRows();
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
              <IconButton label={t("ai.newConversation")} onClick={() => startAiConversation(session, t)} data-testid="ai-new">
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
          onOpenSettings={setup.open}
          onPickNote={() => openAiNotePick("pin")}
          start={startRows.waiting > 0 || startRows.recent.length > 0 ? <AiStartPage onHistory={onHistory} /> : undefined}
          onOpenSkills={() => onHistory("skills")}
        />
        {setup.sheet}
      </div>
    </AiSessionContext.Provider>
  );
}

/** What the empty AI screen's start page lists: what waits for a decision, and the last conversations. */
function useAiStartRows(): { waiting: number; lines: OpenWriteLine[]; recent: ConversationSummary[]; hasVault: boolean } {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const proposals = useOpenProposals(session);
  if (!state.hasVault) return { waiting: 0, lines: [], recent: [], hasVault: false };
  return {
    // Exactly what the segment "To decide" lists (mockup M10): skills that wait have their own number at "Skills".
    waiting: openWritesCount(state.drafts, proposals),
    lines: openWriteLines(t, i18n.language, state.drafts, proposals),
    recent: state.summaries.slice(0, 3),
    hasVault: true,
  };
}

/** How many of the things that wait the start page lists; the number beside the heading says how many there are. */
const START_WAITING_LINES = 3;

/**
 * What waits and the last conversations — the empty AI screen's start page. The way to the skills and the memory is
 * the last entry of the "Skills" menu at the foot (F71 of release 0.9.0), not a row here: one way, one place.
 */
function AiStartPage({ onHistory }: { onHistory: (view?: AiHistoryView) => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const { waiting, lines, recent, hasVault } = useAiStartRows();
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  if (!hasVault) return null;
  return (
    <div className="m-ai-start" data-testid="ai-start">
      {/* What waits (F71 of release 0.9.0, mockup M12): the first lines of the segment "To decide", as it shows them;
          the number beside the heading says how many there are, a tap opens the segment. */}
      {waiting > 0 && (
        <>
          <SectionLabel end={<span className="m-row-note" data-testid="ai-start-waiting-count">{waiting}</span>}>{t("ai.write.open.segment")}</SectionLabel>
          <GroupCard>
            <RowList>
              {lines.slice(0, START_WAITING_LINES).map((line) => (
                <Row key={line.key} title={line.title} subtitle={line.detail} onClick={() => onHistory("open")} data-testid="ai-start-waiting" />
              ))}
            </RowList>
          </GroupCard>
        </>
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
    </div>
  );
}
