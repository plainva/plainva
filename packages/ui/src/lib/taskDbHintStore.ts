import type { TaskViewStorage } from "./taskViewState";

/**
 * Whether the quiet hint "your task lists need a standard task database" was
 * put away, per vault and per device (issue 172, maintainer 2026-11-16). The
 * pattern is `taskNameCleanupStore`'s. Hidden stays hidden until the state
 * changes: the task sync clears the mark whenever it runs WITH a task
 * database, so a database set and later removed brings the hint back.
 */
export const taskDbHintHiddenKey = (vault: string) => `plainva-task-db-hint-hidden-${vault}`;

function defaultStorage(): TaskViewStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isTaskDbHintHidden(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): boolean {
  if (!vault || !storage) return false;
  try {
    return storage.getItem(taskDbHintHiddenKey(vault)) === "1";
  } catch {
    return false;
  }
}

export function hideTaskDbHint(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): void {
  if (!vault || !storage) return;
  try {
    storage.setItem(taskDbHintHiddenKey(vault), "1");
  } catch {
    /* A preference that cannot be stored keeps the hint — the safe side. */
  }
}

/** The vault has a task database again: a later loss of it is a new state, and the hint may say so. */
export function resetTaskDbHint(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): void {
  if (!vault || !storage) return;
  try {
    if (storage.getItem(taskDbHintHiddenKey(vault)) !== null) storage.removeItem(taskDbHintHiddenKey(vault));
  } catch {
    /* nothing to undo */
  }
}
