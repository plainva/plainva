import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, FileText, Lock, MessageSquare, RefreshCw, Replace } from "lucide-react";
import type { CommentStoreState, WorkspaceCommentRecord } from "@plainva/core";
import { buildCommentOverview, Button, COMMENT_OVERVIEW_FOCUS_EVENT, commentAuthorLabel, EmptyState, groupSuggestionRounds, ICON, noteDisplayName, parseCommentMentions, requestCommentJump, Segmented, takeCommentOverviewFocus } from "@plainva/ui";
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
  const { listAllWorkspaceComments, listWorkspaceMembers, getCommentSelfId, getCommentStoreState, vaultPath } = useVault();
  // Locked on this device (N3): the list is empty for a reason, and the
  // reason is what this view has to say.
  const [storeState, setStoreState] = useState<CommentStoreState | null>(null);
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
    void getCommentStoreState().then(setStoreState).catch(() => setStoreState(null));
    // Names travel with the files (N2): a device that just showed up has one.
    void listWorkspaceMembers().then((members) => setMemberNames(new Map(members.map((m) => [m.memberId, m.displayName])))).catch(() => setMemberNames(new Map()));
    void listAllWorkspaceComments()
      .then(setByPath)
      .catch(() => setByPath(new Map()))
      .finally(() => setLoading(false));
  }, [listAllWorkspaceComments, getCommentStoreState, listWorkspaceMembers]);

  useEffect(() => {
    refresh();
    // Posting, resolving or accepting anywhere changes what is waiting here.
    const listener = () => refresh();
    window.addEventListener("plainva-workspace-comments-changed", listener);
    window.addEventListener("plainva-encryption-changed", listener);
    return () => { window.removeEventListener("plainva-workspace-comments-changed", listener); window.removeEventListener("plainva-encryption-changed", listener); };
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
        <h2 className="pv-comment-overview__title">{t("comments.commentOverview")}</h2>
        <span className="pv-comment-overview__spacer" />
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as "all" | "mine" | "new")}
          options={[
            ...(focus ? [{ value: "new", label: t("comments.commentOverviewNew"), testId: "comments-overview-new" }] : []),
            { value: "all", label: t("comments.commentOverviewAll"), testId: "comments-overview-all" },
            { value: "mine", label: t("comments.commentOverviewMine"), testId: "comments-overview-mine" },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.refresh")}
        </Button>
      </div>
      <div className="pv-comment-overview__body">
        {storeState?.mode === "locked" && (
          <EmptyState
            icon={<Lock size={ICON.empty} />}
            action={<Button size="sm" data-testid="comments-unlock" onClick={() => window.dispatchEvent(new CustomEvent("plainva-encryption-locked", { detail: { vaultPath, force: true } }))}>{t("comments.commentsUnlock")}</Button>}
          >
            {t("comments.commentsLocked")}
          </EmptyState>
        )}
        {storeState?.mode !== "locked" && notes.length === 0 && (
          <EmptyState icon={<MessageSquare size={ICON.empty} />}>
            {filter === "new" ? t("comments.commentOverviewNoneNew") : onlyAddressed ? t("comments.commentOverviewNoneMine") : t("comments.commentOverviewNone")}
          </EmptyState>
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
                  <strong>{t("comments.suggestRound", { name: commentAuthorLabel({ authorMemberId: round.authorMemberId, targetRevisionId: round.blocks[0]?.root.targetRevisionId }, memberNames, selfMemberId, t) })}</strong>
                  {" · "}{t("comments.suggestRoundCount", { n: round.open })}
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
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("comments.commentMentionsYou")}
                  </span>
                )}
                {root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
                {root.suggestion && (
                  <span className="pv-comment-card__state">
                    <Replace size={ICON.meta} aria-hidden="true" /> {t("comments.suggestionPending")}
                  </span>
                )}
                <small className="pv-comment-card__meta" data-tip={root.authorMemberId}>
                  {commentAuthorLabel(root, memberNames, selfMemberId, t)}
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
                  <span className="pv-comment-card__state">{t("comments.commentReplyCount", { count: replies.length })}</span>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
