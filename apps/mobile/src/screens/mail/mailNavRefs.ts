import type { MailAttachment } from "@plainva/ui/mail";
import type { MailDraft } from "../MailComposeScreen";

/**
 * A mail message needs three values in one nav path — account, mailbox and
 * message id. JSON keeps mailbox names with any character intact (a raw
 * separator byte would not, and NUL once turned source files binary here).
 *
 * Both readers are total: a malformed path yields empty values rather than
 * throwing, because a nav entry from an older build must never crash the shell.
 *
 * Each reader has its WRITER beside it, and the route tables use nothing else
 * (finding 2026-10-09). The paths used to be spelled as object literals at the
 * six places that push them, and the two sides came apart twice, each time in
 * a commit that taught one of them a new field:
 *
 *  - the composer's reader never learned the files a note sends along
 *    (2026-08-20), so "send this note as an attachment" opened the composer
 *    without the attachment;
 *  - the mail tab never wrote the read state the pushed mail screen writes
 *    (2026-08-09), so a message opened from the bar was marked read again on
 *    every visit and its menu offered "mark read" for a message that was.
 *
 * Neither could be seen by a type: an object literal handed to `JSON.stringify`
 * is checked against nothing. A writer that takes the type is.
 *
 * The desktop has no such path and never had the fault: its composer takes a
 * draft as an object through `plainva-compose-mail`, files included
 * (apps/desktop/e2e/mail.spec.ts, "compose from an attachment payload").
 */

export interface MailRef {
  accountId: string;
  mailbox: string;
  messageId: string;
  flagged: boolean;
  /** Read state from the list. A fetched message carries none, and without it
   *  the auto-read timer would re-mark an already read message on every visit. */
  seen: boolean;
}

/** A draft as the path of its `mailcompose` entry. */
export function draftPath(draft: MailDraft): string {
  return JSON.stringify(draft);
}

const isAttachment = (a: unknown): a is MailAttachment =>
  !!a && typeof a === "object" &&
  typeof (a as MailAttachment).name === "string" &&
  typeof (a as MailAttachment).mime === "string" &&
  typeof (a as MailAttachment).contentBase64 === "string";

export function parseDraft(path: string): MailDraft {
  try {
    const d = JSON.parse(path) as Partial<MailDraft>;
    return {
      accountId: d.accountId ?? "",
      to: d.to ?? "",
      subject: d.subject ?? "",
      body: d.body ?? "",
      // Only a list is a list of files, and only its well-formed entries are
      // files: the composer encodes and sends whatever arrives here unseen.
      ...(Array.isArray(d.attachments) ? { attachments: d.attachments.filter(isAttachment) } : {}),
    };
  } catch {
    return { accountId: "", to: "", subject: "", body: "" };
  }
}

/**
 * A message as the path of its `mailmsg` entry. The short keys are the stored
 * format: unlike a draft, an open message comes back after a restart
 * (services/sessionState.ts), so a path written by an older build is still read.
 */
export function mailRefPath(ref: MailRef): string {
  return JSON.stringify({ a: ref.accountId, m: ref.mailbox, id: ref.messageId, f: ref.flagged, s: ref.seen });
}

export function parseMailRef(path: string): MailRef {
  try {
    const p = JSON.parse(path) as { a?: string; m?: string; id?: string; f?: boolean; s?: boolean };
    return { accountId: p.a ?? "", mailbox: p.m ?? "", messageId: p.id ?? "", flagged: p.f === true, seen: p.s === true };
  } catch {
    return { accountId: "", mailbox: "", messageId: "", flagged: false, seen: false };
  }
}
