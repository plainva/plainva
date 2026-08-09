import type { MailDraft } from "../MailComposeScreen";

/**
 * A mail message needs three values in one nav path — account, mailbox and
 * message id. JSON keeps mailbox names with any character intact (a raw
 * separator byte would not, and NUL once turned source files binary here).
 *
 * Both readers are total: a malformed path yields empty values rather than
 * throwing, because a nav entry from an older build must never crash the shell.
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

export function parseDraft(path: string): MailDraft {
  try {
    const d = JSON.parse(path) as Partial<MailDraft>;
    return { accountId: d.accountId ?? "", to: d.to ?? "", subject: d.subject ?? "", body: d.body ?? "" };
  } catch {
    return { accountId: "", to: "", subject: "", body: "" };
  }
}

export function parseMailRef(path: string): MailRef {
  try {
    const p = JSON.parse(path) as { a?: string; m?: string; id?: string; f?: boolean; s?: boolean };
    return { accountId: p.a ?? "", mailbox: p.m ?? "", messageId: p.id ?? "", flagged: p.f === true, seen: p.s === true };
  } catch {
    return { accountId: "", mailbox: "", messageId: "", flagged: false, seen: false };
  }
}
