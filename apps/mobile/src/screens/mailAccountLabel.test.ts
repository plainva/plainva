// @vitest-environment jsdom
// The label now reads the window (see labelRoomForWindow): the room a phone
// has is not the room a tablet has, so the unit that decides it needs one.
import { describe, expect, it } from "vitest";
import { mailAccountLabel } from "./MailListScreen";

/**
 * The mailbox bar used to cut the address at the "@", which made
 * marco.kammradt@outlook.com and marco.kammradt@gmail.com display identically —
 * and those are exactly the two accounts a person is most likely to hold at the
 * same time. The domain is what tells them apart, so the domain is what
 * survives shortening.
 */
describe("mailAccountLabel", () => {
  it("keeps the whole address when it fits", () => {
    expect(mailAccountLabel("me@example.com")).toBe("me@example.com");
  });

  it("distinguishes two accounts that share a local part", () => {
    const outlook = mailAccountLabel("marco.kammradt@outlook.com");
    const gmail = mailAccountLabel("marco.kammradt@gmail.com");
    expect(outlook).not.toBe(gmail);
    expect(outlook).toContain("@outlook.com");
    expect(gmail).toContain("@gmail.com");
  });

  it("elides the local part, never the domain", () => {
    const label = mailAccountLabel("a.very.long.local.part@outlook.com", 24);
    expect(label.endsWith("@outlook.com")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(24);
    expect(label).toContain("…");
  });

  it("unwraps a display-name form", () => {
    expect(mailAccountLabel("Marco Kammradt <me@example.com>")).toBe("me@example.com");
  });

  it("still shows the domain when even that does not fit", () => {
    expect(mailAccountLabel("someone@a-very-long-domain-name.example", 12)).toContain("@a-very-long-domain-name.example");
  });

  it("offers more room on a wide window than on a phone", () => {
    // The row's ellipsis decides the last pixel; this decides what it gets to
    // work with. A tablet used to show the phone's stub beside empty space.
    const long = "a.very.long.local.part@outlook.com";
    const original = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
      const phone = mailAccountLabel(long);
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
      const tablet = mailAccountLabel(long);
      expect(phone).toContain("…");
      expect(tablet).toBe(long);
      expect(tablet.length).toBeGreaterThan(phone.length);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
    }
  });

  it("handles a label that is not an address at all", () => {
    expect(mailAccountLabel("Work")).toBe("Work");
    expect(mailAccountLabel(undefined)).toBe("");
  });
});
