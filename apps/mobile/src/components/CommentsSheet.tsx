import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Bell, BellOff, Check, ListChecks, Lock, MessageSquare, Replace, Trash2 } from "lucide-react";
import { CommentDecisionConflict, anchorDisplayLabel, Button, buildCommentThreads, CommentBody, CommentCardHead, groupSuggestionRounds, ICON, IconButton, isCommentThreadOpen, MentionTextArea, Segmented, SuggestionDiff, toAnchorDisplayHint, type AnchorCellPlace, type CommentThread, EmptyState, commentAuthorLabel, authorInitials } from "@plainva/ui";
import type { WorkspaceCommentRecord, WorkspacePropertyAnchorResolution } from "@plainva/core";
import { SheetGrip } from "./SheetGrip";

/**
 * Comments and suggestions on the phone (Stufe D, D5).
 *
 * The desktop shows a column beside the note; a phone has no room for one, so
 * the same records arrive as a sheet - a different surface, never a second
 * meaning. What a thread IS (grouping, the verdict on a proposal) is decided by
 * the shared record, not here, so the two views cannot drift apart.
 *
 * Suggestions are read and ACCEPTED here, never written: proposing a wording
 * needs a selection in the text, and the note opens read-first on the phone.
 */
export interface CommentsSheetProps {
  comments: readonly WorkspaceCommentRecord[];
  operationStatus?: ReactNode;
  memberNames: ReadonlyMap<string, string>;
  /** Who this device is - the member id in a workspace, the device id otherwise. */
  selfMemberId: string | null;
  /**
   * What became of each property anchor (Stufe E, E2), by comment id.
   *
   * A property comment never reaches the quote resolver - its key is not in the
   * body - so its own verdict decides whether the card names the key as it was
   * written, names the key it was renamed to, or admits the property is gone.
   */
  propertyResolutions?: ReadonlyMap<string, WorkspacePropertyAnchorResolution>;
  canComment: boolean;
  canWrite: boolean;
  onSubmit(body: string, parentCommentId: string | null): Promise<void>;
  onResolve(commentId: string): void;
  onReviewDecision?(comment: WorkspaceCommentRecord): void;
  onApplySuggestion(comment: WorkspaceCommentRecord): void;
  onDeclineSuggestion(comment: WorkspaceCommentRecord): void;
  /**
   * Turns the thread into a task in the default task database (D11).
   *
   * Gated on `canComment` like the desktop, and for the same reason: what
   * happens HERE is the reply that links to the task - the task note itself
   * lands in a different note, in the database's own folder.
   */
  onPromoteToTask(comment: WorkspaceCommentRecord): void;
  /** Tapping an anchored quote reveals the passage in the note (D6). */
  onRevealAnchor(comment: WorkspaceCommentRecord): void;
  onClose(): void;
  /**
   * Whether this note is silenced, and how to change it (Stufe F, §3 rule 4).
   *
   * The same control the desktop column carries, in the phone's own idiom -
   * silence is a state of THIS note, and the moment somebody wants it is the
   * moment they are looking at the remarks. Absent while notifications are off
   * for the vault: a switch that silences something which never speaks reads as
   * broken.
   */
  muted?: boolean;
  onToggleMute?(): void;
  /** A `[[wiki link]]` in a remark - the reply "task created" carries one (K4). */
  onOpenNote?(target: string): void;
  onOpenUrl?(url: string): void;
  /** Deletes a remark (K7): its author, or a moderator on everything. */
  onDelete?(comment: WorkspaceCommentRecord): void;
  canModerate?: boolean;
  /** Whether open suggestions are drawn in the text (K5); the head carries the switch. */
  inlineSuggestions?: boolean;
  onToggleInlineSuggestions?(): void;
  /** Where each cell comment was found today (V7): the card names the cell with it. */
  cellPlaces?: ReadonlyMap<string, AnchorCellPlace>;
  /** A whole proposal round at once (V5). */
  onApplyRound?(batchId: string): void;
  onDeclineRound?(batchId: string): void;
  /**
   * The card a tap in the text named (finding 2026-09-03): the sheet opens on
   * its tab, scrolled to it and marked - the desktop column's behaviour.
   */
  activeCommentId?: string | null;
  /**
   * The remarks are locked on this phone (N3): a keyfile in the vault, no
   * unlocked key here. The sheet says so and offers the way out, instead of an
   * empty list that reads as "nobody wrote anything".
   */
  locked?: { onUnlock(): void };
}

/**
 * A comment body with `@Name` lifted out of the text.
 *
 * Derived on every render, never stored: the body is the single truth, so a
 * renamed member changes what this shows and nothing has to be migrated.
 */

function suggestionState(comment: WorkspaceCommentRecord): "open" | "applied" | "declined" | "conflict" | null {
  if (!comment.suggestion) return null;
  if (comment.suggestionDecision?.status === "conflict") return "conflict";
  if (comment.suggestion.appliedAt) return "applied";
  if (comment.suggestion.declinedAt) return "declined";
  return comment.resolvedAt ? "declined" : "open";
}

export function CommentsSheet({
  comments,
  operationStatus,
  memberNames,
  selfMemberId,
  canComment,
  canWrite,
  propertyResolutions,
  onSubmit,
  onResolve,
  onReviewDecision,
  onApplySuggestion,
  onDeclineSuggestion,
  onPromoteToTask,
  onRevealAnchor,
  onOpenNote,
  onOpenUrl,
  onDelete,
  canModerate,
  inlineSuggestions,
  onToggleInlineSuggestions,
  cellPlaces,
  onApplyRound,
  onDeclineRound,
  activeCommentId = null,
  onClose,
  muted,
  onToggleMute,
  locked,
}: CommentsSheetProps) {
  const { t, i18n } = useTranslation();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  /** Same two views as the desktop column (K3): what is open, or everything. */
  const [filter, setFilter] = useState<"open" | "all">("open");
  const threads = useMemo(
    () => buildCommentThreads(comments, selfMemberId, memberNames),
    [comments, memberNames, selfMemberId],
  );
  const openCount = useMemo(() => threads.filter((thread) => isCommentThreadOpen(thread.root)).length, [threads]);
  const shownThreads = useMemo(
    () => (filter === "open" ? threads.filter((thread) => isCommentThreadOpen(thread.root) || thread.root.pending) : threads),
    [threads, filter],
  );
  const grouped = useMemo(() => groupSuggestionRounds(shownThreads), [shownThreads]);
  const [kind, setKind] = useState<"comments" | "suggestions">("comments");
  const kindTouched = useRef(false);
  const openByKind = useMemo(() => {
    const all = groupSuggestionRounds(threads);
    return { comments: all.threads.filter((thread) => isCommentThreadOpen(thread.root)).length, suggestions: all.rounds.reduce((n, round) => n + round.open, 0) };
  }, [threads]);
  useEffect(() => {
    if (kindTouched.current) return;
    if (openByKind.comments === 0 && openByKind.suggestions > 0) setKind("suggestions");
  }, [openByKind]);
  // A card named from the text shows on ITS tab and scrolls into view
  // (finding 2026-09-03) - the tap is explicit intent and wins over the tab
  // and the "open" filter the reader chose. Same rule as the desktop column.
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeCommentId) return;
    const thread = threads.find((entry) => entry.root.commentId === activeCommentId || entry.replies.some((reply) => reply.commentId === activeCommentId));
    if (!thread) return;
    setKind(thread.root.suggestion ? "suggestions" : "comments");
    if (!isCommentThreadOpen(thread.root) && !thread.root.pending) setFilter("all");
  }, [activeCommentId, threads]);
  useEffect(() => {
    const card = activeCardRef.current;
    if (!activeCommentId || !card || typeof card.scrollIntoView !== "function") return;
    card.scrollIntoView({ block: "nearest" });
  }, [activeCommentId, kind, filter]);
  const nameOf = (ref: { authorMemberId: string; targetRevisionId?: string }) => commentAuthorLabel(ref, memberNames, selfMemberId, t);
  const roundAuthor = (round: { authorMemberId: string; blocks: Array<{ root: WorkspaceCommentRecord }> }) =>
    nameOf({ authorMemberId: round.authorMemberId, targetRevisionId: round.blocks[0]?.root.targetRevisionId });
  /** Same question in the card as on the desktop (K7). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const mayDelete = (record: WorkspaceCommentRecord) => !!onDelete && !record.pending && (record.authorMemberId === selfMemberId || canModerate === true);
  const deleteControl = (record: WorkspaceCommentRecord) => mayDelete(record) ? (
    <IconButton label={t("comments.commentDelete")} onClick={() => setConfirmDelete(confirmDelete === record.commentId ? null : record.commentId)}>
      <Trash2 size={ICON.touch} />
    </IconButton>
  ) : null;
  const confirmBox = (record: WorkspaceCommentRecord, replyCount: number) => confirmDelete === record.commentId ? (
    <div className="pv-comment-card__confirm" role="alertdialog">
      <span>{replyCount > 0 ? t("comments.commentDeleteConfirmThread") : t("comments.commentDeleteConfirm")}</span>
      <div className="pv-comment-card__actions">
        <Button variant="danger" size="sm" onClick={() => { setConfirmDelete(null); onDelete?.(record); }}>{t("comments.commentDelete")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
      </div>
    </div>
  ) : null;

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSubmit(text, replyTo);
      setBody("");
      setReplyTo(null);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Stufe E (E1): a widget anchor has no readable quote - its source is
   * `![[picture.png]]` or a whole table's Markdown. The shared helper names the
   * thing instead, so the phone and the desktop column say the same words.
   */
  const anchorText = (comment: WorkspaceCommentRecord) => {
    if (!comment.anchor) return "";
    // Stufe E (E2): a property anchor names a frontmatter key, and its own
    // verdict decides which key - the one that was written, or the one it was
    // renamed to. A property that is gone says so; its quote (the value at the
    // time of writing) would read like a passage that is still there.
    const property = propertyResolutions?.get(comment.commentId);
    if (property) {
      if (property.status === "orphan") {
        // Same record as the desktop card: the key it was written against plus
        // the value it held. A name alone leaves the reader nothing to place.
        const gone = t("comments.commentPropertyOrphan", {
          key: comment.anchor.display?.kind === "property" ? comment.anchor.display.key : "",
        });
        if (!comment.anchor.quote) return gone;
        return `${gone} ${t("comments.commentPropertyOrphanValue", { value: comment.anchor.quote })}`;
      }
      const hint = toAnchorDisplayHint(
        comment.anchor.display,
        property.status === "renamed" ? property.key : undefined,
      ) ?? { kind: "property" as const, key: property.key };
      const renamed = anchorDisplayLabel(hint);
      return t(renamed.key, renamed.params);
    }
    if (!comment.anchor.display) return comment.anchor.quote;
    const hint = toAnchorDisplayHint(comment.anchor.display, undefined, cellPlaces?.get(comment.commentId) ?? null);
    if (!hint) return comment.anchor.quote;
    const label = anchorDisplayLabel(hint);
    return t(label.key, label.params);
  };

  /** One thread as a card - inside a round and on its own. */
  const renderThread = ({ root, replies, addressed }: CommentThread) => {
            const state = suggestionState(root);
            return (
              <div key={root.commentId} ref={activeCommentId === root.commentId ? activeCardRef : undefined} className={`pv-comment-card${activeCommentId === root.commentId ? " is-active" : ""}`}>
                <CommentCardHead name={nameOf(root)} initials={authorInitials(memberNames.get(root.authorMemberId) ?? nameOf(root))} memberId={root.authorMemberId} createdAt={root.createdAt} locale={i18n.language} />
                {addressed && (
                  <span className="pv-comment-card__state">
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("comments.commentMentionsYou")}
                  </span>
                )}
                {root.anchor && (
                  <button
                    type="button"
                    className="pv-comment-card__quote pv-comment-card__quote--tap"
                    onClick={() => onRevealAnchor(root)}
                  >
                    {/* Stufe E (E1): a widget anchor has no readable quote - its
                        source is `![[picture.png]]` or a whole table. The shared
                        helper names the thing so both shells say the same. */}
                    {anchorText(root)}
                  </button>
                )}
                {root.body && <CommentBody body={root.body} names={memberNames} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />}
                {state && root.suggestion && (
                  <SuggestionDiff quote={root.anchor?.quote ?? ""} replacement={root.suggestion.replacement} deletesLabel={t("comments.suggestionDeletes")} />
                )}
                {replies.map((reply) => (
                  <div key={reply.commentId} className="pv-comment-card__reply">
                    <CommentCardHead name={nameOf(reply)} initials={authorInitials(memberNames.get(reply.authorMemberId) ?? nameOf(reply))} memberId={reply.authorMemberId} createdAt={reply.createdAt} locale={i18n.language} />
                    <CommentBody body={reply.body} names={memberNames} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
                    {mayDelete(reply) && <div className="pv-comment-card__actions">{deleteControl(reply)}</div>}
                    {confirmBox(reply, 0)}
                  </div>
                ))}
                {state === "conflict" && <CommentDecisionConflict onReview={canComment && onReviewDecision ? () => onReviewDecision(root) : undefined} />}
                {state === "open" && canWrite && (
                  // The decision is its own row (finding 2026-09-03, desktop
                  // parity): accept and decline side by side, never wrapped apart.
                  <div className="pv-comment-card__decision">
                    <Button size="sm" onClick={() => onApplySuggestion(root)}>
                      {t("comments.suggestionApply")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDeclineSuggestion(root)}>
                      {t("comments.suggestionDecline")}
                    </Button>
                  </div>
                )}
                <div className="pv-comment-card__actions">
                  {state === "applied" && (
                    <span className="pv-comment-card__state">{t("comments.suggestionApplied")}</span>
                  )}
                  {state === "declined" && (
                    <span className="pv-comment-card__state">{t("comments.suggestionDeclined")}</span>
                  )}
                  {canComment && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setReplyTo(root.commentId)}>
                        {t("comments.commentReply")}
                      </Button>
                      {/* A remark and a proposal alike can turn out to be
                          work, so this sits outside the `!state` branch. */}
                      {!root.resolvedAt && (
                        <Button size="sm" variant="ghost" onClick={() => onPromoteToTask(root)}>
                          <ListChecks size={ICON.meta} aria-hidden="true" />
                          {t("comments.commentToTask")}
                        </Button>
                      )}
                      {!state && !root.resolvedAt && (
                        <Button size="sm" variant="ghost" onClick={() => onResolve(root.commentId)}>
                          <Check size={ICON.meta} aria-hidden="true" />
                          {t("workspaceSecurity.resolve")}
                        </Button>
                      )}
                    </>
                  )}
                  {deleteControl(root)}
                </div>
                {confirmBox(root, replies.length)}
              </div>
            );
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <div className="pv-comment-column__head">
          <Segmented
            size="sm"
            ariaLabel={t("comments.comments")}
            value={kind}
            onChange={(next) => { kindTouched.current = true; setKind(next); }}
            options={[
              { value: "comments", label: `${t("comments.comments")} · ${openByKind.comments}` },
              { value: "suggestions", label: `${t("comments.suggestions")} · ${openByKind.suggestions}` },
            ]}
          />
          <span className="pv-comment-column__count" hidden>{t("comments.commentOpenCount", { n: openCount })}</span>
          <span className="pv-comment-column__spacer" />
          {threads.length > 0 && (
            <Segmented
              size="sm"
              ariaLabel={t("comments.comments")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: t("comments.commentFilterOpen") },
                { value: "all", label: t("comments.commentOverviewAll") },
              ]}
            />
          )}
          {onToggleInlineSuggestions && (
            <IconButton label={t("comments.suggestionInline")} active={inlineSuggestions === true} onClick={onToggleInlineSuggestions}>
              <Replace size={ICON.touch} />
            </IconButton>
          )}
          {onToggleMute && (
            <IconButton
              label={muted ? t("commentNotify.unmute") : t("commentNotify.mute")}
              active={muted}
              onClick={onToggleMute}
            >
              {muted ? <BellOff size={ICON.touch} /> : <Bell size={ICON.touch} />}
            </IconButton>
          )}
        </div>
        {operationStatus}
        {locked && (
          <EmptyState icon={<Lock size={ICON.empty} />} action={<Button size="sm" onClick={locked.onUnlock} data-testid="comments-unlock">{t("comments.commentsUnlock")}</Button>}>
            {t("comments.commentsLocked")}
          </EmptyState>
        )}
        {!locked && kind === "comments" && grouped.threads.length === 0 && <p className="pv-comment-column__empty">{t("comments.commentsNone")}</p>}
        <div className="pv-comment-list">
          {!locked && kind === "suggestions" && grouped.rounds.length === 0 && <p className="pv-comment-column__empty">{t("comments.suggestionsNone")}</p>}
          {kind === "suggestions" && grouped.rounds.map((round) => (
            <section key={round.batchId} className="pv-comment-round">
              {!round.batchId.startsWith("single:") && (
                <div className="pv-comment-round__head">
                  <CommentCardHead name={roundAuthor(round)} initials={authorInitials(memberNames.get(round.authorMemberId) ?? roundAuthor(round))} memberId={round.authorMemberId} createdAt={round.createdAt} locale={i18n.language} />
                  <p className="pv-comment-round__meta">{round.note ? <em>„{round.note}“ · </em> : null}{t("comments.suggestRoundCount", { n: round.blocks.length })}</p>
                  {round.open > 1 && !round.blocks.some((block) => block.root.suggestionDecision?.status === "conflict") && (
                    <div className="pv-comment-card__actions">
                      {canWrite && onApplyRound && <Button size="sm" onClick={() => onApplyRound(round.batchId)}>{t("comments.suggestApplyAll")}</Button>}
                      {canComment && onDeclineRound && <Button size="sm" variant="ghost" onClick={() => onDeclineRound(round.batchId)}>{t("comments.suggestDeclineAll")}</Button>}
                    </div>
                  )}
                </div>
              )}
              <div className="pv-comment-round__blocks">{round.blocks.map(renderThread)}</div>
            </section>
          ))}
          {kind === "comments" && grouped.threads.map(renderThread)}
        </div>
        {canComment && !locked && (
          <div className="pv-comment-compose">
            <MentionTextArea
              aria-label={t(replyTo ? "comments.commentReply" : "workspaceSecurity.addComment")}
              names={memberNames}
              onChange={setBody}
              pickerLabel={t("comments.commentMentionPicker")}
              placeholder={t(replyTo ? "comments.commentReplyPlaceholder" : "workspaceSecurity.addComment")}
              rows={3}
              value={body}
            />
            <Button onClick={() => void send()} disabled={!body.trim() || busy}>
              <MessageSquare size={ICON.meta} aria-hidden="true" />
              {t("workspaceSecurity.send")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
