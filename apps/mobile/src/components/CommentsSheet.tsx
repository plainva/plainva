import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Bell, BellOff, Check, ListChecks, MessageSquare, Replace, Trash2 } from "lucide-react";
import { anchorDisplayLabel, Button, buildCommentThreads, CommentBody, CommentCardHead, groupSuggestionRounds, ICON, IconButton, isCommentThreadOpen, MentionTextArea, Segmented, SuggestionDiff, toAnchorDisplayHint, type CommentThread } from "@plainva/ui";
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
  /** A whole proposal round at once (V5). */
  onApplyRound?(batchId: string): void;
  onDeclineRound?(batchId: string): void;
}

/**
 * A comment body with `@Name` lifted out of the text.
 *
 * Derived on every render, never stored: the body is the single truth, so a
 * renamed member changes what this shows and nothing has to be migrated.
 */

function suggestionState(comment: WorkspaceCommentRecord): "open" | "applied" | "declined" | null {
  if (!comment.suggestion) return null;
  if (comment.suggestion.appliedAt) return "applied";
  if (comment.suggestion.declinedAt) return "declined";
  return comment.resolvedAt ? "declined" : "open";
}

export function CommentsSheet({
  comments,
  memberNames,
  selfMemberId,
  canComment,
  canWrite,
  propertyResolutions,
  onSubmit,
  onResolve,
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
  onApplyRound,
  onDeclineRound,
  onClose,
  muted,
  onToggleMute,
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
  const nameOf = (id: string) => memberNames.get(id) ?? t("workspaceSecurity.commentUnknownAuthor");
  /** Same question in the card as on the desktop (K7). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const mayDelete = (record: WorkspaceCommentRecord) => !!onDelete && !record.pending && (record.authorMemberId === selfMemberId || canModerate === true);
  const deleteControl = (record: WorkspaceCommentRecord) => mayDelete(record) ? (
    <IconButton label={t("workspaceSecurity.commentDelete")} onClick={() => setConfirmDelete(confirmDelete === record.commentId ? null : record.commentId)}>
      <Trash2 size={ICON.touch} />
    </IconButton>
  ) : null;
  const confirmBox = (record: WorkspaceCommentRecord, replyCount: number) => confirmDelete === record.commentId ? (
    <div className="pv-comment-card__confirm" role="alertdialog">
      <span>{replyCount > 0 ? t("workspaceSecurity.commentDeleteConfirmThread") : t("workspaceSecurity.commentDeleteConfirm")}</span>
      <div className="pv-comment-card__actions">
        <Button variant="danger" size="sm" onClick={() => { setConfirmDelete(null); onDelete?.(record); }}>{t("workspaceSecurity.commentDelete")}</Button>
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
        const gone = t("workspaceSecurity.commentPropertyOrphan", {
          key: comment.anchor.display?.kind === "property" ? comment.anchor.display.key : "",
        });
        if (!comment.anchor.quote) return gone;
        return `${gone} ${t("workspaceSecurity.commentPropertyOrphanValue", { value: comment.anchor.quote })}`;
      }
      const hint = toAnchorDisplayHint(
        comment.anchor.display,
        property.status === "renamed" ? property.key : undefined,
      ) ?? { kind: "property" as const, key: property.key };
      const renamed = anchorDisplayLabel(hint);
      return t(renamed.key, renamed.params);
    }
    if (!comment.anchor.display) return comment.anchor.quote;
    const hint = toAnchorDisplayHint(comment.anchor.display);
    if (!hint) return comment.anchor.quote;
    const label = anchorDisplayLabel(hint);
    return t(label.key, label.params);
  };

  /** One thread as a card - inside a round and on its own. */
  const renderThread = ({ root, replies, addressed }: CommentThread) => {
            const state = suggestionState(root);
            return (
              <div key={root.commentId} className="pv-comment-card">
                <CommentCardHead name={nameOf(root.authorMemberId)} memberId={root.authorMemberId} createdAt={root.createdAt} locale={i18n.language} />
                {addressed && (
                  <span className="pv-comment-card__state">
                    <AtSign size={ICON.meta} aria-hidden="true" /> {t("workspaceSecurity.commentMentionsYou")}
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
                  <SuggestionDiff quote={root.anchor?.quote ?? ""} replacement={root.suggestion.replacement} deletesLabel={t("workspaceSecurity.suggestionDeletes")} />
                )}
                {replies.map((reply) => (
                  <div key={reply.commentId} className="pv-comment-card__reply">
                    <CommentCardHead name={nameOf(reply.authorMemberId)} memberId={reply.authorMemberId} createdAt={reply.createdAt} locale={i18n.language} />
                    <CommentBody body={reply.body} names={memberNames} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
                    {mayDelete(reply) && <div className="pv-comment-card__actions">{deleteControl(reply)}</div>}
                    {confirmBox(reply, 0)}
                  </div>
                ))}
                <div className="pv-comment-card__actions">
                  {state === "open" && canWrite && (
                    <>
                      <Button size="sm" onClick={() => onApplySuggestion(root)}>
                        {t("workspaceSecurity.suggestionApply")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDeclineSuggestion(root)}>
                        {t("workspaceSecurity.suggestionDecline")}
                      </Button>
                    </>
                  )}
                  {state === "applied" && (
                    <span className="pv-comment-card__state">{t("workspaceSecurity.suggestionApplied")}</span>
                  )}
                  {state === "declined" && (
                    <span className="pv-comment-card__state">{t("workspaceSecurity.suggestionDeclined")}</span>
                  )}
                  {canComment && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setReplyTo(root.commentId)}>
                        {t("workspaceSecurity.commentReply")}
                      </Button>
                      {/* A remark and a proposal alike can turn out to be
                          work, so this sits outside the `!state` branch. */}
                      {!root.resolvedAt && (
                        <Button size="sm" variant="ghost" onClick={() => onPromoteToTask(root)}>
                          <ListChecks size={ICON.meta} aria-hidden="true" />
                          {t("workspaceSecurity.commentToTask")}
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
            ariaLabel={t("workspaceSecurity.comments")}
            value={kind}
            onChange={(next) => { kindTouched.current = true; setKind(next); }}
            options={[
              { value: "comments", label: `${t("workspaceSecurity.comments")} · ${openByKind.comments}` },
              { value: "suggestions", label: `${t("workspaceSecurity.suggestions")} · ${openByKind.suggestions}` },
            ]}
          />
          <span className="pv-comment-column__count" hidden>{t("workspaceSecurity.commentOpenCount", { n: openCount })}</span>
          <span className="pv-comment-column__spacer" />
          {threads.length > 0 && (
            <Segmented
              size="sm"
              ariaLabel={t("workspaceSecurity.comments")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: t("workspaceSecurity.commentFilterOpen") },
                { value: "all", label: t("workspaceSecurity.commentOverviewAll") },
              ]}
            />
          )}
          {onToggleInlineSuggestions && (
            <IconButton label={t("workspaceSecurity.suggestionInline")} active={inlineSuggestions === true} onClick={onToggleInlineSuggestions}>
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
        {kind === "comments" && grouped.threads.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
        <div className="pv-comment-list">
          {kind === "suggestions" && grouped.rounds.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.suggestionsNone")}</p>}
          {kind === "suggestions" && grouped.rounds.map((round) => (
            <section key={round.batchId} className="pv-comment-round">
              {!round.batchId.startsWith("single:") && (
                <div className="pv-comment-round__head">
                  <CommentCardHead name={nameOf(round.authorMemberId)} memberId={round.authorMemberId} createdAt={round.createdAt} locale={i18n.language} />
                  <p className="pv-comment-round__meta">{round.note ? <em>„{round.note}“ · </em> : null}{t("workspaceSecurity.suggestRoundCount", { n: round.blocks.length })}</p>
                  {round.open > 1 && (
                    <div className="pv-comment-card__actions">
                      {canWrite && onApplyRound && <Button size="sm" onClick={() => onApplyRound(round.batchId)}>{t("workspaceSecurity.suggestApplyAll")}</Button>}
                      {canComment && onDeclineRound && <Button size="sm" variant="ghost" onClick={() => onDeclineRound(round.batchId)}>{t("workspaceSecurity.suggestDeclineAll")}</Button>}
                    </div>
                  )}
                </div>
              )}
              <div className="pv-comment-round__blocks">{round.blocks.map(renderThread)}</div>
            </section>
          ))}
          {kind === "comments" && grouped.threads.map(renderThread)}
        </div>
        {canComment && (
          <div className="pv-comment-compose">
            <MentionTextArea
              aria-label={t(replyTo ? "workspaceSecurity.commentReply" : "workspaceSecurity.addComment")}
              names={memberNames}
              onChange={setBody}
              pickerLabel={t("workspaceSecurity.commentMentionPicker")}
              placeholder={t(replyTo ? "workspaceSecurity.commentReplyPlaceholder" : "workspaceSecurity.addComment")}
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
