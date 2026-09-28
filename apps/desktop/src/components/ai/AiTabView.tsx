import { useEffect, useState, type MouseEvent } from "react";
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
  useAiSession,
  useAiState,
  type ConversationRowCaps,
} from "@plainva/ui";
import { appConfirm, appPrompt } from "../../services/appDialogs";

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
}: {
  activeNote: { path: string; title: string } | null;
  onOpenNote: (target: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenSettings: () => void;
  onPickNote?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: ConversationRowCaps } | null>(null);

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
        </nav>
        <section className="pv-ai-tabmain">
          <AiConversation dress="tab" activeNote={activeNote} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} />
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
