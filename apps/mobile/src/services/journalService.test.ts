// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The phone's seam of the journal's write path (plan Journal, J2/J4): one way
 * of writing — `vaultOps.save` — and what has to follow it. The rules of the
 * path itself (read, transform, re-read, flush the open editor first) are
 * shared and pinned in the desktop package (`journalWrite.test.ts`).
 */
const order: string[] = [];
vi.mock("./vaultService", () => ({
  vaultOps: {
    save: vi.fn(async (_vault: unknown, path: string) => void order.push(`save:${path}`)),
    read: vi.fn(async () => "## Journal\n"),
    ensureDailyNote: vi.fn(async (_vault: unknown, _date: Date, mode: string) => { order.push(`ensure:${mode}`); return { path: "2026-09-20.md", created: false }; }),
  },
}));
vi.mock("./syncService", () => ({ syncSoon: vi.fn(() => void order.push("sync")) }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ journalHeading: "  Logbuch  ", dailyFolder: "Tage", dailyFormat: "YYYY-MM-DD" }) }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

import { journalFiles, journalHeading, onJournalWrite, planSharedJournalEntry } from "./journalService";

afterEach(() => { order.length = 0; });

describe("journalService", () => {
  it("writes through the shell's one way, nudges the sync, tells an open editor and the open views — in that order", async () => {
    const seen: string[] = [];
    const onEditor = (event: Event) => void order.push(`editor:${(event as CustomEvent<{ path: string }>).detail.path}`);
    window.addEventListener("m-external-update", onEditor);
    const off = onJournalWrite((path) => { order.push(`view:${path}`); seen.push(path); });

    await journalFiles({} as never).writeTextFile("Tage/2026-09-20.md", "## Journal\n\n- 14:05 x\n");

    expect(order).toEqual(["save:Tage/2026-09-20.md", "sync", "editor:Tage/2026-09-20.md", "view:Tage/2026-09-20.md"]);
    off();
    await journalFiles({} as never).writeTextFile("Tage/2026-09-20.md", "x");
    expect(seen).toEqual(["Tage/2026-09-20.md"]);
    window.removeEventListener("m-external-update", onEditor);
  });

  it("creates a missing daily note without the template's questions (decision E4)", async () => {
    await journalFiles({} as never).ensureDailyNote(new Date(2026, 8, 20));
    expect(order).toEqual(["ensure:headless"]);
  });

  it("reads the vault's heading normalised, and plans a shared entry with day, time, heading and note", () => {
    expect(journalHeading()).toBe("Logbuch");
    expect(planSharedJournalEntry(new Date(2026, 8, 20, 9, 5))).toEqual({ date: "2026-09-20", time: "09:05", heading: "Logbuch", notePath: "Tage/2026-09-20.md" });
  });
});
