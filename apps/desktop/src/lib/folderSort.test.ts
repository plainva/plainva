import { describe, it, expect } from "vitest";
import {
  compareFolderEntries,
  matchesFolderQuery,
  nextFolderSort,
  parseFolderSort,
  readStoredFolderSort,
  sortFolderEntries,
  timesAreUniform,
  writeStoredFolderSort,
  DEFAULT_FOLDER_SORT,
} from "@plainva/ui";

const items = [
  { title: "Note 10", mtime: 300, ctime: 30 },
  { title: "Note 2", mtime: 100, ctime: 10 },
  { title: "älter", mtime: 200 },
  { title: "Zeta", mtime: undefined, ctime: 20 },
];

describe("folder sort (feedback round 2026-09-01, P11)", () => {
  it("sorts names naturally and accent-blind", () => {
    expect(sortFolderEntries(items, { key: "title", dir: "asc" }).map((i) => i.title)).toEqual(["älter", "Note 2", "Note 10", "Zeta"]);
    expect(sortFolderEntries(items, { key: "title", dir: "desc" }).map((i) => i.title)).toEqual(["Zeta", "Note 10", "Note 2", "älter"]);
  });

  it("sorts by time newest first by default, unknown times last, ties by name", () => {
    expect(sortFolderEntries(items, { key: "modified", dir: "desc" }).map((i) => i.title)).toEqual(["Note 10", "älter", "Note 2", "Zeta"]);
    expect(sortFolderEntries(items, { key: "modified", dir: "asc" }).map((i) => i.title)).toEqual(["Note 2", "älter", "Note 10", "Zeta"]);
    expect(sortFolderEntries(items, { key: "created", dir: "desc" }).map((i) => i.title)).toEqual(["Note 10", "Zeta", "Note 2", "älter"]);
    expect(compareFolderEntries({ title: "b", mtime: 1 }, { title: "a", mtime: 1 }, { key: "modified", dir: "desc" })).toBeGreaterThan(0);
  });

  it("choosing a key switches to it with its natural direction; choosing it again flips", () => {
    expect(nextFolderSort(DEFAULT_FOLDER_SORT, "modified")).toEqual({ key: "modified", dir: "desc" });
    expect(nextFolderSort({ key: "modified", dir: "desc" }, "modified")).toEqual({ key: "modified", dir: "asc" });
    expect(nextFolderSort({ key: "modified", dir: "asc" }, "title")).toEqual({ key: "title", dir: "asc" });
  });

  it("filters case- and accent-insensitively, every word must match", () => {
    expect(matchesFolderQuery("Ärztliche Überweisung", "arzt")).toBe(true);
    expect(matchesFolderQuery("Ärztliche Überweisung", "uber arzt")).toBe(true);
    expect(matchesFolderQuery("Ärztliche Überweisung", "arzt zahn")).toBe(false);
    expect(matchesFolderQuery("anything", "   ")).toBe(true);
  });

  it("says when the times cannot tell rows apart", () => {
    expect(timesAreUniform([{ title: "a", mtime: 1_020_000 }, { title: "b", mtime: 1_030_000 }, { title: "c", mtime: 1_059_000 }])).toBe(true);
    expect(timesAreUniform([{ title: "a", mtime: 1_000_000 }, { title: "b", mtime: 5_000_000 }])).toBe(false);
    expect(timesAreUniform([{ title: "a", mtime: 1 }])).toBe(false);
    expect(timesAreUniform([{ title: "a" }, { title: "b" }])).toBe(true);
  });

  it("round-trips through storage and tolerates garbage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeStoredFolderSort({ key: "created", dir: "asc" }, storage);
    expect(readStoredFolderSort(storage)).toEqual({ key: "created", dir: "asc" });
    store.set("plainva-folder-sort", "{{{");
    expect(readStoredFolderSort(storage)).toEqual(DEFAULT_FOLDER_SORT);
    expect(parseFolderSort({ key: "bogus", dir: "sideways" })).toEqual(DEFAULT_FOLDER_SORT);
    expect(parseFolderSort({ key: "modified" })).toEqual({ key: "modified", dir: "desc" });
  });
});
