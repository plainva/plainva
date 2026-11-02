import { wikiLinkParts } from "@plainva/core";
/**
 * The anchor of a link target (issue #92, plan Kalender, Anker-Links,
 * Dependabot 2026-09-10, P5): `Note#Heading`, `Note#^block`, `#Heading`
 * (the same note), `other.md#heading`.
 *
 * ONE split above the core, the same rule the core's scanner applies
 * (`parseLinkTarget` in ast-scanner.ts: the first `#` or `^`, whichever comes
 * first). Six places used to do `split("#")[0]` and throw the rest away —
 * which is why a click on `[[Note#Section]]` opened the note at the top and
 * `[[#Section]]` did nothing at all. The anchor keeps its marker, so a caller
 * can tell a heading (`#…`) from a block (`^…` or `#^…`).
 */
export interface SplitLink {
  /** The note part, trimmed; empty for a same-note anchor. */
  target: string;
  /** `#Heading`, `#^block`, `^block` — or null when there is none. */
  anchor: string | null;
}

export function splitLinkAnchor(raw: string): SplitLink {
  const s = raw.trim();
  const hash = s.indexOf("#");
  const caret = s.indexOf("^");
  let at = -1;
  if (hash !== -1 && caret !== -1) at = Math.min(hash, caret);
  else if (hash !== -1) at = hash;
  else if (caret !== -1) at = caret;
  if (at === -1) return { target: s, anchor: null };
  const anchor = s.slice(at).trim();
  return { target: s.slice(0, at).trim(), anchor: anchor.length > 1 ? anchor : null };
}

/** True for a block reference (`^id` or `#^id`), false for a heading. */
export function isBlockAnchor(anchor: string): boolean {
  return anchor.startsWith("^") || anchor.startsWith("#^");
}

/** The text between `[[` and `]]`, read by the core's one rule. */
export interface WikiLinkInner extends SplitLink {
  /** Name and anchor as written: in front of the alias bar and of the backslash that keeps it in a table cell. */
  head: string;
  /** What stands behind the bar, each `\|` read as the `|` it spells; null without a bar. */
  alias: string | null;
  /** Where the alias begins in the inner text, behind its bar; -1 without one. */
  aliasStart: number;
}

/**
 * Splits the text between a wiki link's brackets into name, anchor and alias
 * (Sammelplan § 3.133 Nr. 1). The core's `wikiLinkParts` decides where the
 * name ends: in a table cell the bar is written `\|`, and `[[Note\|alias]]`
 * names "Note" for the index, a rename and the reading view. The readers above
 * the core cut at the first `|` themselves and took the backslash into the
 * name: the editor drew "Note\" as not created yet, and a click made it.
 */
export function readWikiLinkInner(inner: string): WikiLinkInner {
  const parts = wikiLinkParts(inner);
  const head = inner.slice(0, parts.headEnd);
  return { ...splitLinkAnchor(head), head, alias: parts.alias ?? null, aliasStart: parts.aliasStart };
}
