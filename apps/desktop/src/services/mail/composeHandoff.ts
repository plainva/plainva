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
 * Hands the snapshot to the window it was made for.
 *
 * Deliberately a READ, not a take, and the reason is a bug this had on the
 * first real window (maintainer finding 2026-08-23): React StrictMode runs an
 * effect twice in development, so the window asked twice. The first answer
 * carried the draft and deleted it, the second came back empty and won — and
 * the writer saw "the draft is gone" over an empty form.
 *
 * The snapshot stays until the window it belongs to goes away: `openAuxWindow`
 * already calls `forgetComposeDraft` on close, whichever way it closed. That
 * bounds the map by the same lifetime a take would have, without making a
 * second question fatal.
 */
export function readComposeDraft(label: string): ComposeSnapshot | null {
  return drafts.get(label) ?? null;
}

/** A window closed before it ever asked (the writer changed their mind). */
export function forgetComposeDraft(label: string): void {
  drafts.delete(label);
}
