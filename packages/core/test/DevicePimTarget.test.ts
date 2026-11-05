import { describe, expect, it } from "vitest";
import { DevicePimTarget, deviceFieldVersion, deviceHandleOf, deviceUpdateSpan, anchorSeriesDraft, PimConflictError } from "../src/index.js";
import type { DeviceCollection, DeviceEventDraft, DeviceEventHandle, DeviceEventRecord, DevicePimPort, DeviceReminderDraft, DeviceReminderRecord } from "../src/index.js";

/**
 * The device provider against a fake port (plan EventKit K1). What is pinned:
 * the collections split into calendars and reminder lists, a series arrives as
 * expanded instances plus ONE master with the rule, the etag promise holds
 * through the port's version stamp, reminders round-trip, and Android (no
 * reminder store) is honestly empty rather than broken.
 */
class FakePort implements DevicePimPort {
  readonly supportsReminders: boolean;
  collections: DeviceCollection[] = [
    { id: "cal-1", title: "Privat", color: "#4a8f8b", source: "iCloud", writable: true, kind: "event" },
    { id: "cal-ro", title: "Feiertage", source: "iCloud", writable: false, kind: "event" },
    { id: "list-1", title: "Erinnerungen", writable: true, kind: "reminder" },
  ];
  eventRows: DeviceEventRecord[] = [];
  reminderRows: DeviceReminderRecord[] = [];
  seq = 0;
  writes: string[] = [];
  reminderDrafts: DeviceReminderDraft[] = [];

  constructor(supportsReminders = true) {
    this.supportsReminders = supportsReminders;
  }

  async listCollections() {
    return this.collections;
  }
  async events(calendarId: string, fromTs: number, toTs: number) {
    return this.eventRows.filter((e) => e.startTs < toTs && e.endTs > fromTs && this.calendarOf(e.id) === calendarId);
  }
  async event(handle: DeviceEventHandle) {
    return this.eventRows.find((e) => e.id === handle.id && (handle.occurrenceStartTs === undefined || e.startTs === handle.occurrenceStartTs)) ?? null;
  }
  async createEvent(calendarId: string, draft: DeviceEventDraft) {
    const rec: DeviceEventRecord = { id: `${calendarId}:e${++this.seq}`, ...this.fields(draft), version: `m${this.seq}` };
    if (draft.rrule) rec.rrule = draft.rrule;
    this.eventRows.push(rec);
    this.writes.push(`create ${rec.id}`);
    return rec;
  }
  async updateEvent(handle: DeviceEventHandle, draft: DeviceEventDraft) {
    const rec = await this.event(handle);
    if (!rec) throw new Error("gone");
    Object.assign(rec, this.fields(draft), { version: `m${++this.seq}` });
    if (draft.rrule === null) delete rec.rrule;
    else if (draft.rrule) rec.rrule = draft.rrule;
    this.writes.push(`update ${handle.id}${handle.occurrenceStartTs !== undefined ? "@" + handle.occurrenceStartTs : ""}`);
    return rec;
  }
  async deleteEvent(handle: DeviceEventHandle) {
    this.eventRows = this.eventRows.filter((e) => e.id !== handle.id);
    this.writes.push(`delete ${handle.id}`);
  }
  async reminders(listId: string) {
    return this.reminderRows.filter((r) => r.listId === listId);
  }
  async reminder(id: string) {
    return this.reminderRows.find((r) => r.id === id) ?? null;
  }
  async createReminder(listId: string, draft: DeviceReminderDraft) {
    const rec: DeviceReminderRecord = { id: `r${++this.seq}`, listId, ...draft, version: `m${this.seq}` };
    this.reminderRows.push(rec);
    return rec;
  }
  async updateReminder(id: string, draft: DeviceReminderDraft) {
    this.reminderDrafts.push(draft);
    const rec = await this.reminder(id);
    if (!rec) throw new Error("gone");
    Object.assign(rec, draft, { version: `m${++this.seq}` });
    return rec;
  }
  async deleteReminder(id: string) {
    this.reminderRows = this.reminderRows.filter((r) => r.id !== id);
  }

  private calendarOf(id: string) {
    return id.split(":")[0];
  }
  private fields(d: DeviceEventDraft) {
    return { title: d.title, startTs: d.startTs, endTs: d.endTs, allDay: d.allDay, location: d.location, notes: d.notes };
  }
}

const H = 60 * 60 * 1000;
const day0 = Date.UTC(2026, 8, 7, 9); // a Monday, 09:00 UTC

describe("DevicePimTarget", () => {
  it("lists calendars and reminder lists as one collection list, read-only calendars marked", async () => {
    const target = new DevicePimTarget(new FakePort());
    const cols = await target.listCalendars();
    expect(cols.map((c) => [c.id, c.supportsEvents, c.supportsTasks, c.readOnly])).toEqual([
      ["cal-1", true, false, false],
      ["cal-ro", true, false, true],
      ["list-1", false, true, false],
    ]);
    expect(cols[0].name).toBe("Privat · iCloud");
    expect(await target.listTaskLists(cols)).toEqual([{ id: "list-1", name: "Erinnerungen" }]);
  });

  it("gives every occurrence its own uid and emits one master per series", async () => {
    const port = new FakePort();
    port.eventRows = [0, 1, 2].map((week) => ({
      id: "cal-1:series",
      seriesId: "cal-1:series",
      title: "Wochenplanung",
      startTs: day0 + week * 7 * 24 * H,
      endTs: day0 + week * 7 * 24 * H + H,
      allDay: false,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      version: "m1",
    }));
    port.eventRows.push({ id: "cal-1:single", title: "Zahnarzt", startTs: day0 + 2 * H, endTs: day0 + 3 * H, allDay: false, version: "m2" });
    const target = new DevicePimTarget(port);
    const { events } = await target.pullEvents("cal-1", day0 - H, day0 + 30 * 24 * H);
    const instances = events.filter((e) => e.seriesMaster);
    const masters = events.filter((e) => e.recurrence);
    expect(instances.map((e) => e.uid)).toEqual([`cal-1:series@${day0}`, `cal-1:series@${day0 + 7 * 24 * H}`, `cal-1:series@${day0 + 14 * 24 * H}`]);
    expect(masters).toHaveLength(1);
    expect(masters[0]).toMatchObject({ uid: "cal-1:series", recurrence: "RRULE:FREQ=WEEKLY;BYDAY=MO" });
    expect(events.find((e) => e.uid === "cal-1:single")?.etag).toBe("m2");
    // The uid carries what the port needs to find that occurrence again.
    expect(deviceHandleOf(`cal-1:series@${day0}`)).toEqual({ id: "cal-1:series", occurrenceStartTs: day0 });
    expect(deviceHandleOf("cal-1:single")).toEqual({ id: "cal-1:single" });
  });

  it("all-day events carry civil dates", async () => {
    const port = new FakePort();
    port.eventRows = [{ id: "cal-1:ad", title: "Urlaub", startTs: Date.UTC(2026, 8, 10), endTs: Date.UTC(2026, 8, 11), allDay: true, version: "m1" }];
    const { events } = await target(port).pullEvents("cal-1", 0, Date.UTC(2027, 0, 1));
    expect(events[0].allDay).toBe(true);
    expect(events[0].start.date).toMatch(/^2026-09-\d\d$/);
  });

  it("keeps the etag promise: a moved version refuses the write, a matching one goes through", async () => {
    const port = new FakePort();
    const t = target(port);
    const created = await t.createEvent("cal-1", { title: "A", start: { ts: day0 }, end: { ts: day0 + H }, allDay: false });
    expect(created.etag).toBe("m1");
    // Someone else edited on the device: the version moved.
    port.eventRows[0].version = "m9";
    await expect(
      t.updateEvent({ calendarId: "cal-1", uid: created.uid, etag: "m1" }, { title: "B", start: { ts: day0 }, end: { ts: day0 + H }, allDay: false }),
    ).rejects.toBeInstanceOf(PimConflictError);
    const ok = await t.updateEvent({ calendarId: "cal-1", uid: created.uid, etag: "m9" }, { title: "B", start: { ts: day0 }, end: { ts: day0 + H }, allDay: false });
    expect(ok.etag).toBe("m2");
    expect(port.eventRows[0].title).toBe("B");
  });

  it("a recurrence in the draft becomes the platform's rule; leaving it out leaves the rule alone", async () => {
    const port = new FakePort();
    const t = target(port);
    const created = await t.createEvent("cal-1", {
      title: "Standup", start: { ts: day0 }, end: { ts: day0 + H }, allDay: false,
      recurrence: { freq: "weekly", interval: 1, byWeekday: ["MO", "WE"] },
    });
    expect(port.eventRows[0].rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(created.uid).toBe(`cal-1:e1@${day0}`);
    // A drag moves the time and says nothing about the rule.
    await t.updateEvent({ calendarId: "cal-1", uid: created.uid, etag: "m1" }, { title: "Standup", start: { ts: day0 + H }, end: { ts: day0 + 2 * H }, allDay: false });
    expect(port.eventRows[0].rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(port.writes.at(-1)).toBe(`update cal-1:e1@${day0}`);
    // The moved occurrence has a new uid (its start is part of it), as the next pull would show.
    const moved = `cal-1:e1@${day0 + H}`;
    // `null` removes it.
    await t.updateEvent({ calendarId: "cal-1", uid: moved, etag: "m2" }, { title: "Standup", start: { ts: day0 + H }, end: { ts: day0 + 2 * H }, allDay: false, recurrence: null });
    expect(port.eventRows[0].rrule).toBeUndefined();
  });

  it("deleting what is already gone is a success", async () => {
    const t = target(new FakePort());
    await expect(t.deleteEvent({ calendarId: "cal-1", uid: "cal-1:nothing" })).resolves.toBeUndefined();
  });

  it("reminders round-trip as tasks with the version as etag", async () => {
    const port = new FakePort();
    const t = target(port);
    const created = await t.createTask("list-1", { title: "Milch", due: "2026-09-08", completed: false });
    expect(created).toEqual({ uid: "r1", etag: "m1" });
    const { tasks } = await t.pullTasks("list-1");
    expect(tasks).toEqual([{ uid: "r1", listId: "list-1", title: "Milch", notes: undefined, due: "2026-09-08", completed: false, etag: "m1" }]);
    port.reminderRows[0].version = "m5";
    await expect(t.updateTask({ listId: "list-1", uid: "r1", etag: "m1" }, { title: "Milch", completed: true })).rejects.toBeInstanceOf(PimConflictError);
    const ok = await t.updateTask({ listId: "list-1", uid: "r1", etag: "m5" }, { title: "Milch", completed: true });
    expect(ok.etag).toBe("m2");
    await t.deleteTask({ listId: "list-1", uid: "r1" });
    expect(port.reminderRows).toEqual([]);
  });

  it("a reminder says whether it repeats", async () => {
    const port = new FakePort();
    port.reminderRows = [
      { id: "r1", listId: "list-1", title: "Probe", due: "2026-10-24T09:00", completed: false, version: "m1", recurring: true },
      { id: "r2", listId: "list-1", title: "Milch", completed: false, version: "m2", recurring: false },
    ];
    const { tasks } = await target(port).pullTasks("list-1");
    expect(tasks.map((t) => [t.uid, t.recurring])).toEqual([["r1", true], ["r2", false]]);
  });

  it("an update answers with the task as the device holds it after the write", async () => {
    // EventKit moves a completed recurring reminder on inside the save itself:
    // the answer is the next occurrence, not what was sent.
    const port = new FakePort();
    port.reminderRows = [{ id: "r1", listId: "list-1", title: "Probe", due: "2026-10-24T09:00", completed: false, version: "m1", recurring: true }];
    port.updateReminder = async (id, draft) => {
      port.reminderDrafts.push(draft);
      const rec = port.reminderRows.find((r) => r.id === id)!;
      Object.assign(rec, { completed: false, due: "2026-10-25T09:00", version: "m2" });
      return { ...rec };
    };
    const res = await target(port).updateTask({ listId: "list-1", uid: "r1", etag: "m1" }, { title: "Probe", due: "2026-10-24T09:00", completed: true });
    expect(res.etag).toBe("m2");
    expect(res.task).toMatchObject({ uid: "r1", listId: "list-1", title: "Probe", due: "2026-10-25T09:00", completed: false, etag: "m2", recurring: true });
  });

  it("a draft without notes leaves the reminder's notes alone; an empty one clears them", async () => {
    const port = new FakePort();
    port.reminderRows = [{ id: "r1", listId: "list-1", title: "Milch", notes: "2 Liter, Hafer", completed: false, version: "m1" }];
    const t = target(port);
    // What the task sync sends: no notes - and a due that is not there.
    await t.updateTask({ listId: "list-1", uid: "r1", etag: "m1" }, { title: "Milch", due: undefined, notes: undefined, completed: true });
    expect("notes" in port.reminderDrafts[0]!).toBe(false);
    expect(port.reminderRows[0]!.notes).toBe("2 Liter, Hafer");
    await t.updateTask({ listId: "list-1", uid: "r1" }, { title: "Milch", notes: "", completed: true });
    expect(port.reminderDrafts[1]!.notes).toBe("");
  });

  it("without a reminder store (Android) there are no task lists, and writing one says so", async () => {
    const port = new FakePort(false);
    const t = target(port);
    const cols = await t.listCalendars();
    expect(cols.map((c) => c.id)).toEqual(["cal-1", "cal-ro"]);
    expect(await t.listTaskLists(cols)).toEqual([]);
    expect(await t.pullTasks("list-1")).toEqual({ tasks: [] });
    await expect(t.createTask("list-1", { title: "x", completed: false })).rejects.toThrow(/no reminder store/);
  });

  it("the field version is stable and moves with a visible change", () => {
    const a = deviceFieldVersion({ title: "A", startTs: 1, endTs: 2 });
    expect(a).toBe(deviceFieldVersion({ title: "A", startTs: 1, endTs: 2, notes: "" }));
    expect(a).not.toBe(deviceFieldVersion({ title: "B", startTs: 1, endTs: 2 }));
    expect(a).toMatch(/^f[0-9a-f]+$/);
  });
});

function target(port: DevicePimPort) {
  return new DevicePimTarget(port);
}

describe("deviceUpdateSpan (iPhone: All events without a rule change)", () => {
  const draft: DeviceEventDraft = { title: "T", startTs: 1, endTs: 2, allDay: false };

  it("treats a handle without an occurrence start as the whole event", () => {
    expect(deviceUpdateSpan(deviceHandleOf("series-1"), draft)).toBe("series");
  });

  it("treats an occurrence handle with the rule left alone as this event", () => {
    expect(deviceUpdateSpan(deviceHandleOf("series-1@1700000000000"), draft)).toBe("occurrence");
  });

  it("treats any write that carries a rule - even a removal - as the series", () => {
    expect(deviceUpdateSpan(deviceHandleOf("series-1@1700000000000"), { ...draft, rrule: "FREQ=DAILY" })).toBe("series");
    expect(deviceUpdateSpan(deviceHandleOf("series-1@1700000000000"), { ...draft, rrule: null })).toBe("series");
  });
});

describe("a series-wide save moves the series by what the person changed (iPhone/Android 'All events')", () => {
  const at = (day: number, h: number, m = 0, month = 10) => new Date(2026, month, day, h, m, 0, 0).getTime();
  const first = { startTs: at(2, 9) }; // Monday, first occurrence of a weekly series
  // The sheet opened on the master row, whose start is the 4th occurrence (W).
  const opened = { startTs: at(23, 9) };
  const draft = (over: Partial<DeviceEventDraft> = {}): DeviceEventDraft => ({ title: "Jour fixe", startTs: at(23, 9), endTs: at(23, 10), allDay: false, ...over });

  it("a title-only change keeps start and end exactly", () => {
    const out = anchorSeriesDraft(first, draft({ title: "Neu" }), opened);
    expect(out).toMatchObject({ title: "Neu", startTs: at(2, 9), endTs: at(2, 10) });
  });

  it("a time-only change from the 4th occurrence keeps the first date with the new time", () => {
    const out = anchorSeriesDraft(first, draft({ startTs: at(23, 9, 30), endTs: at(23, 10, 30) }), opened);
    expect(out.startTs).toBe(at(2, 9, 30));
    expect(out.endTs).toBe(at(2, 10, 30));
  });

  it("a date move by +1 day from the 4th occurrence moves the first occurrence by +1 day", () => {
    const out = anchorSeriesDraft(first, draft({ startTs: at(24, 9), endTs: at(24, 10) }), opened);
    expect(out.startTs).toBe(at(3, 9));
    expect(out.endTs).toBe(at(3, 10));
  });

  it("keeps the wall-clock time across a DST change (first occurrence in October, opened in November)", () => {
    // Europe/Berlin switched on 2026-10-25; elsewhere this is plain arithmetic and holds as well.
    const f = { startTs: at(19, 9, 0, 9) };
    const w = { startTs: at(23, 9) };
    const out = anchorSeriesDraft(f, draft({ startTs: at(23, 9, 30), endTs: at(23, 10, 30) }), w);
    expect(out.startTs).toBe(at(19, 9, 30, 9));
    expect(out.endTs).toBe(at(19, 10, 30, 9));
  });

  it("an all-day series: unchanged keeps the first day, +1 day moves it, the switch lays the day on the first date", () => {
    const utc = (day: number) => Date.UTC(2026, 10, day);
    const f = { startTs: utc(2) };
    const orig = { startTs: utc(23), date: "2026-11-23" };
    const allDay = (day: number): DeviceEventDraft => ({ title: "x", allDay: true, startTs: utc(day), endTs: utc(day + 1) });
    expect(anchorSeriesDraft(f, allDay(23), orig)).toMatchObject({ startTs: utc(2), endTs: utc(3) });
    expect(anchorSeriesDraft(f, allDay(24), orig)).toMatchObject({ startTs: utc(3), endTs: utc(4) });
    // From a timed event to all-day (no row date): the original day is its local date.
    const timed = anchorSeriesDraft({ startTs: at(2, 9) }, allDay(23), { startTs: at(23, 9) });
    expect(timed.allDay).toBe(true);
    expect(timed.startTs).toBe(utc(2));
  });

  it("is applied by the target to a series save, not to an occurrence save or a single event", async () => {
    const port = new FakePort(true);
    const row = (id: string, startTs: number, rrule?: string): DeviceEventRecord => ({
      id, title: "Jour fixe", startTs, endTs: startTs + 3_600_000, allDay: false, version: "v", ...(rrule ? { rrule, seriesId: id } : {}),
    });
    port.eventRows = [row("cal-1:s", at(2, 9), "FREQ=WEEKLY"), row("cal-1:single", at(5, 9))];
    const t = target(port);
    const d = (title: string, day: number) => ({ title, allDay: false, start: { ts: at(day, 9, 30) }, end: { ts: at(day, 10, 30) } });

    await t.updateEvent({ calendarId: "cal-1", uid: "cal-1:s", originalStartTs: at(23, 9) }, d("A", 23));
    expect(port.eventRows[0]).toMatchObject({ startTs: at(2, 9, 30), endTs: at(2, 10, 30) });

    await t.updateEvent({ calendarId: "cal-1", uid: "cal-1:single", originalStartTs: at(5, 9) }, d("B", 6));
    expect(port.eventRows[1]).toMatchObject({ startTs: at(6, 9, 30) });

    await t.updateEvent({ calendarId: "cal-1", uid: `cal-1:s@${at(2, 9, 30)}` }, d("C", 9));
    expect(port.eventRows[0]).toMatchObject({ startTs: at(9, 9, 30) });
  });
});
