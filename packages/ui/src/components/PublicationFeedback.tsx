import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { commentAuthorKey, commentCreatedAt } from "@plainva/core";
import { isLegacyTableQuote, type PublicationComment, type WorkspaceCommentRecord } from "@plainva/core/workspace";
import { buildCommentThreads } from "../lib/commentThreads";
import { authorInitials } from "../lib/commentAuthor";
import { ICON } from "../lib/iconSizes";
import { Button } from "./ui/Button";
import { CommentCardHead } from "./CommentCardHead";
import { CommentBody } from "./CommentBody";
import { CommentProvenance } from "./CommentProvenance";
import { CommentDecisionConflict } from "./CommentDecisionReview";
import { SuggestionDiff } from "./SuggestionDiff";

export type PublicationFeedbackEntry = PublicationComment & { publicationName: string };
export interface PublicationFeedbackProps {
  entries: readonly PublicationFeedbackEntry[];
  kind?: "comments" | "suggestions";
  canWrite: boolean;
  canComment: boolean;
  onApplySuggestion(comment: WorkspaceCommentRecord): void;
  onDeclineSuggestion(comment: WorkspaceCommentRecord): void;
  onReviewDecision?(comment: WorkspaceCommentRecord): void;
  onOpenNote?(path: string): void;
  onOpenUrl?(url: string): void;
}

/** Same source-note review in the desktop column and the mobile comment sheet. */
export function PublicationFeedback({ entries, kind, canWrite, canComment, onApplySuggestion, onDeclineSuggestion,
  onReviewDecision, onOpenNote, onOpenUrl }: PublicationFeedbackProps) {
  const { t, i18n } = useTranslation();
  const groups = useMemo(() => {
    const grouped = new Map<string, PublicationFeedbackEntry[]>();
    for (const entry of entries) {
      const group = grouped.get(entry.publicationId) ?? [];
      group.push(entry); grouped.set(entry.publicationId, group);
    }
    return [...grouped].map(([id, items]) => {
      const names = new Map(items.filter(item => item.authorDisplayName).map(item => [commentAuthorKey(item.comment), item.authorDisplayName!]));
      return { id, name: items[0].publicationName, names, byId: new Map(items.map(item => [item.comment.commentId, item])),
        threads: buildCommentThreads(items.map(item => item.comment), null, names) };
    });
  }, [entries]);
  return <>{groups.map(group => {
    const threads = group.threads.filter(thread => !kind || (kind === "suggestions") === !!thread.root.suggestion);
    if (!threads.length) return null;
    const body = (comment: WorkspaceCommentRecord) => {
      const author = group.names.get(commentAuthorKey(comment)) ?? t("comments.commentUnknownAuthor");
      return <><CommentCardHead name={author} initials={authorInitials(author)} memberId={commentAuthorKey(comment)} createdAt={commentCreatedAt(comment)} locale={i18n.language} />
        <CommentProvenance comment={comment} /><CommentBody body={comment.body} names={group.names} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} /></>;
    };
    return <section key={group.id} className="pv-comment-returns" aria-label={t("workspaceSecurity.publicationCommentsFrom", { name: group.name })}>
      <h4 className="pv-comment-returns__heading"><Share2 size={ICON.meta} /> {t("workspaceSecurity.publicationCommentsFrom", { name: group.name })}</h4>
      {threads.map(({ root, replies }) => {
        const entry = group.byId.get(root.commentId)!;
        const conflict = root.suggestionDecision?.status === "conflict";
        return <div key={root.commentId} className="pv-comment-card pv-comment-card--incoming">
          {root.suggestion ? <SuggestionDiff quote={root.anchor?.quote ?? ""} replacement={root.suggestion.replacement} deletesLabel={t("comments.suggestionDeletes")} />
            : root.anchor && !isLegacyTableQuote(root.anchor) && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
          {body(root)}
          {replies.map(reply => <div key={reply.commentId} className="pv-comment-card__reply">{body(reply)}</div>)}
          {!entry.authorActive && <span className="pv-comment-card__state">{t("workspaceSecurity.publicationCommentAuthorGone")}</span>}
          {root.suggestion && !entry.suggestionApplicable && <span className="pv-comment-card__state">{t("workspaceSecurity.publicationSuggestionStale")}</span>}
          {root.suggestion && <>
            <p className="pv-comment-card__state">{t("comments.publicationReviewLocal")}</p>
            {conflict ? <CommentDecisionConflict onReview={canComment && onReviewDecision ? () => onReviewDecision(root) : undefined} />
              : root.suggestion.appliedAt ? <span className="pv-comment-card__state">{t("comments.suggestionApplied")}</span>
                : root.suggestion.declinedAt ? <span className="pv-comment-card__state">{t("comments.suggestionDeclined")}</span>
                  : !root.resolvedAt && <div className="pv-comment-compose__actions">
                    {canWrite && canComment && entry.suggestionApplicable && <Button size="sm" onClick={() => onApplySuggestion(root)}>{t("comments.suggestionApply")}</Button>}
                    {canComment && <Button size="sm" variant="ghost" onClick={() => onDeclineSuggestion(root)}>{t("comments.suggestionDecline")}</Button>}
                  </div>}
          </>}
        </div>;
      })}
    </section>;
  })}</>;
}
