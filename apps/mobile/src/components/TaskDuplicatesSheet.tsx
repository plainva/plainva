import { useTranslation } from "react-i18next";
import { Button, TaskDuplicatesList, type TaskDuplicatesState } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Review of "tasks that exist more than once" on the phone (finding
 * 2026-09-20) — the sheet shape of the desktop's dialog, on the same shared
 * state (`useTaskDuplicates`) and the same list body, so a verdict reads the
 * same on both. The list scrolls inside the sheet; the buttons stay reachable
 * below it however many tasks are affected.
 */
export function TaskDuplicatesSheet({
  dupes,
  onOpenNote,
  onRemoved,
}: {
  dupes: TaskDuplicatesState;
  onOpenNote: (path: string) => void;
  onRemoved: (count: number) => void;
}) {
  const { t } = useTranslation();
  if (!dupes.groups) return null;
  const nothing = dupes.removable === 0;
  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={dupes.close}>
      <div className="pv-sheet m-sheet" data-testid="task-duplicates-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={dupes.close} />
        <p className="m-sheet-title">{t("tasks.duplicatesTitle")}</p>
        <p className="m-hint">{nothing ? `${t("tasks.duplicatesNothing")} ${t("tasks.duplicatesPutAwayHint")}` : t("tasks.duplicatesHint")}</p>
        <div className="m-sheet-scroll">
          <TaskDuplicatesList
            groups={dupes.groups}
            onOpen={(path) => {
              dupes.close();
              onOpenNote(path);
            }}
          />
        </div>
        <div className="m-btnrow">
          <Button variant="ghost" disabled={dupes.busy} onClick={dupes.close}>
            {t("common.close")}
          </Button>
          {nothing ? (
            <Button variant="secondary" data-testid="task-duplicates-putaway" onClick={dupes.putAway}>
              {t("tasks.duplicatesPutAway")}
            </Button>
          ) : (
            <Button
              variant="primary"
              data-testid="task-duplicates-remove"
              disabled={dupes.busy}
              onClick={() => void dupes.remove().then((n) => { if (n > 0) onRemoved(n); })}
            >
              {t("tasks.duplicatesRemove", { count: dupes.removable })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
