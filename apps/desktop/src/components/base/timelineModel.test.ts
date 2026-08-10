import { describe, it, expect } from "vitest";
import { barFor, compareRows, edgeDrag, moveBar, stepWindow, windowAround, windowDays } from "@plainva/ui";

/**
 * The timeline as a row per entry (S21). Every assertion here can write a date
 * into someone's note, so each has a red counter-proof noted in the loop's § 5.
 */

const week = windowDays({ scale: "week", from: "2026-08-10" });

describe("the window", () => {
  it("shows as many days as its scale says, starting where it says", () => {
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-08-10");
    expect(week[6]).toBe("2026-08-16");
    expect(windowDays({ scale: "quarter", from: "2026-08-10" })).toHaveLength(91);
  });

  it("steps by a whole screenful", () => {
    expect(stepWindow({ scale: "week", from: "2026-08-10" }, 1).from).toBe("2026-08-17");
    expect(stepWindow({ scale: "threeWeeks", from: "2026-08-10" }, -1).from).toBe("2026-07-20");
  });

  it("puts a day in view WITH some past context", () => {
    // Starting exactly on today would hide everything that led up to it.
    const w = windowAround("2026-08-10", "week");
    expect(w.from).toBe("2026-08-08");
    expect(windowDays(w)).toContain("2026-08-10");
  });
});

describe("barFor", () => {
  it("spans the columns between start and end", () => {
    expect(barFor("2026-08-11", "2026-08-13", week)).toEqual({ startCol: 1, endCol: 3, clippedStart: false, clippedEnd: false });
  });

  it("is a one-day bar without an end", () => {
    // On a timeline a single date is still a point one wants to see and drag.
    expect(barFor("2026-08-12", undefined, week)).toEqual({ startCol: 2, endCol: 2, clippedStart: false, clippedEnd: false });
  });

  it("clips at both edges and says so", () => {
    const bar = barFor("2026-08-01", "2026-08-25", week)!;
    expect(bar).toMatchObject({ startCol: 0, endCol: 6, clippedStart: true, clippedEnd: true });
  });

  it("is null when the entry lies outside the window entirely", () => {
    expect(barFor("2026-09-01", "2026-09-02", week)).toBeNull();
    expect(barFor("kein Datum", undefined, week)).toBeNull();
  });
});

describe("edgeDrag", () => {
  const base = { currentStart: "2026-08-11", currentEnd: "2026-08-13", hasEnd: true };

  it("moves the end, and only the end", () => {
    expect(edgeDrag({ ...base, edge: "end", toDay: "2026-08-15" })).toEqual({ end: "2026-08-15" });
  });

  it("moves the start, and only the start", () => {
    expect(edgeDrag({ ...base, edge: "start", toDay: "2026-08-09" })).toEqual({ start: "2026-08-09" });
  });

  it("never lets one edge cross the other", () => {
    // An end before its start is not a shorter task, it is a broken record.
    expect(edgeDrag({ ...base, edge: "end", toDay: "2026-08-05" })).toEqual({ end: "2026-08-11" });
    expect(edgeDrag({ ...base, edge: "start", toDay: "2026-08-20" })).toEqual({ start: "2026-08-13" });
  });

  it("does not invent an end when the view has no end column", () => {
    // A gesture about the beginning must not create an end that the database
    // has nowhere to keep.
    expect(edgeDrag({ currentStart: "2026-08-11", currentEnd: undefined, hasEnd: false, edge: "end", toDay: "2026-08-15" })).toEqual({});
  });

  it("writes nothing when the edge did not actually move", () => {
    expect(edgeDrag({ ...base, edge: "end", toDay: "2026-08-13" })).toEqual({});
    expect(edgeDrag({ ...base, edge: "start", toDay: "2026-08-11" })).toEqual({});
  });
});

describe("moveBar", () => {
  it("keeps the length when the whole bar moves", () => {
    // Dragging a three-day task must not turn it into a one-day task.
    expect(moveBar({ toDay: "2026-08-20", currentStart: "2026-08-11", currentEnd: "2026-08-13", hasEnd: true })).toEqual({
      start: "2026-08-20",
      end: "2026-08-22",
    });
  });

  it("moves a single date without giving it an end", () => {
    expect(moveBar({ toDay: "2026-08-20", currentStart: "2026-08-11", currentEnd: undefined, hasEnd: true })).toEqual({ start: "2026-08-20" });
  });
});

describe("compareRows", () => {
  it("orders by start, then by the longer bar, then by name", () => {
    const rows = [
      { start: "2026-08-12", end: "2026-08-12", name: "B" },
      { start: "2026-08-11", end: "2026-08-11", name: "A" },
      { start: "2026-08-12", end: "2026-08-20", name: "C" },
    ];
    expect([...rows].sort(compareRows).map((r) => r.name)).toEqual(["A", "C", "B"]);
  });
});

describe("the colour column survives a save (S21)", () => {
  it("round-trips through the plainva namespace, invisible to Obsidian", async () => {
    const { parseBaseConfig, serializeBaseConfig } = await import("@plainva/ui");
    const yaml = serializeBaseConfig({
      filters: { and: ['file.folder == "P"'] },
      columns: {},
      views: [{ type: "table", name: "Zeit", plainva: { render: "timeline" }, dateField: "start", colorBy: "status" }],
    } as never);
    // Obsidian only ever sees its own four top-level keys — the colour column
    // lives in the tolerated namespace.
    expect(yaml).toContain("colorBy: status");
    expect(yaml).not.toMatch(/^\s{4}colorBy:/m);
    expect((parseBaseConfig(yaml) as any).views[0].colorBy).toBe("status");
  });
});
