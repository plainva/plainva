import { useTranslation } from "react-i18next";
import { DuePicker, useTodayKey, useWeekStartDay, type DuePick } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The date sheet behind a task's date (plan Befunde 2026-10-06, W2): a tap on
 * the date of a task — in the planner, in "All", on the Today screen — opens
 * the shared due picker here (wishes 2026-10-24, E2: quick choices, the month
 * grid and a time). The desktop's twin is the same `DuePicker` in a
 * `DateJumpPopover` under the date. What a pick writes is the caller's
 * (`applyTaskDueChanges`), so every surface answers with the same notice and
 * the same Undo.
 */
export function TaskDueSheet({
  value,
  time,
  timeAllowed,
  onPick,
  onClose,
}: {
  /** The day the task carries now; null for a task without one (the grid then stands on today). */
  value: string | null;
  /** The time it carries now (`HH:MM`); null when it is due all day. */
  time: string | null;
  /** False where the task keeps a day only (a checkbox in a note). */
  timeAllowed: boolean;
  onPick: (pick: DuePick) => void;
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
        <DuePicker
          day={value}
          time={time}
          timeAllowed={timeAllowed}
          todayKey={todayKey}
          weekStart={weekStart}
          onPick={onPick}
          onClose={onClose}
          size="sheet"
          testId="task-due"
        />
      </div>
    </div>
  );
}
