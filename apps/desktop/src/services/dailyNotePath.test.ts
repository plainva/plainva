import { describe, it, expect } from "vitest";
import { buildDailyNotePath, localIsoKey, parseDailyNoteDate } from "./dailyNotePath";

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
