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
