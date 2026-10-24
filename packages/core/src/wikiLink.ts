/**
 * What a wiki link says (finding 2026-10-11).
 *
 * The parser hands a wiki link over as a node of its own that holds the link
 * as it stands in the note (`wikiLinkSyntax.ts`). This reads the text between
 * its brackets: the file it names, the anchor in that file, the alias it is
 * shown under. One reading for every reader of the tree — the index, the link
 * rewriter and the note source used to cut that text each in its own lines.
 *
 * The text is not Markdown. A backslash, a `*`, an `&amp;` in it is the
 * character it is. One spelling is known besides the plain one: in a table
 * cell a `|` has to be written `\|`, or the cell would end there. So a `\|`
 * is a bar wherever it stands — the one that begins the alias, and one in the
 * alias —, also outside a table, where notes carry that spelling too (a row
 * moved out of a table, a tool that always writes it). The Markdown parse read
 * it so as well.
 */

export interface WikiLinkParts {
  /**
   * The file the link names, as the index lists it (`links.target_path`):
   * what stands in front of the alias and of the anchor, trimmed. Empty for a
   * link to a place in the note itself (`[[#Heading]]`).
   */
  target: string;
  /** Target and anchor as they are written, trimmed (`links.target_raw`). */
  rawTarget: string;
  /** From the first `#` or `^` on: `#Heading`, `^block`, `#^block`. */
  anchor?: string;
  /** What stands behind the first `|`, each `\|` in it read as the `|` it spells. */
  alias?: string;
  /** Where `target` stands in the text between the brackets. */
  targetStart: number;
  targetEnd: number;
  /** Where name and anchor end in that text: in front of the bar — and of its backslash —, or at its end. */
  headEnd: number;
  /** Where the alias begins in that text, behind its `|`; -1 without one. */
  aliasStart: number;
}

const BACKSLASH = "\\";

/** The text between the brackets of a wiki link node: behind `[[` or `![[`, in front of `]]`. */
export function wikiLinkInner(node: { value: string; embed: boolean }): string {
  return node.value.slice(node.embed ? 3 : 2, -2);
}

/** Reads the text between the brackets of a wiki link. */
export function wikiLinkParts(inner: string): WikiLinkParts {
  const bar = inner.indexOf("|");
  // The name ends in front of the bar, and in front of the backslash that keeps the bar in its cell.
  const headEnd = bar < 0 ? inner.length : bar > 0 && inner[bar - 1] === BACKSLASH ? bar - 1 : bar;
  const head = inner.slice(0, headEnd);
  const rawTarget = head.trim();
  const hash = rawTarget.indexOf("#");
  const caret = rawTarget.indexOf("^");
  const mark = hash < 0 ? caret : caret < 0 ? hash : Math.min(hash, caret);
  const target = (mark < 0 ? rawTarget : rawTarget.slice(0, mark)).trim();
  const targetStart = head.length - head.trimStart().length;
  const parts: WikiLinkParts = { target, rawTarget, targetStart, targetEnd: targetStart + target.length, headEnd, aliasStart: bar < 0 ? -1 : bar + 1 };
  if (mark >= 0) parts.anchor = rawTarget.slice(mark).trim();
  if (bar >= 0) parts.alias = inner.slice(bar + 1).split(BACKSLASH + "|").join("|");
  return parts;
}

/**
 * The text between the brackets with its bars written plainly — the form a
 * reader takes that cuts it at `|` itself: `image.png\|300` is `image.png|300`.
 */
export function plainWikiLinkInner(inner: string): string {
  const parts = wikiLinkParts(inner);
  return parts.alias === undefined ? inner : `${inner.slice(0, parts.headEnd)}|${parts.alias}`;
}
