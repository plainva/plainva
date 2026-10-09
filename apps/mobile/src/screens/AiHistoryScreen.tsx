import { useEffect, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { AiOpenPanel, startableSkills, conversationRowActions, EmptyState, GroupCard, ICON, openLearnSurface, openWritesCount, Row, RowList, SearchField, SectionLabel, Segmented, useOpenProposals, waitingCount, type ConversationRowCaps } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { RowActionSheet } from "../components/RowActionSheet";
import { SwipeRow } from "../components/SwipeRow";
import { useLongPress } from "../lib/useLongPress";
import { getMobileAiSession, takeSkillReview } from "../services/ai/mobileAi";
import { MobileMemoryView } from "../components/MobileMemoryView";
import { MobileSkillsWorkshop } from "../components/MobileSkillsWorkshop";
import { mConfirm, mPrompt } from "../services/mobileDialogs";

/**
 * The conversations of this vault (plan KI-Harness §16): on this device only.
 * A tap opens one in the KI screen; hold opens the row's sheet, a swipe its
 * loud action — both read the shared list (rename, delete), the same words as
 * the desktop's context menu.
 */
export function AiHistoryScreen({ onBack, onOpenNote, initialView = "chats" }: { onBack: () => void; onOpenNote: (path: string) => void; initialView?: "chats" | "skills" | "memory" }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ title: string; caps: ConversationRowCaps } | null>(null);
  // The skills workshop is this screen's second segment (plan KI-Harness P3-5).
  // And everything that waits for the user is its third (plan P5): the drafts of this phone, the notes with a machine's open proposals.
  // And the vault's memory (plan P6): what an assistant is told about the user in every conversation, or can look up.
  const [view, setView] = useState<"chats" | "skills" | "memory" | "open">(initialView);
  const [review, setReview] = useState(() => takeSkillReview());
  const proposals = useOpenProposals(session);
  const waiting = openWritesCount(state.drafts, proposals);

  useEffect(() => {
    let alive = true;
    if (!query.trim()) {
      setShown(null);
      return;
    }
    void session.search(query).then((ids) => {
      if (alive) setShown(ids);
    });
    return () => {
      alive = false;
    };
  }, [session, query, state.summaries]);

  const list = shown === null ? state.summaries : state.summaries.filter((s) => shown.includes(s.id));
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const capsFor = (id: string, title: string): ConversationRowCaps => ({
    // What a conversation can teach (plan P6-2): the sheet says first what would go where.
    learn: () => openLearnSurface({ kind: "learn", conversationId: id }),
    rename: () => {
      void mPrompt({ title: t("ai.history.rename"), initial: title }).then((res) => {
        if (!res.cancelled && res.value.trim()) void session.rename(id, res.value);
      });
    },
    delete: () => {
      void mConfirm({ title: t("ai.history.deleteConfirm", { title }), message: t("ai.history.deleteBody"), danger: true, confirmLabel: t("ai.history.delete") }).then((ok) => {
        if (ok) void session.remove(id);
      });
    },
  });
  const rowActions = (caps: ConversationRowCaps) =>
    conversationRowActions(t, caps).map((a) => ({ icon: <a.icon size={ICON.head} />, label: a.label, danger: a.danger, swipe: a.swipe, testId: `ai-history-${a.id}`, onClick: a.run }));
  const press = useLongPress<() => void>((show) => show());
  const startPress = (event: ReactPointerEvent, show: () => void) => {
    if ((event.target as HTMLElement).closest("button,a,input")) return;
    press.start(show);
  };

  return (
    <div className="m-page" data-testid="ai-history-screen">
      <AppBar onBack={onBack} title={t("ai.history.title")} />
      <Segmented
        ariaLabel={t("ai.workshop.title")}
        value={view}
        onChange={setView}
        options={[
          { value: "chats", label: t("ai.workshop.segmentChats"), testId: "ai-history-chats" },
          { value: "skills", label: waitingCount(state.skills.entries) ? `${t("ai.workshop.segmentSkills")} · ${waitingCount(state.skills.entries)}` : t("ai.workshop.segmentSkills"), testId: "ai-history-skills" },
          { value: "memory", label: t("ai.memory.segment"), testId: "ai-history-memory" },
          { value: "open", label: waiting ? `${t("ai.write.open.segment")} · ${waiting}` : t("ai.write.open.segment"), testId: "ai-history-waiting" },
        ]}
      />
      {view === "skills" ? (
        // Keyed by the review it was asked for: the workshop opens that one when it shows.
        <MobileSkillsWorkshop key={review ?? ""} onOpenNote={onOpenNote} onRun={onBack} review={review} />
      ) : view === "memory" ? (
        <MobileMemoryView
          onOpenNote={onOpenNote}
          onOpenWaiting={() => setView("open")}
          onReviewRules={(id) => {
            // The vault's instructions are reviewed where every instruction is: in the workshop.
            setReview(id);
            setView("skills");
          }}
        />
      ) : view === "open" ? (
        <AiOpenPanel session={session} state={state.drafts} proposals={proposals} onOpenNote={onOpenNote} touch />
      ) : (
        <>
      <SearchField value={query} onValueChange={setQuery} placeholder={t("ai.history.search")} aria-label={t("ai.history.search")} clearLabel={t("ai.history.clearSearch")} />
      <GroupCard>
        {list.length === 0 ? (
          <EmptyState icon={<MessageSquare size={ICON.empty} />}>{query.trim() ? t("ai.history.noMatch") : t("ai.history.none")}</EmptyState>
        ) : (
          <RowList>
            {list.map((summary) => {
              const caps = capsFor(summary.id, summary.title);
              return (
                <SwipeRow key={summary.id} actions={rowActions(caps).filter((a) => a.swipe)}>
                  <Row
                    title={summary.title || t("ai.history.untitled")}
                    subtitle={when.format(new Date(summary.updatedAt))}
                    data-testid="ai-history-row"
                    onPointerDown={(event: ReactPointerEvent) => startPress(event, () => setSheet({ title: summary.title, caps }))}
                    onPointerUp={press.clear}
                    onPointerLeave={press.clear}
                    onPointerCancel={press.clear}
                    onClick={() => {
                      if (press.clicked()) void session.open(summary.id).then(onBack);
                    }}
                  />
                </SwipeRow>
              );
            })}
          </RowList>
        )}
      </GroupCard>
      <SectionLabel>{t("ai.skills.title")}</SectionLabel>
      <GroupCard>
        <RowList>
          {startableSkills(t, state.skills.entries).map((skill) => (
            <Row
              key={skill.id}
              icon={<skill.icon size={ICON.ui} />}
              title={skill.title}
              subtitle={skill.description}
              disabled={Boolean(state.live)}
              data-testid={skill.commandId.replace(/^ai-skill-/, "ai-history-skill-")}
              onClick={() => {
                // A new conversation bound to the skill, shown on the KI screen while it streams.
                void session.runSkill(skill.id, skill.start);
                onBack();
              }}
            />
          ))}
        </RowList>
      </GroupCard>
        </>
      )}
      {sheet && <RowActionSheet title={sheet.title} actions={rowActions(sheet.caps)} onClose={() => setSheet(null)} />}
    </div>
  );
}
