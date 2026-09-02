// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn(), isPermissionGranted: async () => true, requestPermission: vi.fn() }));
vi.mock("./settingsStore", () => ({ getSettingsStore: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) }));
vi.mock("./pim/taskOverlay", () => ({ loadDueTasks: vi.fn() }));
vi.mock("./background", () => ({ setTrayNext: vi.fn(async () => {}), enableTray: vi.fn(), RUN_IN_TRAY_KEY: "runInTray" }));
vi.mock("@plainva/ui/i18n", () => ({
  default: { language: "de", t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k) },
}));
import { nextLine, nextStart } from "./reminderScheduler";
import { forgetTrayNext, reportTrayComments, reportTrayNext, resetTrayNext } from "./trayNext";
import { setTrayNext } from "./background";

const NOW = Date.parse("2026-08-12T09:00:00Z");
const s = (over: Record<string, unknown>) => ({ key: "k", kind: "event" as const, title: "T", startTs: NOW, allDay: false, accountId: "", calendarId: "", ...over });

describe("nextLine (tray menu)", () => {
  it("names the nearest appointment still to come", () => {
    const line = nextLine([s({ key: "b", title: "Spät", startTs: NOW + 7200_000 }), s({ key: "a", title: "Bald", startTs: NOW + 600_000 })], NOW);
    expect(line).toContain("Bald");
    expect(line).not.toContain("Spät");
  });

  it("says nothing is in sight rather than showing a past appointment", () => {
    expect(nextLine([s({ startTs: NOW - 60_000 })], NOW)).toBe("background.trayNoNext");
  });

  it("leaves tasks out — 'next' must mean one thing", () => {
    // A task is due on a day, not at a place in the day's sequence.
    expect(nextLine([s({ kind: "task", title: "Müll", startTs: NOW + 60_000 })], NOW)).toBe("background.trayNoNext");
  });
});

/**
 * One tray, several schedulers (multi-window stage D, E7).
 *
 * Each open vault runs its own reminder loop now. Letting each write the tray
 * line means the last vault to tick wins — the line would flip every cycle and
 * settle on whichever appointment happened to be later, which is not "next" by
 * any reading.
 */
describe("the tray line across open vaults (stage D)", () => {
  const written = () => (setTrayNext as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);

  beforeEach(() => {
    resetTrayNext();
    (setTrayNext as unknown as { mock: { calls: unknown[] } }).mock.calls.length = 0;
  });

  it("shows the earliest appointment, whichever vault it is in", () => {
    reportTrayNext("/work", "at 15:00", NOW + 7200_000);
    reportTrayNext("/home", "at 10:00", NOW + 600_000);
    // Reported second and earlier: order of arrival must not decide.
    expect(written().pop()).toContain("at 10:00");
  });

  it("names the vault only once a second one is open", () => {
    reportTrayNext("/work", "at 10:00", NOW + 600_000);
    expect(written().pop()).toBe("at 10:00");

    reportTrayNext("/home", "at 15:00", NOW + 7200_000);
    // With two vaults "at ten" is ambiguous in the one way that matters.
    expect(written().pop()).toContain("work");
  });

  it("gives the line back to the vault that is left", () => {
    reportTrayNext("/work", "at 15:00", NOW + 7200_000);
    reportTrayNext("/home", "at 10:00", NOW + 600_000);
    forgetTrayNext("/home");
    // A closed vault's appointment is not "next" any more — and with one vault
    // left the name is noise again.
    expect(written().pop()).toBe("at 15:00");
  });

  it("ignores a vault with nothing coming up", () => {
    reportTrayNext("/work", "at 15:00", NOW + 7200_000);
    reportTrayNext("/home", "background.trayNoNext", null);
    expect(written().pop()).toContain("at 15:00");
  });

  it("says nothing is coming when no vault has anything", () => {
    reportTrayNext("/work", "background.trayNoNext", null);
    expect(written().pop()).toBe("background.trayNoNext");
  });
});

describe("nextStart (what the merge sorts by)", () => {
  it("reports when the nearest appointment is, not just its wording", () => {
    // The line is text; merging two vaults needs a number to compare.
    expect(nextStart([s({ startTs: NOW + 600_000 }), s({ key: "b", startTs: NOW + 60_000 })], NOW)).toBe(NOW + 60_000);
  });

  it("reports nothing for a vault with no appointment left", () => {
    expect(nextStart([s({ startTs: NOW - 60_000 })], NOW)).toBe(null);
  });
});

/**
 * The tray counter (Stufe F, F2). It states what is WAITING, not what just
 * arrived - a notification is about a moment, this line is about a state.
 */
describe("tray comment counter", () => {
  beforeEach(() => {
    resetTrayNext();
    vi.mocked(setTrayNext).mockClear();
  });

  const lastLine = () => {
    // Index rather than `.at(-1)`: this package's lib target predates it.
    const calls = vi.mocked(setTrayNext).mock.calls;
    return calls.length ? calls[calls.length - 1][0] : "";
  };

  it("says nothing at zero - a line that always claims '0 waiting' stops being read", () => {
    reportTrayNext("/v", "Next: X", NOW + 600_000);
    expect(lastLine()).not.toContain("trayComments");
    reportTrayComments("/v", 0);
    expect(lastLine()).not.toContain("trayComments");
  });

  it("appends the count to the appointment line", () => {
    reportTrayNext("/v", "Next: X", NOW + 600_000);
    reportTrayComments("/v", 3);
    expect(lastLine()).toContain("Next: X");
    expect(lastLine()).toContain("\"count\":3");
  });

  it("sums across vaults, because the tray has one line", () => {
    reportTrayComments("/a", 2);
    reportTrayComments("/b", 3);
    expect(lastLine()).toContain("\"count\":5");
  });

  it("redraws nothing when the count is unchanged", () => {
    reportTrayComments("/v", 2);
    const before = vi.mocked(setTrayNext).mock.calls.length;
    reportTrayComments("/v", 2);
    expect(vi.mocked(setTrayNext).mock.calls.length).toBe(before);
    // Absent and zero are the same statement, so this must not redraw either.
    reportTrayComments("/other", 0);
    expect(vi.mocked(setTrayNext).mock.calls.length).toBe(before);
  });

  it("forgets a closed vault's count", () => {
    reportTrayComments("/v", 4);
    forgetTrayNext("/v");
    expect(lastLine()).not.toContain("trayComments");
  });
});
