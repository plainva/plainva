/**
 * Storage keys of features that are gone, removed once at every start (plan
 * Befunde 2026-09-24, E13).
 *
 * The task trace ("Aufgaben-Rohdaten mitschreiben", 19.09.–24.09.) kept the
 * provider's task rows — ids, dates, revisions and the first characters of each
 * title — under `plainva-pim-trace*` until its switch was turned off again. The
 * switch is gone, so a device that left it on could never empty that buffer.
 * Both shells call this at start; with nothing left, it reads the key list and
 * does nothing. Should a later finding need raw rows again, commit `c902d14c`
 * is the template.
 */
export const RETIRED_STORAGE_PREFIXES: readonly string[] = ["plainva-pim-trace"];

type KeyedStorage = Pick<Storage, "length" | "key" | "removeItem">;

function defaultStorage(): KeyedStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Removes every key under a retired prefix; returns what went. Never throws. */
export function removeRetiredStorage(storage: KeyedStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && RETIRED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    return [];
  }
  return doomed;
}
