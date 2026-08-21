import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduler around the planner: what it does with the permission, how it
 * replaces the window rather than adding to it, and that two triggers arriving
 * together cannot cancel each other's notifications half-way.
 */

const { notifications, settings, cache, taskDb } = vi.hoisted(() => ({
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
    reminderTaskLeadDays: 0,
    reminderTaskAtMinutes: 9 * 60,
    reminderCalendars: [] as string[],
    taskDatabase: "",
  },
  cache: { listEvents: vi.fn() },
  taskDb: { base: "", query: vi.fn() },
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: notifications }));
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/pim/pimService", () => ({ getPimCache: () => cache }));
vi.mock("./services/vaultService", () => ({
  getMobileVault: async () => ({ queryService: { queryDatabaseFiles: taskDb.query } }),
  vaultOps: { read: async () => taskDb.base },
}));

import { getReminderState, rescheduleReminders } from "./services/reminderScheduler";

const NOW = Date.now();

/** A task database whose due column IS a date - the ordinary case. */
const DUE_BASE = `filters: []
properties:
  note.faellig:
    plainva:
      input: date
views:
  - type: table
    name: Offen
`;

/** ...and one whose due column is plain text, which is the silent failure. */
const TEXT_BASE = DUE_BASE.replace("input: date", "input: text");

function taskRow(path: string, due: Date) {
  const day = [due.getFullYear(), String(due.getMonth() + 1).padStart(2, "0"), String(due.getDate()).padStart(2, "0")].join("-");
  return { "file.path": path, "file.name": path.split("/").pop(), faellig: day };
}
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
    // Reset here too: a leaked task database from one test is a green run that
    // proves nothing in the next.
    settings.taskDatabase = "";
    taskDb.query.mockReset();
    taskDb.query.mockResolvedValue([]);
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
    // The notification says WHAT it is, not just when — the finding was that a
    // task and an appointment arrived indistinguishable.
    // Real i18n here, so this is the shipped sentence rather than a key: the
    // body names the kind and then the moment.
    expect(sent[0].body).toMatch(/^\S+ · \d{2}:\d{2}$/);
    expect(sent[0].body).not.toContain("reminders.");
    expect(sent[0].smallIcon).toBe("ic_stat_event");
  });

  it("says why nothing was planned for tasks", async () => {
    // The silence the maintainer hit: reminders on, tasks on, no task database
    // — and no word anywhere about it. The database only reaches the phone
    // through the settings sync, so this is the commonest cause by far.
    settings.remindTasks = true;
    settings.taskDatabase = "";
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();
    expect(getReminderState()).toMatchObject({ scheduled: 1, events: 1, tasks: 0, reason: "noTaskDb" });
  });

  it("plans tasks even when appointment reminders are switched off", async () => {
    // The finding (plan Mobile-Feedback, P1/4): reading `remindEvents` alone
    // made task reminders a SUB-setting of appointment reminders. Somebody who
    // wants only task reminders got NOTHING, and no screen said why.
    settings.remindEvents = false;
    settings.remindTasks = true;
    settings.taskDatabase = "Tasks.base";
    taskDb.base = DUE_BASE;
    const day = new Date(NOW + 2 * 86_400_000);
    taskDb.query.mockResolvedValue([taskRow("Notes/steuer.md", day)]);
    cache.listEvents.mockResolvedValue([event("standup", 3)]);

    await rescheduleReminders();

    const s2 = getReminderState();
    expect(s2.tasks).toBe(1);
    // ...and the appointment stays out, because ITS switch is off.
    expect(s2.events).toBe(0);
    expect(notifications.schedule).toHaveBeenCalled();
  });

  it("still plans nothing when BOTH switches are off", async () => {
    settings.remindEvents = false;
    settings.remindTasks = false;
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(getReminderState().reason).toBe("off");
  });

  it("says when the due column is not typed as a date", async () => {
    // A task database whose due column is text yields rows nobody can schedule.
    // Asked of the schema, because the row projection already swallowed it.
    settings.remindTasks = true;
    settings.taskDatabase = "Tasks.base";
    taskDb.base = TEXT_BASE;
    taskDb.query.mockResolvedValue([taskRow("Notes/steuer.md", new Date(NOW + 2 * 86_400_000))]);
    await rescheduleReminders();
    expect(getReminderState()).toMatchObject({ tasks: 0, reason: "taskDueNotDate" });
  });

  it("names the tasks switch when it is the reason", async () => {
    settings.remindTasks = false;
    cache.listEvents.mockResolvedValue([event("standup", 3)]);
    await rescheduleReminders();
    expect(getReminderState().reason).toBe("tasksOff");
  });

  it("counts appointments and tasks apart", async () => {
    // "12 planned" hides "and none of them a task"; the split is the diagnosis.
    cache.listEvents.mockResolvedValue([event("a", 2), event("b", 4)]);
    await rescheduleReminders();
    const s = getReminderState();
    expect(s.events).toBe(2);
    expect(s.tasks).toBe(0);
    expect(s.events + s.tasks).toBe(s.scheduled);
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
