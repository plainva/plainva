import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 30_000 });

/**
 * One "today", and the right one (plan Journal-Erweiterungen, X1).
 *
 * Before this there was no function that answered "which day is it". Three
 * rebuilds of the same local key stood side by side and around twenty places
 * read `new Date()` raw. That was survivable while every part of the app meant
 * the same thing by "today" — and stopped being survivable with the day
 * boundary (X2), because the diary's day and the calendar's day are now two
 * different answers.
 *
 * The rule this enforces, only for the files where the diary lives: a day is
 * asked for by NAME. `journalToday()` / `journalTodayKey()` / `useJournalDayKey()`
 * for the daily note and the journal, `calendarDay()` for the calendar. A bare
 * `new Date()` handed to something that wants a day is the bug this exists to
 * stop: it makes "today" mean midnight in one place and the boundary in
 * another, and the two disagree for a few hours every night — the hours in
 * which someone writes the entry that goes to the wrong day.
 *
 * Elsewhere a raw `new Date()` is fine and common: a timestamp, a duration, an
 * age. This does not police those, and it does not police the calendar's own
 * files — an appointment at 01:30 is on the day the clock says.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = join(SRC, "../../..");

/** The files that decide which day a diary entry or a daily note belongs to. */
const DIARY_FILES = [
  "apps/desktop/src/AppShell.tsx",
  "apps/desktop/src/hooks/useJournal.ts",
  "apps/desktop/src/components/journal/JournalView.tsx",
  "apps/desktop/src/components/journal/JournalSidebarSection.tsx",
  "apps/desktop/src/components/journal/JournalCaptureDialog.tsx",
  "apps/mobile/src/App.tsx",
  "apps/mobile/src/services/journalService.ts",
  "apps/mobile/src/screens/JournalScreen.tsx",
  "apps/mobile/src/screens/TodayScreen.tsx",
  "apps/mobile/src/components/TodayJournalSection.tsx",
  "apps/mobile/src/components/JournalCaptureSheet.tsx",
];

/**
 * What a raw `new Date()` must not be handed to in those files. Each name takes
 * a DAY and turns it into a note, a path or a key — so the day must already
 * have been decided by one of the two named functions.
 */
const DAY_SINKS = [
  "buildDailyNotePath",
  "dailyNotePathFor",
  "ensureDailyNote",
  "handleOpenDailyNote",
  "openDaily",
  "appendJournalEntry",
  "buildDayStrip",
  "calendarDay",
  "localIsoKey",
  "isoOf",
  "dayKey",
];

const read = (rel: string): string => readFileSync(join(REPO, rel), "utf8");

describe("the diary asks for its day by name", () => {
  it("hands no raw `new Date()` to anything that wants a day", () => {
    const offenders: string[] = [];
    for (const rel of DIARY_FILES) {
      const lines = read(rel).split("\n");
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        for (const sink of DAY_SINKS) {
          // `sink(new Date())` — with or without further arguments.
          if (new RegExp(`\\b${sink}\\s*\\(\\s*new Date\\(\\)`).test(line)) {
            offenders.push(`${rel}:${i + 1}  ${sink}(new Date(…))  →  ${sink}(journalToday()…)`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("builds no fourth copy of the key anywhere in the app", () => {
    // `${d.getFullYear()}-${…getMonth()…}` — the shape all three rebuilds had.
    const shape = /getFullYear\(\)\}-\$\{/;
    const offenders: string[] = [];
    for (const rel of [...DIARY_FILES, "packages/ui/src/base/calendarRange.ts", "packages/ui/src/lib/dailyNotePath.ts", "apps/mobile/src/lib/dates.ts", "apps/desktop/src/components/base/BaseCalendarView.tsx"]) {
      read(rel).split("\n").forEach((line, i) => {
        if (shape.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the three old names as re-exports of the one function", () => {
    // They stay for their callers; what must not come back is a second body.
    for (const [rel, name] of [
      ["packages/ui/src/lib/dailyNotePath.ts", "localIsoKey"],
      ["packages/ui/src/base/calendarRange.ts", "dayKey"],
      ["apps/mobile/src/lib/dates.ts", "isoOf"],
    ] as const) {
      expect(read(rel)).toContain(`export const ${name} = calendarDay;`);
    }
  });
});
