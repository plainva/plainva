import { comparePlannerRows, isOpenState, type PlannerRow } from "./taskPlanner";

/**
 * Subtasks under their task, and what was finished on a day (TestFlight wishes
 * of 2026-10-24, E5 and E6). Pure like `taskPlanner.ts`: no I/O, no clock of
 * its own — both shells draw the planner from the same answer.
 *
 * A checkbox indented under another is a subtask (`parentId`, read by the
 * core's `scanTasks`). With the tree on, the planner shows it the way the
 * Tasks plugin's `show tree` does:
 *
 * - under its task, wherever that task is listed, open or done, indented;
 * - on its own as well where it has a day of its own that its task is not
 *   listed on — a subtask due on Tuesday is on Tuesday even when its task is
 *   due on Friday;
 * - not on its own in the Inbox: an undated subtask of an open task is part of
 *   that task, and listing it twice made one task read as several.
 */

/** One row of a section with the subtasks that hang under it. */
export interface PlannerTreeNode {
  row: PlannerRow;
  children: PlannerTreeNode[];
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rows the planner sorts into its lists when subtasks stand under their
 * task: every row but an undated subtask whose task is open — that one is
 * shown under its task instead. Counts follow, so a list's number is what it
 * lists.
 */
export function plannerRowsForTree(rows: readonly PlannerRow[]): PlannerRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    if (!row.parentId || (row.due && DAY_KEY.test(row.due))) return true;
    const parent = byId.get(row.parentId);
    return !(parent && isOpenState(parent.state));
  });
}

/** Document order inside one note: the order the subtasks were written in. */
function byOrdinal(a: PlannerRow, b: PlannerRow): number {
  return (a.ordinal ?? 0) - (b.ordinal ?? 0) || comparePlannerRows(a, b);
}

/**
 * A planner section as a tree. `sectionRows` are the rows the section lists, in
 * its order; `allRows` every row the view knows, where a task's subtasks are
 * looked up whatever their day or state. A row whose task (or that task's task)
 * is listed in the same section hangs under it and is not listed again.
 */
export function nestPlannerRows(sectionRows: readonly PlannerRow[], allRows: readonly PlannerRow[]): PlannerTreeNode[] {
  const byId = new Map(allRows.map((row) => [row.id, row]));
  const childrenOf = new Map<string, PlannerRow[]>();
  for (const row of allRows) {
    if (!row.parentId || !byId.has(row.parentId)) continue;
    const list = childrenOf.get(row.parentId);
    if (list) list.push(row);
    else childrenOf.set(row.parentId, [row]);
  }
  for (const list of childrenOf.values()) list.sort(byOrdinal);
  const listed = new Set(sectionRows.map((row) => row.id));
  const underListed = (row: PlannerRow): boolean => {
    const seen = new Set<string>();
    for (let up = row.parentId; up && !seen.has(up); up = byId.get(up)?.parentId) {
      if (listed.has(up)) return true;
      seen.add(up);
    }
    return false;
  };
  const grow = (row: PlannerRow, path: Set<string>): PlannerTreeNode => {
    // A parent always stands earlier in its note than its subtask, so a cycle
    // cannot come from the scanner; the guard keeps a hand-made row from looping.
    const next = new Set(path).add(row.id);
    return { row, children: (childrenOf.get(row.id) ?? []).filter((child) => !next.has(child.id)).map((child) => grow(child, next)) };
  };
  return sectionRows.filter((row) => !underListed(row)).map((row) => grow(row, new Set()));
}

/**
 * What was finished on `day` (E5): rows that are done and say on which day —
 * a checkbox by its `✅` date, a database entry by the day its note last
 * changed. A cancelled task was not done and stays out, and so does a finished
 * checkbox without a date: nothing says when that was.
 *
 * `last` reaches further like `dueTasksForDay` does: on the diary's today before
 * the vault's day boundary, what was finished after midnight belongs to it too.
 */
export function doneTasksOnDay(rows: readonly PlannerRow[], day: string, last: string = day): PlannerRow[] {
  return rows.filter((row) => row.state === "done" && row.doneOn !== undefined && row.doneOn >= day && row.doneOn <= last).sort(comparePlannerRows);
}

const DONE_FOLD_KEY = "plainva-done-today-open";

/** Whether the "Done (n)" fold stands open — a choice of this device, closed until it is made. */
export function readDoneFoldOpen(): boolean {
  try {
    return localStorage.getItem(DONE_FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDoneFoldOpen(open: boolean): void {
  try {
    localStorage.setItem(DONE_FOLD_KEY, open ? "1" : "0");
  } catch {
    /* a convenience: losing it is not worth an error */
  }
}
