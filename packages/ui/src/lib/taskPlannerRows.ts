import { stripTasksPriority, tasksDescription, type TaskRecord } from "@plainva/core";
import type { TaskDbRow } from "./taskDatabase";
import type { PlannerRow, TaskPriority, TaskState } from "./taskPlanner";

/**
 * The two task sources in the planner's one row shape (plan Aufgaben-Oberfläche,
 * B1). Pure: the shells hand in what they already load — the database rows with
 * what the indexed `plainva` namespace says about them, and the checkbox tasks
 * of the vault — and get rows both can draw, sort and count the same way.
 */

export const plannerDbId = (path: string): string => `db:${path}`;
export const plannerTaskId = (path: string, ordinal: number): string => `note:${path}#${ordinal}`;

/** Strips the metadata that already has its own chip or flag, so it is not said twice. */
export function taskDisplayText(text: string): string {
  return stripTasksPriority(tasksDescription(text)).replace(/(^|\s)#[\p{L}\p{N}][\p{L}\p{N}_/-]*/gu, "$1").replace(/\s{2,}/g, " ").trim();
}

/** What a view knows about a database row beyond `TaskDbRow`. */
export interface PlannerDbMeta {
  repeats?: boolean;
  mirrored?: boolean;
  repeatsAtProvider?: boolean;
  priority?: TaskPriority;
  tags?: readonly string[];
}

export function plannerRowsFromDb(rows: readonly TaskDbRow[], metaOf: (path: string) => PlannerDbMeta | undefined): PlannerRow[] {
  return rows.map((row) => {
    const meta = metaOf(row.path) ?? {};
    return {
      id: plannerDbId(row.path),
      source: "database",
      path: row.path,
      title: row.title,
      state: row.done ? "done" : "open",
      due: row.due,
      dueMinutes: row.dueMinutes ?? null,
      priority: meta.priority ?? row.priority ?? 0,
      tags: meta.tags ?? [],
      repeats: meta.repeats,
      mirrored: meta.mirrored,
      repeatsAtProvider: meta.repeatsAtProvider,
    };
  });
}

/** A checkbox task; `state` and `priority` arrive with the scanner once it reads them. */
type CheckboxTask = TaskRecord & { state?: TaskState; priority?: TaskPriority };

export function plannerRowsFromTasks(tasks: readonly CheckboxTask[]): PlannerRow[] {
  return tasks.map((task) => ({
    id: plannerTaskId(task.path, task.ordinal),
    source: "note",
    path: task.path,
    ordinal: task.ordinal,
    title: taskDisplayText(task.text) || task.text,
    noteTitle: task.title,
    state: task.state ?? (task.done ? "done" : "open"),
    due: task.due,
    dueMinutes: null,
    priority: task.priority ?? 0,
    tags: task.tags,
    repeats: task.recurrence !== undefined,
  }));
}
