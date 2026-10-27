import { noteDisplayName } from "./noteTitle";
import type { TaskRowCaps } from "./rowActions";
import { isOpenState, type PlannerRow } from "./taskPlanner";
import { taskPlainTitle } from "./taskTitle";

/**
 * What a task row can do, once, for every list that shows one (TestFlight wish
 * of 2026-10-24, E1).
 *
 * The phone's tasks tab built its row capabilities out of its own internals,
 * so Today → Due could tick a task and move its day and nothing else. The
 * RULES live here — which kind of task takes which action — and a shell hands
 * in only HOW it does each one; `taskRowActions` then turns the answer into the
 * sheet, the swipe and the context menu. A list that shows a task asks this
 * function and cannot offer a different set.
 *
 * - Ticking needs a database that can say "done" (a completion model).
 * - Moving a database entry's day needs a date column; a checkbox moves its
 *   `📅` as long as its line is known.
 * - Only a checkbox goes into the database, and only a checkbox has the four
 *   box states; only a database entry carries Plainva's repeat rule — and not
 *   one mirrored from a provider, which repeats where it came from.
 */

/** How a shell carries out each action for a row. Absent: the shell cannot here. */
export interface PlannerRowHandlers {
  open: (row: PlannerRow) => void;
  toggle?: (row: PlannerRow) => void;
  promote?: (row: PlannerRow) => void;
  repeat?: (row: PlannerRow) => void;
  block?: (row: PlannerRow) => void;
  due?: (row: PlannerRow) => void;
  priority?: (row: PlannerRow) => void;
  state?: (row: PlannerRow) => void;
}

/** What the task database allows, as the shell has read it. */
export interface PlannerRowAbilities {
  /** The database has a completion model, so a tick can write "done". */
  databaseTickable: boolean;
  /** The database has a date column, so an entry's day can move. */
  databaseDue: boolean;
}

/** A row's capabilities with what its sheet needs besides: a heading and "Open". */
export interface TaskRowSheet extends TaskRowCaps {
  title: string;
  open: () => void;
}

export function plannerRowCaps(row: PlannerRow, handlers: PlannerRowHandlers, can: PlannerRowAbilities): TaskRowSheet {
  const database = row.source === "database";
  const bind = (run: ((row: PlannerRow) => void) | undefined) => (run ? () => run(row) : undefined);
  const lineKnown = !database && row.line !== undefined;
  return {
    title: database ? noteDisplayName(row.title) : taskPlainTitle(row.title),
    open: () => handlers.open(row),
    done: !isOpenState(row.state),
    toggle: database && !can.databaseTickable ? undefined : bind(handlers.toggle),
    promote: lineKnown ? bind(handlers.promote) : undefined,
    repeat: database && !row.mirrored ? bind(handlers.repeat) : undefined,
    block: bind(handlers.block),
    due: (database ? can.databaseDue : lineKnown) ? bind(handlers.due) : undefined,
    priority: database || lineKnown ? bind(handlers.priority) : undefined,
    state: lineKnown ? bind(handlers.state) : undefined,
  };
}
