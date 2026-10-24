import { describe, expect, it } from "vitest";
import { groupRecentsByDay, recentDayLabel } from "@plainva/ui";

/** The full "Recent" list, grouped by day (plan Rückmeldungen 2026-10-24, E8). */
describe("groupRecentsByDay", () => {
  // Saturday, 24 October 2026, 10:30 local time.
  const now = new Date(2026, 9, 24, 10, 30);
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  const shape = (groups: ReturnType<typeof groupRecentsByDay<{ path: string; at?: number }>>) =>
    groups.map((g) => [g.kind, g.day ?? null, g.items.map((i) => i.path)]);

  it("puts today, yesterday and older days under their own heading, newest first", () => {
    const entries = [
      { path: "Older.md", at: at(20, 9) },
      { path: "Morning.md", at: at(24, 8, 5) },
      { path: "Evening.md", at: at(23, 18, 40) },
      { path: "Now.md", at: at(24, 10, 24) },
      { path: "Night.md", at: at(23, 0, 10) },
    ];
    expect(shape(groupRecentsByDay(entries, (e) => e.at, now))).toEqual([
      ["today", "2026-10-24", ["Now.md", "Morning.md"]],
      ["yesterday", "2026-10-23", ["Evening.md", "Night.md"]],
      ["day", "2026-10-20", ["Older.md"]],
    ]);
  });

  it("splits at local midnight, not at UTC midnight", () => {
    const entries = [
      { path: "JustBefore.md", at: at(23, 23, 59) },
      { path: "JustAfter.md", at: at(24, 0, 1) },
    ];
    expect(shape(groupRecentsByDay(entries, (e) => e.at, now))).toEqual([
      ["today", "2026-10-24", ["JustAfter.md"]],
      ["yesterday", "2026-10-23", ["JustBefore.md"]],
    ]);
  });

  it("keeps the given order when two opens share a time stamp", () => {
    const t = at(24, 9);
    const entries = [{ path: "B.md", at: t }, { path: "A.md", at: t }];
    expect(shape(groupRecentsByDay(entries, (e) => e.at, now))[0][2]).toEqual(["B.md", "A.md"]);
  });

  it("collects entries without a time in one last group instead of dating them 1970", () => {
    const entries = [{ path: "NoTime.md", at: 0 }, { path: "Today.md", at: at(24, 9) }, { path: "Missing.md" }];
    expect(shape(groupRecentsByDay(entries, (e) => e.at, now))).toEqual([
      ["today", "2026-10-24", ["Today.md"]],
      ["earlier", null, ["NoTime.md", "Missing.md"]],
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupRecentsByDay([], () => 1, now)).toEqual([]);
  });

  it("names the groups: words for today, yesterday and the undated rest, a date for any other day", () => {
    const words = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };
    expect(recentDayLabel({ kind: "today", day: "2026-10-24" }, words, "en", now)).toBe("Today");
    expect(recentDayLabel({ kind: "yesterday", day: "2026-10-23" }, words, "en", now)).toBe("Yesterday");
    expect(recentDayLabel({ kind: "earlier" }, words, "en", now)).toBe("Earlier");
    expect(recentDayLabel({ kind: "day", day: "2026-10-20" }, words, "en", now)).toBe("Tuesday, October 20");
    // The year is said only when it is not this year's.
    expect(recentDayLabel({ kind: "day", day: "2025-12-31" }, words, "en", now)).toBe("Wednesday, December 31, 2025");
  });
});
