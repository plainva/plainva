import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Check, ListChecks, MessageSquare } from "lucide-react";
import { Button, buildCommentThreads, ICON, MentionTextArea, parseCommentMentions } from "@plainva/ui";
import type { WorkspaceCommentRecord } from "@plainva/core";
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
  onSubmit,
  onResolve,
  onApplySuggestion,
  onDeclineSuggestion,
  onPromoteToTask,
  onRevealAnchor,
  onClose,
}: CommentsSheetProps) {
  const { t } = useTranslation();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const threads = useMemo(
    () => buildCommentThreads(comments, selfMemberId, memberNames),
    [comments, memberNames, selfMemberId],
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

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("workspaceSecurity.comments")}</p>
        {threads.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
        <div className="pv-comment-list">
          {threads.map(({ root, replies, addressed }) => {
            const state = suggestionState(root);
            return (
              <div key={root.commentId} className="pv-comment-card">
                <p className="pv-comment-card__meta">{nameOf(root.authorMemberId)}</p>
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
                    {root.anchor.quote}
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
                    <p className="pv-comment-card__meta">{nameOf(reply.authorMemberId)}</p>
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
