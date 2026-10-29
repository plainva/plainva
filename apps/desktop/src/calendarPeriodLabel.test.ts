import { afterEach, describe, expect, it } from "vitest";
import { dayRangeLabel } from "@plainva/ui";

/**
 * The period label of both calendars for a run of days (feedback 2026-10-29).
 * Both shells glued a fixed "." after the first day, so English read
 * "26.–Nov 1" and a week over a month's end named only the second month.
 */
const LANGUAGES = ["de", "en", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"];
const OCT_26 = new Date(2026, 9, 26);
const NOV_1 = new Date(2026, 10, 1);
const NOV_2 = new Date(2026, 10, 2);
const NOV_8 = new Date(2026, 10, 8);
/** ICU sets thin or narrow no-break spaces around the dash; compare words, not space widths. */
const spaced = (label: string) => label.replace(/\s/g, " ");

describe("dayRangeLabel", () => {
  it("reads as the language writes a range", () => {
    expect(spaced(dayRangeLabel(OCT_26, NOV_1, "de"))).toBe("26. Okt. – 1. Nov.");
    expect(spaced(dayRangeLabel(NOV_2, NOV_8, "de"))).toBe("2.–8. Nov.");
    expect(spaced(dayRangeLabel(OCT_26, NOV_1, "en"))).toBe("Oct 26 – Nov 1");
    expect(spaced(dayRangeLabel(NOV_2, NOV_8, "en"))).toBe("Nov 2 – 8");
    expect(spaced(dayRangeLabel(OCT_26, NOV_1, "de", "long"))).toBe("26. Oktober – 1. November");
  });

  it("names both months over a month's end, in every app language", () => {
    for (const language of LANGUAGES) {
      const label = dayRangeLabel(OCT_26, NOV_1, language);
      // Nothing is glued on after the first day any more ...
      expect(label, language).not.toMatch(/^26\.–/);
      expect(label, language).toMatch(/26/);
      // ... and where the language writes month names, both are there
      // (Japanese and Chinese write this range in numbers: "10/26～11/01").
      if (language === "ja" || language === "zh-CN") continue;
      const month = new Intl.DateTimeFormat(language, { month: "short" });
      expect(label, language).toContain(month.format(OCT_26).replace(/\.$/, ""));
      expect(label, language).toContain(month.format(NOV_1).replace(/\.$/, ""));
    }
  });

  it("is the day itself for a single day", () => {
    expect(dayRangeLabel(NOV_2, new Date(2026, 10, 2, 18), "de")).toBe("2. Nov.");
  });

  describe("without formatRange", () => {
    // The lib this package compiles against does not declare formatRange.
    const proto = Intl.DateTimeFormat.prototype as unknown as { formatRange?: unknown };
    const original = proto.formatRange;
    afterEach(() => {
      proto.formatRange = original;
    });
    it("joins the two ends with a dash", () => {
      delete proto.formatRange;
      expect(dayRangeLabel(OCT_26, NOV_1, "de")).toBe("26. Okt. – 1. Nov.");
    });
  });
});
