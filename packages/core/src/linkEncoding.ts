import { parseCommonMarkTree } from "./markdown-parser.js";

/**
 * Percent-encoding for the markdown link targets Plainva WRITES — index
 * files, the welcome note of a vault template, a renamed link.
 *
 * `encodeURI` was wrong for this job for the same reason it was wrong for
 * WebDAV (issue #78, `encodeDavPath`): it leaves `#` and `?` untouched, so a
 * note named "Draft #1.md" produced `Draft%20#1.md` — a link to "Draft " with
 * the anchor "1.md". Parentheses are the markdown-specific hazard: CommonMark
 * ends a link destination at an unbalanced `)`, so "Notes (draft.md" broke
 * the link at the space that `encodeURI` had dutifully encoded.
 *
 * Everything else stays as `encodeURI` had it — spaces become `%20`, umlauts
 * their UTF-8 bytes, `/` stays a separator — so an existing vault reads back
 * byte-identical for every name that does not carry one of the four
 * characters. The readers (`decodeMarkdownLinkTarget`) understand both the
 * old and the new form: `decodeURIComponent` decodes what `decodeURI` decoded
 * and additionally `%23`, `%3F`, `%28`, `%29`.
 */

const HAZARDS = /[#?()]/g;

/** Vault-relative path (or a relative `../x/y.md`) as a markdown link destination. */
export function encodeMarkdownLinkPath(path: string): string {
  return encodeURI(path).replace(HAZARDS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * A heading/block anchor for a destination: `#Heading Name` → `#Heading%20Name`.
 * The leading `#` IS the anchor marker and stays; any further `#`, `?` or
 * parenthesis inside the heading text is encoded like a path segment.
 */
export function encodeMarkdownLinkAnchor(anchor: string): string {
  if (!anchor) return "";
  const text = anchor.startsWith("#") ? anchor.slice(1) : anchor;
  return `#${encodeMarkdownLinkPath(text)}`;
}

/**
 * Decodes a markdown link destination the way both forms need it: the full
 * component decode first (it also decodes the four hazards), the reserved-
 * character-preserving decode as the fallback for a destination that only
 * `decodeURI` accepts, and the raw string when neither parses — a malformed
 * `%` sequence is a name, not a crash.
 */
export function decodeMarkdownLinkTarget(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    try {
      return decodeURI(url);
    } catch {
      return url;
    }
  }
}

/**
 * What a Markdown link's URL names: the target — the file or folder — and the
 * anchor behind it, marker included; null without one.
 *
 * ONE reading for the index, a click and a rename (finding 2026-10-11). The
 * first WRITTEN `#` is the anchor marker; a `#` that belongs to a file's name
 * arrives encoded (`%23`) and stays in the name, and so does a `^`. The
 * index's reader used to cut the DECODED target at the first `#` or `^` where
 * the URL carried no marker of its own: `Draft%20%231.md` was listed as a link
 * to `Draft`, so the note "Draft #1" had no backlink, no edge and no rewrite
 * on a rename — and a note `Draft.md` got all three.
 */
export function markdownLinkTarget(url: string): { target: string; anchor: string | null } {
  const marker = url.indexOf("#");
  const target = decodeMarkdownLinkTarget(marker < 0 ? url : url.slice(0, marker)).trim();
  const anchor = marker < 0 ? "" : decodeMarkdownLinkTarget(url.slice(marker)).trim();
  return { target, anchor: anchor.length > 1 ? anchor : null };
}

/** `\(` is `(`: a backslash in front of ASCII punctuation escapes it. */
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/**
 * A destination without the title behind it: `"…"`, `'…'` or `(…)` at its
 * end, a blank in front. Read from the end, one look per character — a
 * pattern for it would search the blanks of a long line again from every
 * start (plan Befunde 24.09., E6).
 */
function withoutTitle(text: string): string {
  const close = text[text.length - 1];
  const open = close === '"' || close === "'" ? close : close === ")" ? "(" : null;
  if (open === null) return text;
  const from = text.lastIndexOf(open, text.length - 2);
  if (from <= 0 || !/\s/.test(text[from - 1])) return text;
  return text.slice(0, from).trimEnd();
}

/** The URL the parser reads from `[x](written)`; null where that is no link of its own. */
function parsedDestination(written: string): string | null {
  const input = `[x](${written})`;
  const paragraph = parseCommonMarkTree(input).children?.[0];
  const link = paragraph?.children?.length === 1 ? paragraph.children[0] : undefined;
  return link?.type === "link" && typeof link.url === "string" && link.position?.end.offset === input.length ? link.url : null;
}

/** A character reference: `&amp;`, `&#35;`, `&#x23;`. Bounded parts: one look per `&`. */
const CHARACTER_REFERENCE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

/**
 * The URL of an inline link, from the text between its parentheses as a
 * surface holds it that scans a line instead of parsing it (the editor's link
 * drawing, a table cell, a journal entry): angle brackets and a title are
 * taken off and backslash escapes resolved — what the parser hands the index
 * for the same link. `[x](<My letter.md>)` and `[x](Letter.md "Title")` name
 * a file; the click used to be handed the brackets and the title with it.
 *
 * A destination with a blank and no title keeps the blank: such a link is none
 * for the parser, but the editor draws it and has always opened it.
 */
export function markdownDestinationUrl(written: string): string {
  const text = written.trim();
  // A character reference (`Tom&amp;Jerry.md`, `&#35;`) is resolved by the
  // parser, and the index and the reading view take the URL from it; read
  // here as written it named another file, and a click offered to create it
  // beside the real one (review 2026-10-22). The parser is asked only where
  // such a reference stands - a table cell asks for every link, and a `&` of
  // a query string is no reason -; everything else is read by hand below,
  // as the surfaces that scan a line have always read it.
  if (CHARACTER_REFERENCE.test(text)) {
    const parsed = parsedDestination(text);
    if (parsed !== null) return parsed;
  }
  if (text.startsWith("<")) {
    const close = text.indexOf(">");
    return (close < 0 ? text.slice(1) : text.slice(1, close)).replace(BACKSLASH_ESCAPE, "$1");
  }
  return withoutTitle(text).replace(BACKSLASH_ESCAPE, "$1");
}
