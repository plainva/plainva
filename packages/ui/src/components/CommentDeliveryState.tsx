import type { WorkspaceCommentRecord } from "@plainva/core";
import { AlertCircle, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { ICON } from "../lib/iconSizes";

/** Both shells show the same durable outgoing state and recovery actions. */
export function CommentDeliveryState({ comment, own, onRetry, onDiscard }: {
  comment: WorkspaceCommentRecord;
  own: boolean;
  onRetry?(outboxId: string): void;
  onDiscard?(outboxId: string): void;
}) {
  const { t } = useTranslation();
  const pending = comment.pending;
  if (!pending) return null;
  if (pending.lastError === null) return <span className="pv-comment-card__state" data-state="sending"><Send size={ICON.meta} /> {t("comments.commentSending")}</span>;
  return <>
    <span className="pv-comment-card__state" data-state="error"><AlertCircle size={ICON.meta} /> {t("comments.commentSendFailed", { reason: pending.lastError })}</span>
    {own && onRetry && <Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); onRetry(pending.outboxId); }}>{t("comments.commentSendRetry")}</Button>}
    {own && onDiscard && !comment.legacyOrigin && <Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); onDiscard(pending.outboxId); }}>{t("comments.commentSendDiscard")}</Button>}
  </>;
}
