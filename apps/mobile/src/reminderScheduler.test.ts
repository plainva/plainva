import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduler around the planner: what it does with the permission, how it
 * replaces the window rather than adding to it, and that two triggers arriving
 * together cannot cancel each other's notifications half-way.
 */

const { notifications, settings, cache } = vi.hoisted(() => ({
  notifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getPending: vi.fn(),
    cancel: vi.fn(),
    schedule: vi.fn(),
    registerActionTypes: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  },
  settings: {
    remindEvents: true,
    reminderLeadMinutes: 15,
    reminderAllDayLeadDays: 1,
    reminderAllDayAtMinutes: 19 * 60,
    remindTasks: false,
    reminderCalendars: [] as string[],
    taskDatabase: "",
  },
  cache: { listEvents: vi.fn() },
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: notifications }));
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/pim/pimService", () => ({ getPimCache: () => cache }));

import { getReminderState, rescheduleReminders } from "./services/reminderScheduler";

const NOW = Date.now();
function event(uid: string, inHours: number, extra: Record<string, unknown> = {}) {
  const ts = NOW + inHours * 3_600_000;
  return { uid, accountId: "a1", calendarId: "c1", title: uid, start: { ts }, end: { ts: ts + 1800_000 }, allDay: false, ...extra };
}

describe("rescheduleReminders", () => {
  beforeEach(() => {
    for (const [name, fn] of Object.entries(notifications)) {
      fn.mockReset();
      if (name === "registerActionTypes") fn.mockResolvedValue(undefined);
      if (name === "addListener") fn.mockResolvedValue({ remove: async () => {} });
    }
    notifications.checkPermissions.mockResolvedValue({ display: "granted" });
    notifications.getPending.mockResolvedValue({ notifications: [] });
    notifications.cancel.mockResolvedValue(undefined);
    notifications.schedule.mockResolvedValue(undefined);
    cache.listEvents.mockReset();
    cache.listEvents.mockResolvedValue([]);
    settings.remindEvents = true;
    settings.remindTasks = false;
    settings.reminderCalendars = [];
  });

  it("schedules an appointment with Doze survival and its identity attached", async () => {
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();

    const [{ notifications: sent }] = notifications.schedule.mock.calls[0];
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("standup");
    // Without allowWhileIdle Android batches the alarm into the next
    // maintenance window — which for a reminder means "after the appointment".
    expect(sent[0].schedule.allowWhileIdle).toBe(true);
    expect(sent[0].extra).toMatchObject({ uid: "standup", accountId: "a1", calendarId: "c1" });
    expect(getReminderState()).toMatchObject({ scheduled: 1, truncatedFrom: null, denied: false });
  });

  it("replaces the window instead of adding to it", async () => {
    notifications.getPending.mockResolvedValue({ notifications: [{ id: 7 }] });
    cache.listEvents.mockResolvedValue([event("neu", 2)]);
    await rescheduleReminders();
    // The old pending set goes first — otherwise a moved or deleted appointment
    // would keep announcing itself from the operating system's memory.
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 7 }] });
    expect(notifications.cancel.mock.invocationCallOrder[0]).toBeLessThan(notifications.schedule.mock.invocationCallOrder[0]);
  });

  it("asks for permission only once reminders are switched on", async () => {
    settings.remindEvents = false;
    await rescheduleReminders();
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(getReminderState().scheduled).toBe(0);
  });

  it("clears what the system still holds when reminders are switched off", async () => {
    settings.remindEvents = false;
    notifications.getPending.mockResolvedValue({ notifications: [{ id: 3 }] });
    await rescheduleReminders();
    // Otherwise the phone keeps announcing appointments after the switch is off.
    expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 3 }] });
  });

  it("says plainly that a refused permission means nothing will fire", async () => {
    notifications.checkPermissions.mockResolvedValue({ display: "denied" });
    notifications.requestPermissions.mockResolvedValue({ display: "denied" });
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(getReminderState().denied).toBe(true);
  });

  it("reports from when on the platform ceiling cuts the plan", async () => {
    cache.listEvents.mockResolvedValue(Array.from({ length: 70 }, (_, i) => event(`e${i}`, i + 1)));
    await rescheduleReminders();
    const [{ notifications: sent }] = notifications.schedule.mock.calls[0];
    expect(sent).toHaveLength(64);
    expect(getReminderState().truncatedFrom).not.toBeNull();
    expect(getReminderState().dropped).toBe(6);
  });

  it("reminds only from the chosen calendars, and from all of them when none is chosen", async () => {
    cache.listEvents.mockResolvedValue([
      { ...event("privat", 2), calendarId: "c1" },
      { ...event("arbeit", 3), calendarId: "c2" },
    ]);
    await rescheduleReminders();
    expect(notifications.schedule.mock.calls[0][0].notifications).toHaveLength(2);

    settings.reminderCalendars = ["a1 c2"];
    await rescheduleReminders();
    const sent = notifications.schedule.mock.calls[1][0].notifications;
    expect(sent.map((n: { title: string }) => n.title)).toEqual(["arbeit"]);
  });

  it("gives an appointment and a task different notification actions", async () => {
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();
    const [{ notifications: sent }] = notifications.schedule.mock.calls[0];
    // The buttons differ because what one can do differs: an appointment gets a
    // meeting note, a task gets ticked off.
    expect(sent[0].actionTypeId).toBe("plainva-event");
    expect(sent[0].extra.kind).toBe("event");
  });

  it("serialises two triggers instead of letting them cancel each other", async () => {
    // A foreground switch that completes a PIM cycle fires both within the same
    // second; two runs interleaving their cancel and schedule calls is exactly
    // how a phone ends up silent.
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    // The gate is created eagerly: an executor inside mockImplementationOnce
    // would not run until the scheduler actually calls getPending, and by then
    // the test has already tried to release it.
    let release!: () => void;
    const gate = new Promise((resolve) => { release = () => resolve({ notifications: [] }); });
    notifications.getPending.mockImplementationOnce(() => gate);
    const first = rescheduleReminders();
    const second = rescheduleReminders();
    release();
    await Promise.all([first, second]);
    expect(notifications.schedule).toHaveBeenCalledTimes(2);
    // The sharp part: the second run does not so much as LOOK at the pending
    // set until the first has finished scheduling. "Both ran" would also be
    // true of two runs trampling each other — this is what rules that out.
    expect(notifications.getPending.mock.invocationCallOrder[1]).toBeGreaterThan(
      notifications.schedule.mock.invocationCallOrder[0]
    );
  });
});
