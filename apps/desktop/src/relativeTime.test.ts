import { describe, expect, it } from "vitest";
import { absoluteTimeLabel, authorHue, authorInitials, relativeTimeLabel } from "@plainva/ui";

/**
 * The time and the chip on a comment card (K3). Both are derived, never
 * stored - so what has to hold is that the derivation is stable and speaks the
 * app language.
 */
describe("relativeTimeLabel", () => {
  const NOW = Date.parse("2026-09-03T12:00:00.000Z");

  it("speaks in the given language and switches to a date after a week", () => {
    expect(relativeTimeLabel("2026-09-03T11:59:40.000Z", "en", NOW)).toBe("now");
    expect(relativeTimeLabel("2026-09-03T11:20:00.000Z", "en", NOW)).toBe("40 minutes ago");
    expect(relativeTimeLabel("2026-09-03T10:00:00.000Z", "de", NOW)).toBe("vor 2 Stunden");
    expect(relativeTimeLabel("2026-09-02T09:00:00.000Z", "en", NOW)).toBe("yesterday");
    expect(relativeTimeLabel("2026-08-20T09:00:00.000Z", "en", NOW)).toMatch(/Aug 20|20 Aug/);
    expect(relativeTimeLabel("2025-08-20T09:00:00.000Z", "en", NOW)).toContain("2025");
  });

  it("never throws on a bad locale or a bad timestamp", () => {
    expect(relativeTimeLabel("2026-09-03T11:00:00.000Z", "no-such-locale-xx", NOW)).toBe("1 hour ago");
    expect(relativeTimeLabel("not a date", "en", NOW)).toBe("not a date");
    expect(absoluteTimeLabel("not a date", "en")).toBe("not a date");
  });
});

describe("author chip", () => {
  it("takes two letters from a name and keeps a member's hue stable", () => {
    expect(authorInitials("Marco Kammradt")).toBe("MK");
    expect(authorInitials("Lena")).toBe("LE");
    expect(authorInitials("  ")).toBe("?");
    expect(authorInitials("Anna Maria Berg")).toBe("AB");
    expect(authorHue("aabbccdd11223344")).toBe(authorHue("aabbccdd11223344"));
    expect(authorHue("x")).toBeLessThan(6);
  });
});
