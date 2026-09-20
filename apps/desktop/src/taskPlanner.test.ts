import { describe, expect, it } from "vitest";
import { addDaysToKey, buildPlanner, comparePlannerRows, UPCOMING_DAYS, type PlannerRow } from "@plainva/ui";

/** Plan Aufgaben-Oberfläche, B1: the lists of the planner over both task sources. */

const TODAY = "2026-09-21";

function row(id: string, over: Partial<PlannerRow> = {}): PlannerRow {
  return {
    id, source: "database", path: `Aufgaben/${id}.md`, title: id, state: "open",
    due: null, dueMinutes: null, priority: 0, tags: [], ...over,
  };
}

describe("buildPlanner", () => {
  it("sorts rows into today (with overdue on top), upcoming by day, inbox and done", () => {
    const planner = buildPlanner([
      row("steuer", { due: "2026-09-18" }),
      row("zahnarzt", { due: "2026-09-20", source: "note", ordinal: 3 }),
      row("angebot", { due: TODAY, dueMinutes: 14 * 60, priority: 1 }),
      row("backup", { due: TODAY }),
      row("morgen", { due: "2026-09-22" }),
      row("spaeter", { due: "2026-09-30" }),
      row("irgendwann"),
      row("erledigt", { state: "done", due: "2026-09-19" }),
      row("abgebrochen", { state: "cancelled" }),
      row("in-arbeit", { state: "progress", due: TODAY }),
    ], TODAY);

    expect(planner.counts).toEqual({ overdue: 2, today: 3, upcoming: 2, inbox: 1, done: 2 });
    const today = planner.sections("today");
    expect(today.map((s) => s.kind)).toEqual(["overdue", "today"]);
    // Overdue: the longest-waiting first.
    expect(today[0].rows.map((r) => r.id)).toEqual(["steuer", "zahnarzt"]);
    // Today: priority, then the clock, then the name. "In progress" is open.
    expect(today[1].rows.map((r) => r.id)).toEqual(["angebot", "backup", "in-arbeit"]);
    expect(planner.sections("upcoming").map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ["2026-09-22", ["morgen"]],
      ["2026-09-30", ["spaeter"]],
    ]);
    expect(planner.sections("inbox")[0].rows.map((r) => r.id)).toEqual(["irgendwann"]);
    // Cancelled counts as closed.
    expect(planner.sections("done")[0].rows.map((r) => r.id)).toEqual(["erledigt", "abgebrochen"]);
  });

  it("keeps Today's section even when nothing is due — and drops an empty overdue section", () => {
    const planner = buildPlanner([row("x")], TODAY);
    expect(planner.sections("today")).toEqual([{ key: "today", kind: "today", rows: [] }]);
  });

  it("looks exactly UPCOMING_DAYS ahead; what lies beyond is in no list but All", () => {
    const edge = addDaysToKey(TODAY, UPCOMING_DAYS);
    const beyond = addDaysToKey(TODAY, UPCOMING_DAYS + 1);
    const planner = buildPlanner([row("rand", { due: edge }), row("weit", { due: beyond })], TODAY);
    expect(planner.counts.upcoming).toBe(1);
    expect(planner.counts.inbox).toBe(0);
  });

  it("puts a date it cannot read into the inbox instead of losing the task", () => {
    const planner = buildPlanner([row("kaputt", { due: "nächste Woche" })], TODAY);
    expect(planner.counts.inbox).toBe(1);
  });
});

describe("comparePlannerRows", () => {
  it("ranks a set priority before none, a time before no time, then by name with numbers in order", () => {
    const rows = [
      row("b", { title: "Aufgabe 10" }),
      row("a", { title: "Aufgabe 2" }),
      row("t", { title: "mit Uhrzeit", dueMinutes: 9 * 60 }),
      row("p3", { title: "niedrig", priority: 3 }),
      row("p1", { title: "hoch", priority: 1 }),
    ];
    expect(rows.sort(comparePlannerRows).map((r) => r.id)).toEqual(["p1", "p3", "t", "a", "b"]);
  });
});

describe("addDaysToKey", () => {
  it("crosses months, years and the DST change without drifting", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-10-24", 2)).toBe("2026-10-26"); // European DST ends on the 25th
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
  });
});
