import { deleteFrontmatterPath, readFrontmatterPath, readTasksMetadata, resolveTaskOrdinal, setChecklistTaskDue, setFrontmatterPath, setTasksField } from "@plainva/core";
import { isOpenState, type PlannerRow } from "./taskPlanner";

/**
 * Moving a task's due day (plan Befunde 2026-10-06, W2/W3), shared by both
 * shells: a tap on a task's date opens the date picker, and "all overdue to
 * today" moves a whole section at once.
 *
 * Both task sources are written the way they are stored. A database entry
 * keeps its due value in the database's date column; only the DAY changes
 * there, so a task due at 14:00 stays due at 14:00. A checkbox carries the
 * Tasks plugin's `📅` field on its line.
 *
 * Every write answers with what it would take to put things back — the same
 * kind of change, pointing at the day that was there — so "Undo" is this
 * function called again, not a second code path. A task that had NO date is put
 * back by taking the date away again: that is what `day: null` is for.
 */

/** What a checkbox line is found by; `text` is the line as the index listed it. */
export interface TaskDueLineRef {
  ordinal: number;
  text: string;
  taskId?: string;
}

/** `day: null` takes the date away. */
export type TaskDueChange =
  | { source: "database"; path: string; day: string | null }
  | { source: "note"; path: string; task: TaskDueLineRef; day: string | null };

export interface TaskDueDeps {
  readTextFile(path: string): Promise<string>;
  /** The shell's write path for a note that holds checkboxes (whole content). */
  writeNoteText(path: string, content: string): Promise<void>;
  /** The shell's task-note write path (conflict guard, index, sync queue). */
  writeDbNote(path: string, mutate: (raw: string) => string): Promise<void>;
  /** The database's date column (`taskDbDueKey`); null: its entries cannot carry a date. */
  dueKey: string | null;
}

export interface TaskDueOutcome {
  /** How many tasks now carry their new day. */
  moved: number;
  /** Tasks that were left alone: gone or changed since they were listed, or unreadable. */
  skipped: number;
  /** The same changes pointing back at the day each task had — hand it to `applyTaskDueChanges` to undo. */
  undo: TaskDueChange[];
  /** Notes with checkboxes that were rewritten, for the shell's index update. */
  notePaths: string[];
  /** The checkbox lines that moved, with the text they carry now — what a view shows until the index catches up. */
  lines: Array<{ path: string; ordinal: number; text: string; day: string | null }>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * A stored due value with another day. What follows the day — a time of day,
 * seconds, a zone — is kept as written; a value that is not a date is replaced.
 */
export function withDueDay(raw: unknown, day: string): string {
  const text = raw == null ? "" : String(raw).trim();
  const head = DAY_PREFIX.exec(text);
  return head ? day + text.slice(head[1].length) : day;
}

function storedDay(raw: unknown): string | null {
  const head = DAY_PREFIX.exec(raw == null ? "" : String(raw).trim());
  return head ? head[1] : null;
}

/**
 * Applies the changes. One file is written once however many of its tasks
 * move; a task that cannot be found any more is counted, not guessed at.
 */
export async function applyTaskDueChanges(deps: TaskDueDeps, changes: readonly TaskDueChange[]): Promise<TaskDueOutcome> {
  const out: TaskDueOutcome = { moved: 0, skipped: 0, undo: [], notePaths: [], lines: [] };
  const byNote = new Map<string, Array<Extract<TaskDueChange, { source: "note" }>>>();

  for (const change of changes) {
    if (change.day !== null && !DAY.test(change.day)) {
      out.skipped += 1;
      continue;
    }
    if (change.source === "note") {
      const list = byNote.get(change.path);
      if (list) list.push(change);
      else byNote.set(change.path, [change]);
      continue;
    }
    const key = deps.dueKey;
    if (!key) {
      out.skipped += 1;
      continue;
    }
    try {
      // Filled in by the mutation, which runs inside the shell's write path.
      const seen: { previous: string | null; empty: boolean; written: boolean } = { previous: null, empty: true, written: false };
      const day = change.day;
      await deps.writeDbNote(change.path, (raw) => {
        const current = readFrontmatterPath(raw, [key]);
        seen.previous = storedDay(current);
        seen.empty = current == null || String(current).trim() === "";
        if (day === null) {
          if (seen.empty) return raw;
          seen.written = true;
          return deleteFrontmatterPath(raw, [key]);
        }
        const next = withDueDay(current, day);
        if (!seen.empty && String(current).trim() === next) return raw;
        seen.written = true;
        return setFrontmatterPath(raw, [key], next);
      });
      if (!seen.written) continue;
      out.moved += 1;
      // Back to the day that was there, or to no date at all. A value that was
      // there but was not a date cannot be brought back, so nothing is offered.
      if (seen.previous) out.undo.push({ source: "database", path: change.path, day: seen.previous });
      else if (seen.empty) out.undo.push({ source: "database", path: change.path, day: null });
    } catch {
      out.skipped += 1;
    }
  }

  for (const [path, list] of byNote) {
    try {
      let content = await deps.readTextFile(path);
      const undo: TaskDueChange[] = [];
      const lines: TaskDueOutcome["lines"] = [];
      let skipped = 0;
      for (const change of list) {
        // The ordinal comes from a listing; the note may have changed since.
        const ordinal = resolveTaskOrdinal(content, change.task);
        const next = ordinal < 0 ? null : setChecklistTaskDue(content, ordinal, change.day);
        if (!next || !next.changed) {
          skipped += 1;
          continue;
        }
        content = next.content;
        const text = setTasksField(change.task.text, "due", change.day);
        lines.push({ path, ordinal, text, day: change.day });
        undo.push({ source: "note", path, task: { ordinal, text, ...(change.task.taskId ? { taskId: change.task.taskId } : {}) }, day: readTasksMetadata(change.task.text).due });
      }
      if (lines.length > 0) {
        await deps.writeNoteText(path, content);
        out.notePaths.push(path);
        out.moved += lines.length;
        out.undo.push(...undo);
        out.lines.push(...lines);
      }
      out.skipped += skipped;
    } catch {
      out.skipped += list.length;
    }
  }
  return out;
}

/**
 * The changes that bring every open, overdue row of a planner section to `day`
 * (W3). `lineOf` hands in the listed checkbox line of a note row; a row whose
 * line is not known any more is simply not part of the move.
 */
export function overdueToDayChanges(rows: readonly PlannerRow[], day: string, lineOf: (row: PlannerRow) => TaskDueLineRef | undefined): TaskDueChange[] {
  const out: TaskDueChange[] = [];
  for (const row of rows) {
    if (!isOpenState(row.state) || !row.due || row.due >= day) continue;
    if (row.source === "database") out.push({ source: "database", path: row.path, day });
    else {
      const task = lineOf(row);
      if (task) out.push({ source: "note", path: row.path, task, day });
    }
  }
  return out;
}
