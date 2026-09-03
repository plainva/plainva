import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, FileText, MessageSquare, RefreshCw, Replace } from "lucide-react";
import type { WorkspaceCommentRecord } from "@plainva/core";
import { Button, ICON, Segmented, buildCommentOverview, groupSuggestionRounds, noteDisplayName, parseCommentMentions, requestCommentJump, COMMENT_OVERVIEW_FOCUS_EVENT, takeCommentOverviewFocus } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";

/**
 * Every open comment of the vault in one place (Stufe D, D9).
 *
 * The column beside a note answers "what is on THIS note". Nothing answered
 * "where am I being waited for" — you had to open a note to learn that anyone
 * had written on it, which is the one question a reviewer actually starts the
 * day with. So this is a vault-wide view, not a second column.
 *
 * It reads ONE query over the whole vault (`listAllWorkspaceComments`) rather
 * than asking note by note, and it renders resolved threads not at all: a
 * closed thread is deliberately never "waiting".
 */
export function CommentsOverview({ onOpenPath }: { onOpenPath(path: string, newTab?: boolean): void }) {
  const { t } = useTranslation();
  const { listAllWorkspaceComments, listWorkspaceMembers, getCommentSelfId, vaultPath } = useVault();
  const [byPath, setByPath] = useState<ReadonlyMap<string, WorkspaceCommentRecord[]>>(new Map());
  const [memberNames, setMemberNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [selfMemberId, setSelfMemberId] = useState<string | null>(null);
  // "new" exists only while a gathered notification handed its ids in (C30):
  // the overview cannot tell new from old on its own, and a segment that is
  // always empty would be a lie about the list.
  const [focus, setFocus] = useState<ReadonlySet<string> | null>(() => takeCommentOverviewFocus());
  const [filter, setFilter] = useState<"all" | "mine" | "new">(() => (focus ? "new" : "all"));
  useEffect(() => {
    const onFocus = (e: Event) => {
      const next = (e as CustomEvent<ReadonlySet<string> | null>).detail ?? null;
      setFocus(next);
      if (next) setFilter("new");
    };
    window.addEventListener(COMMENT_OVERVIEW_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(COMMENT_OVERVIEW_FOCUS_EVENT, onFocus);
  }, []);
  const onlyAddressed = filter === "mine";
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void listAllWorkspaceComments()
      .then(setByPath)
      .catch(() => setByPath(new Map()))
      .finally(() => setLoading(false));
  }, [listAllWorkspaceComments]);

  useEffect(() => {
    refresh();
    // Posting, resolving or accepting anywhere changes what is waiting here.
    const listener = () => refresh();
    window.addEventListener("plainva-workspace-comments-changed", listener);
    return () => window.removeEventListener("plainva-workspace-comments-changed", listener);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void listWorkspaceMembers()
      .then((members) => { if (active) setMemberNames(new Map(members.map((m) => [m.memberId, m.displayName]))); })
      .catch(() => { if (active) setMemberNames(new Map()); });
    void getCommentSelfId()
      .then((id) => { if (active) setSelfMemberId(id); })
      .catch(() => { if (active) setSelfMemberId(null); });
    return () => { active = false; };
  }, [getCommentSelfId, listWorkspaceMembers, vaultPath]);

  const entries = useMemo(
    () => [...byPath].map(([path, comments]) => ({ path, comments })),
    [byPath],
  );
  const notes = useMemo(
    () => buildCommentOverview(entries, selfMemberId, memberNames, { onlyAddressed, onlyIds: filter === "new" && focus ? focus : undefined }),
    [entries, memberNames, onlyAddressed, selfMemberId, filter, focus],
  );
  return (
    <div className="pv-comment-overview">
      <div className="pv-comment-overview__head">
        <MessageSquare size={ICON.head} aria-hidden="true" />
        <h2 className="pv-comment-overview__title">{t("workspaceSecurity.commentOverview")}</h2>
        <span className="pv-comment-overview__spacer" />
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as "all" | "mine" | "new")}
          options={[
            ...(focus ? [{ value: "new", label: t("workspaceSecurity.commentOverviewNew"), testId: "comments-overview-new" }] : []),
            { value: "all", label: t("workspaceSecurity.commentOverviewAll"), testId: "comments-overview-all" },
            { value: "mine", label: t("workspaceSecurity.commentOverviewMine"), testId: "comments-overview-mine" },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.refresh")}
        </Button>
      </div>
      <div className="pv-comment-overview__body">
        {notes.length === 0 && (
          <p className="pv-comment-overview__empty">
            {filter === "new" ? t("workspaceSecurity.commentOverviewNoneNew") : onlyAddressed ? t("workspaceSecurity.commentOverviewNoneMine") : t("workspaceSecurity.commentOverviewNone")}
          </p>
        )}
        {notes.map((note) => (
          <section className="pv-comment-overview__note" key={note.path} data-testid="comments-overview-note">
            <button
              type="button"
              className="pv-comment-overview__notehead"
              onClick={() => onOpenPath(note.path)}
              data-tip={note.path}
            >
              <FileText size={ICON.ui} aria-hidden="true" />
              <span className="pv-comment-overview__noteid">
                {noteDisplayName(note.path)}
                <span className="pv-comment-overview__path">{note.path}</span>
              </span>
              <span className="pv-comment-overview__badge">{note.threads.length}</span>
            </button>
            {/* A proposal round is one row (V4): what one "send" produced,
                with its sentence, landing on its first block. */}
            {groupSuggestionRounds(note.threads).rounds.map((round) => (
              <div
                className="pv-comment-card pv-comment-round"
                key={round.batchId}
                data-testid="comments-overview-round"
                onClick={() => {
                  requestCommentJump({ path: note.path, commentId: round.blocks[0].root.commentId });
                  onOpenPath(note.path);
                }}
              >
                <p className="pv-comment-round__meta">
                  <strong>{t("workspaceSecurity.suggestRound", { name: memberNames.get(round.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor") })}</strong>
                  {" · "}{t("workspaceSecurity.suggestRoundCount", { n: round.open })}
                  {round.note ? <em> · „{round.note}“</em> : null}
                </p>
              </div>
            ))}
            {groupSuggestionRounds(note.threads).threads.map(({ root, replies, addressed }) => (
              <div
                className="pv-comment-card"
                key={root.commentId}
                onClick={() => {
                  // Land on THIS card, not merely in the note (Stufe F, §6).
                  // The overview is where somebody picks one thread out of many;
                  // dropping them at the top of the note would make them find it
                  // a second time.
                  requestCommentJump({ path: note.path, commentId: root.commentId });
                  onOpenPath(note.path);
                }}
              >
                {addressed && (
                  <span className="pv-comment-card__state">
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.commentMentionsYou")}
                  </span>
                )}
                {root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
                {root.suggestion && (
                  <span className="pv-comment-card__state">
                    <Replace size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.suggestionPending")}
                  </span>
                )}
                <small className="pv-comment-card__meta" data-tip={root.authorMemberId}>
                  {memberNames.get(root.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor")}
                  {" · "}
                  {new Date(root.createdAt).toLocaleString()}
                </small>
                <span className="pv-comment-card__body">
                  {parseCommentMentions(root.body, memberNames).map((segment, index) =>
                    segment.kind === "mention" ? (
                      <span key={index} className="pv-comment-card__mention">{segment.text}</span>
                    ) : (
                      <Fragment key={index}>{segment.text}</Fragment>
                    ),
                  )}
                </span>
                {/* The replies are counted, not printed: this view is a list of
                    places to go, and the thread itself reads better beside the
                    passage it talks about. */}
                {replies.length > 0 && (
                  <span className="pv-comment-card__state">{t("workspaceSecurity.commentReplyCount", { count: replies.length })}</span>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
