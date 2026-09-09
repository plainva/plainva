import { commentCreatedAt } from "@plainva/core";
import { CommentLegacyLock, CommentProvenance } from "@plainva/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, FileText, Lock, MessageSquare, Replace } from "lucide-react";
import type { WorkspaceCommentRecord } from "@plainva/core";
import {
  buildCommentOverview,
  Button,
  commentAuthorLabel,
  EmptyState,
  ICON,
  noteDisplayName,
  parseCommentMentions,
  Segmented,
  COMMENT_OVERVIEW_FOCUS_EVENT,
  takeCommentOverviewFocus,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { refreshVaultAction, usePullToRefresh } from "../lib/usePullToRefresh";
import {
  listAllMobileComments,
  listMobileCommentAuthors,
  mobileCommentSelfId,
  mobileCommentStoreState,
} from "../services/mobileComments";
import type { MobileVault } from "../services/vaultService";

/**
 * Every open comment of the vault, grouped by note (Stufe D, D9).
 *
 * The desktop opens the same list as a tab; the phone gets it as an area of
 * its own, because the areas sheet IS the phone's ribbon and burying it in
 * maintenance would put a daily question two levels deep. Same records, same
 * grouping, same "@ me" filter - the shared builder decides all three, so the
 * two surfaces cannot drift apart.
 *
 * This is a list of PLACES, not a second comment column: a card names the
 * passage and who wrote about it, and a tap goes to the note where the thread
 * can actually be answered. Replies are counted, never printed.
 */
export function CommentsScreen({
  vault,
  bump = 0,
  onBack,
  onMenu,
  onOpenNote,
}: {
  vault: MobileVault;
  bump?: number;
  /** Absent as a tab root - there is nothing to go back to. */
  onBack?: () => void;
  onMenu?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [byPath, setByPath] = useState<ReadonlyMap<string, WorkspaceCommentRecord[]>>(new Map());
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [selfId, setSelfId] = useState<string | null>(null);
  // Locked on this phone (N3): the list is empty for a reason, and the reason
  // is what this screen has to say.
  const [locked, setLocked] = useState(false);
  const [legacyLocked, setLegacyLocked] = useState(false);
  // "new" exists only while a gathered notification handed its ids in (C30).
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
  const onlyMine = filter === "mine";
  const ptrRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [comments, authors, self, state] = await Promise.all([
      listAllMobileComments(vault),
      listMobileCommentAuthors(vault),
      mobileCommentSelfId(vault),
      mobileCommentStoreState(vault),
    ]);
    setByPath(comments);
    setNames(authors);
    setSelfId(self);
    setLocked(state.mode === "locked");
    setLegacyLocked(state.legacyLocked === true);
  }, [vault]);

  // Pulling refreshes the vault the way every other list does, and then re-reads
  // the comments: a sync can have brought a colleague's thread in.
  const ptrIndicator = usePullToRefresh(ptrRef, async () => {
    await refreshVaultAction();
    await load();
  });

  useEffect(() => {
    void load();
  }, [load, bump]);

  // The same signal the note surface fires after writing a comment, so posting
  // on one screen and looking at the other cannot disagree.
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener("plainva-workspace-comments-changed", onChanged);
    return () => window.removeEventListener("plainva-workspace-comments-changed", onChanged);
  }, [load]);

  const notes = useMemo(
    () =>
      buildCommentOverview(
        [...byPath].map(([path, comments]) => ({ path, comments })),
        selfId,
        names,
        { onlyAddressed: onlyMine, onlyIds: filter === "new" && focus ? focus : undefined },
      ),
    [byPath, names, selfId, onlyMine, filter, focus],
  );

  const nameOf = (ref: { authorMemberId: string; targetRevisionId?: string }) => commentAuthorLabel(ref, names, selfId, t);

  return (
    <div className="m-page" ref={ptrRef}>
      <AppBar
        large={!onBack}
        onBack={onBack}
        onMenu={onMenu}
        title={t("comments.commentOverview")}
      />
      {ptrIndicator}
      <Segmented
        ariaLabel={t("comments.commentOverview")}
        value={filter}
        onChange={(value) => setFilter(value as "all" | "mine" | "new")}
        options={[
          ...(focus ? [{ value: "new", label: t("comments.commentOverviewNew") }] : []),
          { value: "all", label: t("comments.commentOverviewAll") },
          { value: "mine", label: t("comments.commentOverviewMine") },
        ]}
      />
      {legacyLocked && <CommentLegacyLock onUnlock={() => window.dispatchEvent(new CustomEvent("m-comments-unlock", { detail: { legacy: true } }))} />}
      {locked ? (
        <EmptyState icon={<Lock size={ICON.empty} />} action={<Button size="sm" data-testid="comments-unlock" onClick={() => window.dispatchEvent(new CustomEvent("m-comments-unlock"))}>{t("comments.commentsUnlock")}</Button>}>
          {t(vault.workspaceState ? "comments.workspaceLocked" : "comments.commentsLocked")}
        </EmptyState>
      ) : notes.length === 0 ? (
        <EmptyState icon={<MessageSquare size={ICON.empty} />}>
          {t(filter === "new" ? "comments.commentOverviewNoneNew" : onlyMine ? "comments.commentOverviewNoneMine" : "comments.commentOverviewNone")}
        </EmptyState>
      ) : (
        notes.map((note) => (
          <section className="pv-comment-overview__note" key={note.path}>
            <button
              className="pv-comment-overview__notehead"
              onClick={() => onOpenNote(note.path)}
              type="button"
            >
              <FileText size={ICON.ui} aria-hidden="true" />
              <span className="pv-comment-overview__noteid">
                {noteDisplayName(note.path)}
                <span className="pv-comment-overview__path">{note.path}</span>
              </span>
              <span className="pv-comment-overview__badge">{note.threads.length}</span>
            </button>
            {note.threads.map(({ root, replies, addressed }) => (
              <button
                className="pv-comment-card"
                key={root.commentId}
                onClick={() => onOpenNote(note.path)}
                type="button"
              >
                {addressed && (
                  <span className="pv-comment-card__state">
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("comments.commentMentionsYou")}
                  </span>
                )}
                {root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
                {root.suggestion && !root.suggestion.appliedAt && !root.suggestion.declinedAt && (
                  <span className="pv-comment-card__state">
                    <Replace size={ICON.meta} aria-hidden="true" /> {t(root.suggestionDecision?.status === "conflict" ? "comments.decisionConflict" : "comments.suggestionPending")}
                  </span>
                )}
                <small className="pv-comment-card__meta">
                  {nameOf(root)} · {new Date(commentCreatedAt(root)).toLocaleDateString()}
                </small>
                <CommentProvenance comment={root} />
                <span className="pv-comment-card__body">
                  {parseCommentMentions(root.body, names).map((segment, index) =>
                    segment.kind === "mention" ? (
                      <span className="pv-comment-card__mention" key={index}>
                        {segment.text}
                      </span>
                    ) : (
                      <Fragment key={index}>{segment.text}</Fragment>
                    ),
                  )}
                </span>
                {replies.length > 0 && (
                  <small className="pv-comment-card__meta">
                    {t("comments.commentReplyCount", { count: replies.length })}
                  </small>
                )}
              </button>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
