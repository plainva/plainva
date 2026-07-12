import { describe, expect, it } from "vitest";
import { dropRecentEntry, parseRecentsFile, pushRecentEntry, serializeRecentsFile } from "@plainva/ui";

/** Shared .plainva/recents.json contract (plan Mobile M3E 2026-07-12, B1). */
describe("recentsFile", () => {
  it("round-trips the canonical shape", () => {
    const entries = [
      { path: "A.md", openedAt: 100 },
      { path: "B/C.md", openedAt: 50 },
    ];
    expect(parseRecentsFile(serializeRecentsFile(entries))).toEqual(entries);
  });

  it("tolerates a bare array, missing timestamps and junk entries", () => {
    expect(parseRecentsFile('[{"path":"A.md"},{"nope":1},"str",{"path":7}]')).toEqual([
      { path: "A.md", openedAt: 0 },
    ]);
    expect(parseRecentsFile("broken")).toEqual([]);
    expect(parseRecentsFile('{"foo":[]}')).toEqual([]);
  });

  it("pushRecentEntry dedupes to the front and caps the list", () => {
    let list = pushRecentEntry([], "A.md", 1);
    list = pushRecentEntry(list, "B.md", 2);
    list = pushRecentEntry(list, "A.md", 3);
    expect(list.map((e) => e.path)).toEqual(["A.md", "B.md"]);
    expect(list[0].openedAt).toBe(3);

    const many = Array.from({ length: 25 }, (_, i) => ({ path: `n${i}.md`, openedAt: i }));
    expect(pushRecentEntry(many, "new.md", 99)).toHaveLength(20);
  });

  it("dropRecentEntry removes a stale path", () => {
    const list = [
      { path: "A.md", openedAt: 2 },
      { path: "B.md", openedAt: 1 },
    ];
    expect(dropRecentEntry(list, "A.md").map((e) => e.path)).toEqual(["B.md"]);
  });
});
