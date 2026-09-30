import type { TaskViewStorage } from "./taskViewState";
import type { TaskNameCleanupJournalStore } from "../pim/taskNameCleanup";

/**
 * Where the task-name clean-up keeps its two small facts, per vault and per
 * device (plan Befunde 2026-09-24, E12):
 *
 * - "hidden": the signature of the offer somebody put away. A new set of
 *   names (an older device still hands them out) brings the notice back.
 * - the journal of a run in progress: the renames a person confirmed, so an
 *   interrupted run is finished on the next start. Device-local on purpose —
 *   the run happens on ONE device; the others receive its renames as moves.
 */
export const taskNamesHiddenKey = (vault: string) => `plainva-task-names-hidden-${vault}`;
export const taskNamesJournalKey = (vault: string) => `plainva-task-names-journal-${vault}`;

function defaultStorage(): TaskViewStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readHiddenTaskNames(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): string | null {
  if (!vault || !storage) return null;
  try {
    return storage.getItem(taskNamesHiddenKey(vault));
  } catch {
    return null;
  }
}

export function writeHiddenTaskNames(vault: string | null, signature: string, storage: TaskViewStorage | null = defaultStorage()): void {
  if (!vault || !storage) return;
  try {
    if (signature) storage.setItem(taskNamesHiddenKey(vault), signature);
    else storage.removeItem(taskNamesHiddenKey(vault));
  } catch {
    /* A preference that cannot be stored keeps the notice — the safe side. */
  }
}

/**
 * The journal lives in the same per-device storage. A journal that cannot be
 * written is reported as an error by the write (the caller stops): renaming
 * without one would lose the ability to finish an interrupted run.
 */
export function taskNameJournalStore(vault: string, storage: TaskViewStorage | null = defaultStorage()): TaskNameCleanupJournalStore {
  return {
    read: () => {
      if (!storage) return null;
      try {
        return storage.getItem(taskNamesJournalKey(vault));
      } catch {
        return null;
      }
    },
    write: (text) => {
      if (!storage) throw new Error("journal_unavailable");
      if (text === null) storage.removeItem(taskNamesJournalKey(vault));
      else storage.setItem(taskNamesJournalKey(vault), text);
    },
  };
}
