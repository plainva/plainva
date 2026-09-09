import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommentOperation } from "@plainva/core";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { SuggestionDiff } from "./SuggestionDiff";

/** The same recovery states in the desktop column and mobile sheet. */
export function CommentOperationStatus({ operations, failed, onRetry, onRefresh, currentText }: {
  operations: readonly CommentOperation[];
  failed: boolean;
  onRetry(operation: CommentOperation): Promise<void>;
  onRefresh(): void;
  currentText: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  return <>
    {failed && <Banner kind="error" actions={<Button size="sm" variant="ghost" onClick={onRefresh}>{t("comments.operationRetry")}</Button>}>{t("comments.operationReadFailed")}</Banner>}
    {operations.map((operation) => <div key={operation.operationId} className="pv-comment-card" data-testid="comment-operation-status" data-phase={operation.phase}>
      <Banner kind={operation.phase === "needs-review" ? "warning" : "info"} actions={
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => {
          setBusy(operation.operationId);
          void onRetry(operation).finally(() => setBusy(null));
        }}>{t("comments.operationRetry")}</Button>
      }>{t(operation.phase === "needs-review" ? "comments.operationNeedsReview" : operation.receipt ? "comments.operationMarkersPending" : operation.text ? "comments.operationTextPending" : "comments.operationCommentsPending")}</Banner>
      {operation.text && <details>
        <summary>{t("comments.operationCompare")}</summary>
        <p>{t("comments.operationPlanned")}</p>
        <SuggestionDiff quote={operation.text.before} replacement={operation.text.intended} deletesLabel={t("comments.suggestionDeletes")} />
        <p>{t("comments.operationCurrent")}</p>
        <pre className="pv-comment-card__quote">{currentText}</pre>
        {operation.phase === "needs-review" && <p>{t("comments.operationReviewHelp")}</p>}
      </details>}
    </div>)}
  </>;
}
