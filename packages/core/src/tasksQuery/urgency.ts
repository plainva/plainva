/**
 * The urgency score of the Tasks plugin, as its documentation gives it
 * (Advanced/Urgency, Tasks 8.6.0): the sum of four parts. It ignores the
 * task's status; the default sort puts `status.type` in front of it.
 *
 * - due: more than 7 days overdue 12.0, then falling linearly by 12 × 0.8 / 21
 *   per day to 2.4 at 14 days ahead, 2.4 beyond, 0 without a due date;
 * - priority: highest 9.0, high 6.0, medium 3.9, none 1.95, low 0, lowest −1.8;
 * - scheduled today or earlier: 5.0;
 * - starts tomorrow or later: −3.0.
 */

import type { TasksPriorityLevel } from "../vault/taskMetadata.js";
import { dayNumberOf, type DayKey } from "./dates.js";

export const TASKS_URGENCY_PRIORITY: Record<TasksPriorityLevel, number> = {
  highest: 9.0, high: 6.0, medium: 3.9, none: 1.95, low: 0.0, lowest: -1.8,
};
const DUE_COEFFICIENT = 12.0;
const SCHEDULED_SCORE = 5.0;
const STARTS_LATER_SCORE = -3.0;

/** The due part alone: 0 without a due date. */
export function tasksDueUrgency(due: DayKey | null | undefined, today: DayKey): number {
  if (!due) return 0;
  const dueDay = dayNumberOf(due);
  const todayDay = dayNumberOf(today);
  if (dueDay === null || todayDay === null) return 0;
  const daysOverdue = todayDay - dueDay;
  let multiplier: number;
  if (daysOverdue >= 7) multiplier = 1.0;
  else if (daysOverdue >= -14) multiplier = ((daysOverdue + 14) * 0.8) / 21 + 0.2;
  else multiplier = 0.2;
  return multiplier * DUE_COEFFICIENT;
}

/** What urgency reads of a task — the scanner's fields. */
export interface TasksUrgencyInput {
  due?: DayKey | null;
  scheduled?: DayKey;
  start?: DayKey;
  priorityLevel?: TasksPriorityLevel;
}

export function tasksUrgency(task: TasksUrgencyInput, today: DayKey): number {
  let urgency = tasksDueUrgency(task.due, today);
  if (task.scheduled && task.scheduled <= today) urgency += SCHEDULED_SCORE;
  if (task.start && task.start > today) urgency += STARTS_LATER_SCORE;
  urgency += TASKS_URGENCY_PRIORITY[task.priorityLevel ?? "none"];
  return urgency;
}
