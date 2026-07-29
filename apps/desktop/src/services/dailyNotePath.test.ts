import { describe, it, expect } from "vitest";
import { buildDailyNotePath, localIsoKey, parseDailyNoteDate } from "@plainva/ui";

const key = (d: Date | null) => (d ? localIsoKey(d) : null);

describe("parseDailyNoteDate", () => {
  it("parses a note at the vault root with the default format", () => {
    expect(key(parseDailyNoteDate("2026-07-07.md", "YYYY-MM-DD", ""))).toBe("2026-07-07");
  });

  it("parses a note inside the configured daily-notes folder", () => {
    expect(key(parseDailyNoteDate("Journal/2026-07-07.md", "YYYY-MM-DD", "Journal"))).toBe("2026-07-07");
  });

  it("tolerates a trailing slash on the folder and backslash separators in the path", () => {
    expect(key(parseDailyNoteDate("Journal\\2026-07-07.md", "YYYY-MM-DD", "Journal/"))).toBe("2026-07-07");
  });

  it("supports custom Moment-style formats", () => {
    expect(key(parseDailyNoteDate("Daily/20260707.md", "YYYYMMDD", "Daily"))).toBe("2026-07-07");
  });

  it("rejects a note outside the daily-notes folder", () => {
    expect(parseDailyNoteDate("Other/2026-07-07.md", "YYYY-MM-DD", "Journal")).toBeNull();
  });

  it("rejects non-markdown files", () => {
    expect(parseDailyNoteDate("Journal/2026-07-07.txt", "YYYY-MM-DD", "Journal")).toBeNull();
  });

  it("rejects ordinary notes that do not match the format", () => {
    expect(parseDailyNoteDate("Journal/Meeting notes.md", "YYYY-MM-DD", "Journal")).toBeNull();
  });

  it("rejects near-misses via the round-trip guard (unpadded and partial dates)", () => {
    // Would parse leniently, but rebuilding produces 2026-07-07.md, not this path.
    expect(parseDailyNoteDate("2026-7-7.md", "YYYY-MM-DD", "")).toBeNull();
    // Month-only name is not a daily note under a full-date format.
    expect(parseDailyNoteDate("2026-07.md", "YYYY-MM-DD", "")).toBeNull();
    // Trailing junk after a valid date must not count.
    expect(parseDailyNoteDate("2026-07-07-draft.md", "YYYY-MM-DD", "")).toBeNull();
  });

  it("rejects an empty path", () => {
    expect(parseDailyNoteDate("", "YYYY-MM-DD", "")).toBeNull();
  });

  it("round-trips with buildDailyNotePath for any date", () => {
    const date = new Date(2025, 0, 3); // 2025-01-03 (local)
    const { fullPath } = buildDailyNotePath(date, "YYYY-MM-DD", "Journal");
    expect(key(parseDailyNoteDate(fullPath, "YYYY-MM-DD", "Journal"))).toBe("2025-01-03");
  });
});

// Plan Vorlagen-Engine, P1: the format translation moved to `momentFormat`.
// The risk of that move is the calendar losing existing daily notes, so the
// round trip is pinned across the formats people actually configure.
describe("parseDailyNoteDate — round trip after the format layer move", () => {
  const FORMATS = ["YYYY-MM-DD", "DD.MM.YYYY", "YYYY/MM/DD", "YY-MM-DD", "DD-MM-YYYY", "YYYYMMDD"];
  const FOLDERS = ["", "Journal", "Daily/2026"];

  it("re-reads every path it builds", () => {
    const date = new Date(2026, 6, 29);
    for (const format of FORMATS) {
      for (const folder of FOLDERS) {
        const { fullPath } = buildDailyNotePath(date, format, folder);
        const parsed = parseDailyNoteDate(fullPath, format, folder);
        expect(parsed, `${format} in "${folder}"`).not.toBeNull();
        expect(parsed!.getFullYear()).toBe(2026);
        expect(parsed!.getMonth()).toBe(6);
        expect(parsed!.getDate()).toBe(29);
      }
    }
  });

  it("now formats weekday names instead of repeating the day number", () => {
    // Before the move this produced "27272727" — a file name nobody wanted.
    const { dateStr } = buildDailyNotePath(new Date(2026, 6, 29), "YYYY-MM-DD dddd", "");
    expect(dateStr).toBe("2026-07-29 Wednesday");
  });

  it("still rejects a note that merely resembles the format", () => {
    expect(parseDailyNoteDate("2026-07.md", "YYYY-MM-DD", "")).toBeNull();
    expect(parseDailyNoteDate("Notes/2026-07-29.md", "YYYY-MM-DD", "Journal")).toBeNull();
  });
});
