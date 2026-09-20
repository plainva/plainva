import { useTranslation } from "react-i18next";
import { Banner, Button, Modal, TaskDuplicatesList, errorText, toast, useTaskDuplicates, type TaskCompletionModel } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { applyIndexChanges } from "../../services/fileActions";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";

/**
 * "Tasks that exist more than once" in the tasks view (finding 2026-09-20). The
 * reconciler maintains ONE note per provider task; copies that older versions
 * left behind stay frozen, usually at "open" — which read as "ticked off at
 * Google, still open here" for 63 tasks of the maintainer's vault.
 *
 * State and rules live in the shared `useTaskDuplicates`; this is the desktop's
 * shape of it (Banner + Modal), the phone's is a sheet in TasksScreen.
 *
 * Removal is a plain, confirmed vault delete: the provider's task is never
 * touched, because a copy is not the task. It deliberately does NOT go through
 * the cascade dialog, whose whole point is to make the provider copy follow.
 */
export function TaskDuplicatesNotice({
  db, reloadKey, onOpenPath, onChanged,
}: {
  /** Date column and completion model of the task database; null = no database. */
  db: { dueKey: string | null; completion: TaskCompletionModel | null } | null;
  /** Anything that means "the index may have changed". */
  reloadKey: unknown;
  onOpenPath: (path: string, newTab: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, vaultPath, indexer, pimRuntime } = useVault();
  const dupes = useTaskDuplicates({
    vault: vaultPath,
    db: vaultAdapter ? db : null,
    reloadKey,
    queryService: queryService ?? null,
    listBoundTaskNotes: () => (pimRuntime ? pimRuntime.cache.listBoundTaskNotes() : Promise.resolve([])),
    readTextFile: (path) => vaultAdapter!.readTextFile(path),
    deleteNote: (path) => vaultAdapter!.deleteItem(path, false, { confirmed: true }),
    onRemoved: async (removed) => {
      if (indexer) await applyIndexChanges(indexer, { removed }).catch(() => undefined);
      notifyFileOps(removed.map((path) => ({ type: "delete" as const, path })));
      onChanged();
    },
    onError: (e) => {
      console.error("[TaskDuplicatesNotice]", e);
      toast.error(errorText(e));
    },
  });

  if (!dupes.visible && !dupes.groups) return null;
  return (
    <>
      {dupes.visible && (
        <Banner
          kind="info"
          rounded
          className="pv-dupes-banner"
          actions={
            <Button variant="secondary" size="sm" disabled={dupes.busy} onClick={() => void dupes.review()} data-testid="task-duplicates-review">
              {t("tasks.duplicatesReview")}
            </Button>
          }
        >
          <strong data-testid="task-duplicates-banner">{t("tasks.duplicatesBanner", { count: dupes.count })}</strong> {t("tasks.duplicatesHint")}
        </Banner>
      )}
      {dupes.groups && (
        <Modal
          onClose={dupes.close}
          title={t("tasks.duplicatesTitle")}
          size="md"
          testId="task-duplicates-dialog"
          footer={
            <>
              <Button variant="ghost" onClick={dupes.close}>{t("common.close")}</Button>
              {dupes.removable === 0 ? (
                <Button variant="secondary" onClick={dupes.putAway} data-testid="task-duplicates-putaway">
                  {t("tasks.duplicatesPutAway")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={dupes.busy}
                  data-testid="task-duplicates-remove"
                  onClick={() => void dupes.remove().then((n) => { if (n > 0) toast.info(t("tasks.duplicatesRemoved", { count: n })); })}
                >
                  {t("tasks.duplicatesRemove", { count: dupes.removable })}
                </Button>
              )}
            </>
          }
        >
          <p className="pv-dupes-intro">
            {dupes.removable === 0 ? `${t("tasks.duplicatesNothing")} ${t("tasks.duplicatesPutAwayHint")}` : t("tasks.duplicatesHint")}
          </p>
          <TaskDuplicatesList groups={dupes.groups} onOpen={(path) => onOpenPath(path, true)} />
        </Modal>
      )}
    </>
  );
}
