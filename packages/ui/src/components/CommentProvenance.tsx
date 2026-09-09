import type { WorkspaceCommentRecord } from "@plainva/core";
import { useTranslation } from "react-i18next";

/** The import signature certifies receipt, not the old author's identity. */
export function CommentProvenance({ comment }: { comment: WorkspaceCommentRecord }) {
  const { t } = useTranslation();
  if (!comment.legacyOrigin) return null;
  return <>
    <span className="pv-comment-card__state" data-tip={t("comments.legacyOriginDetail")} aria-label={t("comments.legacyOriginDetail")}>
      {t("comments.legacyOrigin")}
    </span>
    {comment.legacyPending && <p className="pv-comment-card__state" data-state="error">{t("comments.legacyImportPending")}</p>}
  </>;
}
