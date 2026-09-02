/**
 * Sorting and filtering a folder listing (feedback round 2026-09-01, P11/T5).
 *
 * The phone listed a folder hard-sorted by title with no way to change it and
 * no search box; the desktop tree did the same. The report came from a real
 * vault — 640 notes in one folder — where that is simply not usable. One
 * shared rule for both shells: the sort key is chosen (title, last modified,
 * created), the direction follows, and the choice is remembered per device.
 *
 * A second finding rode along on the screenshot: under every row stood
 * "218 days ago". A vault copied or synced in one go carries the same
 * modification time everywhere, and a subtitle that cannot tell rows apart
 * costs half a row's height for nothing. `timesAreUniform` lets the caller
 * drop it.
 */

export type FolderSortKey = "title" | "modified" | "created";
export type FolderSortDir = "asc" | "desc";

export interface FolderSort {
  key: FolderSortKey;
  dir: FolderSortDir;
}

export const DEFAULT_FOLDER_SORT: FolderSort = { key: "title", dir: "asc" };
export const FOLDER_SORT_KEYS: readonly FolderSortKey[] = ["title", "modified", "created"];
/** Device-local storage key, the same on both shells. */
export const FOLDER_SORT_STORAGE_KEY = "plainva-folder-sort";

/** The direction a key starts in: names read A-Z, times read newest first. */
export function defaultDirFor(key: FolderSortKey): FolderSortDir {
  return key === "title" ? "asc" : "desc";
}

/** Choosing a key switches to it; choosing the active key again flips the direction. */
export function nextFolderSort(current: FolderSort, chosen: FolderSortKey): FolderSort {
  if (current.key !== chosen) return { key: chosen, dir: defaultDirFor(chosen) };
  return { key: chosen, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function parseFolderSort(value: unknown): FolderSort {
  if (!value || typeof value !== "object") return DEFAULT_FOLDER_SORT;
  const v = value as Partial<FolderSort>;
  const key = FOLDER_SORT_KEYS.includes(v.key as FolderSortKey) ? (v.key as FolderSortKey) : DEFAULT_FOLDER_SORT.key;
  const dir = v.dir === "asc" || v.dir === "desc" ? v.dir : defaultDirFor(key);
  return { key, dir };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredFolderSort(storage: StorageLike | null | undefined = typeof localStorage === "undefined" ? null : localStorage): FolderSort {
  try {
    const raw = storage?.getItem(FOLDER_SORT_STORAGE_KEY);
    return raw ? parseFolderSort(JSON.parse(raw)) : DEFAULT_FOLDER_SORT;
  } catch {
    return DEFAULT_FOLDER_SORT;
  }
}

export function writeStoredFolderSort(sort: FolderSort, storage: StorageLike | null | undefined = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    storage?.setItem(FOLDER_SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    /* the preference simply does not persist */
  }
}

/** What an entry needs to be sorted: a name, and the two times where known. */
export interface FolderSortable {
  title: string;
  mtime?: number | null;
  ctime?: number | null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Compares two entries under `sort`. Names compare naturally ("Note 2" before
 * "Note 10"); an entry without the requested time sorts after every entry that
 * has one, whatever the direction, and ties fall back to the name.
 */
export function compareFolderEntries(a: FolderSortable, b: FolderSortable, sort: FolderSort): number {
  const byName = collator.compare(a.title, b.title);
  if (sort.key === "title") return sort.dir === "asc" ? byName : -byName;
  const ta = sort.key === "modified" ? a.mtime : a.ctime;
  const tb = sort.key === "modified" ? b.mtime : b.ctime;
  const hasA = typeof ta === "number" && Number.isFinite(ta);
  const hasB = typeof tb === "number" && Number.isFinite(tb);
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (hasA && hasB && ta !== tb) return sort.dir === "asc" ? (ta as number) - (tb as number) : (tb as number) - (ta as number);
  return byName;
}

export function sortFolderEntries<T extends FolderSortable>(items: readonly T[], sort: FolderSort): T[] {
  return [...items].sort((a, b) => compareFolderEntries(a, b, sort));
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Case- and accent-insensitive "contains" over every word of the query. */
export function matchesFolderQuery(title: string, query: string): boolean {
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fold(title);
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * True when the listing's modification times cannot tell the rows apart — all
 * the same (to the minute), or fewer than two known. The caller then drops the
 * "N days ago" subtitle instead of repeating one figure under every row.
 */
export function timesAreUniform(items: readonly FolderSortable[]): boolean {
  const known = items.map((i) => i.mtime).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (known.length < 2) return items.length > 1 && known.length === 0;
  const minute = (t: number) => Math.floor(t / 60_000);
  const first = minute(known[0]);
  return known.every((t) => minute(t) === first);
}
