import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, MessageSquare } from "lucide-react";
import { Button, ICON, TextArea } from "@plainva/ui";
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
  canComment: boolean;
  canWrite: boolean;
  onSubmit(body: string, parentCommentId: string | null): Promise<void>;
  onResolve(commentId: string): void;
  onApplySuggestion(comment: WorkspaceCommentRecord): void;
  onDeclineSuggestion(comment: WorkspaceCommentRecord): void;
  /** Tapping an anchored quote reveals the passage in the note (D6). */
  onRevealAnchor(comment: WorkspaceCommentRecord): void;
  onClose(): void;
}

interface Thread {
  root: WorkspaceCommentRecord;
  replies: WorkspaceCommentRecord[];
}

/**
 * A reply whose root has not arrived yet (partial sync) becomes its own thread
 * rather than disappearing: every comment must stay reachable.
 */
function buildThreads(comments: readonly WorkspaceCommentRecord[]): Thread[] {
  const byId = new Map(comments.map((c) => [c.commentId, c]));
  const threads = new Map<string, Thread>();
  for (const comment of comments) {
    if (!comment.parentCommentId || !byId.has(comment.parentCommentId)) {
      threads.set(comment.commentId, { root: comment, replies: [] });
    }
  }
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    threads.get(comment.parentCommentId)?.replies.push(comment);
  }
  return [...threads.values()];
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
  canComment,
  canWrite,
  onSubmit,
  onResolve,
  onApplySuggestion,
  onDeclineSuggestion,
  onRevealAnchor,
  onClose,
}: CommentsSheetProps) {
  const { t } = useTranslation();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const threads = useMemo(() => buildThreads(comments), [comments]);
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
          {threads.map(({ root, replies }) => {
            const state = suggestionState(root);
            return (
              <div key={root.commentId} className="pv-comment-card">
                <p className="pv-comment-card__meta">{nameOf(root.authorMemberId)}</p>
                {root.anchor && (
                  <button
                    type="button"
                    className="pv-comment-card__quote pv-comment-card__quote--tap"
                    onClick={() => onRevealAnchor(root)}
                  >
                    {root.anchor.quote}
                  </button>
                )}
                {root.body && <p className="pv-comment-card__body">{root.body}</p>}
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
                    <p className="pv-comment-card__body">{reply.body}</p>
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
            <TextArea
              aria-label={t(replyTo ? "workspaceSecurity.commentReply" : "workspaceSecurity.addComment")}
              onChange={(e) => setBody(e.target.value)}
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
