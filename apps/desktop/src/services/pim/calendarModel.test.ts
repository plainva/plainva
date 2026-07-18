import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import {
  bucketEventsByDay,
  emptyEventForm,
  eventDayKeys,
  eventFormFromEvent,
  eventFormToDraft,
  eventStartDayKey,
  formatTimeRange,
  shiftDayKey,
} from "./calendarModel";

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

describe("event form helpers (stage 3)", () => {
  it("shiftDayKey does calendar math across month boundaries", () => {
    expect(shiftDayKey("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDayKey("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("timed form values become a LOCAL wall-clock draft; end<=start falls back to +30min", () => {
    const draft = eventFormToDraft({
      title: " Planning ",
      allDay: false,
      dayKey: "2026-08-01",
      endDayKey: "2026-08-01",
      startTime: "10:00",
      endTime: "11:30",
      location: " Raum 5 ",
      description: " Agenda besprechen ",
      color: " #f4511e ",
      calendarKey: "a c",
      attendees: "",
      attendeesTouched: false,
      notifyAttendees: false,
      repeatFreq: "",
      repeatInterval: 1,
      repeatByWeekday: [],
      repeatEnd: "never",
      repeatUntil: "",
      repeatCount: 10,
      repeatTouched: false,
    });
    expect(draft.title).toBe("Planning");
    expect(draft.location).toBe("Raum 5");
    expect(draft.description).toBe("Agenda besprechen");
    expect(draft.color).toBe("#f4511e");
    expect(draft.allDay).toBe(false);
    expect(draft.start.ts).toBe(new Date(2026, 7, 1, 10, 0).getTime());
    expect(draft.end.ts).toBe(new Date(2026, 7, 1, 11, 30).getTime());
    const inverted = eventFormToDraft({
      title: "X",
      allDay: false,
      dayKey: "2026-08-01",
      endDayKey: "2026-08-01",
      startTime: "10:00",
      endTime: "09:00",
      location: "",
      description: "",
      color: "",
      calendarKey: "",
      attendees: "",
      attendeesTouched: false,
      notifyAttendees: false,
      repeatFreq: "",
      repeatInterval: 1,
      repeatByWeekday: [],
      repeatEnd: "never",
      repeatUntil: "",
      repeatCount: 10,
      repeatTouched: false,
    });
    expect(inverted.end.ts).toBe(inverted.start.ts + 30 * 60 * 1000);
  });

  it("notifyAttendees only rides along when there are invitees", () => {
    const base = emptyEventForm("2026-08-01", "a c");
    // no invitees -> gated off even when flagged (default true)
    expect(eventFormToDraft(base).notifyAttendees).toBeUndefined();
    const withInvitees = { ...base, attendees: "x@y.org", attendeesTouched: true, notifyAttendees: true };
    expect(eventFormToDraft(withInvitees).notifyAttendees).toBe(true);
    // invitees present but the box unchecked -> not sent
    expect(eventFormToDraft({ ...withInvitees, notifyAttendees: false }).notifyAttendees).toBeUndefined();
  });

  it("all-day form values convert the inclusive dialog end to the exclusive iCal end", () => {
    const draft = eventFormToDraft({
      title: "Urlaub",
      allDay: true,
      dayKey: "2026-08-10",
      endDayKey: "2026-08-12",
      startTime: "",
      endTime: "",
      location: "",
      description: "",
      color: "",
      calendarKey: "",
      attendees: "",
      attendeesTouched: false,
      notifyAttendees: false,
      repeatFreq: "",
      repeatInterval: 1,
      repeatByWeekday: [],
      repeatEnd: "never",
      repeatUntil: "",
      repeatCount: 10,
      repeatTouched: false,
    });
    expect(draft.start.date).toBe("2026-08-10");
    expect(draft.end.date).toBe("2026-08-13");
  });

  it("round-trips an all-day event through the form (exclusive -> inclusive -> exclusive)", () => {
    const e = ev({
      allDay: true,
      title: "Messe",
      start: { ts: Date.UTC(2026, 7, 10), date: "2026-08-10" },
      end: { ts: Date.UTC(2026, 7, 13), date: "2026-08-13" },
    });
    const form = eventFormFromEvent(e);
    expect(form.dayKey).toBe("2026-08-10");
    expect(form.endDayKey).toBe("2026-08-12"); // inclusive display
    const draft = eventFormToDraft(form);
    expect(draft.end.date).toBe("2026-08-13"); // exclusive again
  });

  it("prefills a timed event with its local times and colour", () => {
    const e = ev({ start: { ts: localTs(2026, 8, 1, 14, 30) }, end: { ts: localTs(2026, 8, 1, 15, 0) }, color: "#33b679" });
    const form = eventFormFromEvent(e);
    expect(form.dayKey).toBe("2026-08-01");
    expect(form.startTime).toBe("14:30");
    expect(form.endTime).toBe("15:00");
    expect(form.calendarKey).toBe("acc cal");
    expect(form.color).toBe("#33b679");
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

  it("only writes attendees / recurrence when the user touched them (else undefined)", () => {
    const base = emptyEventForm("2026-08-01", "acc cal");
    // Untouched: both stay undefined (a drag / unrelated edit preserves them).
    const untouched = eventFormToDraft({ ...base, title: "X", attendees: "a@b.de", repeatFreq: "weekly" });
    expect(untouched.attendees).toBeUndefined();
    expect(untouched.recurrence).toBeUndefined();
    // Touched: written.
    const touched = eventFormToDraft({ ...base, title: "X", attendees: "a@b.de, a@b.de\nc@d.de", attendeesTouched: true, repeatFreq: "weekly", repeatInterval: 2, repeatByWeekday: ["MO"], repeatEnd: "count", repeatCount: 6, repeatTouched: true });
    expect(touched.attendees).toEqual(["a@b.de", "c@d.de"]); // deduped, split on comma/newline
    expect(touched.recurrence).toEqual({ freq: "weekly", interval: 2, byWeekday: ["MO"], count: 6 });
    // "none" with a touched control clears the rule.
    const cleared = eventFormToDraft({ ...base, repeatFreq: "", repeatTouched: true });
    expect(cleared.recurrence).toBeNull();
  });

  it("fills the recurrence controls from an existing RRULE (edit an existing series)", () => {
    const e = ev({ start: { ts: Date.parse("2026-08-01T08:00:00Z") }, end: { ts: Date.parse("2026-08-01T09:00:00Z") }, recurrence: "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4" });
    const form = eventFormFromEvent(e);
    expect(form.repeatFreq).toBe("weekly");
    expect(form.repeatInterval).toBe(2);
    expect(form.repeatByWeekday).toEqual(["MO", "WE"]);
    expect(form.repeatEnd).toBe("count");
    expect(form.repeatCount).toBe(4);
    // A Graph master exposes only the pattern type -> at least the frequency.
    expect(eventFormFromEvent(ev({ start: { ts: 0 }, end: { ts: 0 }, recurrence: "absoluteMonthly" })).repeatFreq).toBe("monthly");
  });
});
