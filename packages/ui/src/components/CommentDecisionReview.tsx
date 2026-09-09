import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceCommentRecord } from "@plainva/core";
import { Modal } from "./ui/Modal";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { SuggestionDiff } from "./SuggestionDiff";

export function CommentDecisionConflict({ onReview }: { onReview?: () => void }) {
  const { t } = useTranslation();
  return <Banner kind="warning" actions={onReview && <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); onReview(); }}>{t("comments.decisionReview")}</Button>}>
    {t("comments.decisionConflict")}
  </Banner>;
}

/** Explicitly reviews the current text; neither button reapplies the old proposal. */
export function CommentDecisionReview({ comment, text, onDecision, onClose }: {
  comment: WorkspaceCommentRecord;
  text: string;
  onDecision(outcome: "applied" | "declined"): Promise<void>;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const decide = (outcome: "applied" | "declined") => {
    setBusy(true);
    void onDecision(outcome).finally(() => setBusy(false));
  };
  return <Modal title={t("comments.decisionReview")} onClose={onClose} size="lg" testId="comment-decision-review" footer={<>
    <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
    <Button variant="ghost" disabled={busy} onClick={() => decide("declined")}>{t("comments.decisionConfirmDeclined")}</Button>
    <Button disabled={busy} onClick={() => decide("applied")}>{t("comments.decisionConfirmApplied")}</Button>
  </>}>
    <Banner kind="warning">{t("comments.decisionConflict")}</Banner>
    <p>{t("comments.operationPlanned")}</p>
    <SuggestionDiff quote={comment.anchor?.quote ?? ""} replacement={comment.suggestion?.replacement ?? ""} deletesLabel={t("comments.suggestionDeletes")} />
    <p>{t("comments.operationCurrent")}</p>
    <pre className="pv-comment-card__quote">{text}</pre>
    <p>{t("comments.decisionReviewHelp")}</p>
  </Modal>;
}
