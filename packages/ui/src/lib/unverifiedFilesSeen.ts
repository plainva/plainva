import type { TaskViewStorage } from "./taskViewState";

/**
 * "I have looked at these files — leave the notice" for the files Google Drive
 * no longer reports (D7). Like the duplicate-task notice, it is put away
 * against the SIGNATURE of the set it was shown for, per vault and per device:
 * a file that joins or leaves changes the signature, and the notice returns by
 * itself.
 */
export const unverifiedFilesSeenKey = (vault: string) => `plainva-unverified-files-seen-${vault}`;

/** The set in one string; the order of the list does not matter. */
export const unverifiedFilesSignature = (paths: readonly string[]): string => [...paths].sort().join("\n");

function defaultStorage(): TaskViewStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSeenUnverifiedFiles(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): string | null {
  if (!vault || !storage) return null;
  try {
    return storage.getItem(unverifiedFilesSeenKey(vault));
  } catch {
    return null;
  }
}

export function writeSeenUnverifiedFiles(vault: string | null, signature: string, storage: TaskViewStorage | null = defaultStorage()): void {
  if (!vault || !storage) return;
  try {
    if (signature) storage.setItem(unverifiedFilesSeenKey(vault), signature);
    else storage.removeItem(unverifiedFilesSeenKey(vault));
  } catch {
    /* A preference that cannot be stored keeps the notice — the safe side. */
  }
}
