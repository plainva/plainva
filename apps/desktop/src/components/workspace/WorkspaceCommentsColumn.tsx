import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CornerDownRight, MessageSquare } from "lucide-react";
import type { WorkspaceCommentAnchorResolution, WorkspaceCommentRecord } from "@plainva/core";
import { Button, ICON, TextArea } from "@plainva/ui";

/** A top-level comment with the replies hanging off it, in posting order. */
interface CommentThread {
  root: WorkspaceCommentRecord;
  replies: WorkspaceCommentRecord[];
}

export interface WorkspaceCommentsColumnProps {
  comments: readonly WorkspaceCommentRecord[];
  /** memberId -> display name from the workspace policy. */
  memberNames: ReadonlyMap<string, string>;
  /** commentId -> where its anchor currently lands; absent means note-wide. */
  resolutions: ReadonlyMap<string, WorkspaceCommentAnchorResolution>;
  canComment: boolean;
  /** The card whose range is emphasised in the text, or null. */
  activeCommentId: string | null;
  /** What a new comment would attach to, or null for the note as a whole. */
  selectionQuote: string | null;
  onSelect(commentId: string | null): void;
  /** Posts a comment; `parentCommentId` null starts a new thread. */
  onSubmit(body: string, parentCommentId: string | null): Promise<void>;
  onResolve(commentId: string): void;
}

/**
 * The comment column beside the note.
 *
 * It replaces a collapsed list that showed the first eight characters of a
 * member id, carried no threads, and printed the literal English word
 * "Resolved" in every language. A name here is a CLAIM the workspace policy
 * carries, not a verified identity - the technical id stays reachable on the
 * card so nobody has to take the name on faith. A revoked member keeps the name
 * on old comments; anything else would falsify the record.
 */
export function WorkspaceCommentsColumn({
  comments, memberNames, resolutions, canComment, activeCommentId, selectionQuote,
  onSelect, onSubmit, onResolve,
}: WorkspaceCommentsColumnProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const threads = useMemo<CommentThread[]>(() => {
    const known = new Set(comments.map((entry) => entry.commentId));
    const byParent = new Map<string, WorkspaceCommentRecord[]>();
    for (const entry of comments) {
      if (!entry.parentCommentId) continue;
      const list = byParent.get(entry.parentCommentId);
      if (list) list.push(entry);
      else byParent.set(entry.parentCommentId, [entry]);
    }
    // A reply whose root has not arrived yet (partial sync) would otherwise
    // vanish; showing it as its own thread keeps every comment reachable.
    const roots = comments.filter((entry) => entry.parentCommentId === null || !known.has(entry.parentCommentId));
    return roots.map((root) => ({ root, replies: byParent.get(root.commentId) ?? [] }));
  }, [comments]);

  const authorOf = (comment: WorkspaceCommentRecord): string =>
    memberNames.get(comment.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor");

  const post = async (body: string, parent: string | null) => {
    setBusy(true);
    try {
      await onSubmit(body, parent);
      if (parent === null) setDraft("");
      else { setReplyDraft(""); setReplyTo(null); }
    } finally {
      setBusy(false);
    }
  };

  const anchorNote = (comment: WorkspaceCommentRecord) => {
    if (!comment.anchor) return null;
    const status = resolutions.get(comment.commentId)?.status;
    if (status === "orphan") return <span className="pv-comment-card__state">{t("workspaceSecurity.commentAnchorOrphan")}</span>;
    if (status === "moved") return <span className="pv-comment-card__state">{t("workspaceSecurity.commentAnchorMoved")}</span>;
    return null;
  };

  return (
    <aside className="pv-comment-column" aria-label={t("workspaceSecurity.comments")}>
      {threads.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
      {threads.map(({ root, replies }) => (
        <div
          key={root.commentId}
          className={`pv-comment-card${root.resolvedAt ? " is-resolved" : ""}${activeCommentId === root.commentId ? " is-active" : ""}`}
          onClick={() => onSelect(activeCommentId === root.commentId ? null : root.commentId)}
        >
          {root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
          {anchorNote(root)}
          <CommentBody comment={root} author={authorOf(root)} />
          {replies.map((reply) => (
            <div key={reply.commentId} className="pv-comment-card__reply">
              <CommentBody comment={reply} author={authorOf(reply)} />
            </div>
          ))}
          <div className="pv-comment-card__actions">
            {canComment && !root.resolvedAt && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => { event.stopPropagation(); setReplyTo(replyTo === root.commentId ? null : root.commentId); setReplyDraft(""); }}
              >
                <CornerDownRight size={ICON.meta} /> {t("workspaceSecurity.commentReply")}
              </Button>
            )}
            {root.resolvedAt
              ? <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.resolved")}</span>
              : canComment && (
                <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onResolve(root.commentId); }}>
                  {t("workspaceSecurity.resolve")}
                </Button>
              )}
          </div>
          {replyTo === root.commentId && (
            <div className="pv-comment-compose" onClick={(event) => event.stopPropagation()}>
              <TextArea
                value={replyDraft}
                rows={2}
                placeholder={t("workspaceSecurity.commentReplyPlaceholder")}
                onChange={(event) => setReplyDraft(event.target.value)}
              />
              <Button size="sm" disabled={busy || !replyDraft.trim()} onClick={() => void post(replyDraft.trim(), root.commentId)}>
                {t("workspaceSecurity.send")}
              </Button>
            </div>
          )}
        </div>
      ))}
      {canComment && (
        <div className="pv-comment-compose pv-comment-compose--new">
          <p className="pv-comment-compose__target">
            {selectionQuote
              ? t("workspaceSecurity.commentOnSelection", { quote: selectionQuote })
              : t("workspaceSecurity.commentOnNote")}
          </p>
          <TextArea
            value={draft}
            rows={3}
            placeholder={t("workspaceSecurity.addComment")}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void post(draft.trim(), null)}>
            <MessageSquare size={ICON.meta} /> {t("workspaceSecurity.send")}
          </Button>
        </div>
      )}
    </aside>
  );
}

function CommentBody({ comment, author }: { comment: WorkspaceCommentRecord; author: string }) {
  return (
    <>
      <small className="pv-comment-card__meta" data-tip={comment.authorMemberId}>
        {author} · {new Date(comment.createdAt).toLocaleString()}
      </small>
      <span className="pv-comment-card__body">{comment.body}</span>
    </>
  );
}
