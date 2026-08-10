/**
 * The public mail shapes, shared by both backends and both shells (feinplan
 * G0.1). Extracted from `mailClient.ts` so the transport interface can name
 * them without importing the client.
 */

/** Special-use role of a mailbox, where the backend states it authoritatively
 * (Graph well-known folders). IMAP leaves it unset — there the role is guessed
 * from the name, which only works for English/known conventions. */
export type MailFolderRole = "inbox" | "drafts" | "sent" | "trash" | "junk" | "archive";

export interface MailboxInfo {
  name: string;
  role?: MailFolderRole;
  /** Server-stated IMAP hierarchy delimiter (Graph folders use "/"). Lets the
   * UI split nested names at the real separator instead of guessing. */
  delimiter?: string;
}

export interface MailEnvelope {
  id: string;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
  flagged: boolean;
  /**
   * Opening words of the body, for the third line of a mobile list row (device
   * report B3). Rides along in the envelope request — Graph carries
   * `bodyPreview` anyway and IMAP takes a truncated body prefix in the same
   * FETCH — so it never costs a second roundtrip. Absent or empty when the
   * server gave nothing usable; the row then shows two lines.
   */
  preview?: string;
  /**
   * Thread identity (findings P9.1), for grouping a conversation. Rides along in
   * the same request as everything else above — Graph hands out its own
   * `conversationId`, IMAP the RFC chain in the same header FETCH.
   *
   * `threadId` is the provider's own grouping when it has one; the three RFC
   * fields are what IMAP gives, normalised WITHOUT angle brackets by the one
   * shared parser (`threading.ts`). All optional: a server that says nothing
   * leaves them absent, and grouping then falls back to the subject.
   */
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface MailEnvelopePage {
  total: number;
  /** Unread (\Unseen) count for the mailbox — the folder badge/status use this. */
  unseen: number;
  messages: MailEnvelope[];
}

export interface MailAttachmentInfo {
  index: number;
  name: string;
  mime: string;
  size: number;
}

export interface MailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  dateTs: number;
  text: string | null;
  html: string | null;
  attachments: MailAttachmentInfo[];
  /** IMAP mailbox epoch; paired with UID for a safe fallback identity. */
  uidValidity?: number;
  /** RFC Message-ID for cross-folder identity (notably Gmail All Mail). */
  providerMessageId?: string;
  /** RFC 2369 `List-Unsubscribe`, verbatim as the sender wrote it (S23). */
  listUnsubscribe?: string;
  /** RFC 8058 `List-Unsubscribe-Post` — the sender's one-click promise. */
  listUnsubscribePost?: string;
}

// ---- IMAP wire shapes (numeric uid), mapped to the string-id surface in
// mailClient. The transport speaks these; nothing above it does.

export interface RawImapEnvelope {
  uid: number;
  subject: string;
  from: string;
  dateTs: number;
  seen: boolean;
  flagged: boolean;
  /** See MailEnvelope.preview — built from the truncated body prefix. */
  preview?: string;
  /**
   * Thread headers AS THE SERVER WROTE THEM (findings P9.1): both transports
   * forward the header value and `mailClient` runs the one shared normaliser
   * over it. The Rust path parses with mail-parser (brackets already stripped),
   * the socket path forwards the raw text — the normaliser accepts both, which
   * is the point of having exactly one.
   */
  messageId?: string;
  inReplyTo?: string;
  /** Space-joined, the header's own form. */
  references?: string;
}

export interface RawImapEnvelopePage {
  total: number;
  unseen: number;
  messages: RawImapEnvelope[];
}

export interface RawImapMessage {
  uid: number;
  subject: string;
  from: string;
  to: string;
  dateTs: number;
  text: string | null;
  html: string | null;
  attachments: MailAttachmentInfo[];
  uidValidity?: number;
  providerMessageId?: string;
  /** RFC 2369 `List-Unsubscribe`, verbatim as the sender wrote it (S23). */
  listUnsubscribe?: string;
  /** RFC 8058 `List-Unsubscribe-Post` — the sender's one-click promise. */
  listUnsubscribePost?: string;
}
