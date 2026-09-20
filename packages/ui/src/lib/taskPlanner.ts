/**
 * The planner behind the tasks view (plan Aufgaben-Oberfläche, B1): the lists a
 * to-do app is expected to have — Today, Upcoming, Inbox, Done — over the two
 * sources Plainva already has, the task database and the checkboxes in notes.
 *
 * Pure and platform-free like `taskList.ts`: no I/O, no React, no clock of its
 * own. The shells hand in the rows they already load and today's day key; both
 * draw the same answer, and the widgets' snapshot (follow-up plan) reads it too.
 *
 * "All" is deliberately NOT modelled here: it is the view as it has always
 * been — database section, then notes grouped by note — and stays where it is.
 */

export type PlannerList = "today" | "upcoming" | "inbox" | "done";

/**
 * Which list the tasks view shows: the planner's four plus "all" — the view as
 * it has always been. The order is the order both shells offer them in.
 */
export type TaskViewList = PlannerList | "all";
export const TASK_VIEW_LISTS: readonly TaskViewList[] = ["today", "upcoming", "inbox", "all", "done"];
export function isTaskViewList(value: unknown): value is TaskViewList {
  return typeof value === "string" && (TASK_VIEW_LISTS as readonly string[]).includes(value);
}

/** 0 = none. 1 is the most important; "none" sorts after every set priority. */
export type TaskPriority = 0 | 1 | 2 | 3;

/** How a checkbox or a database row stands. `progress` counts as open, `cancelled` as closed. */
export type TaskState = "open" | "progress" | "done" | "cancelled";

export interface PlannerRow {
  /** Stable within one load: source, path and (for a checkbox) its ordinal. */
  id: string;
  source: "database" | "note";
  path: string;
  /** Checkbox ordinal inside the note; absent for a database row. */
  ordinal?: number;
  /** What the row says: the database title, or the checkbox text without its metadata. */
  title: string;
  /** For a checkbox: the note it lives in. */
  noteTitle?: string;
  state: TaskState;
  /** Day key `YYYY-MM-DD`, or null. */
  due: string | null;
  /** Minutes since midnight when the due value carries a time, else null. */
  dueMinutes: number | null;
  priority: TaskPriority;
  tags: readonly string[];
  /** Repeats through Plainva's own recurrence. */
  repeats?: boolean;
  /** Mirrored from a provider list. */
  mirrored?: boolean;
  /** The provider has reopened this task before — it repeats THERE. */
  repeatsAtProvider?: boolean;
}

export interface PlannerSection {
  /** `overdue`, `today`, `inbox`, `done` — or a day key in Upcoming. */
  key: string;
  kind: "overdue" | "today" | "day" | "inbox" | "done";
  rows: PlannerRow[];
}

export interface PlannerCounts {
  overdue: number;
  today: number;
  upcoming: number;
  inbox: number;
  done: number;
}

export interface Planner {
  counts: PlannerCounts;
  sections(list: PlannerList): PlannerSection[];
}

/** How far Upcoming looks ahead, in days after today. */
export const UPCOMING_DAYS = 14;

export const isOpenState = (state: TaskState): boolean => state === "open" || state === "progress";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Day key plus `days`, in calendar arithmetic (no time zone, no DST surprises). */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Order inside a section: what matters most first, then the clock, then the
 * name. A row without a priority sorts after every row that has one; a row
 * without a time after every row that has one — "at 14:00" is more specific
 * than "today", and the specific thing is what gets missed.
 */
export function comparePlannerRows(a: PlannerRow, b: PlannerRow): number {
  const pa = a.priority === 0 ? 9 : a.priority;
  const pb = b.priority === 0 ? 9 : b.priority;
  if (pa !== pb) return pa - pb;
  const ta = a.dueMinutes ?? Number.POSITIVE_INFINITY;
  const tb = b.dueMinutes ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  return byTitle !== 0 ? byTitle : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sorts `rows` into the planner's lists for the day `todayKey`.
 *
 * A due value that is not a day key is treated as "no date": the row lands in
 * the Inbox rather than vanishing, which is the honest place for a task whose
 * date Plainva cannot read.
 */
export function buildPlanner(rows: readonly PlannerRow[], todayKey: string): Planner {
  const horizon = addDaysToKey(todayKey, UPCOMING_DAYS);
  const overdue: PlannerRow[] = [];
  const today: PlannerRow[] = [];
  const inbox: PlannerRow[] = [];
  const done: PlannerRow[] = [];
  const byDay = new Map<string, PlannerRow[]>();

  for (const row of rows) {
    if (!isOpenState(row.state)) {
      done.push(row);
      continue;
    }
    const due = row.due && DAY_KEY.test(row.due) ? row.due : null;
    if (!due) inbox.push(row);
    else if (due < todayKey) overdue.push(row);
    else if (due === todayKey) today.push(row);
    else if (due <= horizon) {
      const list = byDay.get(due);
      if (list) list.push(row);
      else byDay.set(due, [row]);
    }
    // Beyond the horizon: neither urgent nor undated. "All" still shows it.
  }

  // Overdue reads oldest first — the longest-waiting thing leads — then by rank.
  overdue.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : comparePlannerRows(a, b)));
  today.sort(comparePlannerRows);
  inbox.sort(comparePlannerRows);
  // Done has no completion date to go by for every source; the most recent due first.
  done.sort((a, b) => ((b.due ?? "") < (a.due ?? "") ? -1 : (b.due ?? "") > (a.due ?? "") ? 1 : comparePlannerRows(a, b)));
  const days = [...byDay.keys()].sort();
  for (const day of days) byDay.get(day)!.sort(comparePlannerRows);

  const counts: PlannerCounts = {
    overdue: overdue.length,
    today: today.length,
    upcoming: days.reduce((n, day) => n + byDay.get(day)!.length, 0),
    inbox: inbox.length,
    done: done.length,
  };

  return {
    counts,
    sections(list) {
      if (list === "today") {
        return [
          ...(overdue.length > 0 ? [{ key: "overdue", kind: "overdue" as const, rows: overdue }] : []),
          { key: "today", kind: "today" as const, rows: today },
        ];
      }
      if (list === "upcoming") return days.map((day) => ({ key: day, kind: "day" as const, rows: byDay.get(day)! }));
      if (list === "inbox") return [{ key: "inbox", kind: "inbox" as const, rows: inbox }];
      return [{ key: "done", kind: "done" as const, rows: done }];
    },
  };
}
