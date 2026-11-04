// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the phone plans its reminders again (Sammelplan § 3.145 Nr. 1, E3).
 *
 * The operating system holds what the last run handed it. A box ticked, a line
 * given another time, a note renamed — none of it reached the OS before: the
 * runs came at app start, after a calendar cycle and on returning to the app,
 * so a task finished in the app was still announced, from memory, once the
 * app was closed. Now a change of the vault plans again after a quiet spell
 * (task reminders only — appointments do not live in the vault), and so does
 * going into the background, the moment after which the notifications fire.
 */

const { notifications, settings, appListeners } = vi.hoisted(() => ({
  notifications: {
    checkPermissions: vi.fn(async () => ({ display: "granted" })),
    requestPermissions: vi.fn(),
    getPending: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(),
    schedule: vi.fn(),
    registerActionTypes: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  },
  settings: { remindEvents: false, remindTasks: false, remindCheckboxes: true, taskDatabase: "", reminderCalendars: [] as string[] },
  appListeners: [] as Array<(state: { isActive: boolean }) => void>,
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: notifications }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_name: string, listener: (state: { isActive: boolean }) => void) => {
      appListeners.push(listener);
      return { remove: async () => {} };
    }),
  },
}));
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/pim/pimService", () => ({ getPimCache: () => null }));
vi.mock("./services/vaultService", () => ({
  getMobileVault: async () => ({ vaultId: "v1", queryService: { listTasks: async () => [] } }),
  vaultOps: { read: async () => "" },
}));

import { initReminderScheduler } from "./services/reminderScheduler";

describe("reminder triggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initReminderScheduler();
    notifications.checkPermissions.mockClear();
    settings.remindTasks = false;
    settings.remindCheckboxes = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plans again after the vault changed, once for a burst of changes", async () => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new CustomEvent("m-paths-indexed"));
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(notifications.checkPermissions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(notifications.checkPermissions).toHaveBeenCalledTimes(1);
  });

  it("does not plan on a change of the vault while no task reminds", async () => {
    settings.remindCheckboxes = false;
    window.dispatchEvent(new CustomEvent("m-paths-indexed"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(notifications.checkPermissions).not.toHaveBeenCalled();
  });

  it("plans again when the app goes into the background, not only when it comes back", async () => {
    expect(appListeners.length).toBeGreaterThan(0);
    appListeners[0]({ isActive: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(notifications.checkPermissions).toHaveBeenCalledTimes(1);
  });
});
