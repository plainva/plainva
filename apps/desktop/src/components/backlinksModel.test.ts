import { describe, expect, it } from "vitest";
import { groupBacklinks } from "./backlinksModel";

describe("groupBacklinks", () => {
  it("collapses repeated sources and counts their occurrences", () => {
    const grouped = groupBacklinks([
      { source_path: "a.md" },
      { source_path: "b.md" },
      { source_path: "a.md" },
      { source_path: "a.md" },
    ]);
    expect(grouped).toEqual([
      { source_path: "a.md", count: 3 },
      { source_path: "b.md", count: 1 },
    ]);
  });

  it("keeps the first-seen order of the sources", () => {
    const grouped = groupBacklinks([
      { source_path: "z.md" },
      { source_path: "a.md" },
      { source_path: "z.md" },
    ]);
    expect(grouped.map((g) => g.source_path)).toEqual(["z.md", "a.md"]);
  });

  it("returns an empty list for no links", () => {
    expect(groupBacklinks([])).toEqual([]);
  });
});
