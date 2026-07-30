/**
 * Thread identity of a message — the data grouping needs (findings P9.1).
 *
 * Two providers, two shapes. Microsoft Graph hands out its own `conversationId`
 * and we simply keep it. IMAP has no such thing: a conversation is reconstructed
 * from the RFC 5322 chain (`Message-ID`, `In-Reply-To`, `References`), which is
 * why those three ride along in the same header FETCH as subject and sender —
 * one roundtrip, exactly like the list preview.
 *
 * ONE normaliser for both platforms lives here. The Rust IMAP path parses
 * headers with `mail-parser` (which strips the angle brackets) while the mobile
 * socket path forwards the raw header text (which keeps them); a second parser
 * on either side would drift, and grouping is precisely the place where a
 * mismatch is invisible until two halves of a conversation stop finding each
 * other. Everything here is pure.
 *
 * Canonical form: WITHOUT angle brackets, whitespace collapsed, nothing else
 * touched. Case is preserved — RFC 5322 makes the local part of a msg-id
 * case-sensitive, and lowercasing it would merge ids that a server considers
 * different.
 */

/**
 * Every message id in a header value, in the order written. Accepts both forms
 * (`<a@b> <c@d>` and the already-stripped `a@b c@d`) and drops anything that is
 * not plausibly an id, so a mangled header yields fewer ids rather than junk.
 */
export function parseMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const bracketed = [...text.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
  const ids = bracketed.length > 0 ? bracketed : text.split(" ").map((t) => t.trim()).filter(Boolean);
  // An id has to contain an "@" to be one; broken clients write "(none)" or a
  // bare word, and letting that through would group unrelated mails together.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id.includes("@")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The single id of a header that carries one (Message-ID, In-Reply-To). */
export function parseMessageId(value: string | null | undefined): string | undefined {
  return parseMessageIds(value)[0];
}

/** The header form of a chain: `<a@b> <c@d>`. Round-trips `parseMessageIds`. */
export function formatMessageIds(ids: string[] | null | undefined): string {
  return (ids ?? []).filter(Boolean).map((id) => `<${id}>`).join(" ");
}

/** What a transport hands over: header values, in whatever form it has them. */
export interface RawThreadHeaders {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  /** Provider-native conversation grouping (Graph), passed through untouched. */
  threadId?: string | null;
}

/** The normalised thread fields of one envelope. Absent keys stay absent, so an
 * account whose server says nothing does not gain empty strings. */
export interface ThreadFields {
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** Normalises raw header values into the envelope's thread fields. Pure. */
export function threadFields(raw: RawThreadHeaders): ThreadFields {
  const out: ThreadFields = {};
  const threadId = raw.threadId?.trim();
  if (threadId) out.threadId = threadId;
  const messageId = parseMessageId(raw.messageId);
  if (messageId) out.messageId = messageId;
  const inReplyTo = parseMessageId(raw.inReplyTo);
  if (inReplyTo) out.inReplyTo = inReplyTo;
  const references = parseMessageIds(raw.references);
  if (references.length > 0) out.references = references;
  return out;
}

/** Reply and forward prefixes to strip before comparing subjects. Includes the
 * German, French, Italian, Spanish, Polish, Dutch and CJK forms clients write —
 * a conversation does not stop being one because the sender's mail app is in
 * another language. */
const SUBJECT_PREFIX =
  /^\s*(?:\[[^\]]{1,40}\]\s*)?(?:(?:re|aw|antw|antwort|ref|rif|res|odp|sv|vs|回复|回覆|답장)\s*(?:\[\d+\])?\s*:\s*|(?:fwd?|wg|weitergeleitet|tr|rv|enc|pd|转发|轉寄|전달)\s*(?:\[\d+\])?\s*:\s*)/i;

/**
 * A subject reduced to what two messages of one conversation share: reply and
 * forward prefixes stripped (repeatedly — "Re: AW: Re: x" happens), whitespace
 * collapsed, lowercased. For COMPARISON only; the displayed subject is always
 * the original. Pure.
 */
export function normalizeSubject(subject: string | null | undefined): string {
  let text = (subject ?? "").replace(/\s+/g, " ").trim();
  // Bounded: a pathological subject of nothing but prefixes must not spin.
  for (let i = 0; i < 12; i++) {
    const next = text.replace(SUBJECT_PREFIX, "");
    if (next === text) break;
    text = next.trim();
  }
  return text.toLowerCase();
}

/** True when the subject announces itself as a reply or forward. */
export function isReplySubject(subject: string | null | undefined): boolean {
  return SUBJECT_PREFIX.test((subject ?? "").trim());
}

/**
 * The full ancestor chain of a message, oldest first, with the parent last.
 *
 * `References` is supposed to be the whole chain, but plenty of clients send
 * only `In-Reply-To` — so the parent is appended when the chain does not already
 * end there. Deliberately not the message's own id: that is its identity, not
 * its ancestry, and mixing the two would make every message its own parent.
 */
export function ancestorChain(fields: ThreadFields): string[] {
  const chain = [...(fields.references ?? [])];
  const parent = fields.inReplyTo;
  if (parent && !chain.includes(parent)) chain.push(parent);
  return chain;
}

// ---- Grouping (findings P9.2) --------------------------------------------

/**
 * How far apart two messages may sit and still be joined by their SUBJECT.
 *
 * Only the subject fallback below uses this — a real reference chain is
 * unbounded in time, because it is evidence. A subject is a guess, and
 * "Re: Rechnung" in January is not the same conversation as "Re: Rechnung" the
 * following December. Thirty days is long enough to cover a thread that goes
 * quiet over a holiday and short enough that a recurring subject does not
 * collapse into one endless thread.
 */
export const SUBJECT_MATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The minimum a message needs to be grouped. Envelopes satisfy it; so does a
 *  cached row, which is why the grouping is pure and shared. */
export interface ThreadableMessage extends ThreadFields {
  id: string;
  subject: string;
  dateTs: number;
  /**
   * The folder this message was read from. Kept per message, never per thread:
   * a conversation legitimately spans Inbox, Sent and Archive, and a combined
   * list that forgot where a message came from could not act on it (open it,
   * move it, delete it) afterwards.
   */
  mailbox?: string;
  /**
   * Which account the message belongs to. A thread NEVER spans accounts — a
   * combined "all inboxes" list mixes them, and "Re: Rechnung" in the work
   * account is not the conversation of the same name in the private one. The
   * grouping keys are scoped by this, so a cross-account merge is impossible
   * rather than merely unlikely.
   */
  account?: string;
}

export interface MailThread<T extends ThreadableMessage> {
  /**
   * Stable, OPAQUE identity of the conversation — do not parse it. Built from
   * the account and either the provider id or the lexicographically smallest id
   * in the chain, which every reply names, so the key survives the oldest
   * message not being loaded.
   */
  key: string;
  /** The account every message in this thread belongs to. */
  account?: string;
  /** Subject of the OLDEST message: what the conversation was called. */
  subject: string;
  /** Newest timestamp in the thread — what a list sorts by. */
  latestTs: number;
  /** Oldest first, the order a conversation is read in. */
  messages: T[];
}

/** Minimal union-find over id strings. */
class Union {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x);
    if (root === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Smaller id wins, so the root is deterministic regardless of input order.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/**
 * Groups messages into conversations (P9.2).
 *
 * Evidence first, guess second:
 *
 *  1. A provider conversation id (Graph) decides on its own. Exchange has
 *     already grouped the mailbox, including replies whose References a client
 *     dropped, and second-guessing that would only ever make it worse.
 *  2. Otherwise the RFC chain: a message joins every id it names (its parent
 *     and its References), so two messages meet as soon as they share one
 *     ancestor. Unbounded in time — a chain is evidence.
 *  3. Only then the subject, and only for a message that has NO ancestry at all
 *     AND calls itself a reply ("Re: …"). That is the one case where the headers
 *     were lost rather than absent. A message without a reply marker is a
 *     conversation STARTER: merging two starters that happen to share a subject
 *     ("Rechnung", "Termin?") is the failure this rule exists to avoid.
 *
 * A message appearing in two folders (a sent copy in Gmail's All Mail, say)
 * appears ONCE per thread — the first occurrence wins, so callers decide
 * priority by the order they concatenate folders in.
 *
 * Pure and total: every input message ends up in exactly one thread, even with
 * no usable headers at all.
 */
export function groupThreads<T extends ThreadableMessage>(messages: T[]): MailThread<T>[] {
  const union = new Union();
  // Oldest first: the subject pass below wants to see an existing conversation
  // before the reply that tries to join it, and iterating in a fixed order keeps
  // the whole function deterministic.
  const ordered = [...messages].sort((a, b) => a.dateTs - b.dateTs || a.id.localeCompare(b.id));

  // Every key carries its account, so no union can ever cross one. NUL is not
  // valid in an account id, a message id or a Graph conversation id, so the
  // scope can never be confused with the value behind it.
  const SEP = "\u0000";
  const scope = (m: T): string => `${m.account ?? ""}${SEP}`;
  const anchorOf = (m: T): string =>
    scope(m) + (m.threadId ? `t:${m.threadId}` : m.messageId ? `m:${m.messageId}` : `x:${m.id}`);

  // 1 + 2: provider id and reference chain.
  for (const m of ordered) {
    const anchor = anchorOf(m);
    union.find(anchor);
    if (m.threadId) continue; // the provider's grouping is the whole answer
    for (const ancestor of ancestorChain(m)) union.join(anchor, `${scope(m)}m:${ancestor}`);
  }

  // 3: the subject fallback, for reply-marked messages with nothing to go on.
  const subjectRoots = new Map<string, Array<{ root: string; ts: number }>>();
  for (const m of ordered) {
    const subject = normalizeSubject(m.subject);
    if (!subject) continue;
    const key = `${scope(m)}${subject}`;
    const root = union.find(anchorOf(m));
    const known = subjectRoots.get(key);
    const orphan = !m.threadId && ancestorChain(m).length === 0;
    if (orphan && isReplySubject(m.subject) && known) {
      // Nearest in time among the conversations with this subject; a match
      // outside the window is no match at all.
      let best: { root: string; ts: number } | null = null;
      for (const cand of known) {
        if (union.find(cand.root) === root) continue;
        const distance = Math.abs(m.dateTs - cand.ts);
        if (distance > SUBJECT_MATCH_WINDOW_MS) continue;
        if (!best || distance < Math.abs(m.dateTs - best.ts)) best = cand;
      }
      if (best) union.join(anchorOf(m), best.root);
    }
    (known ?? subjectRoots.set(key, []).get(key)!).push({ root: union.find(anchorOf(m)), ts: m.dateTs });
  }

  // Collect.
  const groups = new Map<string, T[]>();
  const seenIds = new Map<string, Set<string>>();
  for (const m of ordered) {
    const root = union.find(anchorOf(m));
    const list = groups.get(root) ?? [];
    if (m.messageId) {
      const seen = seenIds.get(root) ?? new Set<string>();
      if (seen.has(m.messageId)) continue; // same mail, second folder
      seen.add(m.messageId);
      seenIds.set(root, seen);
    }
    list.push(m);
    groups.set(root, list);
  }

  const threads: Array<MailThread<T>> = [];
  for (const [root, list] of groups) {
    threads.push({
      // The root string verbatim: it already carries the account and IS the
      // smallest id of the union (see Union.join). Opaque on purpose — the only
      // promises it makes are stability and uniqueness.
      key: root,
      account: list[0]?.account,
      subject: list[0]?.subject ?? "",
      latestTs: list.reduce((max, m) => Math.max(max, m.dateTs), 0),
      messages: list,
    });
  }
  threads.sort((a, b) => b.latestTs - a.latestTs || a.key.localeCompare(b.key));
  return threads;
}

// ---- Row model for the list (findings P9.3) -------------------------------

/** What a list row needs beyond the grouping fields. */
export interface ThreadableEnvelope extends ThreadableMessage {
  from: string;
  seen: boolean;
  flagged: boolean;
}

export interface ThreadRow<T extends ThreadableEnvelope> {
  thread: MailThread<T>;
  /** The message a collapsed row stands for — the newest, as in every client. */
  latest: T;
  /** Distinct participants, oldest first: who is in this conversation. */
  participants: string[];
  count: number;
  /** True when ANY message is unread: a thread with one unread reply is unread. */
  unseen: boolean;
  flagged: boolean;
  /** The folders this conversation spans, in the order first seen. */
  mailboxes: string[];
}

/** Display name of a sender, or the bare address when there is no name. */
function senderName(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return (named?.[1] ?? from).trim();
}

/**
 * Groups messages and turns each conversation into one list row (P9.3).
 *
 * The counts are deliberately over the WHOLE thread, not the newest message: a
 * conversation with one unread reply is unread, and a thread whose oldest mail
 * is flagged is flagged. Anything else would hide the reason someone is looking
 * at the list.
 *
 * `maxParticipants` caps the name list — "Ada, Ben, Cleo +2" reads; twelve names
 * do not. Pure.
 */
export interface ThreadRowOptions {
  /** How many distinct names a collapsed row names before it stops. */
  maxParticipants?: number;
  /**
   * The mailbox the list is showing. Threads without a single message from it
   * are dropped: a folder read along to complete conversations (Sent) must not
   * put its own messages into the list (report 2026-07-30 — a reply whose
   * received counterpart is older than the loaded page grouped alone and then
   * appeared as an inbox row labelled "Sent").
   */
  anchorMailbox?: string;
}

export function threadRows<T extends ThreadableEnvelope>(
  messages: T[],
  opts: ThreadRowOptions | number = {},
): Array<ThreadRow<T>> {
  const { maxParticipants = 3, anchorMailbox } = typeof opts === "number" ? { maxParticipants: opts } : opts;
  const grouped = groupThreads(messages);
  const threads =
    anchorMailbox === undefined
      ? grouped
      : grouped.filter((t) => t.messages.some((m) => (m.mailbox ?? "") === anchorMailbox));
  return threads.map((thread) => {
    const names: string[] = [];
    const mailboxes: string[] = [];
    for (const m of thread.messages) {
      const name = senderName(m.from);
      if (name && !names.includes(name)) names.push(name);
      if (m.mailbox && !mailboxes.includes(m.mailbox)) mailboxes.push(m.mailbox);
    }
    // The newest message: what a collapsed row shows and opens.
    const latest = thread.messages.reduce((newest, m) => (m.dateTs >= newest.dateTs ? m : newest), thread.messages[0]);
    return {
      thread,
      latest,
      participants: names.slice(0, Math.max(1, maxParticipants)),
      count: thread.messages.length,
      unseen: thread.messages.some((m) => !m.seen),
      flagged: thread.messages.some((m) => m.flagged),
      mailboxes,
    };
  });
}
