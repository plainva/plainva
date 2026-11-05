import { setTasksDue, setTasksField, setTasksPriority } from "@plainva/core";
import type { CaptureResult } from "./taskCapture";
import type { RepeatRule } from "./taskRecurrence";
import type { TaskDbLabels } from "./taskDatabase";

/**
 * A task captured where the vault has no task database (plan Rückmeldungen
 * 2026-11-05, E1): it becomes a checkbox line in today's journal, the way Siri
 * and Shortcuts file one. What the capture recognised goes onto the line as the
 * Tasks plugin's marks — tags, priority, rhythm, due date with its time — so the
 * task view reads back exactly what was typed. Pure.
 */

const UNIT: Record<RepeatRule["freq"], string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };

/** A repeat rule in the Tasks plugin's words (`every 2 weeks when done`). */
export function tasksRecurrenceOf(rule: RepeatRule): string {
  const unit = UNIT[rule.freq];
  const every = rule.interval > 1 ? `every ${rule.interval} ${unit}s` : `every ${unit}`;
  return rule.from === "completion" ? `${every} when done` : every;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The text after the box: the title, then `#tags`, priority, `🔁` and
 * `📅 YYYY-MM-DD HH:MM`, in the Tasks plugin's order. Empty when there is no title.
 */
export function checkboxTextOfCapture(result: Pick<CaptureResult, "title" | "due" | "minutes" | "priority" | "tags" | "repeat">): string {
  const title = result.title.trim();
  if (!title) return "";
  let text = [title, ...result.tags.map((tag) => `#${tag}`)].join(" ");
  if (result.priority > 0) text = setTasksPriority(text, result.priority);
  if (result.repeat) text = setTasksField(text, "recurrence", tasksRecurrenceOf(result.repeat));
  if (result.due) {
    const time = result.minutes === null ? null : `${pad(Math.floor(result.minutes / 60))}:${pad(result.minutes % 60)}`;
    text = setTasksDue(text, result.due, time);
  }
  return text;
}

/**
 * The labels a new task database is written with — one set for every place
 * that creates one (both settings screens, the hint of the task capture).
 */
export function taskDatabaseLabels(t: (key: string) => string): TaskDbLabels {
  return {
    viewTable: t("database.viewTable"),
    viewBoard: t("database.viewBoard"),
    viewTimeline: t("database.viewTimeline"),
    doneKey: t("tasks.dbDoneKey"),
    dueKey: t("tasks.dbDueKey"),
    statusOptions: [t("tasks.dbStatusOpen"), t("tasks.dbStatusInProgress"), t("tasks.dbStatusDone")],
    priorityKey: t("tasks.dbPriorityKey"),
    priorityOptions: [t("tasks.priorityHigh"), t("tasks.priorityMedium"), t("tasks.priorityLow")],
  };
}
