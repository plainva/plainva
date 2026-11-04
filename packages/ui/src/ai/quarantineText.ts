import { checkWebUrl, extractPage, webAddressesIn } from "@plainva/core";

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

export function readableBody(input: { html?: string | null; text?: string | null }, max: number): ReadableBody {
  const html = input.html?.trim();
  if (html) {
    // The base is no place: a relative link in a mail leads nowhere, and the address check drops it.
    const page = extractPage(html, "https://mail.invalid/");
    const body = cut(page.text, max);
    return { text: body.text, links: page.links.slice(0, LINKS_MAX), truncated: body.truncated || page.truncated };
  }
  const body = cut((input.text ?? "").replace(/\r\n?/g, "\n").trim(), max);
  return { text: body.text, links: linksIn(body.text), truncated: body.truncated };
}
