import { useTranslation } from "react-i18next";
import type { TemplateKeyCleanupState } from "../hooks/useTemplateKeyCleanup";
import { toast } from "../services/toastStore";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { GroupCard, Row, RowList } from "./ui/GroupedRows";
import { cx } from "./ui/cx";

/**
 * "Keys taken over from templates" in the tasks view (open-items plan 3.136
 * no. 1, decision E2). ONE surface for both shells, the twin of the notice for
 * task-note names: the count and why it matters, **Remove keys …** behind a
 * confirmation and **Hide**, and beneath it the notes — each with a box, all
 * picked to begin with, and what it carries. A note hidden from the tasks on
 * purpose is left as it is by taking its tick away. The shells differ only in
 * the confirmation dialog they hand in.
 */
export interface TemplateKeysNoticeProps {
  state: TemplateKeyCleanupState;
  /** The shell's confirmation dialog. */
  confirm(opts: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
  className?: string;
}

export function TemplateKeysNotice({ state, confirm, className }: TemplateKeysNoticeProps) {
  const { t } = useTranslation();
  if (!state.visible) return null;
  const count = state.picked.size;

  const remove = async () => {
    const ok = await confirm({
      title: t("tasks.templateKeysConfirmTitle"),
      message: t("tasks.templateKeysConfirmMsg", { count }),
      confirmLabel: t("tasks.templateKeysConfirm"),
    });
    if (!ok) return;
    const result = await state.remove();
    if (!result) return;
    if (result.removed > 0) toast.success(t("tasks.templateKeysDone", { count: result.removed }));
    if (result.failed > 0) toast.error(t("database.bulkSetPartial", { done: result.removed, failed: result.failed }));
  };

  return (
    <div className={cx("pv-names-notice", className)} data-testid="template-keys-notice">
      <Banner
        kind="info"
        rounded
        actions={
          <>
            <Button variant="primary" size="sm" disabled={state.busy || count === 0} onClick={() => void remove()} data-testid="template-keys-remove">
              {t("tasks.templateKeysRemove")}
            </Button>
            <Button variant="ghost" size="sm" disabled={state.busy} onClick={state.hide} data-testid="template-keys-hide">
              {t("tasks.legacyNamesHide")}
            </Button>
          </>
        }
      >
        <strong data-testid="template-keys-banner">{t("tasks.templateKeysBanner", { count: state.items.length })}</strong>{" "}
        {t("tasks.templateKeysHint")}
      </Banner>
      <GroupCard>
        <RowList>
          {state.items.map((item) => (
            <Row
              key={item.path}
              data-testid="template-keys-row"
              data-tip={item.path}
              icon={
                <Checkbox
                  checked={state.picked.has(item.path)}
                  disabled={state.busy}
                  onChange={() => state.toggle(item.path)}
                  aria-label={item.title}
                  data-testid="template-keys-pick"
                />
              }
              title={item.title}
              subtitle={[item.hidesTasks ? t("tasks.templateKeysHidesTasks") : null, item.templateFor ? t("tasks.templateKeysAssignment") : null].filter(Boolean).join(" · ")}
            />
          ))}
        </RowList>
      </GroupCard>
    </div>
  );
}
