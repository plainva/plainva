import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a tapped reminder does. The interesting cases are the ones where the
 * world has moved on since the notification was scheduled — the phone plans up
 * to 14 days ahead, so "the appointment is gone" is ordinary, not exceptional.
 */

const { cache, meetingNote, setTaskDone, toasts } = vi.hoisted(() => ({
  cache: { getEventByUid: vi.fn() },
  meetingNote: vi.fn(),
  setTaskDone: vi.fn(),
  toasts: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("./services/pim/pimService", () => ({ getPimCache: () => cache, openMeetingNoteFor: meetingNote }));
vi.mock("./services/taskCompletionAction", () => ({ setTaskDone }));
vi.mock("@plainva/ui", () => ({ toast: toasts }));
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
    for (const fn of [cache.getEventByUid, meetingNote, setTaskDone, host.openNote, host.openCalendar, toasts.info, toasts.error]) fn.mockReset();
    setTaskDone.mockResolvedValue({ changed: true });
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
