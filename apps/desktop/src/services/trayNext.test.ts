// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn(), isPermissionGranted: async () => true, requestPermission: vi.fn() }));
vi.mock("./settingsStore", () => ({ getSettingsStore: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) }));
vi.mock("./pim/taskOverlay", () => ({ loadDueTasks: vi.fn() }));
vi.mock("@plainva/ui/i18n", () => ({
  default: { language: "de", t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k) },
}));
import { nextLine } from "./reminderScheduler";

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
