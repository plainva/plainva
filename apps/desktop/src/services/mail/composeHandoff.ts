import type { MailAttachment } from "@plainva/ui/mail";

/**
 * What a compose window is opened with (multi-window P3).
 *
 * Popping the composer out must not cost a word: everything the writer has
 * entered — recipients, subject, body, attachments, the chosen sender and
 * drafts folder — travels as a snapshot. Attachments are base64, so the URL is
 * not the place for it: the owner keeps the snapshot until the new window asks
 * for it once, over the bus.
 */
export interface ComposeSnapshot {
  accountId: string;
  fromAddress: string;
  to: string;
  cc: string;
  bcc: string;
  /** Whether the writer had opened the Cc/Bcc row — part of "loses nothing". */
  showCc: boolean;
  subject: string;
  body: string;
  attachments: MailAttachment[];
  mailbox: string;
}

const drafts = new Map<string, ComposeSnapshot>();

/** Keeps a snapshot for the window that is being opened for it. */
export function stashComposeDraft(label: string, snapshot: ComposeSnapshot): void {
  drafts.set(label, snapshot);
}

/**
 * Hands the snapshot to the window it was made for, once. Taken rather than
 * read: a compose window that reloads starts from what its user typed since,
 * not from the state it was popped out with.
 */
export function takeComposeDraft(label: string): ComposeSnapshot | null {
  const snap = drafts.get(label) ?? null;
  drafts.delete(label);
  return snap;
}

/** A window closed before it ever asked (the writer changed their mind). */
export function forgetComposeDraft(label: string): void {
  drafts.delete(label);
}
