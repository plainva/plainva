/**
 * Sorting the two lists that had no order of their own (finding 2026-09-19):
 * search hits and backlinks.
 *
 * Search hits came by relevance and nothing else; backlinks came in whatever
 * order the link table happened to return — the query had no ORDER BY at all,
 * so the same note could show its backlinks differently from one open to the
 * next. Both now share the file tree's idiom (`folderSort.ts`): one key, a
 * direction that follows from it, the active key chosen again flips the
 * direction, and the choice is remembered per device. Relevance has no
 * direction to flip — best first is the only reading of it.
 */
import type { SearchOrder, SearchOrderKey } from "@plainva/core";
import type { GroupedBacklink } from "./backlinks";

export type ListSortDir = "asc" | "desc";

export type SearchSortKey = SearchOrderKey;
export type SearchSort = SearchOrder;
export const SEARCH_SORT_KEYS: readonly SearchSortKey[] = ["relevance", "modified", "title", "path"];
export const DEFAULT_SEARCH_SORT: SearchSort = { key: "relevance", dir: "desc" };
export const SEARCH_SORT_STORAGE_KEY = "plainva-search-sort";

export type BacklinkSortKey = "title" | "modified" | "count";
export interface BacklinkSort {
  key: BacklinkSortKey;
  dir: ListSortDir;
}
export const BACKLINK_SORT_KEYS: readonly BacklinkSortKey[] = ["title", "modified", "count"];
export const DEFAULT_BACKLINK_SORT: BacklinkSort = { key: "title", dir: "asc" };
export const BACKLINK_SORT_STORAGE_KEY = "plainva-backlink-sort";

/** Names and paths read A-Z; times, counts and relevance read "most first". */
export function defaultListSortDir(key: SearchSortKey | BacklinkSortKey): ListSortDir {
  return key === "title" || key === "path" ? "asc" : "desc";
}

/** Choosing a key switches to it; the active key again flips the direction — except relevance, which has none. */
export function nextSearchSort(current: SearchSort, chosen: SearchSortKey): SearchSort {
  if (current.key !== chosen || chosen === "relevance") return { key: chosen, dir: defaultListSortDir(chosen) };
  return { key: chosen, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function nextBacklinkSort(current: BacklinkSort, chosen: BacklinkSortKey): BacklinkSort {
  if (current.key !== chosen) return { key: chosen, dir: defaultListSortDir(chosen) };
  return { key: chosen, dir: current.dir === "asc" ? "desc" : "asc" };
}

function parse<K extends string>(value: unknown, keys: readonly K[], fallback: { key: K; dir: ListSortDir }): { key: K; dir: ListSortDir } {
  if (!value || typeof value !== "object") return fallback;
  const v = value as { key?: unknown; dir?: unknown };
  if (!keys.includes(v.key as K)) return fallback;
  const key = v.key as K;
  const dir = v.dir === "asc" || v.dir === "desc" ? v.dir : defaultListSortDir(key as SearchSortKey | BacklinkSortKey);
  return { key, dir: key === "relevance" ? "desc" : dir };
}

export const parseSearchSort = (value: unknown): SearchSort => parse(value, SEARCH_SORT_KEYS, DEFAULT_SEARCH_SORT);
export const parseBacklinkSort = (value: unknown): BacklinkSort => parse(value, BACKLINK_SORT_KEYS, DEFAULT_BACKLINK_SORT);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const deviceStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

function read<T>(key: string, parser: (value: unknown) => T, storage: StorageLike | null | undefined): T {
  try {
    const raw = storage?.getItem(key);
    return parser(raw ? JSON.parse(raw) : null);
  } catch {
    return parser(null);
  }
}
function write(key: string, value: unknown, storage: StorageLike | null | undefined): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* the preference simply does not persist */
  }
}

export const readStoredSearchSort = (storage: StorageLike | null | undefined = deviceStorage()): SearchSort => read(SEARCH_SORT_STORAGE_KEY, parseSearchSort, storage);
export const writeStoredSearchSort = (sort: SearchSort, storage: StorageLike | null | undefined = deviceStorage()): void => write(SEARCH_SORT_STORAGE_KEY, sort, storage);
export const readStoredBacklinkSort = (storage: StorageLike | null | undefined = deviceStorage()): BacklinkSort => read(BACKLINK_SORT_STORAGE_KEY, parseBacklinkSort, storage);
export const writeStoredBacklinkSort = (sort: BacklinkSort, storage: StorageLike | null | undefined = deviceStorage()): void => write(BACKLINK_SORT_STORAGE_KEY, sort, storage);

/** The locale key of a sort key's label — one table for both shells and both lists. */
export function listSortLabelKey(key: SearchSortKey | BacklinkSortKey): string {
  switch (key) {
    case "relevance": return "browse.sortRelevance";
    case "modified": return "browse.sortModified";
    case "title": return "browse.sortTitle";
    case "path": return "browse.sortPath";
    case "count": return "browse.sortLinkCount";
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** What a backlink row is called: the note's title, else its file name without the extension. */
export function backlinkTitle(link: Pick<GroupedBacklink, "source_path" | "title">): string {
  const title = link.title?.trim();
  if (title) return title;
  return (link.source_path.split(/[/\\]/).pop() ?? link.source_path).replace(/\.md$/i, "");
}

/**
 * Backlinks in the chosen order. Every comparison ends on the path, so two
 * notes with the same title, time or count never trade places between opens.
 */
export function sortBacklinks<T extends GroupedBacklink>(links: readonly T[], sort: BacklinkSort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...links].sort((a, b) => {
    const primary =
      sort.key === "title" ? collator.compare(backlinkTitle(a), backlinkTitle(b))
      : sort.key === "modified" ? (a.mtime ?? 0) - (b.mtime ?? 0)
      : a.count - b.count;
    if (primary !== 0) return sign * primary;
    return collator.compare(a.source_path, b.source_path);
  });
}
