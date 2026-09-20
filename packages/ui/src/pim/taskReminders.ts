import type { ReminderSubject } from "./reminderPlan";

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
  /** Note path — the subject's identity. */
  path: string;
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
    const snoozedTo = opts.snoozes?.[task.path];
    const snoozed = snoozedTo !== undefined && snoozedTo > opts.now;
    // An overdue task is only of interest here while a "later" is parked for it.
    if (!snoozed && (startTs > opts.windowEndTs + 86_400_000 || startTs < opts.now - 86_400_000)) continue;
    const own = parseTaskRemind(task.remind);
    if (own && own.length === 0) continue;
    out.push({
      key: task.path,
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
    });
  }
  return out;
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
