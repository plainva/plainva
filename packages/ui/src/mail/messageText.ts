import type { VisibleDocument } from "@plainva/core";
import { mailHtmlView, type MailHtmlView, type SanitizeEmailOptions } from "./mailSanitize";
import type { MailMessage } from "./types";

/** The two parts of a message its text can come from. */
export type MailBodyParts = Pick<MailMessage, "text" | "html">;

/** What the readers and the assistant are given of an HTML part the pass could not make safe: none of it. */
const UNREADABLE: MailHtmlView = {
  html: "",
  blockedRemote: 0,
  unreadable: true,
  document: () => ({ text: "", links: [], shows: false }),
  engineDocument: async () => ({ text: "", links: [], shows: false }),
  shows: () => false,
};

/**
 * The HTML part as the reader is given it and what the reader shows of it
 * (`mailHtmlView`). Where the pass cannot make it safe — no DOM, a sanitizer
 * or shaper that throws, a parse with no body — nobody is given the markup as
 * it came: not the reader, not the assistant, not a quote (review of
 * 2026-11-18: a pass that threw handed the reader's frame the raw mail, with
 * its style sheet, its form and its refresh).
 */
function viewOf(html: string, options?: SanitizeEmailOptions): MailHtmlView {
  try {
    const view = mailHtmlView(html, options);
    return view.unreadable ? UNREADABLE : view;
  } catch {
    return UNREADABLE;
  }
}

/**
 * The text and the links of an HTML part as the reader shows them: read from
 * the tree the reader's frame is given — what the mail sanitizer leaves of it
 * — without what that tree hides from the reader.
 *
 * Everything that turns a mail's HTML into words reads it here — the quote,
 * the filed note, and what the assistant reads of a message (finding
 * 2026-11-16: the assistant took the raw markup down on a way of its own, and
 * read words the reader never showed: a form the sanitizer removes, a folded
 * `<details>`, a popover, a box clipped to no size). One way, so that what a
 * person reads and what the assistant reads cannot drift apart; and one pass
 * over a message, shared by all of them (review of 2026-11-17).
 */
export function mailHtmlDocument(html: string): VisibleDocument {
  return viewOf(html).document();
}

/**
 * The body the reader shows of a message: its HTML part as the reader is given
 * it, or `null` where it shows the text part — one rule for both shells'
 * readers and the assistant (review of 2026-11-16). An HTML part that shows
 * nothing — blanks, or only what it hides — is not the body when there is a
 * text part: the reader used to give it its frame, an empty one, while the
 * assistant read the text part nobody saw. A picture the reader holds back is
 * a place it offers to load, and counts as something shown.
 */
export function mailBodyView(message: MailBodyParts, options?: SanitizeEmailOptions): MailHtmlView | null {
  const html = message.html;
  if (!html) return null;
  const view = viewOf(html, options);
  // A part that could not be made safe leaves the text part where there is
  // one; where there is none, the reader shows a sentence instead of the mail.
  if (!(message.text ?? "").trim()) return view;
  return view.shows() ? view : null;
}

/** The HTML part the reader shows as the body (`mailBodyView`), as the mail wrote it; `null` for the text part, and for a part the pass could not make safe. */
export function mailBodyHtml(message: MailBodyParts): string | null {
  const view = mailBodyView(message);
  return view && !view.unreadable ? message.html! : null;
}

function htmlPartText(html: string): string {
  return mailHtmlDocument(html).text;
}

/**
 * The text of a message — the ONE place that says what it is, for everything
 * that turns a message into words of the user's own: the quote of a reply, a
 * forward, the reply note and the filed note.
 *
 * It is the message's plain-text part where it has one. Many do not: Microsoft
 * Graph hands a body over as HTML unless it is asked otherwise, and a sender is
 * free to write HTML only. Then it is the text of the HTML part as the reader
 * shows it — read from the markup the reader's frame is given, and without
 * what the message hides from the reader there (a preview line, a tracking
 * text), so nobody quotes or files words they never saw.
 *
 * Four callers used to read `message.text` on their own, and a message without
 * that part came out as an empty quote, a forward of nothing but its header
 * block, and a filed note without a body (finding 2026-10-09). No transport
 * hands out a text it made from the HTML part itself: the text part is the
 * sender's, and where there is none, the text is made here, for every backend.
 *
 * Line ends are `\n` whichever part the text came from: `\r\n` is how a mail
 * travels, not part of what it says, and a note is written with `\n`.
 */
export function mailMessageText(message: MailBodyParts): string {
  const plain = message.text ?? "";
  const text = plain.trim() ? plain : message.html ? htmlPartText(message.html) : "";
  return text.replace(/\r\n?/g, "\n");
}
