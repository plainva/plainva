import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceHourCycle, formatClockTime, formatHourMark, formatMinuteOfDay, formatMinuteRange } from "@plainva/ui";

// Finding X4 (review 2026-11-10): the calendar's axis said "14:00" while its
// events said "02:00 PM" in an English UI. Both now come from one function that
// takes the hour cycle from the device and only the words from the language.
describe("timeFormat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives a 24-hour device 24 hours in every app language", () => {
    for (const language of ["en", "de", "fr", "ja", "pt-BR"]) {
      expect(formatMinuteOfDay(14 * 60 + 5, { language, hourCycle: "h23" })).toBe("14:05");
      expect(formatMinuteOfDay(9 * 60, { language, hourCycle: "h23" })).toBe("09:00");
      expect(formatHourMark(14, { language, hourCycle: "h23" })).toBe("14:00");
    }
  });

  it("gives a 12-hour device 12 hours in every app language, with that language's day period", () => {
    const en = formatMinuteOfDay(14 * 60 + 5, { language: "en", hourCycle: "h12" });
    expect(en).toMatch(/^2:05\s?PM$/);
    const de = formatMinuteOfDay(14 * 60 + 5, { language: "de", hourCycle: "h12" });
    expect(de).toMatch(/^2:05\s?PM$/);
    expect(formatHourMark(14, { language: "en", hourCycle: "h12" })).toMatch(/^2\s?PM$/);
    expect(formatHourMark(0, { language: "en", hourCycle: "h12" })).toMatch(/^12\s?AM$/);
  });

  it("writes the axis and an event at the same hour in the same cycle", () => {
    for (const hourCycle of ["h12", "h23"] as const) {
      const axis = formatHourMark(14, { language: "en", hourCycle });
      const event = formatClockTime(new Date(2026, 7, 2, 14, 0), { language: "en", hourCycle });
      const twelve = (s: string) => /AM|PM/.test(s);
      expect(twelve(axis)).toBe(twelve(event));
    }
  });

  it("formats a range of one day", () => {
    expect(formatMinuteRange(9 * 60, 10 * 60 + 30, { language: "de", hourCycle: "h23" })).toBe("09:00–10:30");
  });

  it("clamps a minute outside the day instead of rolling into the next", () => {
    expect(formatMinuteOfDay(24 * 60, { language: "de", hourCycle: "h23" })).toBe("23:59");
    expect(formatMinuteOfDay(-5, { language: "de", hourCycle: "h23" })).toBe("00:00");
  });

  it("reads the device's cycle from the runtime's default locale, not the app language", () => {
    const real = Intl.DateTimeFormat;
    const fake = (cycle: string | undefined) =>
      // A function, not an arrow: the code under test calls it with `new`.
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale?: string | string[], opts?: Intl.DateTimeFormatOptions) {
        if (locale === undefined) return { resolvedOptions: () => ({ hourCycle: cycle }) } as unknown as Intl.DateTimeFormat;
        return new real(locale, opts);
      } as unknown as typeof Intl.DateTimeFormat);
    fake("h12");
    expect(deviceHourCycle()).toBe("h12");
    vi.restoreAllMocks();
    fake("h11");
    expect(deviceHourCycle()).toBe("h12");
    vi.restoreAllMocks();
    fake("h23");
    expect(deviceHourCycle()).toBe("h23");
    vi.restoreAllMocks();
    fake(undefined);
    expect(deviceHourCycle()).toBe("h23");
  });
});
