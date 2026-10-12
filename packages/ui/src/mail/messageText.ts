import { htmlToVisibleText, type MarkupNode } from "@plainva/core";
import type { MailMessage } from "./types";

/** The two parts of a message its text can come from. */
export type MailBodyParts = Pick<MailMessage, "text" | "html">;

/**
 * The HTML part as the platform's own parser reads it — the parser the reader's
 * frame uses, and one that stops nesting at a depth a page can have. The
 * document is inert: nothing in it runs, and nothing it names is fetched.
 */
function readerTree(html: string): MarkupNode {
  const page = new DOMParser().parseFromString(html, "text/html");
  return page.body ?? page.documentElement;
}

function htmlPartText(html: string): string {
  if (typeof DOMParser === "function") {
    try {
      return htmlToVisibleText(html, readerTree);
    } catch {
      /* a platform that refuses the parse: the portable parser below reads the same markup */
    }
  }
  return htmlToVisibleText(html);
}

/**
 * The text of a message — the ONE place that says what it is, for everything
 * that turns a message into words of the user's own: the quote of a reply, a
 * forward, the reply note and the filed note.
 *
 * It is the message's plain-text part where it has one. Many do not: Microsoft
 * Graph hands a body over as HTML unless it is asked otherwise, and a sender is
 * free to write HTML only. Then it is the text of the HTML part as the reader
 * shows it — without what the message hides from the reader (a preview line, a
 * tracking text), so nobody quotes or files words they never saw.
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
