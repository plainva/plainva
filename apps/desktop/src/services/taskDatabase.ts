import { getSettingsStore } from "./settingsStore";
import { taskDatabaseKey } from "../contexts/VaultContext";

/**
 * Standard task database (PIM plan, package 1a). A vault can designate one
 * `.base` as its task database; checkbox tasks from the Tasks view are promoted
 * into it, and the task reconciler syncs external provider tasks into the same
 * place.
 *
 * The MODEL — what a task database looks like, what "done" means in it, how a
 * completion flip is written — moved to `@plainva/ui` (S22b) so the phone
 * answers those questions identically. What stays here is the one thing that is
 * genuinely per-shell: WHICH `.base` this vault designated.
 */

export {
  taskDbFileStem,
  buildTaskDbFile,
  createTaskDatabase,
  resolveTaskStatusModel,
  classifyTaskStatus,
  resolveTaskCompletionModel,
  statusModelOf,
  classifyTaskCompletion,
  applyTaskCompletion,
  applyTaskStatusOption,
  taskDbDueKey,
  taskDbRows,
  splitTaskListKey,
  taskListPickerOptions,
  resolveTaskListName,
  resolveTaskListTarget,
} from "@plainva/ui";
export type { TaskDbLabels, TaskDbAdapter, TaskStatusModel, TaskCompletionModel, TaskDbRow } from "@plainva/ui";

/** The vault's configured standard task database (vault-relative `.base` path),
 * or null when none is set. */
export async function getTaskDatabasePath(vaultPath: string): Promise<string | null> {
  try {
    const store = await getSettingsStore();
    const value = await store.get<string>(taskDatabaseKey(vaultPath));
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
