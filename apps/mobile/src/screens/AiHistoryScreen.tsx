import { useEffect, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { startableSkills, conversationRowActions, EmptyState, GroupCard, ICON, Row, RowList, SearchField, SectionLabel, Segmented, waitingCount, type ConversationRowCaps } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { RowActionSheet } from "../components/RowActionSheet";
import { SwipeRow } from "../components/SwipeRow";
import { useLongPress } from "../lib/useLongPress";
import { getMobileAiSession, takeSkillReview } from "../services/ai/mobileAi";
import { MobileSkillsWorkshop } from "../components/MobileSkillsWorkshop";
import { mConfirm, mPrompt } from "../services/mobileDialogs";

/**
 * The conversations of this vault (plan KI-Harness §16): on this device only.
 * A tap opens one in the KI screen; hold opens the row's sheet, a swipe its
 * loud action — both read the shared list (rename, delete), the same words as
 * the desktop's context menu.
 */
export function AiHistoryScreen({ onBack, onOpenNote, initialView = "chats" }: { onBack: () => void; onOpenNote: (path: string) => void; initialView?: "chats" | "skills" }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ title: string; caps: ConversationRowCaps } | null>(null);
  // The skills workshop is this screen's second segment (plan KI-Harness P3-5).
  const [view, setView] = useState<"chats" | "skills">(initialView);
  const [review] = useState(() => takeSkillReview());

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
        ]}
      />
      {view === "skills" ? (
        <MobileSkillsWorkshop onOpenNote={onOpenNote} onRun={onBack} review={review} />
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
