import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import { bucketEventsByDay, eventDayKeys, eventStartDayKey, formatTimeRange } from "./calendarModel";

function ev(partial: Partial<PimEventRow> & { start: PimEventRow["start"]; end: PimEventRow["end"] }): PimEventRow {
  return {
    accountId: "acc",
    calendarId: "cal",
    uid: partial.uid ?? "uid-1",
    title: partial.title ?? "Event",
    allDay: partial.allDay ?? false,
    ...partial,
  } as PimEventRow;
}

const localTs = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

describe("eventDayKeys", () => {
  it("buckets a timed event on its local day", () => {
    const e = ev({ start: { ts: localTs(2026, 7, 20, 10) }, end: { ts: localTs(2026, 7, 20, 11) } });
    expect(eventDayKeys(e)).toEqual(["2026-07-20"]);
  });

  it("spans a timed event across every local day it touches", () => {
    const e = ev({ start: { ts: localTs(2026, 7, 20, 22) }, end: { ts: localTs(2026, 7, 22, 2) } });
    expect(eventDayKeys(e)).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });

  it("treats a midnight end as exclusive (no bucket on the end day)", () => {
    const e = ev({ start: { ts: localTs(2026, 7, 20, 18) }, end: { ts: localTs(2026, 7, 21, 0) } });
    expect(eventDayKeys(e)).toEqual(["2026-07-20"]);
  });

  it("uses civil dates for all-day events (end exclusive, no timezone math)", () => {
    const e = ev({
      allDay: true,
      start: { ts: Date.UTC(2026, 6, 20), date: "2026-07-20" },
      end: { ts: Date.UTC(2026, 6, 22), date: "2026-07-22" },
    });
    expect(eventDayKeys(e)).toEqual(["2026-07-20", "2026-07-21"]);
  });

  it("keeps a broken all-day range (end <= start) on its start day", () => {
    const e = ev({
      allDay: true,
      start: { ts: Date.UTC(2026, 6, 20), date: "2026-07-20" },
      end: { ts: Date.UTC(2026, 6, 20), date: "2026-07-20" },
    });
    expect(eventDayKeys(e)).toEqual(["2026-07-20"]);
  });

  it("survives an all-day range crossing a month boundary", () => {
    const e = ev({
      allDay: true,
      start: { ts: Date.UTC(2026, 6, 31), date: "2026-07-31" },
      end: { ts: Date.UTC(2026, 7, 2), date: "2026-08-02" },
    });
    expect(eventDayKeys(e)).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("bucketEventsByDay", () => {
  it("sorts each day all-day first, then by start time", () => {
    const timedLate = ev({ uid: "b", title: "Later", start: { ts: localTs(2026, 7, 20, 14) }, end: { ts: localTs(2026, 7, 20, 15) } });
    const timedEarly = ev({ uid: "a", title: "Early", start: { ts: localTs(2026, 7, 20, 9) }, end: { ts: localTs(2026, 7, 20, 10) } });
    const allDay = ev({
      uid: "c",
      title: "Holiday",
      allDay: true,
      start: { ts: Date.UTC(2026, 6, 20), date: "2026-07-20" },
      end: { ts: Date.UTC(2026, 6, 21), date: "2026-07-21" },
    });
    const map = bucketEventsByDay([timedLate, allDay, timedEarly]);
    expect(map.get("2026-07-20")?.map((e) => e.uid)).toEqual(["c", "a", "b"]);
  });

  it("lists a multi-day event on every covered day", () => {
    const e = ev({ start: { ts: localTs(2026, 7, 20, 23) }, end: { ts: localTs(2026, 7, 21, 1) } });
    const map = bucketEventsByDay([e]);
    expect(map.get("2026-07-20")).toHaveLength(1);
    expect(map.get("2026-07-21")).toHaveLength(1);
  });
});

describe("eventStartDayKey / formatTimeRange", () => {
  it("prefers the civil date for all-day events", () => {
    const e = ev({ allDay: true, start: { ts: Date.UTC(2026, 6, 20), date: "2026-07-20" }, end: { ts: Date.UTC(2026, 6, 21), date: "2026-07-21" } });
    expect(eventStartDayKey(e)).toBe("2026-07-20");
  });

  it("formats a timed range and stays empty for all-day", () => {
    const timed = ev({ start: { ts: localTs(2026, 7, 20, 10, 0) }, end: { ts: localTs(2026, 7, 20, 10, 30) } });
    const range = formatTimeRange(timed, "de");
    expect(range).toContain("10:00");
    expect(range).toContain("10:30");
    const allDay = ev({ allDay: true, start: { ts: 0, date: "2026-07-20" }, end: { ts: 0, date: "2026-07-21" } });
    expect(formatTimeRange(allDay, "de")).toBe("");
  });
});
