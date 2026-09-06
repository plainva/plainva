/**
 * "Overdue" for a database row — one rule for every database view.
 *
 * The task list and the calendar agenda have colored a due date since E3
 * (`dueLabel.ts`): today or earlier is the tone `due`, later is `later`. The
 * database views (board, gallery, calendar, timeline) showed the same date as
 * plain text, so a task three days late looked exactly like one due next
 * month (issues #83 and #84).
 *
 * The rule is deliberately narrow (plan Issue-Durchsicht 2026-09-06, E4):
 * a date is "overdue" only where the database knows what DONE means — a
 * checkbox column or a status column with options, the same completion model
 * the provider sync uses (`resolveTaskCompletionModel`). A birthday in a
 * contacts database is never overdue, and a finished task is never overdue
 * however old its date. Everything else returns `none`, which renders as
 * before.
 *
 * Both shells read this; neither invents its own date arithmetic. The day key
 * comparison is the one `dueLabel.ts` uses (local calendar days), so a task
 * does not turn overdue a day early west of Greenwich.
 */
import { dayPartOf } from "../base/calendarRange";
import { classifyTaskCompletion, resolveTaskCompletionModel, type TaskCompletionModel } from "./taskDatabase";

export type RowDueTone = "due" | "later" | "none";

/** The completion model of a parsed `.base` config, or null when the database
 * has no notion of "done" (then nothing in it is ever overdue). */
export function dueModelOf(config: unknown): TaskCompletionModel | null {
  return resolveTaskCompletionModel(config);
}

/** Local day key of a date, `YYYY-MM-DD`. */
function dayKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A row value by column key, tolerant of the `note.` prefix the query rows
 * carry for frontmatter properties. */
function valueOf(row: Record<string, unknown>, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  if (key.startsWith("note.")) return row[key.slice(5)];
  return row[`note.${key}`];
}

/** Whether the row counts as done under the model; `null` when unknown. */
export function rowIsDone(row: Record<string, unknown>, model: TaskCompletionModel): boolean | null {
  const statusKey = model.kind === "checkbox" ? model.status?.key : model.status.key;
  const statusRaw = statusKey ? valueOf(row, statusKey) : null;
  return classifyTaskCompletion(model, {
    checkbox: model.kind === "checkbox" ? valueOf(row, model.key) : undefined,
    status: statusRaw == null ? null : String(statusRaw),
  });
}

/**
 * The tone of `dateValue` for this row: `due` when the day is today or earlier
 * and the row is not done, `later` for a future day, `none` when there is no
 * completion model, no readable date, or the row is done.
 */
export function rowDueTone(
  row: Record<string, unknown>,
  model: TaskCompletionModel | null,
  dateValue: unknown,
  today: Date = new Date()
): RowDueTone {
  if (!model) return "none";
  const day = dayPartOf(dateValue);
  if (!day) return "none";
  if (rowIsDone(row, model) === true) return "none";
  return day <= dayKeyOf(today) ? "due" : "later";
}
