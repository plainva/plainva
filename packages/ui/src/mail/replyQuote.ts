/**
 * Quote grammar for replies and forwards — the ONE place that knows what a
 * quoted original looks like in a draft body.
 *
 * Two callers used to encode this independently: `buildReplyBody` wrote the
 * block (attribution line, then "> " lines), while `withSignature` looked for
 * its start with `/^>/m`. That search misses the attribution line ABOVE the
 * first ">", so the signature landed underneath it and the reader saw a piece
 * of the quoted mail above the signature (maintainer report 2026-07-29). A
 * forward had the same problem from the other side: it carries no ">" line at
 * all, so the signature went to the very end, below the forwarded message.
 *
 * Whoever BUILDS the block and whoever LOOKS for it now read the same rules
 * here, pinned against each other by a test — the point is that these two can
 * never drift apart again.
 */

/** Markdown blockquote marker. */
export const QUOTE_MARK = ">";

/** Separator that opens a forwarded message (a widespread mail convention). */
export const FORWARD_SEPARATOR = "---------- Forwarded message ----------";

/** Prefixes every line of `text` as a Markdown blockquote. Pure. */
export function quoteText(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `${QUOTE_MARK} ${line}`)
    .join("\n");
}

/**
 * The quoted original of a reply: an optional attribution line, then the
 * quoted text. The attribution stays OUTSIDE the quote (as in every mail
 * client) but belongs to the block — it is a statement about the quote, and a
 * signature placed between the two would read as part of the original.
 */
export function buildQuoteBlock(text: string, attribution?: string): string {
  const quoted = quoteText(text ?? "");
  const head = attribution?.trim() ? `${attribution.trim()}\n` : "";
  if (!quoted) return head ? `${head}` : "";
  return `${head}${quoted}`;
}

/**
 * Character index at which the quoted original begins — INCLUDING its
 * attribution line — or -1 when the body carries none.
 *
 * An attribution line counts as part of the block when it sits directly above
 * the first quoted line (no blank line between), is not itself quoted, and
 * ends in a colon. That is exactly the shape `buildQuoteBlock` writes; a line
 * the user typed themselves that happens to match introduces the quote too, so
 * putting the signature above it is right in that case as well.
 */
export function quotedOriginalStart(markdown: string): number {
  const lines = markdown.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1; // + the newline that split() removed
  }

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(QUOTE_MARK)) continue;
    start = i;
    const above = i > 0 ? lines[i - 1] : "";
    const trimmed = above.trim();
    if (trimmed.length > 0 && trimmed.endsWith(":") && !above.startsWith(QUOTE_MARK)) start = i - 1;
    break;
  }

  const forwardAt = lines.findIndex((line) => line.trim() === FORWARD_SEPARATOR);
  if (forwardAt >= 0 && (start < 0 || forwardAt < start)) start = forwardAt;

  return start < 0 ? -1 : offsets[start];
}
