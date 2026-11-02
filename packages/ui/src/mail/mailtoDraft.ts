/**
 * What a `mailto:` link asks to write (RFC 6068) — one reading for both shells
 * (open-items plan 3.82).
 *
 * A mail address in a message opens Plainva's composer, from the mailbox the
 * message lies in, with what the link names: its recipients, its subject and
 * its text. The phone took the link apart in its message screen; the desktop
 * handed every link to the system, a mail address included, and the system's
 * mail program opened under its own sender — or nothing, where none is set.
 */

export interface MailtoDraft {
  /** The recipients, joined with ", ": those before the "?" and those of every `to` field. */
  to: string;
  subject: string;
  body: string;
}

/** Percent-decoding that never throws: a sequence that is no UTF-8 stays as written. */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The draft a `mailto:` address asks for; null for any other address. A "+"
 * is a "+" here — the address is no form: a space is written "%20" (RFC 6068,
 * 5). Field names are read without regard to case; of `subject` and `body` the
 * first counts.
 */
export function mailtoDraft(href: string): MailtoDraft | null {
  const match = /^\s*mailto:([^?#]*)(?:\?([^#]*))?/i.exec(href);
  if (!match) return null;
  const to: string[] = [];
  const add = (list: string): void => {
    for (const address of decoded(list).split(",")) if (address.trim()) to.push(address.trim());
  };
  add(match[1]);
  let subject: string | null = null;
  let body: string | null = null;
  for (const field of (match[2] ?? "").split("&")) {
    const at = field.indexOf("=");
    if (at <= 0) continue;
    const name = decoded(field.slice(0, at)).toLowerCase();
    const value = field.slice(at + 1);
    if (name === "to") add(value);
    else if (name === "subject" && subject === null) subject = decoded(value);
    // RFC 6068 writes a line break as "%0D%0A"; the composer's text has "\n".
    else if (name === "body" && body === null) body = decoded(value).replace(/\r\n?/g, "\n");
  }
  return { to: to.join(", "), subject: subject ?? "", body: body ?? "" };
}
