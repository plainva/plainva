// @vitest-environment jsdom
// The label reads the window (see labelRoomForWindow), so the unit needs one.
import { describe, expect, it } from "vitest";
import { mailAccountLabel } from "./MailListScreen";

/**
 * An account label can carry a display name a server or a person wrote. The
 * address inside the angle brackets is picked out in linear time (plan
 * Befunde 24.09., E6); as a pattern, a long run of "<" cost quadratic time.
 */
describe("mailAccountLabel reads the angle address linearly", () => {
  it("takes the first non-empty angle address, else the whole label", () => {
    expect(mailAccountLabel("Marco <marco@example.com>", 64)).toBe("marco@example.com");
    expect(mailAccountLabel("<> <a@b.c>", 64)).toBe("a@b.c");
    expect(mailAccountLabel("  me@example.com ", 64)).toBe("me@example.com");
  });

  it("stays linear on a long run of angle brackets", () => {
    const label = "<".repeat(100_000);
    const start = performance.now();
    expect(mailAccountLabel(label, 64)).toBe(`${"<".repeat(63)}…`);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
