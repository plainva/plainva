import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, FileText, MessageSquare, Replace } from "lucide-react";
import type { WorkspaceCommentRecord } from "@plainva/core";
import {
  buildCommentOverview,
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
    const [comments, authors, self] = await Promise.all([
      listAllMobileComments(vault),
      listMobileCommentAuthors(vault),
      mobileCommentSelfId(),
    ]);
    setByPath(comments);
    setNames(authors);
    setSelfId(self);
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

  const nameOf = (id: string) => names.get(id) ?? t("workspaceSecurity.commentUnknownAuthor");

  return (
    <div className="m-page" ref={ptrRef}>
      <AppBar
        large={!onBack}
        onBack={onBack}
        onMenu={onMenu}
        title={t("workspaceSecurity.commentOverview")}
      />
      {ptrIndicator}
      <Segmented
        ariaLabel={t("workspaceSecurity.commentOverview")}
        value={filter}
        onChange={(value) => setFilter(value as "all" | "mine" | "new")}
        options={[
          ...(focus ? [{ value: "new", label: t("workspaceSecurity.commentOverviewNew") }] : []),
          { value: "all", label: t("workspaceSecurity.commentOverviewAll") },
          { value: "mine", label: t("workspaceSecurity.commentOverviewMine") },
        ]}
      />
      {notes.length === 0 ? (
        <EmptyState icon={<MessageSquare size={ICON.empty} />}>
          {t(filter === "new" ? "workspaceSecurity.commentOverviewNoneNew" : onlyMine ? "workspaceSecurity.commentOverviewNoneMine" : "workspaceSecurity.commentOverviewNone")}
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
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.commentMentionsYou")}
                  </span>
                )}
                {root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
                {root.suggestion && !root.suggestion.appliedAt && !root.suggestion.declinedAt && (
                  <span className="pv-comment-card__state">
                    <Replace size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.suggestionPending")}
                  </span>
                )}
                <small className="pv-comment-card__meta">
                  {nameOf(root.authorMemberId)} · {new Date(root.createdAt).toLocaleDateString()}
                </small>
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
                    {t("workspaceSecurity.commentReplyCount", { count: replies.length })}
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
