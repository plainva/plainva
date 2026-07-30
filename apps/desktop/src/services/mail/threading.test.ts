import { describe, expect, it } from "vitest";
import { ancestorChain, formatMessageIds, parseMessageId, parseMessageIds, threadFields } from "@plainva/ui/mail";

/**
 * Findings P9.1: the data a conversation is grouped from.
 *
 * The whole point of one shared normaliser is that two transports which parse
 * headers differently end up with the same ids. The Rust IMAP path uses
 * mail-parser, which hands over ids WITHOUT angle brackets; the mobile socket
 * path forwards the raw header text, brackets and folding included. If those two
 * disagreed, two halves of the same conversation would stop finding each other —
 * and nothing would look broken until a thread silently split.
 *
 * So most of these cases are the same header in both forms, asserted to produce
 * the same answer.
 */

describe("parseMessageIds", () => {
  it("reads the bracketed form and drops the brackets", () => {
    expect(parseMessageIds("<a@x.org>")).toEqual(["a@x.org"]);
    expect(parseMessageIds("<a@x.org> <b@y.org>")).toEqual(["a@x.org", "b@y.org"]);
  });

  it("reads the already-stripped form identically", () => {
    // What mail-parser hands the Rust path. Same input, same answer.
    expect(parseMessageIds("a@x.org")).toEqual(["a@x.org"]);
    expect(parseMessageIds("a@x.org b@y.org")).toEqual(["a@x.org", "b@y.org"]);
  });

  it("survives folding and stray whitespace", () => {
    // A long References header arrives folded across lines.
    expect(parseMessageIds("<a@x.org>\r\n\t<b@y.org>  <c@z.org>")).toEqual(["a@x.org", "b@y.org", "c@z.org"]);
  });

  it("keeps case — a msg-id local part is case-sensitive", () => {
    expect(parseMessageIds("<AbC@x.org>")).toEqual(["AbC@x.org"]);
  });

  it("ignores tokens that cannot be ids", () => {
    // Broken clients write these; letting them through would group unrelated
    // mails into one conversation, which is worse than not grouping at all.
    expect(parseMessageIds("(none)")).toEqual([]);
    expect(parseMessageIds("<>")).toEqual([]);
    expect(parseMessageIds("<not-an-id>")).toEqual([]);
    expect(parseMessageIds("")).toEqual([]);
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds(undefined)).toEqual([]);
  });

  it("de-duplicates while keeping the first position", () => {
    expect(parseMessageIds("<a@x.org> <b@y.org> <a@x.org>")).toEqual(["a@x.org", "b@y.org"]);
  });

  it("takes the FIRST id of a single-id header", () => {
    // In-Reply-To names the parent. Taking the last would walk to the wrong end
    // of the chain on the rare header that lists more than one.
    expect(parseMessageId("<parent@x.org> <older@x.org>")).toBe("parent@x.org");
    expect(parseMessageId(null)).toBeUndefined();
  });

  it("round-trips through the header form", () => {
    const ids = ["a@x.org", "b@y.org"];
    expect(formatMessageIds(ids)).toBe("<a@x.org> <b@y.org>");
    expect(parseMessageIds(formatMessageIds(ids))).toEqual(ids);
    expect(formatMessageIds([])).toBe("");
    expect(formatMessageIds(undefined)).toBe("");
  });
});

describe("threadFields", () => {
  it("normalises both transport shapes to the same fields", () => {
    const socket = threadFields({
      messageId: "<c@z.org>",
      inReplyTo: "<b@y.org>",
      references: "<a@x.org> <b@y.org>",
    });
    const rust = threadFields({
      messageId: "c@z.org",
      inReplyTo: "b@y.org",
      references: "a@x.org b@y.org",
    });
    expect(socket).toEqual(rust);
    expect(socket).toEqual({ messageId: "c@z.org", inReplyTo: "b@y.org", references: ["a@x.org", "b@y.org"] });
  });

  it("leaves absent fields absent instead of inventing empty ones", () => {
    // An empty string would later read as "this message has an id", and a row
    // whose id is "" would match every other row without one.
    expect(threadFields({})).toEqual({});
    expect(threadFields({ messageId: "", references: "   ", threadId: null })).toEqual({});
  });

  it("passes a provider conversation id through untouched", () => {
    // Graph's conversationId is opaque — not a message id, not to be parsed.
    expect(threadFields({ threadId: "AAQkAD..." })).toEqual({ threadId: "AAQkAD..." });
  });
});

describe("ancestorChain", () => {
  it("is the References chain, oldest first", () => {
    const fields = threadFields({ references: "<a@x.org> <b@y.org>", inReplyTo: "<b@y.org>" });
    expect(ancestorChain(fields)).toEqual(["a@x.org", "b@y.org"]);
  });

  it("appends the parent when References does not mention it", () => {
    // Plenty of clients send In-Reply-To only; without this the reply would look
    // like the start of its own conversation.
    expect(ancestorChain(threadFields({ inReplyTo: "<b@y.org>" }))).toEqual(["b@y.org"]);
    expect(ancestorChain(threadFields({ references: "<a@x.org>", inReplyTo: "<b@y.org>" }))).toEqual([
      "a@x.org",
      "b@y.org",
    ]);
  });

  it("never includes the message's own id", () => {
    // Its identity is not its ancestry; mixing them would make a message its
    // own parent and the grouping would never terminate.
    const fields = threadFields({ messageId: "<c@z.org>", inReplyTo: "<b@y.org>" });
    expect(ancestorChain(fields)).not.toContain("c@z.org");
  });

  it("is empty for a conversation starter", () => {
    expect(ancestorChain(threadFields({ messageId: "<a@x.org>" }))).toEqual([]);
  });
});
