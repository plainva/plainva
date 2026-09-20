import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import type { TaskPriority } from "../lib/taskPlanner";

/**
 * The priority flag in front of a task's title (plan Aufgaben-Oberfläche, B3).
 * One mark for every task row in both shells — planner lists, the database
 * section and the checkbox rows. High reads in the warning tone, medium in the
 * accent, low muted: never the error red, which means danger, and never colour
 * alone — the rank is the flag's accessible name.
 */
export function TaskPriorityFlag({ rank }: { rank: TaskPriority | undefined }) {
  const { t } = useTranslation();
  if (!rank) return null;
  const label = `${t("tasks.priority")}: ${t(rank === 1 ? "tasks.priorityHigh" : rank === 2 ? "tasks.priorityMedium" : "tasks.priorityLow")}`;
  return (
    <span className="pv-planner-flag" data-priority={rank} data-testid="task-priority-flag" role="img" aria-label={label} data-tip={label}>
      <Flag size={ICON.meta} />
    </span>
  );
}
