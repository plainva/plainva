import { describe, expect, it } from "vitest";
import {
  senderKey,
  senderOptions,
  splitSenderKey,
  withSignature,
  withoutSignature,
  type MailAccountConfig,
} from "@plainva/ui/mail";

/**
 * Signatures and sender addresses (issue #34, round one). All four helpers are
 * pure and shared by both shells, which is the point: a signature must land in
 * the same place and a From choice must encode the same way on desktop and
 * phone, or a reply written on one looks wrong when continued on the other.
 */

const account = (over: Partial<MailAccountConfig> = {}): MailAccountConfig => ({
  id: "a1",
  label: "Work",
  host: "imap.example.org",
  port: 993,
  user: "me@example.org",
  ...over,
});

describe("senderOptions", () => {
  it("puts the account's own address first, then the aliases", () => {
    expect(senderOptions(account({ senders: ["Sales <sales@example.org>"] }))).toEqual([
      "me@example.org",
      "Sales <sales@example.org>",
    ]);
  });

  it("de-duplicates on the ADDRESS, not the display name", () => {
    // "Me <me@example.org>" is the same mailbox as the bare address — offering
    // both would be two entries that send identically.
    const out = senderOptions(account({ senders: ["Me <ME@example.org>", "other@example.org", " "] }));
    expect(out).toEqual(["me@example.org", "other@example.org"]);
  });

  it("survives an account without aliases", () => {
    expect(senderOptions(account())).toEqual(["me@example.org"]);
  });
});

describe("senderKey", () => {
  it("round-trips an account id and an address", () => {
    expect(splitSenderKey(senderKey("a1", "me@example.org"))).toEqual({ accountId: "a1", address: "me@example.org" });
  });

  it("keeps a display name that itself contains the separator", () => {
    const key = senderKey("a1", "Support | Sales <s@example.org>");
    expect(splitSenderKey(key).address).toBe("Support | Sales <s@example.org>");
  });

  it("degrades to an empty address rather than throwing", () => {
    expect(splitSenderKey("a1")).toEqual({ accountId: "a1", address: "" });
  });
});

describe("withSignature", () => {
  const signed = account({ signature: "Marco\nPlainva" });

  it("appends below the text, separated by the conventional marker", () => {
    expect(withSignature("Hello there", signed)).toBe("Hello there\n\n-- \nMarco\nPlainva\n");
  });

  it("goes ABOVE a quoted original, where every mail client puts it", () => {
    const reply = "Sure, works for me.\n\n> On Monday you wrote:\n> the original\n";
    const out = withSignature(reply, signed);
    expect(out.indexOf("-- ")).toBeLessThan(out.indexOf("> On Monday"));
    expect(out).toContain("> the original");
  });

  it("never applies twice", () => {
    const once = withSignature("Hi", signed);
    expect(withSignature(once, signed)).toBe(once);
  });

  it("is a no-op without a signature", () => {
    expect(withSignature("Hi", account())).toBe("Hi");
    expect(withSignature("Hi", account({ signature: "   " }))).toBe("Hi");
    expect(withSignature("Hi", null)).toBe("Hi");
  });
});

describe("withoutSignature", () => {
  it("removes exactly the account's block, leaving the text", () => {
    const signed = account({ signature: "Marco" });
    expect(withoutSignature(withSignature("Hello", signed), signed)).toBe("Hello\n");
  });

  it("leaves a quoted original in place when swapping sender", () => {
    const a = account({ signature: "Marco" });
    const b = account({ id: "a2", signature: "Sales team" });
    const reply = withSignature("Sure.\n\n> the original\n", a);
    const swapped = withSignature(withoutSignature(reply, a), b);
    expect(swapped).toContain("-- \nSales team");
    expect(swapped).not.toContain("Marco");
    expect(swapped).toContain("> the original");
  });

  it("never touches text the user typed themselves", () => {
    // The body contains the words but not the exact block — nothing to remove.
    const a = account({ signature: "Marco" });
    expect(withoutSignature("Marco said hello", a)).toBe("Marco said hello");
  });
});
