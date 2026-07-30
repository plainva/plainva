import { describe, expect, it } from "vitest";
import {
  normalizeSenderAddress,
  senderKey,
  senderOptions,
  signatureFor,
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

  /* The From field once built its own value with a newline while the OPTIONS
     were built with senderKey, so no option ever matched and the Select printed
     the raw value ("a1 me@example.org") instead of the label. Whoever picks the
     field value and whoever builds the options must use the same key. */
  it("is the only shape an option carries — a hand-joined value matches nothing", () => {
    const acc = account({ senders: ["alias@example.org"] });
    const options = senderOptions(acc).map((address) => senderKey(acc.id, address));
    expect(options).toContain(senderKey(acc.id, "me@example.org"));
    expect(options).not.toContain(`${acc.id}\nme@example.org`);
    for (const key of options) expect(key).not.toContain("\n");
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

/**
 * P8.2: a signature belongs to an ADDRESS. `signature` stays the default, so an
 * existing account keeps behaving exactly as it did — which is the part these
 * tests have to keep true while the new structure is added around it.
 */
/** The conventional signature marker a block starts with: "-- " and a newline. */
const SIG_MARK = "-- \n";

describe("signature per address", () => {
  const perAddress = account({
    signature: "Marco",
    senders: ["Sales <sales@example.org>", "billing@example.org"],
    signatures: { "sales@example.org": "Marco · Sales" },
  });

  it("uses the address's own signature, the default otherwise", () => {
    expect(signatureFor(perAddress, "Sales <sales@example.org>")).toBe("Marco · Sales");
    expect(signatureFor(perAddress, "billing@example.org")).toBe("Marco");
    expect(signatureFor(perAddress, "me@example.org")).toBe("Marco");
    // No address given at all = the account default (every existing call site).
    expect(signatureFor(perAddress)).toBe("Marco");
  });

  it("matches an address regardless of display name and case", () => {
    expect(normalizeSenderAddress("Sales <SALES@Example.org>")).toBe("sales@example.org");
    expect(signatureFor(perAddress, "SALES@example.org")).toBe("Marco · Sales");
    expect(signatureFor(perAddress, '"Sales, EU" <sales@example.org>')).toBe("Marco · Sales");
  });

  it("leaves an account without per-address signatures untouched", () => {
    const plain = account({ signature: "Marco" });
    expect(signatureFor(plain, "anything@example.org")).toBe("Marco");
    expect(withSignature("Hallo", plain, "anything@example.org")).toBe(withSignature("Hallo", plain));
  });

  it("swaps the block when only the ADDRESS changes", () => {
    // The bug this exposes: both shells only swapped when the ACCOUNT id
    // changed, so switching between two aliases of one account kept the first
    // signature — invisible before P8.2, wrong the moment addresses differ.
    const signed = withSignature("Hallo", perAddress, "me@example.org");
    expect(signed).toContain(SIG_MARK + "Marco");
    const swapped = withSignature(
      withoutSignature(signed, perAddress, "me@example.org"),
      perAddress,
      "sales@example.org",
    );
    expect(swapped).toContain(SIG_MARK + "Marco · Sales");
    expect(swapped.match(/^-- $/gm)).toHaveLength(1); // never two blocks
  });

  it("removes a block even when the caller no longer knows which address signed it", () => {
    const signed = withSignature("Hallo", perAddress, "sales@example.org");
    expect(withoutSignature(signed, perAddress)).not.toContain("Marco · Sales");
  });

  it("removes a per-address signature that extends the default whole", () => {
    // "Marco · Sales" contains "Marco": removing the shorter block first would
    // leave "· Sales" behind as if the user had typed it.
    const extending = account({ signature: "Marco", signatures: { "sales@example.org": "Marco\nSales team" } });
    const signed = withSignature("Hallo", extending, "sales@example.org");
    const bare = withoutSignature(signed, extending);
    expect(bare).not.toContain("Sales team");
    expect(bare).not.toContain("Marco");
  });
});
