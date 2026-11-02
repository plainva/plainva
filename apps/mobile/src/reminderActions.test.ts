// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a tapped reminder does. The interesting cases are the ones where the
 * world has moved on since the notification was scheduled — the phone plans up
 * to 14 days ahead, so "the appointment is gone" is ordinary, not exceptional.
 */

const { cache, meetingNote, setTaskDone, toasts, vault, update, syncSoon, jump } = vi.hoisted(() => ({
  cache: { getEventByUid: vi.fn() },
  meetingNote: vi.fn(),
  setTaskDone: vi.fn(),
  toasts: { info: vi.fn(), error: vi.fn() },
  vault: { vaultId: "v1", queryService: { listTasks: vi.fn() } },
  update: vi.fn(),
  syncSoon: vi.fn(),
  jump: vi.fn(),
}));
vi.mock("./services/pim/pimService", () => ({ getPimCache: () => cache, openMeetingNoteFor: meetingNote }));
vi.mock("./services/taskCompletionAction", () => ({ setTaskDone }));
vi.mock("./services/vaultService", () => ({ getMobileVault: async () => vault, vaultOps: { update } }));
vi.mock("./services/syncService", () => ({ syncSoon }));
vi.mock("./services/reminderScheduler", () => ({ rescheduleReminders: vi.fn() }));
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => ({ reminderTaskAtMinutes: 540 }) }));
vi.mock("@plainva/ui", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui")>("@plainva/ui");
  return { ...actual, toast: toasts, setPendingSearchJump: jump };
});
// Resources are not loaded here, so the real `t` would swallow the data it was
// given. This keeps the message AND its parameters visible to the assertions.
vi.mock("@plainva/ui/i18n", () => ({
  default: { t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) },
}));

import { runReminderIntent } from "./services/reminderActions";

const host = { openNote: vi.fn(), openCalendar: vi.fn() };
const intent = (over: Partial<Parameters<typeof runReminderIntent>[0]>) => ({
  kind: "event" as const,
  uid: "e1",
  accountId: "a1",
  calendarId: "c1",
  startTs: Date.parse("2026-08-12T09:00:00Z"),
  action: "open" as const,
  ...over,
});

describe("runReminderIntent", () => {
  beforeEach(() => {
    for (const fn of [cache.getEventByUid, meetingNote, setTaskDone, host.openNote, host.openCalendar, toasts.info, toasts.error, vault.queryService.listTasks, update, syncSoon, jump]) fn.mockReset();
    setTaskDone.mockResolvedValue({ changed: true });
    vault.queryService.listTasks.mockResolvedValue([]);
  });

  it("ticks a task off from the notification and says so", async () => {
    await runReminderIntent(intent({ kind: "task", uid: "Tasks/a.md", action: "done" }), host);
    expect(setTaskDone).toHaveBeenCalledWith("Tasks/a.md", true);
    // Nothing on screen confirms this one, so the toast is the confirmation.
    expect(toasts.info).toHaveBeenCalled();
    expect(host.openNote).not.toHaveBeenCalled();
  });

  it("names the next occurrence when ticking off created one", async () => {
    setTaskDone.mockResolvedValue({ changed: true, spawnedDue: "2026-08-16" });
    await runReminderIntent(intent({ kind: "task", uid: "Tasks/a.md", action: "done" }), host);
    expect(toasts.info.mock.calls[0][0]).toContain("2026-08-16");
  });

  it("opens the task's note on a plain tap", async () => {
    await runReminderIntent(intent({ kind: "task", uid: "Tasks/a.md", action: "open" }), host);
    expect(host.openNote).toHaveBeenCalledWith("Tasks/a.md");
    expect(setTaskDone).not.toHaveBeenCalled();
  });

  it("reports a failed successor while retaining the completed task", async () => {
    setTaskDone.mockResolvedValue({ changed: true, spawnFailed: true });
    await runReminderIntent(intent({ kind: "task", uid: "Tasks/a.md", action: "done" }), host);
    expect(toasts.error).toHaveBeenCalledWith("tasks.repeatFailed");
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("opens the meeting note of the appointment the reminder belongs to", async () => {
    cache.getEventByUid.mockResolvedValue({ uid: "e1", title: "Jour fixe" });
    meetingNote.mockResolvedValue({ path: "Meetings/2026-08-12 Jour fixe.md", created: true });
    await runReminderIntent(intent({ action: "meeting" }), host);
    expect(meetingNote).toHaveBeenCalledWith({ uid: "e1", title: "Jour fixe" }, "2026-08-12");
    expect(host.openNote).toHaveBeenCalledWith("Meetings/2026-08-12 Jour fixe.md");
  });

  it("says the appointment is gone rather than failing silently", async () => {
    // Scheduled up to 14 days ahead, then deleted or moved: ordinary, and the
    // person still ends up somewhere useful.
    cache.getEventByUid.mockResolvedValue(null);
    await runReminderIntent(intent({ action: "meeting" }), host);
    expect(toasts.error).toHaveBeenCalled();
    expect(host.openCalendar).toHaveBeenCalled();
    expect(meetingNote).not.toHaveBeenCalled();
  });

  it("brings the calendar to the front on a plain tap of an appointment", async () => {
    await runReminderIntent(intent({ action: "open" }), host);
    expect(host.openCalendar).toHaveBeenCalled();
  });
});

/**
 * A checkbox task's reminder (Sammelplan § 3.145 Nr. 1, E3): the notification
 * carries its line, a tap opens the note AT the line, and "Done" ticks that
 * line through the ordinary write of a note — asked of the index first, so a
 * note renamed since the reminder was planned is still found.
 */
describe("runReminderIntent: a checkbox task", () => {
  const line = { path: "Haushalt.md", ordinal: 1, text: "Bob anrufen 📅 2026-08-12 14:30" };
  const NOTE = "# Haushalt\n\n- [ ] Müll\n- [ ] Bob anrufen 📅 2026-08-12 14:30\n";
  const box = (path: string, ordinal: number, text: string) => ({ path, title: path, excluded: false, line: ordinal + 2, ordinal, done: false, state: "open", text, tags: [], due: "2026-08-12", dueTime: "14:30" });

  it("ticks its line — not the box above — and says so", async () => {
    let written: string | null = null;
    update.mockImplementation(async (_v: unknown, _path: string, change: (text: string) => string | null) => {
      written = change(NOTE);
      return { changed: written !== null };
    });
    const told: unknown[] = [];
    const listen = (e: Event) => told.push((e as CustomEvent).detail);
    window.addEventListener("m-external-update", listen);
    await runReminderIntent(intent({ kind: "task", uid: "checkbox:Haushalt.md#" + line.text, action: "done", line }), host);
    expect(update).toHaveBeenCalledWith(vault, "Haushalt.md", expect.any(Function));
    // An editor holding the note takes the new line.
    window.removeEventListener("m-external-update", listen);
    expect(told).toEqual([{ path: "Haushalt.md", vaultId: "v1" }]);
    expect(written).toMatch(/- \[ \] Müll\n- \[x\] Bob anrufen 📅 2026-08-12 14:30 ✅ \d{4}-\d{2}-\d{2}\n$/);
    expect(syncSoon).toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalledWith("reminders.taskDone");
    // A box is no task note: the database's completion is not asked.
    expect(setTaskDone).not.toHaveBeenCalled();
  });

  it("opens the note at the line on a plain tap", async () => {
    vault.queryService.listTasks.mockResolvedValue([box("Haushalt.md", 1, line.text)]);
    await runReminderIntent(intent({ kind: "task", uid: "checkbox:Haushalt.md#" + line.text, action: "open", line }), host);
    expect(jump).toHaveBeenCalledWith({ path: "Haushalt.md", term: line.text.slice(0, 40) });
    expect(host.openNote).toHaveBeenCalledWith("Haushalt.md");
  });

  it("follows the note it was renamed to since the reminder was planned", async () => {
    vault.queryService.listTasks.mockResolvedValue([box("Archiv/Haushalt 2026.md", 0, line.text)]);
    update.mockResolvedValue({ changed: true });
    await runReminderIntent(intent({ kind: "task", uid: "checkbox:Haushalt.md#" + line.text, action: "open", line }), host);
    expect(host.openNote).toHaveBeenCalledWith("Archiv/Haushalt 2026.md");
    await runReminderIntent(intent({ kind: "task", uid: "checkbox:Haushalt.md#" + line.text, action: "done", line }), host);
    expect(update).toHaveBeenCalledWith(vault, "Archiv/Haushalt 2026.md", expect.any(Function));
  });

  it("says what failed when the note cannot be written", async () => {
    update.mockRejectedValue(new Error("locked"));
    await runReminderIntent(intent({ kind: "task", uid: "checkbox:Haushalt.md#" + line.text, action: "done", line }), host);
    expect(toasts.error).toHaveBeenCalled();
    expect(toasts.info).not.toHaveBeenCalled();
  });
});
