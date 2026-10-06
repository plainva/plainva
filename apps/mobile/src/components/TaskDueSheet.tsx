import { useTranslation } from "react-i18next";
import { DateJumpPicker, useTodayKey, useWeekStartDay } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The date sheet behind a task's date (plan Befunde 2026-10-06, W2): a tap on
 * the date of a task — in the planner, in "All", on the Today screen — opens
 * the shared date picker here. The desktop's twin is a `DateJumpPopover` under
 * the date. The sheet only asks for a day; what a pick writes is the caller's
 * (`applyTaskDueChanges`), so every surface answers with the same notice and
 * the same Undo.
 */
export function TaskDueSheet({
  value,
  onPick,
  onClose,
}: {
  /** The day the task carries now; null for a task without one (the picker then stands on today). */
  value: string | null;
  onPick: (dayKey: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const weekStart = useWeekStartDay();
  const todayKey = useTodayKey();
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="task-due-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("tasks.dueChange")}</p>
        <DateJumpPicker
          value={value ?? todayKey}
          weekStart={weekStart}
          onPick={onPick}
          onToday={() => onPick(todayKey)}
          onClose={onClose}
          size="sheet"
          testId="task-due-grid"
        />
      </div>
    </div>
  );
}
