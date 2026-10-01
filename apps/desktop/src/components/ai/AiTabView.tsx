import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, MoreHorizontal, SquarePen } from "lucide-react";
import {
  AiConversation,
  Button,
  conversationRowActions,
  EmptyState,
  ICON,
  IconButton,
  MenuItem,
  MenuSurface,
  Row,
  RowActionList,
  RowList,
  SearchField,
  SectionLabel,
  Segmented,
  startableSkills,
  waitingCount,
  useAiSession,
  useAiState,
  type ConversationRowCaps,
} from "@plainva/ui";
import { appConfirm, appPrompt } from "../../services/appDialogs";
import { AI_SKILLS_EVENT, takeSkillsRequest } from "../../services/ai/desktopAi";
import { SkillsWorkshop } from "./SkillsWorkshop";
import { editorSelectionReader } from "../../services/editorSelection";

/**
 * The AI tab `plainva://ai` (plan KI-Harness §19.1, dress C): the same
 * conversation as the companion, with room for its history. Choosing a
 * conversation here opens it everywhere — there is one conversation state.
 */
export function AiTabView({
  activeNote,
  onOpenNote,
  onOpenUrl,
  onOpenSettings,
  onPickNote,
  onOpenPath,
}: {
  activeNote: { path: string; title: string } | null;
  onOpenNote: (target: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenSettings: () => void;
  onPickNote?: () => void;
  /** Opens a file of the vault in a tab — a skill's SKILL.md from the workshop. */
  onOpenPath: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: ConversationRowCaps } | null>(null);
  // The workshop (plan KI-Harness P3-5) beside the conversation; the settings may ask for it, with one review.
  const [view, setView] = useState<"chats" | "skills">("chats");
  const [review, setReview] = useState<string | null>(null);
  useEffect(() => {
    const take = () => {
      const request = takeSkillsRequest();
      if (!request) return;
      setView("skills");
      setReview(request.review);
    };
    take();
    window.addEventListener(AI_SKILLS_EVENT, take);
    return () => window.removeEventListener(AI_SKILLS_EVENT, take);
  }, []);
  const reviewOpened = useCallback(() => setReview(null), []);

  const summaries = state?.summaries;
  useEffect(() => {
    let alive = true;
    if (!session || !query.trim()) {
      setShown(null);
      return;
    }
    void session.search(query).then((ids) => {
      if (alive) setShown(ids);
    });
    return () => {
      alive = false;
    };
  }, [session, query, summaries]);

  if (!session || !state) return null;
  const list = shown === null ? state.summaries : state.summaries.filter((s) => shown.includes(s.id));
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  const capsFor = (id: string, title: string): ConversationRowCaps => ({
    rename: () => {
      void appPrompt({ title: t("ai.history.rename"), initial: title }).then((next) => {
        if (next && next.trim()) void session.rename(id, next);
      });
    },
    delete: () => {
      void appConfirm({ title: t("ai.history.deleteConfirm", { title }), message: t("ai.history.deleteBody"), confirmLabel: t("ai.history.delete") }).then((ok) => {
        if (ok) void session.remove(id);
      });
    },
  });
  const openMenu = (event: MouseEvent, id: string, title: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ at: { x: event.clientX, y: event.clientY }, caps: capsFor(id, title) });
  };

  return (
    <div className="pv-ai-tab" data-testid="ai-tab">
      <div className="pv-appbar">
        <h2 className="pv-ai-tabtitle">{t("ai.title")}</h2>
        <Segmented
          size="sm"
          ariaLabel={t("ai.workshop.title")}
          value={view}
          onChange={setView}
          options={[
            { value: "chats", label: t("ai.workshop.segmentChats"), testId: "ai-tab-chats" },
            { value: "skills", label: waitingCount(state.skills.entries) ? `${t("ai.workshop.segmentSkills")} · ${waitingCount(state.skills.entries)}` : t("ai.workshop.segmentSkills"), testId: "ai-tab-skills" },
          ]}
        />
        <Button size="sm" variant="primary" icon={<SquarePen size={ICON.ui} />} disabled={Boolean(state.live)} onClick={() => session.newConversation()} data-testid="ai-tab-new">
          {t("ai.newConversation")}
        </Button>
      </div>
      <div className="pv-ai-tabbody">
        <nav className="pv-ai-history" aria-label={t("ai.history.title")}>
          <SearchField value={query} onValueChange={setQuery} placeholder={t("ai.history.search")} aria-label={t("ai.history.search")} clearLabel={t("ai.history.clearSearch")} data-testid="ai-history-search" />
          {list.length === 0 ? (
            <EmptyState icon={<MessageSquare size={ICON.empty} />}>{query.trim() ? t("ai.history.noMatch") : t("ai.history.none")}</EmptyState>
          ) : (
            <RowList className="pv-ai-historylist">
              {list.map((summary) => (
                <Row
                  key={summary.id}
                  controls
                  className={summary.id === state.active?.id ? "pv-ai-historyrow is-on" : "pv-ai-historyrow"}
                  title={summary.title || t("ai.history.untitled")}
                  subtitle={when.format(new Date(summary.updatedAt))}
                  disabled={Boolean(state.live)}
                  onClick={() => void session.open(summary.id)}
                  onContextMenu={(event) => openMenu(event, summary.id, summary.title)}
                  data-testid="ai-history-row"
                  end={
                    <IconButton label={t("common.moreActions")} size="sm" onClick={(event) => openMenu(event, summary.id, summary.title)}>
                      <MoreHorizontal size={ICON.ui} />
                    </IconButton>
                  }
                />
              ))}
            </RowList>
          )}
          <SectionLabel>{t("ai.skills.title")}</SectionLabel>
          <RowList className="pv-ai-historylist">
            {startableSkills(t, state.skills.entries).map((skill) => (
              <Row
                key={skill.id}
                icon={<skill.icon size={ICON.ui} />}
                title={skill.title}
                subtitle={skill.description}
                disabled={Boolean(state.live)}
                onClick={() => void session.runSkill(skill.id, skill.start)}
                data-testid={skill.commandId.replace(/^ai-skill-/, "ai-tab-skill-")}
              />
            ))}
          </RowList>
        </nav>
        <section className="pv-ai-tabmain">
          {view === "skills" ? (
            <SkillsWorkshop onOpenFile={onOpenPath} onRun={() => setView("chats")} review={review} onReviewOpened={reviewOpened} />
          ) : (
            <AiConversation selection={editorSelectionReader} dress="tab" activeNote={activeNote} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} />
          )}
        </section>
      </div>
      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          <RowActionList build={(tt) => conversationRowActions(tt, menu.caps)}>
            {(a) => (
              <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`ai-history-${a.id}`} onSelect={a.run}>
                {a.label}
              </MenuItem>
            )}
          </RowActionList>
        </MenuSurface>
      )}
    </div>
  );
}
