import { describe, it, expect } from "vitest";
import { formatRelativeDate, DATE_TOKEN_RE } from "@plainva/ui";

const NOW = new Date(2026, 5, 30); // 2026-06-30 (local)

describe("formatRelativeDate", () => {
  it("uses relative words within ±2 days (de)", () => {
    expect(formatRelativeDate("2026-06-30", NOW, "de")).toBe("Heute");
    expect(formatRelativeDate("2026-06-29", NOW, "de")).toBe("Gestern");
    expect(formatRelativeDate("2026-07-01", NOW, "de")).toBe("Morgen");
    expect(formatRelativeDate("2026-07-02", NOW, "de")).toBe("Übermorgen");
    expect(formatRelativeDate("2026-06-28", NOW, "de")).toBe("Vorgestern");
  });

  it("uses relative words in English too", () => {
    expect(formatRelativeDate("2026-06-30", NOW, "en")).toBe("Today");
    expect(formatRelativeDate("2026-07-01", NOW, "en")).toBe("Tomorrow");
  });

  it("falls back to the full localized date beyond ±2 days", () => {
    expect(formatRelativeDate("2026-07-06", NOW, "de")).toBe("06.07.2026");
  });

  it("returns the input unchanged for a non-date string", () => {
    expect(formatRelativeDate("not-a-date", NOW)).toBe("not-a-date");
  });
});

describe("DATE_TOKEN_RE", () => {
  it("matches @YYYY-MM-DD tokens", () => {
    const text = "see @2026-06-30 and @2026-07-01 end";
    const found = [...text.matchAll(DATE_TOKEN_RE)].map((m) => m[0]);
    expect(found).toEqual(["@2026-06-30", "@2026-07-01"]);
  });

  it("does not match an email-like or partial token", () => {
    DATE_TOKEN_RE.lastIndex = 0;
    expect("foo@2026-06-30-7".match(DATE_TOKEN_RE)).toBeNull();
  });
});
