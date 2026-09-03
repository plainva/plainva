import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Bell, BellOff, Check, ListChecks, MessageSquare } from "lucide-react";
import { anchorDisplayLabel, Button, buildCommentThreads, CommentCardHead, ICON, IconButton, isCommentThreadOpen, MentionTextArea, parseCommentMentions, Segmented, toAnchorDisplayHint } from "@plainva/ui";
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
}

/**
 * A comment body with `@Name` lifted out of the text.
 *
 * Derived on every render, never stored: the body is the single truth, so a
 * renamed member changes what this shows and nothing has to be migrated.
 */
function CommentBody({ body, names }: { body: string; names: ReadonlyMap<string, string> }) {
  return (
    <p className="pv-comment-card__body">
      {parseCommentMentions(body, names).map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={index} className="pv-comment-card__mention">
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </p>
  );
}

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
  const nameOf = (id: string) => memberNames.get(id) ?? t("workspaceSecurity.commentUnknownAuthor");

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

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <div className="pv-comment-column__head">
          <p className="m-sheet-title">
            {t("workspaceSecurity.comments")}
            <span className="pv-comment-column__count">{t("workspaceSecurity.commentOpenCount", { n: openCount })}</span>
          </p>
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
        {threads.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
        <div className="pv-comment-list">
          {shownThreads.map(({ root, replies, addressed }) => {
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
                {root.body && <CommentBody body={root.body} names={memberNames} />}
                {state && (
                  <p className="pv-comment-card__replacement">
                    <span className="pv-comment-card__quote pv-comment-card__quote--replaced">{root.anchor?.quote}</span>
                    {" → "}
                    <span>{root.suggestion?.replacement}</span>
                  </p>
                )}
                {replies.map((reply) => (
                  <div key={reply.commentId} className="pv-comment-card__reply">
                    <CommentCardHead name={nameOf(reply.authorMemberId)} memberId={reply.authorMemberId} createdAt={reply.createdAt} locale={i18n.language} />
                    <CommentBody body={reply.body} names={memberNames} />
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
                </div>
              </div>
            );
          })}
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
