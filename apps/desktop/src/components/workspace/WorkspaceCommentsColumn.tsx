import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Check, CornerDownRight, MessageSquare, Replace, X } from "lucide-react";
import type { WorkspaceCommentAnchorResolution, WorkspaceCommentRecord } from "@plainva/core";
import { Button, ICON, MentionTextArea, TextArea, mentionsMember, parseCommentMentions } from "@plainva/ui";

/** A top-level comment with the replies hanging off it, in posting order. */
interface CommentThread {
  root: WorkspaceCommentRecord;
  replies: WorkspaceCommentRecord[];
  /** Somebody wrote `@` and your name in here, and the thread is still open. */
  addressed: boolean;
}

export interface WorkspaceCommentsColumnProps {
  comments: readonly WorkspaceCommentRecord[];
  /** memberId -> display name from the workspace policy. */
  memberNames: ReadonlyMap<string, string>;
  /**
   * Who this device is - the member id in a workspace, the device id in a plain
   * vault. Null while that is still being read, and then nothing counts as
   * addressed: claiming every mention is yours would be worse than claiming none.
   */
  selfMemberId: string | null;
  /** commentId -> where its anchor currently lands; absent means note-wide. */
  resolutions: ReadonlyMap<string, WorkspaceCommentAnchorResolution>;
  canComment: boolean;
  /**
   * Whether this member may write the note - which is what accepting a
   * suggestion does. A commenter without write access can propose and decline,
   * but the swap itself is a write and stays out of reach.
   */
  canWrite: boolean;
  /** The card whose range is emphasised in the text, or null. */
  activeCommentId: string | null;
  /** What a new comment would attach to, or null for the note as a whole. */
  selectionQuote: string | null;
  onSelect(commentId: string | null): void;
  /**
   * Posts a comment; `parentCommentId` null starts a new thread. A non-null
   * `suggestion` proposes a replacement for the current selection - it changes
   * nothing in the note, it only describes what could stand there instead.
   */
  onSubmit(body: string, parentCommentId: string | null, suggestion: { replacement: string } | null): Promise<void>;
  onResolve(commentId: string): void;
  /** Writes the proposed text into the note and closes the thread. */
  onApplySuggestion(comment: WorkspaceCommentRecord): void;
  /** Closes the thread without touching the note. */
  onDeclineSuggestion(comment: WorkspaceCommentRecord): void;
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
  comments, memberNames, selfMemberId, resolutions, canComment, canWrite, activeCommentId, selectionQuote,
  onSelect, onSubmit, onResolve, onApplySuggestion, onDeclineSuggestion,
}: WorkspaceCommentsColumnProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  // The replacement starts as the selected text: a suggestion is almost always
  // an edit of the passage, not a blank page.
  const [replacement, setReplacement] = useState<string | null>(null);
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
    const list = roots.map<CommentThread>((root) => {
      const replies = byParent.get(root.commentId) ?? [];
      return {
        root,
        replies,
        // A resolved thread is deliberately never "addressed": it needs no
        // attention any more, and floating it would push the open ones down
        // for nothing.
        addressed:
          !root.resolvedAt &&
          mentionsMember([root.body, ...replies.map((reply) => reply.body)], selfMemberId, memberNames),
      };
    });
    // A thread that names you comes first - that is what a mention is FOR. The
    // badge on the card says why it jumped, so the order never looks arbitrary.
    if (!list.some((thread) => thread.addressed)) return list;
    return [...list.filter((thread) => thread.addressed), ...list.filter((thread) => !thread.addressed)];
  }, [comments, memberNames, selfMemberId]);

  const authorOf = (comment: WorkspaceCommentRecord): string =>
    memberNames.get(comment.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor");

  const post = async (body: string, parent: string | null, suggestion: { replacement: string } | null = null) => {
    setBusy(true);
    try {
      await onSubmit(body, parent, suggestion);
      if (parent === null) { setDraft(""); setReplacement(null); }
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

  /**
   * What became of a suggestion. Accepting and declining both resolve the
   * thread, so the plain "resolved" word would say the same in both cases -
   * and hide the one thing a reader wants to know.
   */
  const suggestionState = (comment: WorkspaceCommentRecord) => {
    if (!comment.suggestion) return null;
    if (comment.suggestion.appliedAt) return <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.suggestionApplied")}</span>;
    if (comment.suggestion.declinedAt) return <span className="pv-comment-card__state"><X size={ICON.meta} /> {t("workspaceSecurity.suggestionDeclined")}</span>;
    // Resolved without an outcome: a device that predates suggestions closed
    // the thread. Saying "resolved" is the honest answer, not a guess.
    if (comment.resolvedAt) return <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.resolved")}</span>;
    return null;
  };

  return (
    <aside className="pv-comment-column" aria-label={t("workspaceSecurity.comments")}>
      {threads.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
      {threads.map(({ root, replies, addressed }) => (
        <div
          key={root.commentId}
          className={`pv-comment-card${root.resolvedAt ? " is-resolved" : ""}${activeCommentId === root.commentId ? " is-active" : ""}`}
          onClick={() => onSelect(activeCommentId === root.commentId ? null : root.commentId)}
        >
          {root.anchor && <blockquote className={root.suggestion ? "pv-comment-card__quote pv-comment-card__quote--replaced" : "pv-comment-card__quote"}>{root.anchor.quote}</blockquote>}
          {root.suggestion && (
            <p className="pv-comment-card__replacement">
              <Replace size={ICON.meta} />{" "}
              {root.suggestion.replacement.length > 0
                ? root.suggestion.replacement
                : <em>{t("workspaceSecurity.suggestionDeletes")}</em>}
            </p>
          )}
          {addressed && (
            <span className="pv-comment-card__state">
              <AtSign size={ICON.meta} /> {t("workspaceSecurity.commentMentionsYou")}
            </span>
          )}
          {anchorNote(root)}
          <CommentBody comment={root} author={authorOf(root)} names={memberNames} />
          {replies.map((reply) => (
            <div key={reply.commentId} className="pv-comment-card__reply">
              <CommentBody comment={reply} author={authorOf(reply)} names={memberNames} />
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
            {suggestionState(root)}
            {root.resolvedAt
              ? !root.suggestion && <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.resolved")}</span>
              : root.suggestion
                ? (
                  <>
                    {/* Accepting is an ordinary write, so it needs write access;
                        declining only closes the thread. */}
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onApplySuggestion(root); }}>
                        <Check size={ICON.meta} /> {t("workspaceSecurity.suggestionApply")}
                      </Button>
                    )}
                    {canComment && (
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onDeclineSuggestion(root); }}>
                        <X size={ICON.meta} /> {t("workspaceSecurity.suggestionDecline")}
                      </Button>
                    )}
                  </>
                )
                : canComment && (
                  <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onResolve(root.commentId); }}>
                    {t("workspaceSecurity.resolve")}
                  </Button>
                )}
          </div>
          {replyTo === root.commentId && (
            <div className="pv-comment-compose" onClick={(event) => event.stopPropagation()}>
              <MentionTextArea
                value={replyDraft}
                rows={2}
                names={memberNames}
                pickerLabel={t("workspaceSecurity.commentMentionPicker")}
                placeholder={t("workspaceSecurity.commentReplyPlaceholder")}
                onChange={setReplyDraft}
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
          {/* Deliberately a plain field: this text becomes the NOTE. An `@Name`
              picked in here would be written into the document, where it means
              nothing and nobody would ever be notified. */}
          {replacement !== null && (
            <TextArea
              value={replacement}
              rows={2}
              className="pv-comment-compose__replacement"
              placeholder={t("workspaceSecurity.suggestionPlaceholder")}
              onChange={(event) => setReplacement(event.target.value)}
            />
          )}
          <MentionTextArea
            value={draft}
            rows={3}
            names={memberNames}
            pickerLabel={t("workspaceSecurity.commentMentionPicker")}
            placeholder={replacement !== null ? t("workspaceSecurity.suggestionWhyPlaceholder") : t("workspaceSecurity.addComment")}
            onChange={setDraft}
          />
          <div className="pv-comment-compose__actions">
            {/* A proposal has to name the passage it replaces - without a
                selection there is nothing to propose against, so the switch
                only appears once something is selected. */}
            {selectionQuote !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplacement(replacement === null ? selectionQuote : null)}
              >
                <Replace size={ICON.meta} /> {replacement === null ? t("workspaceSecurity.suggestionStart") : t("workspaceSecurity.suggestionCancel")}
              </Button>
            )}
            {/* A suggestion may carry no sentence at all: the replacement text
                IS the content. A plain remark still needs words. */}
            <Button size="sm" disabled={busy || (replacement === null && !draft.trim())} onClick={() => void post(draft.trim(), null, replacement === null ? null : { replacement })}>
              <MessageSquare size={ICON.meta} /> {replacement === null ? t("workspaceSecurity.send") : t("workspaceSecurity.suggestionSend")}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * One comment, with `@Name` lifted out of the text.
 *
 * The mentions are DERIVED here, never stored: the body is the single truth, so
 * a renamed member changes what this shows and nothing has to be migrated.
 */
function CommentBody({
  comment,
  author,
  names,
}: {
  comment: WorkspaceCommentRecord;
  author: string;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <>
      <small className="pv-comment-card__meta" data-tip={comment.authorMemberId}>
        {author} · {new Date(comment.createdAt).toLocaleString()}
      </small>
      <span className="pv-comment-card__body">
        {parseCommentMentions(comment.body, names).map((segment, index) =>
          segment.kind === "mention" ? (
            <span key={index} className="pv-comment-card__mention" data-tip={segment.memberId}>
              {segment.text}
            </span>
          ) : (
            <Fragment key={index}>{segment.text}</Fragment>
          ),
        )}
      </span>
    </>
  );
}
