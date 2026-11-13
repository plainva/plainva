// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wholeIndexReader } from "@plainva/core";
// Imported up front (the mocks below are hoisted above it): a loaded machine took over the test timeout importing it inside the test.
import { rescheduleReminders } from "./reminderScheduler";
// The scheduler imports the vault service when it runs; loaded here first, its mock is what it gets.
import "./vaultService";

/**
 * Reminders are not replanned from half an index (performance plan L3, review
 * of 11.11.). Every run of the phone's scheduler cancels what the system holds
 * and schedules what it finds; the checkbox reminders come from the index. With
 * the first index now built behind the open app — also in the app's own
 * container —, a run during the build cancelled the reminders of every note
 * not read yet, and the app sent to the background before the build ended
 * never scheduled them again.
 */
const notifications = vi.hoisted(() => ({
  pending: [{ id: 1 }] as Array<{ id: number; extra?: { kind: string } }>,
  cancel: vi.fn(async () => {}),
  schedule: vi.fn(async () => {}),
}));
const index = vi.hoisted(() => ({ whole: false, becameWhole: null as null | (() => void) }));
const appointments = vi.hoisted(() => ({ remind: false, events: [] as unknown[] }));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    getPending: async () => ({ notifications: notifications.pending }),
    cancel: notifications.cancel,
    schedule: notifications.schedule,
    registerActionTypes: async () => {},
    addListener: async () => ({ remove: () => {} }),
  },
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));
vi.mock("./mobileSettings", () => ({
  getMobileSettings: () => ({
    remindEvents: appointments.remind,
    remindTasks: false,
    remindCheckboxes: true,
    reminderCalendars: [],
    reminderLeadMinutes: 10,
    reminderAllDayLeadDays: 0,
    reminderAllDayAtMinutes: 540,
    reminderTaskLeadDays: 0,
    reminderTaskAtMinutes: 540,
    reminderTaskTimedLead: 0,
    taskDatabase: "",
  }),
}));
vi.mock("./pim/pimService", () => ({
  getPimCache: () => (appointments.remind ? { listEvents: async () => appointments.events } : null),
}));
vi.mock("./vaultService", () => ({
  getMobileVault: async () => ({
    vaultId: "v",
    queryService: wholeIndexReader({
      indexWholeness: () => (index.whole ? { kind: "whole" } : { kind: "building", done: 1, total: 9 }),
      untilWholeIndex: () => new Promise<void>((resolve) => { index.becameWhole = resolve; }),
      listTasks: async () => [],
    }),
  }),
}));

afterEach(() => {
  notifications.cancel.mockClear();
  notifications.schedule.mockClear();
});

describe("the phone's reminders while the index is not whole", () => {
  it("cancel nothing during the build, and are planned again once it is whole", async () => {
    await rescheduleReminders();
    expect(notifications.cancel).not.toHaveBeenCalled();
    index.whole = true;
    index.becameWhole?.();
    await vi.waitFor(() => expect(notifications.cancel).toHaveBeenCalled(), { timeout: 10_000 });
  }, 60_000);

  it("plan the appointments during the build all the same, and keep what the index planned", async () => {
    // Appointments do not come from the index. The whole run used to wait for
    // it — and after a build that failed, nothing was planned all session.
    index.whole = false;
    appointments.remind = true;
    const start = Date.now() + 3 * 3_600_000;
    appointments.events = [{
      uid: "e1", title: "Dentist", start: { ts: start, date: null }, allDay: false, reminders: [30], accountId: "a", calendarId: "c",
    }];
    notifications.pending = [{ id: 1, extra: { kind: "task" } }, { id: 2, extra: { kind: "event" } }];
    await rescheduleReminders();
    // The old appointment reminder goes, the task reminder of the index stays.
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 2, extra: { kind: "event" } }] });
    const scheduled = (notifications.schedule.mock.calls[notifications.schedule.mock.calls.length - 1] as unknown as [{ notifications: Array<{ id: number; extra: { kind: string } }> }])[0].notifications;
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((n) => n.extra.kind === "event")).toBe(true);
    // Not on the id the kept task reminder holds.
    expect(scheduled.some((n) => n.id === 1)).toBe(false);
    appointments.remind = false;
  });
});
