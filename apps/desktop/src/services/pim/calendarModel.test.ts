import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import {
  bucketEventsByDay,
  buildBlockDraft,
  buildEditCalendarOptions,
  emptyEventForm,
  eventDayKeys,
  eventFormFromEvent,
  eventFormToDraft,
  eventStartDayKey,
  formatTimeRange,
  linkCalendarBlocks,
  shiftDayKey,
  buildTaskBlockDraft,
  calendarPickerOptions,
  minutesToTime,
  nextHalfHourMinutes,
  resolveDefaultCalendarKey,
  splitCalendarKey,
  timeToMinutes,
  writableCalendarsOf,
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
      descriptionTouched: true,
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
      descriptionTouched: false,
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

  it("buildBlockDraft mirrors an event as busy or with details, carrying a series rule", () => {
    const e = { uid: "source-1", title: "Meeting", allDay: false, start: { ts: 1000 }, end: { ts: 2000 }, location: "Room 5", description: "Notes" } as PimEventRow;
    const busy = buildBlockDraft(e, "busy", "Busy");
    expect(busy.title).toBe("Busy");
    expect(busy.location).toBeUndefined();
    expect(busy.description).toBeUndefined();
    expect(busy.start.ts).toBe(1000);
    expect(busy.end.ts).toBe(2000);
    expect(busy.blockOf).toBe("source-1");
    const det = buildBlockDraft(e, "details", "Busy");
    expect(det.title).toBe("Meeting");
    expect(det.location).toBe("Room 5");
    expect(det.description).toBe("Notes");
    // A recurrence (from the source series' master) rides along.
    expect(buildBlockDraft(e, "busy", "Busy", { freq: "weekly" }).recurrence).toEqual({ freq: "weekly" });
    expect(buildBlockDraft(e, "busy", "Busy").recurrence).toBeUndefined();
  });

  it("derives reverse block links without mutating provider rows", () => {
    const original = ev({ uid: "source", start: { ts: 1000 }, end: { ts: 2000 } });
    const block = ev({ uid: "block", accountId: "other", calendarId: "busy", blockOf: "source", start: { ts: 1000 }, end: { ts: 2000 } });
    const linked = linkCalendarBlocks([original, block]);
    expect(linked[0].blockedIn).toEqual([{ accountId: "other", calendarId: "busy", uid: "block" }]);
    expect(linked[1].blockOf).toBe("source");
    expect(original.blockedIn).toBeUndefined();
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
      descriptionTouched: false,
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

describe("buildEditCalendarOptions", () => {
  const opt = (v: string, l: string) => ({ value: v, label: l });
  const writable = [opt("acc calA", "Team · me@work"), opt("acc calB", "Personal · me@work")];
  const calName = new Map([
    ["acc calA", "Team"],
    ["acc calB", "Personal"],
    ["ro readonlyCal", "Holidays"],
  ]);
  const accountLabel = new Map([
    ["acc", "me@work"],
    ["ro", "sub@shared"],
  ]);

  it("prepends the event's own calendar with its name when it is not writable (read-only/subscribed)", () => {
    const e = ev({ accountId: "ro", calendarId: "readonlyCal", start: { ts: 0 }, end: { ts: 0 } });
    const out = buildEditCalendarOptions(e, writable, calName, accountLabel, true);
    // Without this the Select would render the raw "ro readonlyCal" key.
    expect(out[0]).toEqual(opt("ro readonlyCal", "Holidays · sub@shared"));
    expect(out.slice(1)).toEqual(writable);
  });

  it("leaves the list unchanged when the event's calendar is already a writable option", () => {
    const e = ev({ accountId: "acc", calendarId: "calA", start: { ts: 0 }, end: { ts: 0 } });
    expect(buildEditCalendarOptions(e, writable, calName, accountLabel, true)).toBe(writable);
  });

  it("falls back to the calendarId when the calendar name is unknown", () => {
    const e = ev({ accountId: "ro", calendarId: "ghost", start: { ts: 0 }, end: { ts: 0 } });
    expect(buildEditCalendarOptions(e, writable, calName, accountLabel, true)[0]).toEqual(opt("ro ghost", "ghost · sub@shared"));
  });

  it("omits the account suffix for a single account", () => {
    const e = ev({ accountId: "ro", calendarId: "readonlyCal", start: { ts: 0 }, end: { ts: 0 } });
    expect(buildEditCalendarOptions(e, writable, calName, accountLabel, false)[0]).toEqual(opt("ro readonlyCal", "Holidays"));
  });

  it("returns an empty list for a series (no move picker)", () => {
    const master = ev({ accountId: "acc", calendarId: "calA", seriesMaster: "master-uid", start: { ts: 0 }, end: { ts: 0 } });
    expect(buildEditCalendarOptions(master, writable, calName, accountLabel, true)).toEqual([]);
    const instance = ev({ accountId: "acc", calendarId: "calA", recurrence: "FREQ=WEEKLY", start: { ts: 0 }, end: { ts: 0 } });
    expect(buildEditCalendarOptions(instance, writable, calName, accountLabel, true)).toEqual([]);
  });
});

describe("writable calendars (shared picker rule)", () => {
  const cals = [
    { id: "a", name: "Work", accountId: "acc1" },
    { id: "b", name: "Hidden", accountId: "acc1" },
    { id: "c", name: "Holidays", accountId: "acc1", readOnly: true },
    { id: "d", name: "Other", accountId: "acc2" },
  ];

  it("keeps calendars that are merely hidden — visibility is not a write permission", () => {
    // The regression this pins: gating on `selected` used to hide calendars
    // one may legitimately write a block into.
    const out = writableCalendarsOf(cals, new Set(["acc1", "acc2"]));
    expect(out.map((c) => c.id)).toEqual(["a", "b", "d"]);
  });

  it("drops read-only calendars and calendars of disabled accounts", () => {
    expect(writableCalendarsOf(cals, new Set(["acc1"])).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("appends the account name only when more than one account exists", () => {
    const label = new Map([["acc1", "me@work"]]);
    expect(calendarPickerOptions([cals[0]], label, false)).toEqual([{ value: "acc1 a", label: "Work" }]);
    expect(calendarPickerOptions([cals[0]], label, true)).toEqual([{ value: "acc1 a", label: "Work · me@work" }]);
  });

  it("falls back to the first option when the preferred calendar is gone", () => {
    const options = [{ value: "acc1 a" }, { value: "acc1 b" }];
    expect(resolveDefaultCalendarKey(options, "acc1 b")).toBe("acc1 b");
    expect(resolveDefaultCalendarKey(options, "acc9 zz")).toBe("acc1 a");
    expect(resolveDefaultCalendarKey([], "acc1 a")).toBe("");
  });

  it("splits the picker key at the FIRST space only (CalDAV ids contain spaces)", () => {
    expect(splitCalendarKey("acc1 https://dav/cal/my cal/")).toEqual({ accountId: "acc1", calendarId: "https://dav/cal/my cal/" });
    expect(splitCalendarKey("acc1")).toBeNull();
    expect(splitCalendarKey("")).toBeNull();
  });
});

describe("task time blocking", () => {
  it("rounds up to the next half hour and never rolls past the day", () => {
    expect(nextHalfHourMinutes(new Date(2026, 6, 26, 9, 1))).toBe(9 * 60 + 30);
    expect(nextHalfHourMinutes(new Date(2026, 6, 26, 9, 30))).toBe(9 * 60 + 30);
    expect(nextHalfHourMinutes(new Date(2026, 6, 26, 23, 55))).toBe(23 * 60);
  });

  it("round-trips HH:MM and rejects nonsense", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(9 * 60 + 5)).toBe("09:05");
    expect(timeToMinutes("09:05")).toBe(9 * 60 + 5);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9:5")).toBeNull();
    expect(timeToMinutes("nope")).toBeNull();
  });

  it("builds a timed event of the requested length that links back to the note", () => {
    const draft = buildTaskBlockDraft({
      title: "Write the report",
      values: { dayKey: "2026-08-03", startTime: "13:00", durationMinutes: 120 },
      noteTarget: "Tasks/Report",
    });
    expect(draft.allDay).toBe(false);
    expect(draft.title).toBe("Write the report");
    expect(draft.end.ts - draft.start.ts).toBe(120 * 60 * 1000);
    expect(new Date(draft.start.ts).getHours()).toBe(13); // local wall clock
    // A wiki link, not a provider-private property: it stays readable in
    // Google Calendar and Outlook.
    expect(draft.description).toBe("[[Tasks/Report]]");
    expect(draft.descriptionHtml).toContain("Tasks/Report");
  });

  it("omits the description for a task without a note and enforces a minimum length", () => {
    const draft = buildTaskBlockDraft({ title: "Quick", values: { dayKey: "2026-08-03", startTime: "08:00", durationMinutes: 0 } });
    expect(draft.description).toBeUndefined();
    expect(draft.descriptionHtml).toBeUndefined();
    expect(draft.end.ts - draft.start.ts).toBe(5 * 60 * 1000);
  });

  it("falls back to 09:00 when the start time is unparseable", () => {
    const draft = buildTaskBlockDraft({ title: "T", values: { dayKey: "2026-08-03", startTime: "", durationMinutes: 30 } });
    expect(new Date(draft.start.ts).getHours()).toBe(9);
  });
});
