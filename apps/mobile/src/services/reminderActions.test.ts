import { describe, expect, it, vi } from "vitest";

vi.mock("@plainva/ui", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./pim/pimService", () => ({ getPimCache: () => null, openMeetingNoteFor: vi.fn() }));
vi.mock("./taskCompletionAction", () => ({ setTaskDone: vi.fn(async () => ({ changed: true })) }));

import { runReminderIntent } from "./reminderActions";

describe("a tapped reminder (feedback round 2026-09-01, M4)", () => {
  it("an appointment's 'open' lands on THAT appointment, not on today", async () => {
    const openCalendar = vi.fn();
    await runReminderIntent(
      { kind: "event", uid: "u1", accountId: "a1", calendarId: "c1", startTs: 1_700_000_000_000, action: "open" },
      { openNote: vi.fn(), openCalendar }
    );
    expect(openCalendar).toHaveBeenCalledWith({ uid: "u1", accountId: "a1", calendarId: "c1", startTs: 1_700_000_000_000 });
  });

  it("a task's 'open' opens its note — the intent's uid is the note path", async () => {
    const openNote = vi.fn();
    await runReminderIntent(
      { kind: "task", uid: "Aufgaben/T.md", accountId: "", calendarId: "", startTs: 0, action: "open" },
      { openNote, openCalendar: vi.fn() }
    );
    expect(openNote).toHaveBeenCalledWith("Aufgaben/T.md");
  });
});
