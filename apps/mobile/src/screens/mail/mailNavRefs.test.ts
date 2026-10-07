import { describe, expect, it } from "vitest";
import { parseDraft, parseMailRef } from "./mailNavRefs";

/**
 * A route's argument is text: what the composer and the reader open with is
 * read back from it, and a path nobody can read never crashes the shell.
 */
describe("a mail draft in a nav path", () => {
  it("opens the composer with the four fields every caller names", () => {
    expect(parseDraft(JSON.stringify({ accountId: "acc", to: "tom@example.org", subject: "Hello", body: "Text" }))).toEqual({
      accountId: "acc",
      to: "tom@example.org",
      subject: "Hello",
      body: "Text",
    });
    expect(parseDraft(JSON.stringify({ to: "tom@example.org" }))).toEqual({ accountId: "", to: "tom@example.org", subject: "", body: "" });
  });

  it("carries Cc, Bcc and the token of whoever waits to hear that it was sent — where the draft names them (AI harness P5-6)", () => {
    const path = JSON.stringify({ accountId: "", to: "a.okafor@example.org", cc: "tom@example.org, anna@example.org", bcc: "me@example.org", subject: "Re: Shooting day", body: "The 14th is fixed.", doneToken: "compose-3" });
    expect(parseDraft(path)).toEqual({
      accountId: "",
      to: "a.okafor@example.org",
      cc: "tom@example.org, anna@example.org",
      bcc: "me@example.org",
      subject: "Re: Shooting day",
      body: "The 14th is fixed.",
      doneToken: "compose-3",
    });
    // An ordinary draft has none of the three: the composer then behaves as it always did.
    const plain = parseDraft(JSON.stringify({ accountId: "acc", to: "", subject: "", body: "", cc: "", bcc: "", doneToken: "" }));
    expect(plain).toEqual({ accountId: "acc", to: "", subject: "", body: "" });
    // Anything but text in their place is not carried.
    expect(parseDraft(JSON.stringify({ to: "x@example.org", cc: ["y@example.org"], bcc: 7, doneToken: { id: 1 } }))).toEqual({ accountId: "", to: "x@example.org", subject: "", body: "" });
  });

  it("reads a path nobody can read as an empty draft", () => {
    expect(parseDraft("not json")).toEqual({ accountId: "", to: "", subject: "", body: "" });
    expect(parseDraft("")).toEqual({ accountId: "", to: "", subject: "", body: "" });
  });
});

describe("a mail message in a nav path", () => {
  it("is read back with its flags, and as empty values from a broken path", () => {
    expect(parseMailRef(JSON.stringify({ a: "acc", m: "INBOX/Clients & more", id: "42", f: true, s: true }))).toEqual({ accountId: "acc", mailbox: "INBOX/Clients & more", messageId: "42", flagged: true, seen: true });
    expect(parseMailRef("{")).toEqual({ accountId: "", mailbox: "", messageId: "", flagged: false, seen: false });
  });
});
