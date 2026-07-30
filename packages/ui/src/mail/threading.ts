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
