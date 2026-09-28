/**
 * Two Markdown block lines — the ATX heading and the blockquote line — read by
 * hand (plan Befunde 24.09., E6).
 *
 * The plain-text copy and the HTML copy each carried the same two patterns for
 * these lines. Both let a run be split two ways before a rest that had to reach
 * the end of the line — blanks between marker, text and closing `#` run, or
 * `>` markers before the quoted text — so a long run followed by a line break
 * made the engine retry the rest from every split: quadratic time on a pasted
 * line. One reader per line kind serves both copies now, in one pass.
 *
 * The readings stay exactly as they were:
 *
 * - Heading: up to three whitespace characters, one to six `#`, whitespace,
 *   then the text. The text starts after ALL the whitespace behind the marker
 *   and is the shortest one after which only a closing `#` run (with
 *   whitespace before it) and trailing whitespace are left — so `# a #` reads
 *   `a`, while a lone `# #` reads `#`. A line break inside the text makes the
 *   line no heading; one among the trailing whitespace does not.
 * - Quote: up to three whitespace characters, then `>` markers, each followed
 *   by at most one space or tab; the text is the rest. A line break anywhere
 *   after the markers makes the line no quote — the old pattern's `.*` could
 *   not cross it and had to reach the end.
 */

const WHITESPACE = /\s/;
const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && WHITESPACE.test(ch);
/** What `.` does not match. */
const isLineBreak = (ch: string | undefined): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
const hasLineBreak = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (isLineBreak(text[i])) return true;
  return false;
};

export interface AtxHeadingLine {
  /** 1 to 6 — the number of `#`. */
  level: number;
  /** The heading text without the closing `#` run and trailing whitespace. */
  text: string;
}

/** Reads one line as an ATX heading, or null when it is none. */
export function readAtxHeading(line: string): AtxHeadingLine | null {
  let at = 0;
  while (at < 3 && isWhitespace(line[at])) at++;
  let marker = at;
  while (line[marker] === "#") marker++;
  const level = marker - at;
  if (level < 1 || level > 6 || !isWhitespace(line[marker])) return null;

  let start = marker;
  while (isWhitespace(line[start])) start++;
  // What may follow the text: trailing whitespace, and before it a closing
  // `#` run that whitespace separates from the text.
  let end = line.length;
  while (end > start && isWhitespace(line[end - 1])) end--;
  let close = end;
  while (close > start && line[close - 1] === "#") close--;
  let gap = close;
  while (gap > start && isWhitespace(line[gap - 1])) gap--;

  const text = line.slice(start, gap < close ? gap : end);
  return hasLineBreak(text) ? null : { level, text };
}

export interface BlockquoteLine {
  /** The `>` markers with the one space or tab each may carry. */
  markers: string;
  /** What follows the markers. */
  text: string;
}

/** Reads one line as a blockquote line, or null when it is none. */
export function readBlockquoteLine(line: string): BlockquoteLine | null {
  let at = 0;
  while (at < 3 && isWhitespace(line[at])) at++;
  if (line[at] !== ">") return null;
  let end = at;
  while (line[end] === ">") {
    end++;
    if (line[end] === " " || line[end] === "\t") end++;
  }
  const text = line.slice(end);
  return hasLineBreak(text) ? null : { markers: line.slice(at, end), text };
}

/**
 * The quote levels nested in one line — `>  >  > text` — peeled in one pass:
 * what `readBlockquoteLine` applied to its own text again and again reads,
 * without copying and rescanning the rest of the line for every level (a line
 * of twenty thousand levels overflowed the stack of the recursive reader and
 * was quadratic besides). `depth` 0: the line is no quote.
 */
export function peelBlockquotes(line: string): { depth: number; text: string } {
  // A level's text holds a line break exactly when the line holds one at or
  // after the text's start: one scan from the end answers it for every level.
  let lastBreak = line.length - 1;
  while (lastBreak >= 0 && !isLineBreak(line[lastBreak])) lastBreak--;
  let from = 0, depth = 0;
  for (;;) {
    let at = from;
    while (at < from + 3 && isWhitespace(line[at])) at++;
    if (line[at] !== ">") break;
    let end = at;
    while (line[end] === ">") {
      end++;
      if (line[end] === " " || line[end] === "\t") end++;
    }
    if (lastBreak >= end) break;
    depth++;
    from = end;
  }
  return { depth, text: depth === 0 ? line : line.slice(from) };
}
