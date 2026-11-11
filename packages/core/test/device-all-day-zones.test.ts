import { afterEach, describe, expect, it } from "vitest";
import { DevicePimTarget, type DeviceAllDayAnchor, type DeviceEventDraft, type DeviceEventHandle, type DeviceEventRecord, type DevicePimPort } from "../src/index.js";

/**
 * An all-day event on the device calendar, in zones on both sides of UTC
 * (found 2026-11-10 with the tests at 23:59 in New York). Android's
 * CalendarContract keeps the day at UTC midnight, EventKit at local midnight.
 * Read as local midnight, an Android all-day event lay a day early in the
 * Americas; written as UTC midnight, an iPhone there created it a day early.
 * Each zone is the process zone for its case: Date's local reading follows it.
 */
const ZONES = ["America/New_York", "America/Los_Angeles", "Pacific/Honolulu", "Europe/Berlin", "Asia/Tokyo", "Pacific/Auckland"];
const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

class Port implements DevicePimPort {
  readonly supportsReminders = false;
  rows: DeviceEventRecord[] = [];
  constructor(readonly allDayAt: DeviceAllDayAnchor) {}
  listCollections = async () => [{ id: "cal", title: "Cal", writable: true, kind: "event" as const }];
  events = async () => this.rows;
  event = async (h: DeviceEventHandle) => this.rows.find((r) => r.id === h.id) ?? null;
  createEvent = async (_c: string, d: DeviceEventDraft) => {
    const row = { id: `e${this.rows.length}`, title: d.title, startTs: d.startTs, endTs: d.endTs, allDay: d.allDay, version: "v1" };
    this.rows.push(row);
    return row;
  };
  updateEvent = async (h: DeviceEventHandle, d: DeviceEventDraft) => {
    const row = this.rows.find((r) => r.id === h.id)!;
    Object.assign(row, { startTs: d.startTs, endTs: d.endTs, allDay: d.allDay, version: "v2" });
    return row;
  };
  deleteEvent = async () => {};
  reminders = async () => [];
  reminder = async () => null;
  createReminder = async () => { throw new Error("none"); };
  updateReminder = async () => { throw new Error("none"); };
  deleteReminder = async () => {};
}

/** What the edit form writes for an all-day day: UTC midnight and the date. */
const formDay = (date: string) => ({ ts: Date.parse(`${date}T00:00:00Z`), date });

describe("an all-day event on the device calendar, in every zone", () => {
  for (const zone of ZONES) {
    for (const at of ["utc", "local"] as const) {
      it(`${zone}, ${at === "utc" ? "Android (UTC midnight)" : "iPhone (local midnight)"}: is stored on the meant day, read back as that day, and moved by whole days`, async () => {
        process.env.TZ = zone;
        expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
        const port = new Port(at);
        const target = new DevicePimTarget(port);
        const stored = (date: string) => (at === "utc" ? Date.parse(`${date}T00:00:00Z`) : new Date(`${date}T00:00:00`).getTime());

        const made = await target.createEvent("cal", { title: "Holiday", allDay: true, start: formDay("2026-11-11"), end: formDay("2026-11-12") });
        expect([port.rows[0]!.startTs, port.rows[0]!.endTs]).toEqual([stored("2026-11-11"), stored("2026-11-12")]);

        const read = (await target.pullEvents("cal", 0, Date.UTC(2027, 0, 1))).events[0]!;
        expect([read.start.date, read.end.date]).toEqual(["2026-11-11", "2026-11-12"]);

        await target.updateEvent({ calendarId: "cal", uid: made.uid, etag: "v1" }, { title: "Holiday", allDay: true, start: formDay("2026-11-12"), end: formDay("2026-11-14") });
        expect([port.rows[0]!.startTs, port.rows[0]!.endTs]).toEqual([stored("2026-11-12"), stored("2026-11-14")]);
        const moved = (await target.pullEvents("cal", 0, Date.UTC(2027, 0, 1))).events[0]!;
        expect([moved.start.date, moved.end.date]).toEqual(["2026-11-12", "2026-11-14"]);
      });
    }
  }

  it("lies across a change of summer time as whole days on the local clock", async () => {
    process.env.TZ = "Europe/Berlin";
    const port = new Port("local");
    const target = new DevicePimTarget(port);
    await target.createEvent("cal", { title: "Weekend", allDay: true, start: formDay("2026-10-24"), end: formDay("2026-10-26") });
    expect([port.rows[0]!.startTs, port.rows[0]!.endTs]).toEqual([new Date(2026, 9, 24).getTime(), new Date(2026, 9, 26).getTime()]);
    const read = (await target.pullEvents("cal", 0, Date.UTC(2027, 0, 1))).events[0]!;
    expect([read.start.date, read.end.date]).toEqual(["2026-10-24", "2026-10-26"]);
  });
});
