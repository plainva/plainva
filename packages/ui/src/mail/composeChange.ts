import type { MailAttachment } from "./mailOut";

/**
 * "Was this draft changed?" — the one rule both composers ask before they let
 * a message go without a word (finding 2026-10-09).
 *
 * The phone asked on the way out and measured against the wrong thing: against
 * the draft it was handed, so the signature the composer puts in itself counted
 * as unsaved work, and not against the files at all. The desktop composer did
 * not ask: Escape, the close button and "Cancel" dropped whatever stood in it.
 * Two shells answering the same question each in their own way is how they
 * came apart, so the answer lives here and both read it.
 *
 * Changed is measured against what the composer OPENED WITH, and the caller
 * says what that is:
 *
 *  - the recipients, Cc and Bcc it was given;
 *  - the subject it was given;
 *  - the body as an untouched composer shows it — the draft's text plus what
 *    the composer adds on its own, the sender's signature. A composer that
 *    re-signs the body for another sender re-signs this one too;
 *  - the files it arrived with: a note sent as an attachment, an invitation.
 *
 * So a signature alone is not a change, and neither is a file that came with
 * the draft. One put on or taken off by hand is.
 *
 * Which sender is chosen, whether the Cc row is open and which drafts folder a
 * draft would go to are not part of it: none of them is something a person
 * wrote, and each is one tap to choose again.
 */
export interface ComposeContent {
  /** Recipients as the field holds them: comma-, semicolon- or line-separated. */
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: readonly MailAttachment[];
}

/**
 * A recipient field as the entries it names. Split on comma, semicolon and
 * line break only — spaces stay, so "Name <a@b.org>" is one entry.
 */
export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Recipients are compared as the LIST they name, not as the text that spells
 * it. The desktop keeps each list as chips and joins them again with ", ", so
 * "a@b.org;c@d.org" comes back as "a@b.org, c@d.org" after a chip was added and
 * removed; on the phone a trailing comma is somebody still typing. Neither is a
 * recipient that would be lost.
 */
function sameRecipients(a: string, b: string): boolean {
  if (a === b) return true;
  const left = splitRecipients(a);
  const right = splitRecipients(b);
  return left.length === right.length && left.every((entry, i) => entry === right[i]);
}

/**
 * The same text, however its line breaks are written. The compose editor keeps
 * a document as lines, so a body handed to it with Windows line breaks — a
 * quoted mail, a note written on Windows — comes back with plain ones the
 * first time the composer itself touches it, which is when it puts the
 * signature in. Compared character by character, exactly the drafts nobody
 * touched would then count as changed.
 */
function sameText(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.includes("\r") && !b.includes("\r")) return false;
  return a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");
}

/**
 * The same object, or the same file. Identity answers first because it is the
 * usual case and costs nothing: an untouched composer holds the very objects
 * it opened with. The contents are only compared for a file that carries the
 * same name and type — one that travelled to another window beside the list it
 * came from, or one taken off and put back on.
 */
function sameFile(a: MailAttachment, b: MailAttachment): boolean {
  return a === b || (a.name === b.name && a.mime === b.mime && a.contentBase64 === b.contentBase64);
}

/** Whether `now` differs from what the composer opened with. Pure. */
export function composeChanged(opened: ComposeContent, now: ComposeContent): boolean {
  return (
    !sameRecipients(opened.to, now.to) ||
    !sameRecipients(opened.cc, now.cc) ||
    !sameRecipients(opened.bcc, now.bcc) ||
    opened.subject !== now.subject ||
    !sameText(opened.body, now.body) ||
    opened.attachments.length !== now.attachments.length ||
    opened.attachments.some((file, i) => !sameFile(file, now.attachments[i]))
  );
}
