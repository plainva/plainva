import { describe, expect, it } from "vitest";
import { DevicePimTarget, deviceFieldVersion, deviceHandleOf, PimConflictError } from "../src/index.js";
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
