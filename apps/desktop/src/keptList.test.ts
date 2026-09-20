import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyKeptList, keptListFailed, keptListLoaded, keptListLoading, keptListMap, keptListRows } from "@plainva/ui";

/**
 * Finding 2026-09-20 (plan A6): the "From notes" box of the tasks view flickered
 * while a sync moved files — both shells blanked the list on every index change.
 */
describe("kept list", () => {
  const vaultA = { name: "A" };
  const vaultB = { name: "B" };

  it("is loading only until the first load of a source has settled", () => {
    let list = emptyKeptList<string, object>();
    expect(keptListLoading(list, vaultA)).toBe(true);
    expect(keptListRows(list, vaultA)).toEqual([]);

    list = keptListLoaded(["a", "b"], vaultA);
    expect(keptListLoading(list, vaultA)).toBe(false);
    // A reload is running: nothing about the list changes until it arrives.
    expect(keptListRows(list, vaultA)).toEqual(["a", "b"]);
  });

  it("keeps the rows when a reload fails, and never shows another vault's rows", () => {
    const list = keptListLoaded(["a", "b"], vaultA);
    expect(keptListFailed(list, vaultA)).toBe(list);

    // Switched vault: blank at once, and a failing first load settles empty.
    expect(keptListRows(list, vaultB)).toEqual([]);
    expect(keptListLoading(list, vaultB)).toBe(true);
    const failed = keptListFailed(list, vaultB);
    expect(failed).toEqual({ rows: [], source: vaultB });
    expect(keptListLoading(failed, vaultB)).toBe(false);
  });

  it("without a source there is nothing to wait for", () => {
    expect(keptListLoading(emptyKeptList<string, object>(), null)).toBe(false);
    expect(keptListRows(keptListLoaded(["a"], vaultA), null)).toEqual([]);
  });

  it("applies an optimistic change to the rows on screen", () => {
    const list = keptListMap(keptListLoaded([1, 2, 3], vaultA), (rows) => rows.map((n) => n * 2));
    expect(list).toEqual({ rows: [2, 4, 6], source: vaultA });
  });
});

describe("the task views keep their rows", () => {
  // The pattern that flickered: a loading flag raised on every reload, and a
  // list that draws nothing while it is up. Both shells, guarded at the source.
  const files = [
    join(__dirname, "components/tasks/TasksView.tsx"),
    join(__dirname, "../../mobile/src/screens/TasksScreen.tsx"),
  ];
  for (const file of files) {
    it(`${file.split(/[\\/]/).slice(-1)[0]} never raises a loading flag for a reload`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/setLoading\(true\)/);
      expect(source).toMatch(/keptListLoaded\(/);
      expect(source).toMatch(/keptListFailed\(/);
    });
  }
});
