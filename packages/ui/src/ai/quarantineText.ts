import { checkWebUrl, webAddressesIn } from "@plainva/core/ai";
import { mailBodyView } from "../mail/messageText";

/**
 * A stranger's text as a reader in quarantine takes it (plan KI-Harness
 * P4-4): the body of a mail, the description of an appointment. What the user
 * sees is what is read — HTML as a reader would take a page down, without
 * what the markup hides; plain text as it stands — together with the
 * addresses it names, in the form a report's links are checked against.
 */

export interface ReadableBody {
  text: string;
  links: { text: string; url: string }[];
  /** The text is the beginning of something longer. */
  truncated: boolean;
}

const LINKS_MAX = 60;

/** The addresses a plain text names: public https ones, each once. */
function linksIn(text: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  for (const address of webAddressesIn(text)) {
    if (links.length >= LINKS_MAX) break;
    const checked = checkWebUrl(address);
    if (checked.ok && !links.some((link) => link.url === checked.target.url)) links.push({ text: "", url: checked.target.url });
  }
  return links;
}

/** The links of a shown body that a report may name: public https ones, each once. A relative
 * link leads nowhere in a mail (the base is no place), and the address check drops it. */
function checkedLinks(shown: readonly { text: string; href: string }[]): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  for (const link of shown) {
    if (links.length >= LINKS_MAX) break;
    if (link.href.startsWith("#")) continue;
    let absolute: string;
    try {
      absolute = new URL(link.href, "https://mail.invalid/").href;
    } catch {
      continue;
    }
    const checked = checkWebUrl(absolute);
    if (checked.ok && !links.some((known) => known.url === checked.target.url)) links.push({ text: link.text, url: checked.target.url });
  }
  return links;
}

function cut(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  // End at a paragraph where one is near, so the reader does not take half a sentence for a whole one.
  const at = text.lastIndexOf("\n\n", max);
  return { text: text.slice(0, at > max * 0.8 ? at : max).trimEnd(), truncated: true };
}

/** Markup, as far as a first look can tell: a tag that opens and one that closes, or a line break element. */
export function looksLikeHtml(text: string): boolean {
  return /<\/(p|div|span|a|b|i|u|ul|ol|li|table|tr|td|body|html|h[1-6]|strong|em|font)\s*>|<br\s*\/?>/i.test(text);
}

/** What the assistant reads of a body the readers could not make safe and do not show (`mailBodyView`). */
export const UNREADABLE_BODY = "[Plainva could not display this message safely and shows none of its content.]";

/**
 * `readableBody`, with what the reader shows judged by the engine of this device too (plan Umsetzung 0.9.x, B7;
 * F23): words that only the place of other boxes hides — run out of their box and painted over, or off the frame's
 * edge — are not read. What the assistant reads of a mail comes from here.
 */
export async function readableBodyInEngine(input: { html?: string | null; text?: string | null }, max: number, widths?: readonly number[]): Promise<ReadableBody> {
  const view = mailBodyView({ html: input.html ?? null, text: input.text ?? null });
  if (!view || view.unreadable) return readableBody(input, max);
  const shown = await view.engineDocument(widths);
  const body = cut(shown.text.trim(), max);
  return { text: body.text, links: checkedLinks(shown.links), truncated: body.truncated };
}

export function readableBody(input: { html?: string | null; text?: string | null }, max: number): ReadableBody {
  // The part the reader shows: an HTML part that shows nothing leaves the text part (`mailBodyView`).
  const view = mailBodyView({ html: input.html ?? null, text: input.text ?? null });
  if (view?.unreadable) return { text: UNREADABLE_BODY, links: [], truncated: false };
  if (view) {
    // Read as the mail reader shows it — the same way as a quote or a filed
    // note, off the tree the reader is given (finding 2026-11-16), in the one
    // pass the reader made of it —, never on a way of its own from the raw markup.
    const shown = view.document();
    const body = cut(shown.text.trim(), max);
    return { text: body.text, links: checkedLinks(shown.links), truncated: body.truncated };
  }
  const body = cut((input.text ?? "").replace(/\r\n?/g, "\n").trim(), max);
  return { text: body.text, links: linksIn(body.text), truncated: body.truncated };
}
