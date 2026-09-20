import { deleteFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import { parseBaseConfig, serializeBaseConfig } from "../base/baseFormat";
import type { TaskPriority } from "./taskPlanner";
import { priorityValue, resolveTaskPriorityModel, withPriorityColumn } from "./taskPriority";

/**
 * Setting the priority of a task-database entry (plan Aufgaben-Oberfläche, B3),
 * shared by both shells.
 *
 * A database made before priorities existed has no column for them. It gets one
 * the first time somebody SETS a priority — an explicit act — and never as a
 * side effect of opening a view: Plainva does not rewrite a `.base` it was only
 * asked to read. Clearing a priority in a database without the column is a
 * no-op for the same reason.
 */
export interface TaskPriorityWriteDeps {
  readTextFile(path: string): Promise<string>;
  /** Plain write — used for the `.base` only. */
  writeTextFile(path: string, content: string): Promise<void>;
  /** The shell's task-note write path (conflict guard, index, sync queue). */
  writeNote(path: string, mutate: (raw: string) => string): Promise<void>;
}

export interface TaskPriorityLabels {
  /** Column key for a database that has none yet (i18n `tasks.dbPriorityKey`). */
  key: string;
  /** Option values high, medium, low (i18n `tasks.priority*`). */
  options: [string, string, string];
}

export async function setDbTaskPriority(
  deps: TaskPriorityWriteDeps,
  dbPath: string,
  notePath: string,
  rank: TaskPriority,
  labels: TaskPriorityLabels
): Promise<{ columnAdded: string | null }> {
  let config = parseBaseConfig(await deps.readTextFile(dbPath));
  let model = resolveTaskPriorityModel(config);
  let columnAdded: string | null = null;
  if (!model) {
    if (rank === 0) return { columnAdded };
    config = withPriorityColumn(config, labels.key, labels.options);
    await deps.writeTextFile(dbPath, serializeBaseConfig(config));
    model = resolveTaskPriorityModel(config);
    columnAdded = labels.key;
  }
  if (!model) return { columnAdded };
  const key = model.key;
  const value = priorityValue(rank, model);
  await deps.writeNote(notePath, (raw) => (value === null ? deleteFrontmatterPath(raw, [key]) : setFrontmatterPath(raw, [key], value)));
  return { columnAdded };
}
