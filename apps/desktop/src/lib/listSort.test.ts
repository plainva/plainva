import { describe, expect, it } from "vitest";
import {
  BACKLINK_SORT_STORAGE_KEY,
  DEFAULT_BACKLINK_SORT,
  DEFAULT_SEARCH_SORT,
  SEARCH_SORT_STORAGE_KEY,
  backlinkTitle,
  listSortLabelKey,
  nextBacklinkSort,
  nextSearchSort,
  parseBacklinkSort,
  parseSearchSort,
  readStoredBacklinkSort,
  readStoredSearchSort,
  sortBacklinks,
  writeStoredBacklinkSort,
  writeStoredSearchSort,
  type GroupedBacklink,
} from "@plainva/ui";

/**
 * The order of search hits and backlinks (finding 2026-09-19). Backlinks had
 * none — the query carried no ORDER BY — and search hits had exactly one. Both
 * follow the file tree's idiom now; these pin the idiom and the tie-breaks
 * that keep a list from reshuffling between two opens.
 */

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const link = (source_path: string, extra: Partial<GroupedBacklink> = {}): GroupedBacklink => ({
  source_path,
  count: 1,
  lines: [],
  title: null,
  mtime: null,
  ...extra,
});

describe("search sort", () => {
  it("starts on relevance, and relevance has no direction to flip", () => {
    expect(DEFAULT_SEARCH_SORT).toEqual({ key: "relevance", dir: "desc" });
    expect(nextSearchSort(DEFAULT_SEARCH_SORT, "relevance")).toEqual({ key: "relevance", dir: "desc" });
  });

  it("a key starts in its natural direction; the same key again flips it", () => {
    expect(nextSearchSort(DEFAULT_SEARCH_SORT, "modified")).toEqual({ key: "modified", dir: "desc" });
    expect(nextSearchSort({ key: "modified", dir: "desc" }, "modified")).toEqual({ key: "modified", dir: "asc" });
    expect(nextSearchSort({ key: "modified", dir: "asc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSearchSort({ key: "title", dir: "asc" }, "path")).toEqual({ key: "path", dir: "asc" });
  });

  it("reads back what it wrote and survives a damaged or foreign value", () => {
    const storage = memoryStorage();
    expect(readStoredSearchSort(storage)).toEqual(DEFAULT_SEARCH_SORT);
    writeStoredSearchSort({ key: "title", dir: "desc" }, storage);
    expect(JSON.parse(storage.data.get(SEARCH_SORT_STORAGE_KEY)!)).toEqual({ key: "title", dir: "desc" });
    expect(readStoredSearchSort(storage)).toEqual({ key: "title", dir: "desc" });
    storage.setItem(SEARCH_SORT_STORAGE_KEY, "{not json");
    expect(readStoredSearchSort(storage)).toEqual(DEFAULT_SEARCH_SORT);
    expect(parseSearchSort({ key: "count", dir: "asc" })).toEqual(DEFAULT_SEARCH_SORT);
    // A stored ascending relevance is nonsense; it reads as relevance.
    expect(parseSearchSort({ key: "relevance", dir: "asc" })).toEqual(DEFAULT_SEARCH_SORT);
  });
});

describe("backlink sort", () => {
  it("starts on the title, A to Z", () => {
    expect(DEFAULT_BACKLINK_SORT).toEqual({ key: "title", dir: "asc" });
    expect(nextBacklinkSort(DEFAULT_BACKLINK_SORT, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextBacklinkSort(DEFAULT_BACKLINK_SORT, "count")).toEqual({ key: "count", dir: "desc" });
    expect(nextBacklinkSort(DEFAULT_BACKLINK_SORT, "modified")).toEqual({ key: "modified", dir: "desc" });
  });

  it("keeps its own storage slot", () => {
    const storage = memoryStorage();
    writeStoredBacklinkSort({ key: "count", dir: "desc" }, storage);
    expect(storage.data.has(BACKLINK_SORT_STORAGE_KEY)).toBe(true);
    expect(storage.data.has(SEARCH_SORT_STORAGE_KEY)).toBe(false);
    expect(readStoredBacklinkSort(storage)).toEqual({ key: "count", dir: "desc" });
    expect(parseBacklinkSort({ key: "relevance" })).toEqual(DEFAULT_BACKLINK_SORT);
  });

  it("names a row by the note's title and falls back to the file name", () => {
    expect(backlinkTitle(link("Projects/plan.md", { title: "Project plan" }))).toBe("Project plan");
    expect(backlinkTitle(link("Projects/plan.md", { title: "  " }))).toBe("plan");
    expect(backlinkTitle(link("Projects/plan.md"))).toBe("plan");
  });

  it("orders by title with numbers read as numbers, whatever order the index returned", () => {
    const rows = [link("c.md", { title: "Note 10" }), link("a.md", { title: "note 2" }), link("b.md", { title: "Alpha" })];
    expect(sortBacklinks(rows, { key: "title", dir: "asc" }).map((r) => r.source_path)).toEqual(["b.md", "a.md", "c.md"]);
    expect(sortBacklinks(rows, { key: "title", dir: "desc" }).map((r) => r.source_path)).toEqual(["c.md", "a.md", "b.md"]);
    // The input stays as it was - the panels memoise on it.
    expect(rows.map((r) => r.source_path)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("orders by time and by count, most first, and breaks every tie on the path", () => {
    const rows = [
      link("z.md", { mtime: 100, count: 2 }),
      link("a.md", { mtime: 300, count: 2 }),
      link("m.md", { mtime: 300, count: 5 }),
    ];
    expect(sortBacklinks(rows, { key: "modified", dir: "desc" }).map((r) => r.source_path)).toEqual(["a.md", "m.md", "z.md"]);
    expect(sortBacklinks(rows, { key: "count", dir: "desc" }).map((r) => r.source_path)).toEqual(["m.md", "a.md", "z.md"]);
    expect(sortBacklinks(rows, { key: "count", dir: "asc" }).map((r) => r.source_path)).toEqual(["a.md", "z.md", "m.md"]);
  });
});

describe("one label table for both lists and both shells", () => {
  it("maps every key to a locale key under browse.*", () => {
    expect(listSortLabelKey("relevance")).toBe("browse.sortRelevance");
    expect(listSortLabelKey("modified")).toBe("browse.sortModified");
    expect(listSortLabelKey("title")).toBe("browse.sortTitle");
    expect(listSortLabelKey("path")).toBe("browse.sortPath");
    expect(listSortLabelKey("count")).toBe("browse.sortLinkCount");
  });
});
