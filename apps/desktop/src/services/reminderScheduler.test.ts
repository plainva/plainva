// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Desktop reminders.
 *
 * The one thing these tests exist to prevent is the trap the plugin sets: its
 * desktop backend builds a notification from title/body/icon/sound and never
 * reads `schedule`, so handing it a plan shows everything AT ONCE, silently.
 * A reminder that arrives the moment it is planned is worse than none — it
 * trains people to ignore them.
 */

const { notify, permission, store, cache, overlay, taskDbPath, toasts } = vi.hoisted(() => ({
  notify: vi.fn(),
  permission: { granted: true, request: vi.fn() },
  store: new Map<string, unknown>(),
  cache: { listEvents: vi.fn() },
  overlay: vi.fn(),
  taskDbPath: { value: null as string | null },
  toasts: { info: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: notify,
  isPermissionGranted: async () => permission.granted,
  requestPermission: permission.request,
}));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => void store.set(k, v),
    save: async () => {},
  }),
}));
vi.mock("./pim/taskOverlay", () => ({ loadTaskOverlay: overlay }));
vi.mock("./taskDatabase", () => ({ getTaskDatabasePath: async () => taskDbPath.value }));
vi.mock("@plainva/ui", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui")>("@plainva/ui");
  return { ...actual, toast: toasts };
});
vi.mock("@plainva/ui/i18n", () => ({
  default: { language: "de", t: (key: string) => key },
}));

import { announceReminder, reminderStateStore, startReminderScheduler } from "./reminderScheduler";
import { remindEventsKey, reminderCalendarsKey, reminderLeadKey, remindTasksKey } from "./reminderSettings";

const VAULT = "/v";
const NOW = Date.parse("2026-08-12T09:00:00Z");

const deps = {
  vaultPath: VAULT,
  cache: cache as never,
  vaultAdapter: { readTextFile: async () => "" },
  queryService: { queryDatabaseFiles: async () => [] },
  openNote: vi.fn(),
  openCalendar: vi.fn(),
};

/** An appointment `minutes` from NOW ON THE FAKE CLOCK, in the shape the cache
 * returns. Read at call time, so a test that already advanced the clock still
 * gets an appointment in its own future. */
const event = (minutes: number, over: Record<string, unknown> = {}) => ({
  uid: `e${minutes}`,
  title: `Termin ${minutes}`,
  start: { ts: Date.now() + minutes * 60_000 },
  allDay: false,
  accountId: "a1",
  calendarId: "c1",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store.clear();
  store.set(remindEventsKey(VAULT), true);
  for (const fn of [notify, permission.request, cache.listEvents, overlay, deps.openNote, deps.openCalendar, toasts.info]) fn.mockReset();
  permission.granted = true;
  cache.listEvents.mockResolvedValue([]);
  overlay.mockResolvedValue({ tasks: [], completion: null, dueKey: "faellig" });
  taskDbPath.value = "Tasks.base";
});
afterEach(() => {
  vi.useRealTimers();
});

/** Runs the initial planning tick and lets its promises settle. */
async function settle(ms = 20_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("desktop reminder scheduler", () => {
  it("waits for the reminder's moment instead of announcing it at once", async () => {
    // 20 minutes out, 15 minutes lead — the reminder is due in 5.
    cache.listEvents.mockResolvedValue([event(20)]);
    const stop = startReminderScheduler(deps);
    await settle();

    // THE regression this file exists for: the plugin ignores `schedule` on the
    // desktop, so anything handed over now would appear now.
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("hands the plugin no schedule at all — the desktop backend would drop it", async () => {
    cache.listEvents.mockResolvedValue([event(16)]);
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).not.toHaveProperty("schedule");
    stop();
  });

  it("does not announce twice when a slow plan finishes after the reminder fired", async () => {
    // The reachable race: a plan reads the clock, then waits for the calendar
    // cache. If the reminder fires during that wait, the plan is still holding
    // a reminder it believes is in the future — and would arm it again, with a
    // negative delay, i.e. at once.
    const soon = event(16); // due in one minute — the SAME appointment throughout
    cache.listEvents.mockResolvedValue([soon]);
    const stop = startReminderScheduler(deps);
    await settle();

    let release: (() => void) | undefined;
    const slow = new Promise<void>((r) => (release = r));
    cache.listEvents.mockImplementationOnce(async () => {
      await slow;
      return [soon];
    });
    await vi.advanceTimersByTimeAsync(39_000); // t≈59s: plan starts, clock still before the moment
    window.dispatchEvent(new CustomEvent("plainva-pim-changed"));
    await vi.advanceTimersByTimeAsync(2_000); // the reminder fires while the plan waits
    release?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  // Pins the guard that keeps a re-plan from arming a SECOND timer for a
  // reminder already armed or already announced.
  it("announces each reminder once, however often the plan is recomputed", async () => {
    cache.listEvents.mockResolvedValue([event(18)]);
    const stop = startReminderScheduler(deps);
    await settle();
    // A calendar refresh arrives before the reminder is due.
    window.dispatchEvent(new CustomEvent("plainva-pim-changed"));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    window.dispatchEvent(new CustomEvent("plainva-pim-changed"));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps a reminder that comes due in the same minute the plan is recomputed", async () => {
    // The five-minute tick lands on reminder moments regularly, and the planner
    // drops everything at or before `now`. Rebuilding the armed set on every
    // plan therefore disarmed such a reminder and then found nothing to re-arm.
    cache.listEvents.mockResolvedValue([event(25)]); // lead 15 → due in 10 minutes
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays silent while reminders are switched off", async () => {
    store.set(remindEventsKey(VAULT), false);
    cache.listEvents.mockResolvedValue([event(16)]);
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(notify).not.toHaveBeenCalled();
    expect(cache.listEvents).not.toHaveBeenCalled();
    stop();
  });

  it("never announces anything after being stopped", async () => {
    cache.listEvents.mockResolvedValue([event(20)]);
    const stop = startReminderScheduler(deps);
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reminds only from the chosen calendars, and from all of them when none is chosen", async () => {
    cache.listEvents.mockResolvedValue([event(16), event(17, { uid: "other", accountId: "a1", calendarId: "c2" })]);
    store.set(reminderCalendarsKey(VAULT), ["a1 c1"]);
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();

    // An empty list means ALL, so a calendar added later reminds by default
    // rather than falling through a filter written before it existed.
    notify.mockReset();
    store.set(reminderCalendarsKey(VAULT), []);
    cache.listEvents.mockResolvedValue([event(16), event(17, { uid: "other", accountId: "a1", calendarId: "c2" })]);
    const stop2 = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(notify).toHaveBeenCalledTimes(2);
    stop2();
  });

  it("respects the appointment's own reminder over the configured lead time", async () => {
    // The appointment says 60 minutes; the setting says 5. The appointment wins.
    store.set(reminderLeadKey(VAULT), 5);
    cache.listEvents.mockResolvedValue([event(70, { reminders: [60] })]);
    const stop = startReminderScheduler(deps);
    await settle();
    // Due in ten minutes, so it is armed by the five-minute tick, not the first.
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("takes in due tasks only when they are switched on", async () => {
    overlay.mockResolvedValue({
      tasks: [{ path: "T/a.md", title: "Müll", due: "2026-08-12", dueMinutes: 9 * 60 + 30, done: false, repeats: false }],
      completion: null,
      dueKey: "faellig",
    });
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(overlay).not.toHaveBeenCalled();
    stop();

    store.set(remindTasksKey(VAULT), true);
    const stop2 = startReminderScheduler(deps);
    await settle();
    expect(overlay).toHaveBeenCalled();
    stop2();
  });

  it("plans tasks even when appointment reminders are switched off", async () => {
    // The finding: task reminders were a SUB-setting of appointment reminders
    // — switching appointments off switched tasks off too, and nothing said so.
    store.set(remindEventsKey(VAULT), false);
    store.set(remindTasksKey(VAULT), true);
    cache.listEvents.mockResolvedValue([event(16)]);
    overlay.mockResolvedValue({
      tasks: [{ path: "T/a.md", title: "Müll", due: "2026-08-13", dueMinutes: null, done: false, repeats: false }],
      completion: null,
      dueKey: "faellig",
    });

    const stop = startReminderScheduler(deps);
    await settle();
    // The appointment is not planned — its switch is off — but the task is.
    expect(cache.listEvents).not.toHaveBeenCalled();
    expect(reminderStateStore.get().tasks).toBe(1);
    expect(reminderStateStore.get().events).toBe(0);
    stop();
  });

  it("says when no task database is set on this device", async () => {
    // Silent condition #2: the database is a per-vault setting that arrives
    // through the settings sync, so a sync that never ran leaves this empty.
    store.set(remindTasksKey(VAULT), true);
    taskDbPath.value = null;
    const stop = startReminderScheduler(deps);
    await settle();
    expect(reminderStateStore.get().reason).toBe("noTaskDb");
    stop();
  });

  it("says when the due column is not typed as a date", async () => {
    // Silent condition #3: without a date-typed due column every task in the
    // database is undateable, so nothing is ever planned from it.
    store.set(remindTasksKey(VAULT), true);
    overlay.mockResolvedValue({ tasks: [], completion: null, dueKey: null });
    const stop = startReminderScheduler(deps);
    await settle();
    expect(reminderStateStore.get().reason).toBe("taskDueNotDate");
    stop();
  });

  it("asks for permission once and stays quiet when it is refused", async () => {
    permission.granted = false;
    permission.request.mockResolvedValue("denied");
    cache.listEvents.mockResolvedValue([event(16)]);
    const stop = startReminderScheduler(deps);
    await settle();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(permission.request).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    stop();
  });
});

describe("announceReminder", () => {
  const reminder = (kind: "event" | "task") => ({
    at: NOW,
    subject: {
      key: kind === "task" ? "T/a.md" : "e1",
      kind,
      title: "Jour fixe",
      startTs: NOW,
      allDay: false,
      accountId: "a1",
      calendarId: "c1",
    },
  });

  it("carries the action in a toast, because a desktop notification has none", () => {
    // The plugin's desktop side registers only permission and notify — no
    // buttons, no click callback. The app is running by definition here, so the
    // toast is where the action can actually live.
    announceReminder(reminder("event"), deps);
    expect(toasts.info).toHaveBeenCalled();
    toasts.info.mock.calls[0][1].run();
    expect(deps.openCalendar).toHaveBeenCalledWith("2026-08-12");
  });

  it("opens the note for a task rather than the calendar", () => {
    announceReminder(reminder("task"), deps);
    toasts.info.mock.calls[0][1].run();
    expect(deps.openNote).toHaveBeenCalledWith("T/a.md");
    expect(deps.openCalendar).not.toHaveBeenCalled();
  });

  it("names the kind, not just the time", () => {
    // The finding: a bare time told you WHEN without telling you WHAT. The
    // desktop toast had the same gap as the phone's notification, so it takes
    // the same shared sentence.
    announceReminder(reminder("event"), deps);
    const [text] = toasts.info.mock.calls[0];
    expect(text).toContain("Jour fixe");
    expect(text).toContain("reminders.kindEvent");
  });

  it("distinguishes a task from an appointment in the wording", () => {
    announceReminder(reminder("task"), deps);
    const [text] = toasts.info.mock.calls[0];
    expect(text).toContain("reminders.kindTask");
    expect(text).not.toContain("reminders.kindEvent");
  });

  it("never pulls the window to the front", () => {
    // A window that jumps up mid-sentence is worse than a missed meeting note.
    const focus = vi.spyOn(window, "focus");
    announceReminder(reminder("event"), deps);
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
});
