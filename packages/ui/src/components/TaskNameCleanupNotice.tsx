import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { TaskNameCleanupState } from "../hooks/useTaskNameCleanup";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { GroupCard, Row, RowList } from "./ui/GroupedRows";
import { cx } from "./ui/cx";

/**
 * "Task notes that still carry an id in their name" (plan Befunde 2026-09-24,
 * E12, mockup § 4). ONE surface for both shells: the notice with the number of
 * links that follow, **Namen bereinigen …** behind a confirmation and
 * **Ausblenden**, and beneath it the list of renames — each row the old file
 * name struck through, an arrow, the new file name. The shells differ only in
 * the confirmation dialog they hand in.
 *
 * Built from the banner and the container grammar, so it carries no look of
 * its own to keep in step with the themes.
 */
export interface TaskNameCleanupNoticeProps {
  state: TaskNameCleanupState;
  /** The shell's confirmation dialog. */
  confirm(opts: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
  className?: string;
}

const baseName = (path: string) => path.split("/").pop() ?? path;

export function TaskNameCleanupNotice({ state, confirm, className }: TaskNameCleanupNoticeProps) {
  const { t } = useTranslation();
  if (!state.visible) return null;
  const count = state.items.length;

  const clean = async () => {
    const ok = await confirm({
      title: t("tasks.legacyNamesConfirmTitle"),
      message: t("tasks.legacyNamesConfirmMsg", { count }),
      confirmLabel: t("tasks.legacyNamesConfirm"),
    });
    if (!ok) return;
    const result = await state.clean();
    if (!result) return;
    if (result.renamed.length > 0) toast.success(t("tasks.legacyNamesDone", { count: result.renamed.length }));
    if (result.skipped.length > 0) toast.info(t("tasks.legacyNamesSkipped", { count: result.skipped.length }));
    if (result.linkUpdateFailed) toast.warning(t("dialogs.renameLinksFailed"));
  };

  return (
    <div className={cx("pv-names-notice", className)} data-testid="task-names-notice">
      <Banner
        kind="info"
        rounded
        actions={
          <>
            <Button variant="primary" size="sm" disabled={state.busy} onClick={() => void clean()} data-testid="task-names-clean">
              {t("tasks.legacyNamesClean")}
            </Button>
            <Button variant="ghost" size="sm" disabled={state.busy} onClick={state.hide} data-testid="task-names-hide">
              {t("tasks.legacyNamesHide")}
            </Button>
          </>
        }
      >
        <strong data-testid="task-names-banner">{t("tasks.legacyNamesBanner", { count })}</strong>{" "}
        {t("tasks.legacyNamesHint")}{" "}
        {state.links > 0 ? t("tasks.legacyNamesLinks", { count: state.links }) : t("tasks.legacyNamesNoLinks")}
      </Banner>
      <GroupCard>
        <RowList>
          {state.items.map((item) => (
            <Row
              key={item.from}
              data-testid="task-names-row"
              data-tip={item.from}
              title={
                <span className="pv-names-rename">
                  <del className="pv-names-old" data-testid="task-names-old">{baseName(item.from)}</del>
                  <ArrowRight size={ICON.meta} aria-hidden="true" />
                  <span className="pv-names-new" data-testid="task-names-new">{baseName(item.to)}</span>
                </span>
              }
            />
          ))}
        </RowList>
      </GroupCard>
    </div>
  );
}
