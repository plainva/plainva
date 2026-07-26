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
}
