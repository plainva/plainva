// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
  pending: [{ id: 1 }] as Array<{ id: number }>,
  cancel: vi.fn(async () => {}),
  schedule: vi.fn(async () => {}),
}));
const index = vi.hoisted(() => ({ whole: false, becameWhole: null as null | (() => void) }));

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
    remindEvents: false,
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
vi.mock("./pim/pimService", () => ({ getPimCache: () => null }));
vi.mock("./vaultService", () => ({
  getMobileVault: async () => ({
    vaultId: "v",
    queryService: {
      indexWholeness: () => (index.whole ? { kind: "whole" } : { kind: "building", done: 1, total: 9 }),
      untilWholeIndex: () => new Promise<void>((resolve) => { index.becameWhole = resolve; }),
      listTasks: async () => [],
    },
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
});
