import { describe, expect, it } from "vitest";
import { formatDueLabel } from "@plainva/ui";

/**
 * E3: the due date is short, and it says the same thing in both shells.
 *
 * These pin the three decisions that are easy to lose later: today gets WORDS
 * while every other day gets a bare date, the year appears only when it is not
 * the current one, and a day key is a LOCAL day (the UTC parse would report a
 * task as overdue for a whole day west of Greenwich).
 */

const t = (key: string, opts?: Record<string, unknown>) =>
  key === "pim.dueToday" ? "fällig heute" : String(opts?.defaultValue ?? key);

describe("formatDueLabel", () => {
  const today = new Date(2026, 7, 12); // 2026-08-12, local

  it("says today in words and gives every other day a bare date", () => {
    expect(formatDueLabel("2026-08-12", { locale: "de-DE", today, t })).toEqual({
      text: "fällig heute",
      tone: "due",
    });
    // Not "fällig 08.08." — the words are what makes today stand out; giving
    // them to every row would take that away again.
    expect(formatDueLabel("2026-08-08", { locale: "de-DE", today, t }).text).toBe("08.08.");
  });

  it("marks today and the past as due, the future as later", () => {
    expect(formatDueLabel("2026-08-11", { locale: "de-DE", today, t }).tone).toBe("due");
    expect(formatDueLabel("2026-08-12", { locale: "de-DE", today, t }).tone).toBe("due");
    expect(formatDueLabel("2026-08-13", { locale: "de-DE", today, t }).tone).toBe("later");
  });

  it("adds the year only when it differs from the current one", () => {
    expect(formatDueLabel("2026-01-31", { locale: "de-DE", today, t }).text).toBe("31.01.");
    // Without this a two-year-old task reads as if it were due this year.
    expect(formatDueLabel("2024-01-31", { locale: "de-DE", today, t }).text).toContain("24");
  });

  it("formats per locale instead of hardcoding one country's order", () => {
    // The red counter-check for a hand-built "31.07." pattern: it would print
    // German for all ten languages.
    expect(formatDueLabel("2026-01-31", { locale: "en-US", today, t }).text).toBe("01/31");
  });

  it("reads a day key as a local day", () => {
    // 2026-08-12 in a UTC-6 zone parses to Aug 11 via `new Date(string)`.
    const key = "2026-08-12";
    expect(formatDueLabel(key, { locale: "de-DE", today, t }).text).toBe("fällig heute");
  });

  it("shows an unreadable value as it stands", () => {
    expect(formatDueLabel("bald", { locale: "de-DE", today, t }).text).toBe("bald");
  });
});
