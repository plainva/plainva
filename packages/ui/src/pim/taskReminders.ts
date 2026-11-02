import type { TaskRecord } from "@plainva/core";
import type { ReminderLine, ReminderSubject } from "./reminderPlan";
import { dueTaskRows } from "../lib/dueTasks";
import { isOpenState, type PlannerRow } from "../lib/taskPlanner";

/**
 * Tasks as reminder subjects (plan Aufgaben-Oberfläche, B4), shared by both
 * shells — they used to build these in two places, and a task with a time
 * borrowed the APPOINTMENT lead ("15 minutes before").
 *
 * - A task with a time reminds at its time, minus the task lead the person set
 *   (`ReminderRule.taskTimedLeadMinutes`, default 0).
 * - A task without one follows the day rule, as before.
 * - `remind` in the note is the exception per task: `off` silences it, a number
 *   is its own lead in minutes (only meaningful with a time — a lead needs a
 *   moment to count back from).
 * - "Later" on a reminder parks ONE moment for that task (`snoozes`); it
 *   replaces the task's regular reminder until it has passed.
 */
export interface TaskReminderSource {
  /** Note path — the subject's identity, unless `key` names another. */
  path: string;
  /** The identity when the path is not enough: a checkbox (`checkboxReminderKey`). */
  key?: string;
  /** A checkbox task: the line it stands on (`ReminderSubject.line`). */
  reminderLine?: ReminderLine;
  title: string;
  /** Day key `YYYY-MM-DD`. */
  due: string | null;
  dueMinutes?: number;
  done: boolean;
  /** Raw `remind` property of the note. */
  remind?: unknown;
}

/** `undefined` = the task says nothing (the rule applies), `[]` = "do not remind me". */
export function parseTaskRemind(raw: unknown): number[] | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (raw === false) return [];
  const text = String(raw).trim().toLowerCase();
  if (text === "off" || text === "false" || text === "no" || text === "none") return [];
  const minutes = Number(text);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 40_320 ? [Math.floor(minutes)] : undefined;
}

export function taskReminderSubjects(
  tasks: readonly TaskReminderSource[],
  opts: { now: number; windowEndTs: number; snoozes?: Readonly<Record<string, number>> }
): ReminderSubject[] {
  const out: ReminderSubject[] = [];
  for (const task of tasks) {
    if (task.done || !task.due) continue;
    const [y, m, d] = task.due.split("-").map(Number);
    if (!y || !m || !d) continue;
    const timed = task.dueMinutes !== undefined;
    const startTs = new Date(y, m - 1, d, 0, task.dueMinutes ?? 0).getTime();
    const key = task.key ?? task.path;
    const snoozedTo = opts.snoozes?.[key];
    const snoozed = snoozedTo !== undefined && snoozedTo > opts.now;
    // An overdue task is only of interest here while a "later" is parked for it.
    if (!snoozed && (startTs > opts.windowEndTs + 86_400_000 || startTs < opts.now - 86_400_000)) continue;
    const own = parseTaskRemind(task.remind);
    if (own && own.length === 0) continue;
    out.push({
      key,
      kind: "task",
      title: task.title,
      startTs,
      // Without a time the task is a day, and gets the TASK day rule — not the
      // all-day appointment rule.
      allDay: !timed && !snoozed,
      startDate: task.due,
      // A lead is expressed in minutes BEFORE the start; a parked moment is
      // simply the lead that lands on it (negative once the start has passed).
      ...(snoozed ? { reminders: [(startTs - snoozedTo) / 60_000] } : own && timed ? { reminders: own } : {}),
      accountId: "",
      calendarId: "",
      ...(task.reminderLine ? { line: task.reminderLine } : {}),
    });
  }
  return out;
}

/* ---------------------------------------------------------- checkbox tasks */

/**
 * Checkbox tasks as reminder sources (Sammelplan § 3.145 Nr. 1, decision E3):
 * a box in a note that carries a due date WITH a time — `📅 2026-11-02 14:30`
 * — reminds like a task note with a time, by the same rule
 * (`taskReminderSubjects`), behind its own switch per vault. A box with a
 * date and no time does not: a vault written in Obsidian carries hundreds of
 * those, and a notification for each at nine in the morning is noise nobody
 * asked for. Nothing is written into the note for a reminder.
 *
 * Derived from the index's task lines each time, never stored: a line that is
 * ticked, deleted or given another time is simply not there (or there with
 * another moment) the next time the reminders are planned. Which boxes take
 * part is `dueTaskRows` — a note that opts out of task aggregation
 * (`plainva.tasks: false`) stays out, as on every day surface.
 */
export function checkboxReminderSources(rows: readonly PlannerRow[]): TaskReminderSource[] {
  const out: TaskReminderSource[] = [];
  // Two identical lines in one note are two tasks: the second one gets a
  // counter. Counted over every row, finished ones too, so ticking the first
  // does not hand its identity to the second.
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.source !== "note" || !row.line) continue;
    const base = checkboxReminderKey(row.path, row.line);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (!row.due || row.dueMinutes === null) continue;
    out.push({
      key: n > 1 ? `${base}~${n}` : base,
      path: row.path,
      title: row.title,
      due: row.due,
      dueMinutes: row.dueMinutes,
      done: !isOpenState(row.state),
      reminderLine: { path: row.path, ordinal: row.line.ordinal, text: row.line.text, ...(row.line.taskId ? { taskId: row.line.taskId } : {}) },
    });
  }
  return out;
}

/** The checkbox reminders of a vault's task lines (`listTasks`). */
export function checkboxReminderSubjects(
  notes: readonly TaskRecord[],
  opts: { now: number; windowEndTs: number; snoozes?: Readonly<Record<string, number>> }
): ReminderSubject[] {
  return taskReminderSubjects(checkboxReminderSources(dueTaskRows({ notes })), opts);
}

/**
 * A checkbox's identity for its reminder: the note and the line — by the
 * Tasks plugin's `🆔` when the line has one, else by its text. Not by its
 * position: a line inserted above must not turn one task's reminder (and a
 * "Later" parked for it) into its neighbour's.
 */
export function checkboxReminderKey(path: string, line: Pick<ReminderLine, "text" | "taskId">): string {
  return `checkbox:${path}#${line.taskId ? `id:${line.taskId}` : line.text}`;
}

/**
 * Where a checkbox reminder's line stands NOW, asked of the index when the
 * reminder is acted on: in its own note if it is still there, else in the one
 * other note that holds the same line — the note was renamed or moved since
 * the reminder was planned. Null when no note, or more than one, holds it.
 */
export function relocateReminderLine(notes: readonly TaskRecord[], line: ReminderLine): ReminderLine | null {
  const same = (task: TaskRecord) => (line.taskId ? task.taskId === line.taskId : task.text === line.text);
  const found = notes.filter(same);
  const here = found.filter((task) => task.path === line.path);
  const pick = here.length > 0 ? here.find((task) => task.ordinal === line.ordinal) ?? here[0] : new Set(found.map((task) => task.path)).size === 1 ? found[0] : null;
  if (!pick) return null;
  return { path: pick.path, ordinal: pick.ordinal, text: pick.text, ...(pick.taskId ? { taskId: pick.taskId } : {}) };
}

/* ------------------------------------------------------------------ "later" */

type SnoozeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const taskSnoozeKey = (vault: string) => `plainva-task-snooze-${vault}`;

function defaultStorage(): SnoozeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The parked moments of a vault on THIS device; what has passed is dropped on read. */
export function readTaskSnoozes(vault: string, now: number, storage: SnoozeStorage | null = defaultStorage()): Record<string, number> {
  if (!storage) return {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(taskSnoozeKey(vault)) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, number> = {};
    for (const [path, at] of Object.entries(raw as Record<string, unknown>)) if (typeof at === "number" && at > now) out[path] = at;
    return out;
  } catch {
    return {};
  }
}

export function snoozeTask(vault: string, path: string, until: number, now: number, storage: SnoozeStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(taskSnoozeKey(vault), JSON.stringify({ ...readTaskSnoozes(vault, now, storage), [path]: until }));
  } catch {
    /* A "later" that cannot be stored falls back to the regular reminder. */
  }
}

/** "In an hour", or tomorrow at the hour the person set for tasks without a time. */
export function snoozeMoment(choice: "hour" | "tomorrow", now: number, taskAtMinutes: number): number {
  if (choice === "hour") return now + 60 * 60_000;
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, taskAtMinutes).getTime();
}
