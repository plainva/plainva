import { useTranslation } from "react-i18next";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";

/** The workspace can be open while an older history still needs its sync key. */
export function CommentLegacyLock({ onUnlock }: { onUnlock(): void }) {
  const { t } = useTranslation();
  return <Banner kind="warning" actions={<Button variant="ghost" size="sm" onClick={onUnlock}>{t("comments.commentsUnlock")}</Button>}>
    {t("comments.legacyHistoryLocked")}
  </Banner>;
}
