import { resolveTaskOrdinal, setChecklistTaskDone, type TaskRecord } from "@plainva/core";
import type { TaskDbRow } from "./taskDatabase";
import { comparePlannerRows, isOpenState, type PlannerRow, type PlannerTaskLine } from "./taskPlanner";
import { plannerRowsFromDb, plannerRowsFromTasks, type PlannerDbMeta } from "./taskPlannerRows";

/**
 * What is due on a day — one answer for every surface that asks (TestFlight,
 * build 136, Sammelplan § 3.145 Nr. 1).
 *
 * Plainva has two kinds of task: an entry of the task database, and a checkbox
 * in a note — with a due date when the line carries a Tasks-plugin `📅`. The
 * planner's lists read both since they exist. The Today screen, the calendars
 * and the widget read the database alone, each with its own loader, so a
 * checkbox due today was on the planner's Today and missing under Today → Due.
 * The comments that kept it so said a checkbox "has no typed due value"; it
 * has had one since the planner.
 *
 * So the question is answered here, once, over the planner's own row shape:
 *
 * - `dueTaskRows` is which tasks take part — both sources, and a note that
 *   opts out of task aggregation (`plainva.tasks: false`) stays out, as it does
 *   in the planner unless someone asks to see hidden notes.
 * - `dueTasksForDay` is what one day shows: what is due on it, and on today
 *   what is late as well. Late is asked of the CALENDAR (`calendarDay`) — a due
 *   date is a calendar date. The Today screen's own "today" is the diary's
 *   (the vault's day boundary): between midnight and the boundary it is
 *   yesterday on the calendar, and then it lists yesterday's tasks AND the
 *   calendar's today's — so it shows what the planner's Today list shows at
 *   that hour, which is the mismatch this module exists to end.
 * - `dueRowsByDay` is the same rows laid out on a calendar.
 * - `noteTaskTick` is what a tick on a checkbox row writes, for each shell's
 *   ordinary write path of a note.
 *
 * Pure, like `taskPlanner.ts`: no I/O, no clock of its own.
 */

/** The task sources a surface hands in — whatever it already loads. */
export interface DueTaskSources {
  /** The task database's rows (`taskDbRows`); absent or null without a database. */
  database?: readonly TaskDbRow[] | null;
  /** What the indexed `plainva` namespace says about a database row (repeat, mirror). */
  databaseMeta?: (path: string) => PlannerDbMeta | undefined;
  /** The checkboxes of the vault (`listTasks`). */
  notes?: readonly TaskRecord[] | null;
}

/** Both sources in the planner's row shape, without the notes that opt out of task aggregation. */
export function dueTaskRows(sources: DueTaskSources): PlannerRow[] {
  const notes = (sources.notes ?? []).filter((task) => !task.excluded);
  return [...plannerRowsFromDb(sources.database ?? [], sources.databaseMeta ?? (() => undefined)), ...plannerRowsFromTasks(notes)];
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A row's due day as a key, or null when it has none Plainva can read. */
export function dueDayOf(row: Pick<PlannerRow, "due">): string | null {
  return row.due && DAY_KEY.test(row.due) ? row.due : null;
}

export interface DayDue {
  /** Open tasks whose day has passed — only on today; oldest first. */
  overdue: PlannerRow[];
  /** Tasks due on the day itself, in the planner's order. */
  due: PlannerRow[];
}

export interface DayDueOptions {
  /** Today on the calendar (`calendarDay`, `useTodayKey`). */
  today: string;
  /**
   * Today in the diary (`journalDay`, `useJournalDayKey`), for a surface that
   * selects days by it. Between midnight and the vault's day boundary it is
   * yesterday on the calendar, and that day is still "today" there.
   */
  diaryToday?: string;
  /** Lists finished tasks of the day too. Overdue never does: a finished task is not late. */
  includeDone?: boolean;
}

/**
 * What `day` shows. On today — the calendar's or the diary's — what is late
 * leads, oldest first, the way the planner's Today list shows it; any other day
 * shows what is due on it and nothing else.
 */
export function dueTasksForDay(rows: readonly PlannerRow[], day: string, options: DayDueOptions): DayDue {
  // The diary's today before the boundary reaches up to the calendar's today:
  // at 01:30 on the 24th with a 04:00 boundary the Today screen shows the 23rd,
  // and what is due on the 24th is due today all the same.
  const last = day === options.diaryToday && options.today > day ? options.today : day;
  const due = rows
    .filter((row) => {
      const at = dueDayOf(row);
      return at !== null && at >= day && at <= last && (options.includeDone === true || isOpenState(row.state));
    })
    .sort(byDayThenRank);
  if (day !== options.today && day !== options.diaryToday) return { overdue: [], due };
  // Late means before today on the calendar — and never a day the list above
  // already holds (at 01:30 with a 04:00 boundary the diary's today is
  // yesterday, and yesterday's tasks are both "of this day" and late).
  const before = day < options.today ? day : options.today;
  const overdue = rows
    .filter((row) => {
      const at = dueDayOf(row);
      return at !== null && at < before && isOpenState(row.state);
    })
    .sort(byDayThenRank);
  return { overdue, due };
}

/** Earlier days first, within a day the planner's order. */
function byDayThenRank(a: PlannerRow, b: PlannerRow): number {
  return a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : comparePlannerRows(a, b);
}

/** The rows on a calendar: day key → its tasks, open and finished, in the planner's order. */
export function dueRowsByDay(rows: readonly PlannerRow[]): Map<string, PlannerRow[]> {
  const out = new Map<string, PlannerRow[]>();
  for (const row of rows) {
    const day = dueDayOf(row);
    if (!day) continue;
    const list = out.get(day);
    if (list) list.push(row);
    else out.set(day, [row]);
  }
  for (const list of out.values()) list.sort(comparePlannerRows);
  return out;
}

/**
 * What the search jump looks for to open a checkbox at its line: the start of
 * the line's own text — not the display title, which drops tags and Tasks
 * fields from the middle and need not stand in the note. Cut at whole
 * characters: a cut through the middle of a `📅` would leave half an emoji
 * that stands nowhere.
 */
export function checkboxJumpTerm(text: string, max = 40): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * A tap moves between open and done only: open or in progress is completed,
 * done or cancelled is reopened — the rule of the task screens (E12).
 */
export function tickCompletes(row: Pick<PlannerRow, "state">): boolean {
  return isOpenState(row.state);
}

/**
 * The change a tick makes to the note a checkbox lives in, for the shell's
 * ordinary write path of a note (`vaultOps.update` on the phone,
 * `updateVaultText` on the desktop), which hands it the note as it lies there
 * when it is written. The line is found again in that text — a note edited
 * since it was read must not have a neighbour ticked — and set through the
 * same mutation the editor and the task screens use (completion date,
 * recurrence). Null when the line is gone or already so: then nothing is
 * written.
 */
export function noteTaskTick(line: PlannerTaskLine, done: boolean): (fresh: string) => string | null {
  return (fresh) => {
    const ordinal = resolveTaskOrdinal(fresh, line);
    if (ordinal < 0) return null;
    const result = setChecklistTaskDone(fresh, ordinal, done);
    return result.changed ? result.content : null;
  };
}
