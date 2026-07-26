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

  it("handles a label that is not an address at all", () => {
    expect(mailAccountLabel("Work")).toBe("Work");
    expect(mailAccountLabel(undefined)).toBe("");
  });
});
