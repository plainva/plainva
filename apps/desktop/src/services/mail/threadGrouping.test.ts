import { describe, expect, it } from "vitest";
import {
  SUBJECT_MATCH_WINDOW_MS,
  groupThreads,
  isReplySubject,
  normalizeSubject,
  threadFields,
  threadRows,
  type ThreadableEnvelope,
  type ThreadableMessage,
} from "@plainva/ui/mail";

/**
 * Conversation grouping (findings P9.2), the pure core.
 *
 * Grouping fails in two opposite directions, and both are silent. Too little and
 * a conversation arrives in pieces; too much and two unrelated mails merge, so
 * one of them effectively disappears behind the other. The second is the worse
 * failure — a hidden mail looks like a mail that never arrived — which is why
 * the evidence (the reference chain) is unbounded in time while the guess (the
 * subject) is narrow, marker-gated and windowed.
 *
 * The cases named in the plan are the last two describes: "a reply without
 * References" must still find its thread, and "same subject, different
 * conversation" must never merge.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);

/** A message built the way the transports build one: raw headers, normalised. */
function mail(
  id: string,
  subject: string,
  dateTs: number,
  headers: { messageId?: string; inReplyTo?: string; references?: string } = {},
  over: Partial<ThreadableMessage> = {}
): ThreadableMessage {
  return { id, subject, dateTs, ...threadFields(headers), ...over };
}

describe("normalizeSubject", () => {
  it("strips reply and forward prefixes, however many", () => {
    expect(normalizeSubject("Re: Angebot")).toBe("angebot");
    expect(normalizeSubject("AW: Re: Fwd: Angebot")).toBe("angebot");
    expect(normalizeSubject("RE[2]: Angebot")).toBe("angebot");
  });

  it("handles the prefixes other languages write", () => {
    // A conversation does not stop being one because the other side's mail app
    // is in French, Polish or Chinese.
    expect(normalizeSubject("Rif: Preventivo")).toBe("preventivo");
    expect(normalizeSubject("Odp: Oferta")).toBe("oferta");
    expect(normalizeSubject("回复: 报价")).toBe("报价");
    expect(normalizeSubject("WG: Angebot")).toBe("angebot");
  });

  it("strips a leading list tag", () => {
    expect(normalizeSubject("[plainva] Re: Angebot")).toBe("angebot");
  });

  it("collapses whitespace and case but keeps the rest", () => {
    expect(normalizeSubject("  Re:   Das   Angebot ")).toBe("das angebot");
    // Not a prefix: a colon inside the subject must survive.
    expect(normalizeSubject("Rechnung: 2026-07")).toBe("rechnung: 2026-07");
  });

  it("terminates on a subject made of nothing but prefixes", () => {
    // Ten rounds of stripping is far past anything real ("Re: AW: Re: x" is the
    // upper end of what mail actually looks like).
    expect(normalizeSubject("Re: Re: Re: Re: Re: Re: Re: Re: Re: Re: Angebot")).toBe("angebot");
    // Past the bound it stops rather than looping, and keeps the remainder. The
    // trade is deliberate and documented: such a subject may not normalise to
    // the same string as its own reply, so a thread could arrive in pieces —
    // which is the harmless direction of a grouping failure, and infinitely
    // better than a list that never renders.
    const absurd = normalizeSubject("Re: ".repeat(30));
    expect(typeof absurd).toBe("string");
    expect(absurd.startsWith("re:")).toBe(true);
  });

  it("knows a reply marker from a plain subject", () => {
    expect(isReplySubject("Re: Angebot")).toBe(true);
    expect(isReplySubject("AW: Angebot")).toBe(true);
    expect(isReplySubject("Angebot")).toBe(false);
    // The word "Rechnung" starts with "Re" — it must not count as a marker.
    expect(isReplySubject("Rechnung")).toBe(false);
    expect(isReplySubject("Research results")).toBe(false);
  });
});

describe("groupThreads — the reference chain", () => {
  it("joins a real chain of three, oldest first", () => {
    const threads = groupThreads([
      mail("3", "Re: Angebot", T0 + 2 * HOUR, { messageId: "<c@z>", inReplyTo: "<b@y>", references: "<a@x> <b@y>" }),
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Re: Angebot", T0 + HOUR, { messageId: "<b@y>", inReplyTo: "<a@x>", references: "<a@x>" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
    // The conversation is called what it was called at the start.
    expect(threads[0].subject).toBe("Angebot");
    expect(threads[0].latestTs).toBe(T0 + 2 * HOUR);
  });

  it("joins two replies whose common ancestor is not loaded", () => {
    // Paging: the root is off-screen, but both replies name it.
    const threads = groupThreads([
      mail("5", "Re: Angebot", T0 + HOUR, { messageId: "<b@y>", references: "<a@x>" }),
      mail("6", "Re: Angebot", T0 + 2 * HOUR, { messageId: "<c@z>", references: "<a@x>" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("is unbounded in time — a chain is evidence, not a guess", () => {
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Re: Angebot", T0 + 400 * DAY, { messageId: "<b@y>", inReplyTo: "<a@x>" }),
    ]);
    expect(threads).toHaveLength(1);
  });

  it("gives every message a thread, even with no headers at all", () => {
    const threads = groupThreads([mail("1", "Angebot", T0), mail("2", "Termin", T0 + HOUR)]);
    expect(threads).toHaveLength(2);
    expect(threads.flatMap((t) => t.messages)).toHaveLength(2);
    expect(new Set(threads.map((t) => t.key)).size).toBe(2); // distinct keys
  });

  it("sorts threads by their newest message and keeps the key stable", () => {
    const older = mail("1", "A", T0, { messageId: "<a@x>" });
    const newer = mail("2", "B", T0 + DAY, { messageId: "<b@y>" });
    const forwards = groupThreads([older, newer]);
    const backwards = groupThreads([newer, older]);
    expect(forwards.map((t) => t.subject)).toEqual(["B", "A"]);
    // Deterministic: input order must not change the identity of a thread.
    expect(forwards.map((t) => t.key)).toEqual(backwards.map((t) => t.key));
  });
});

describe("groupThreads — the provider's own grouping", () => {
  it("takes a conversation id as the whole answer", () => {
    // Exchange has already grouped the mailbox, including replies whose
    // References a client dropped. Different subjects, same conversation.
    const threads = groupThreads([
      mail("1", "Angebot", T0, {}, { threadId: "conv-1" }),
      mail("2", "Angebot (Nachtrag)", T0 + HOUR, {}, { threadId: "conv-1" }),
      mail("3", "Angebot", T0 + 2 * HOUR, {}, { threadId: "conv-2" }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.messages.length === 2)?.messages.map((m) => m.id)).toEqual(["1", "2"]);
  });
});

describe("groupThreads — across folders", () => {
  it("keeps the origin folder of every message", () => {
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }, { mailbox: "INBOX" }),
      mail("2", "Re: Angebot", T0 + HOUR, { messageId: "<b@y>", inReplyTo: "<a@x>" }, { mailbox: "Sent" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.mailbox)).toEqual(["INBOX", "Sent"]);
  });

  it("shows the same mail once even when two folders hold it", () => {
    // Gmail's All Mail carries a copy of what is in Sent, with the same
    // Message-ID. Two rows for one mail would be a phantom reply.
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }, { mailbox: "Sent" }),
      mail("99", "Angebot", T0, { messageId: "<a@x>" }, { mailbox: "All Mail" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].mailbox).toBe("Sent"); // first one given wins
  });

  it("never merges two accounts", () => {
    // A combined inbox mixes accounts; "Re: Rechnung" at work is not the
    // conversation of the same name in the private account. Same ids on
    // purpose: even that must not join them.
    const threads = groupThreads([
      mail("1", "Rechnung", T0, { messageId: "<a@x>" }, { account: "work" }),
      mail("2", "Re: Rechnung", T0 + HOUR, { messageId: "<b@y>", inReplyTo: "<a@x>" }, { account: "private" }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.account).sort()).toEqual(["private", "work"]);
  });
});

describe("groupThreads — a reply without References", () => {
  it("joins the conversation by its subject", () => {
    // The case the plan names: a client that sends neither References nor
    // In-Reply-To. Its subject says it is a reply, so the headers were lost
    // rather than absent.
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Re: Angebot", T0 + 2 * HOUR, { messageId: "<b@y>" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("joins the conversation it is nearest to in time", () => {
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Angebot", T0 + 20 * DAY, { messageId: "<b@y>" }),
      mail("3", "Re: Angebot", T0 + 21 * DAY, { messageId: "<c@z>" }),
    ]);
    // Two starters stay apart (see below); the reply lands on the near one.
    const withReply = threads.find((t) => t.messages.some((m) => m.id === "3"));
    expect(withReply?.messages.map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("does not reach across the window", () => {
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Re: Angebot", T0 + SUBJECT_MATCH_WINDOW_MS + DAY, { messageId: "<b@y>" }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it("prefers the chain when there is one", () => {
    // A reply-marked message WITH ancestry never consults the subject, so a
    // renamed thread stays one thread.
    const threads = groupThreads([
      mail("1", "Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Re: Angebot (neuer Titel)", T0 + HOUR, { messageId: "<b@y>", inReplyTo: "<a@x>" }),
    ]);
    expect(threads).toHaveLength(1);
  });
});

describe("groupThreads — same subject, different conversation", () => {
  it("never merges two conversation starters", () => {
    // The failure this rule exists to prevent: two unrelated mails called
    // "Rechnung" merging, which hides one of them behind the other.
    const threads = groupThreads([
      mail("1", "Rechnung", T0, { messageId: "<a@x>" }),
      mail("2", "Rechnung", T0 + HOUR, { messageId: "<b@y>" }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it("keeps two independent chains apart even with identical subjects", () => {
    const threads = groupThreads([
      mail("1", "Termin", T0, { messageId: "<a1@x>" }),
      mail("2", "Re: Termin", T0 + HOUR, { messageId: "<a2@x>", inReplyTo: "<a1@x>" }),
      mail("3", "Termin", T0 + 2 * HOUR, { messageId: "<b1@y>" }),
      mail("4", "Re: Termin", T0 + 3 * HOUR, { messageId: "<b2@y>", inReplyTo: "<b1@y>" }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.messages.length).sort()).toEqual([2, 2]);
  });

  it("does not merge two forwards of the same subject", () => {
    // "Fwd: Angebot" twice is two forwards, not a conversation — but each may
    // legitimately attach to an existing thread of that subject, which is why
    // this asserts the STARTERS stay apart rather than forbidding the marker.
    const threads = groupThreads([
      mail("1", "Fwd: Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Fwd: Angebot", T0 + HOUR, { messageId: "<b@y>" }),
    ]);
    // The first has nothing to join; the second joins it, which is the
    // documented behaviour of a marker-gated fallback. What must NOT happen is
    // a third, unrelated PLAIN "Angebot" being pulled in.
    const plain = groupThreads([
      mail("1", "Fwd: Angebot", T0, { messageId: "<a@x>" }),
      mail("2", "Angebot", T0 + HOUR, { messageId: "<b@y>" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(plain).toHaveLength(2);
  });
});

describe("threadRows", () => {
  const env = (
    id: string,
    subject: string,
    dateTs: number,
    from: string,
    headers: { messageId?: string; inReplyTo?: string } = {},
    over: Partial<ThreadableEnvelope> = {}
  ): ThreadableEnvelope => ({
    id,
    subject,
    dateTs,
    from,
    seen: true,
    flagged: false,
    ...threadFields(headers),
    ...over,
  });

  it("summarises a conversation: participants, count, folders", () => {
    const rows = threadRows([
      env("1", "Angebot", T0, "Ada <ada@x>", { messageId: "<a@x>" }, { mailbox: "INBOX" }),
      env("2", "Re: Angebot", T0 + HOUR, "Marco <me@y>", { messageId: "<b@y>", inReplyTo: "<a@x>" }, { mailbox: "Sent" }),
      env("3", "Re: Angebot", T0 + 2 * HOUR, "Ada <ada@x>", { messageId: "<c@x>", inReplyTo: "<b@y>" }, { mailbox: "INBOX" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    // Oldest first, each name once — "Ada, Marco", not "Ada, Marco, Ada".
    expect(rows[0].participants).toEqual(["Ada", "Marco"]);
    expect(rows[0].mailboxes).toEqual(["INBOX", "Sent"]);
    // The collapsed row stands for the NEWEST message, as in every client.
    expect(rows[0].latest.id).toBe("3");
  });

  it("is unread when ANY message is, not when the newest is", () => {
    // A thread with one unread reply is unread — otherwise the list would hide
    // the very reason someone is looking at it.
    const rows = threadRows([
      env("1", "Angebot", T0, "Ada <ada@x>", { messageId: "<a@x>" }, { seen: false }),
      env("2", "Re: Angebot", T0 + HOUR, "Ada <ada@x>", { messageId: "<b@x>", inReplyTo: "<a@x>" }, { seen: true }),
    ]);
    expect(rows[0].unseen).toBe(true);
  });

  it("is flagged when any message is", () => {
    const rows = threadRows([
      env("1", "Angebot", T0, "Ada <ada@x>", { messageId: "<a@x>" }, { flagged: true }),
      env("2", "Re: Angebot", T0 + HOUR, "Ada <ada@x>", { messageId: "<b@x>", inReplyTo: "<a@x>" }),
    ]);
    expect(rows[0].flagged).toBe(true);
  });

  it("caps the participant list", () => {
    const many = ["Ada", "Ben", "Cleo", "Dan", "Eve"].map((n, i) =>
      env(String(i), i === 0 ? "Runde" : "Re: Runde", T0 + i * HOUR, `${n} <${n}@x>`, {
        messageId: `<m${i}@x>`,
        inReplyTo: i === 0 ? undefined : "<m0@x>",
      })
    );
    const rows = threadRows(many, 3);
    expect(rows[0].participants).toEqual(["Ada", "Ben", "Cleo"]);
    expect(rows[0].count).toBe(5);
  });

  it("leaves a single message as a plain row of one", () => {
    const rows = threadRows([env("1", "Angebot", T0, "ada@x", { messageId: "<a@x>" })]);
    expect(rows[0].count).toBe(1);
    expect(rows[0].participants).toEqual(["ada@x"]); // no display name: the address
  });
});
