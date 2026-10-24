import { deleteFrontmatterPath, setFrontmatterPath, updateVaultText, type TextUpdateFiles } from "@plainva/core";
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
/** The database's files — a vault's chain, or a storage with nothing above it (`updateVaultText`) — and the shell's write of a task note. */
export interface TaskPriorityWriteDeps extends TextUpdateFiles {
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
  let model = resolveTaskPriorityModel(parseBaseConfig(await deps.readTextFile(dbPath)));
  let columnAdded: string | null = null;
  if (!model) {
    if (rank === 0) return { columnAdded };
    // The column goes into the database as it lies there — and only where it
    // still has none: somebody may have added one since it was looked for.
    const update = await updateVaultText(deps, dbPath, (text) => {
      const read = parseBaseConfig(text);
      return resolveTaskPriorityModel(read) ? null : serializeBaseConfig(withPriorityColumn(read, labels.key, labels.options));
    });
    if (!resolveTaskPriorityModel(parseBaseConfig(update.before))) columnAdded = labels.key;
    model = resolveTaskPriorityModel(parseBaseConfig(update.text));
  }
  if (!model) return { columnAdded };
  const key = model.key;
  const value = priorityValue(rank, model);
  await deps.writeNote(notePath, (raw) => (value === null ? deleteFrontmatterPath(raw, [key]) : setFrontmatterPath(raw, [key], value)));
  return { columnAdded };
}
