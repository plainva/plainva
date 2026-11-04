import { LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { ICON } from "../lib/iconSizes";

/**
 * The assistant is writing its reply in this thread (plan KI-Harness P3-6).
 *
 * It stands where the reply will stand, under the assistant's mark, from the
 * moment the remark that addressed it was sent — while the send overview waits
 * for an answer as much as while the model writes. Both shells show the same
 * row; stopping it sends nothing more and leaves the thread as it is.
 */
export function CommentAiPending({ label, onStop }: { label: string; onStop(): void }) {
  const { t } = useTranslation();
  return (
    <div className="pv-comment-card__reply" role="status" data-testid="comment-ai-pending" onClick={(event) => event.stopPropagation()}>
      <div className="pv-comment-card__who">
        <span className="pv-comment-card__avatar" data-ai="" aria-hidden="true"><Sparkles size={ICON.meta} /></span>
        <span className="pv-comment-card__name">{label}</span>
      </div>
      <span className="pv-comment-card__state"><LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" /> {t("ai.thread.replying")}</span>
      <div className="pv-comment-card__actions">
        <Button variant="ghost" size="sm" onClick={onStop} data-testid="comment-ai-stop">{t("ai.stop")}</Button>
      </div>
    </div>
  );
}
