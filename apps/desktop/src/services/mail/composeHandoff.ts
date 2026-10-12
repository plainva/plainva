import type { CarriedSnapshot, ComposeContent, MailAttachment } from "@plainva/ui/mail";

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
  /**
   * What the composer OPENED with, before anything was typed (finding
   * 2026-10-09). The leave question is asked when the draft differs from that,
   * and a draft does not become untouched by moving to another window: without
   * this the new window would measure against the moment of the pop-out, and
   * a whole written message could be closed there without a word.
   *
   * Absent means the snapshot is itself the opened state. The files a draft
   * arrived with travel a second time here — a note or an invitation, never
   * what the writer attached by hand.
   */
  opened?: ComposeContent;
  /**
   * The files of a forwarded original: the reference they are loaded by, the
   * ones still on the draft, and the bytes that had arrived. They travel ONCE —
   * the opened state above names them by index instead of holding them — and a
   * file that was still on its way is asked for again in the new window.
   */
  carried?: CarriedSnapshot;
  /**
   * Set when this is a message the mail server refused, coming back
   * (`sendQueue.ts`): the id it is held under. The queue lets go of it when
   * the window has collected this snapshot — until then the notice that
   * offers the way back stays.
   */
  refused?: number;
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
