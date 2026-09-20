import type { TaskViewStorage } from "./taskViewState";

/**
 * "I have looked at these duplicates — they stay" (finding 2026-09-20).
 *
 * The clean-up removes only copies with nothing of their own. What is left is
 * left on purpose: a copy with its own text, or one that disagrees with the
 * synced note. A person may well decide to keep both notes, and a notice that
 * can never be answered turns into wallpaper. So the notice can be put away —
 * against the SIGNATURE of the set it was shown for
 * (`summarizeDuplicateTasks`), per vault and per device. A copy that joins or
 * leaves changes the signature, and the notice returns by itself.
 */
export const taskDuplicatesSeenKey = (vault: string) => `plainva-task-dupes-seen-${vault}`;

function defaultStorage(): TaskViewStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSeenTaskDuplicates(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): string | null {
  if (!vault || !storage) return null;
  try {
    return storage.getItem(taskDuplicatesSeenKey(vault));
  } catch {
    return null;
  }
}

export function writeSeenTaskDuplicates(vault: string | null, signature: string, storage: TaskViewStorage | null = defaultStorage()): void {
  if (!vault || !storage) return;
  try {
    if (signature) storage.setItem(taskDuplicatesSeenKey(vault), signature);
    else storage.removeItem(taskDuplicatesSeenKey(vault));
  } catch {
    /* A preference that cannot be stored keeps the notice — the safe side. */
  }
}
