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
    const line = (value: unknown) => (typeof value === "string" ? value : "");
    // Cc, Bcc and the token of whoever waits to hear that the mail was sent ride along where the draft names them
    // (AI harness P5-6): a mail the assistant drafted.
    return {
      accountId: d.accountId ?? "",
      to: d.to ?? "",
      subject: d.subject ?? "",
      body: d.body ?? "",
      ...(line(d.cc) ? { cc: line(d.cc) } : {}),
      ...(line(d.bcc) ? { bcc: line(d.bcc) } : {}),
      ...(line(d.doneToken) ? { doneToken: line(d.doneToken) } : {}),
    };
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
