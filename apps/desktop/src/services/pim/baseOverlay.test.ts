import { describe, it, expect } from "vitest";
import { loadBaseOverlay, overlayCandidates, overlayKey, parseOverlayKey } from "@plainva/ui";
import { bucketBackdrop } from "./eventBackdrop";
import type { PimEventRow } from "@plainva/core";

/**
 * The calendar overlay (S18, plan P9a): which database views may join the
 * calendar, what they contribute, and the backdrop in the other direction.
 */

const BASE = `filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.milestone:
    displayName: Milestone
views:
  - type: table
    name: All
    order: [file.name]
  - type: calendar
    name: Milestones
    dateField: milestone
    order: [file.name]
  - type: calendar
    name: Broken
    order: [file.name]
  - type: timeline
    name: Phases
    dateField: start
    endField: finish
    order: [file.name]
`;

describe("overlayCandidates", () => {
  it("offers calendar and timeline views that name their date column", () => {
    const cands = overlayCandidates("Projects.base", "Projects", BASE);
    expect(cands.map((c) => c.viewName)).toEqual(["Milestones", "Phases"]);
    expect(cands[0]).toMatchObject({ kind: "calendar", dateField: "milestone", label: "Projects · Milestones" });
    expect(cands[1]).toMatchObject({ kind: "timeline", dateField: "start", endField: "finish" });
  });

  it("skips a calendar view WITHOUT a date column", () => {
    // A toggle for it would switch on and place nothing — worse than absent.
    expect(overlayCandidates("Projects.base", "Projects", BASE).some((c) => c.viewName === "Broken")).toBe(false);
  });

  it("skips table views and survives an unparseable file", () => {
    expect(overlayCandidates("x.base", "x", BASE).some((c) => c.viewName === "All")).toBe(false);
    expect(overlayCandidates("x.base", "x", "\t: [not yaml")).toEqual([]);
  });
});

describe("overlay keys", () => {
  it("round-trips a path that itself contains a hash", () => {
    const ref = { basePath: "Area #1/Projects.base", viewName: "Milestones" };
    expect(parseOverlayKey(overlayKey(ref))).toEqual(ref);
  });

  it("rejects malformed keys instead of inventing a view", () => {
    expect(parseOverlayKey("Projects.base")).toBeNull();
    expect(parseOverlayKey("Projects.base#")).toBeNull();
    expect(parseOverlayKey("#Milestones")).toBeNull();
  });
});

function deps(rows: Record<string, unknown>[], source = BASE) {
  const queries: unknown[] = [];
  return {
    queries,
    vaultAdapter: { readTextFile: async () => source },
    queryService: {
      queryDatabaseFiles: async (config: unknown) => {
        queries.push(config);
        return rows;
      },
    },
  };
}

describe("loadBaseOverlay", () => {
  const rows = [
    { "file.path": "Projects/Alpha.md", "file.name": "Alpha", milestone: "2026-08-12", start: "2026-08-12", finish: "2026-08-20" },
    { "file.path": "Projects/Beta.md", "file.name": "Beta", milestone: "2026-08-13T14:30" },
    { "file.path": "Projects/Gamma.md", "file.name": "Gamma" },
  ];

  it("places the rows of the SELECTED view only", async () => {
    const d = deps(rows);
    const out = await loadBaseOverlay(["Projects.base#Milestones"], [{ path: "Projects.base", title: "Projects" }], d);
    expect(out.map((e) => e.title)).toEqual(["Alpha", "Beta"]);
    expect(out[0]).toMatchObject({ day: "2026-08-12", source: "Projects · Milestones", dateField: "milestone" });
    // A row without a date has nothing to place — it is skipped, not guessed.
    expect(out.some((e) => e.title === "Gamma")).toBe(false);
  });

  it("keeps the time when the column carries one", async () => {
    const out = await loadBaseOverlay(["Projects.base#Milestones"], [], deps(rows));
    expect(out.find((e) => e.title === "Beta")?.minutes).toBe(14 * 60 + 30);
  });

  it("carries the end day of a timeline span", async () => {
    const out = await loadBaseOverlay(["Projects.base#Phases"], [], deps(rows));
    expect(out[0]).toMatchObject({ day: "2026-08-12", endDay: "2026-08-20" });
  });

  it("ignores a selection whose view does not exist", async () => {
    expect(await loadBaseOverlay(["Projects.base#Gone"], [], deps(rows))).toEqual([]);
  });

  it("lets one unreadable database cost only its OWN entries", async () => {
    const d = {
      vaultAdapter: {
        readTextFile: async (p: string) => {
          if (p === "Broken.base") throw new Error("gone");
          return BASE;
        },
      },
      queryService: { queryDatabaseFiles: async () => rows },
    };
    const out = await loadBaseOverlay(["Broken.base#Milestones", "Projects.base#Milestones"], [], d);
    expect(out.map((e) => e.title)).toEqual(["Alpha", "Beta"]);
  });

  it("asks the query for the database's source AND the view's own filters", async () => {
    const source = BASE.replace(
      "    name: Milestones\n",
      "    name: Milestones\n    filters:\n      and:\n        - 'status != \"done\"'\n"
    );
    const d = deps(rows, source);
    await loadBaseOverlay(["Projects.base#Milestones"], [], d);
    // Both halves reach the query — a view that hides rows must not have them
    // reappear in the calendar.
    // Only the `filters` the query is HANDED counts — the config carries its
    // views along regardless, so asserting on the whole object proves nothing.
    const asked = JSON.stringify((d.queries[0] as { filters?: unknown }).filters);
    expect(asked).toContain("status !=");
    expect(asked).toContain("file.folder ==");
  });
});

describe("bucketBackdrop", () => {
  const ev = (uid: string, title: string, start: string, end?: string): PimEventRow =>
    ({
      uid,
      title,
      allDay: true,
      start: { date: start },
      end: { date: end ?? start },
      accountId: "a",
      calendarId: "c",
    }) as unknown as PimEventRow;

  it("counts a day's appointments and keeps a few titles", () => {
    const map = bucketBackdrop([ev("1", "Jour fixe", "2026-08-12"), ev("2", "Review", "2026-08-12")]);
    expect(map.get("2026-08-12")).toEqual({ count: 2, titles: ["Jour fixe", "Review"] });
  });

  it("counts a multi-day appointment on EVERY day it covers", () => {
    // "What else is on this day" — a span is on all of them.
    const map = bucketBackdrop([ev("1", "Offsite", "2026-08-12", "2026-08-14")]);
    expect([...map.keys()].sort()).toEqual(["2026-08-12", "2026-08-13"]);
  });
});
