/**
 * The links of a stretch the parse budget reads as text (`inlineParseBudget.ts`):
 * a paragraph over the inline budget, or a block the note's budget reads as
 * text (L14). There the parser sees stand-ins and makes no node of a link, but
 * the links are the note's: without them a backlink and the graph lose them,
 * and a rename of the note they lead to leaves them naming the old file
 * (Gesamtplan Leistung § 3a.6, decision 4). They are found here by their
 * characters, in one pass over each line — never with a parse of the stretch,
 * which is what the budget keeps from running out of memory — and handed out
 * as the nodes the parser makes of a link, so the index and a rename read them
 * from the same tree as every other link (`markdown-parser.ts`).
 *
 * A wiki link or an embed runs from a `[[` (`![[`) no backslash escapes to the
 * first `]]` on its line; an inline Markdown link from the `[` of its label to
 * the `)` behind its destination. A code span on the line and a fenced code
 * block in the stretch are code and are left alone. A table's rows are read
 * by the parser one at a time instead (`readRowLinks`), which is exact there.
 *
 * Named limits, where the parser reads otherwise and a line alone cannot tell:
 * indented code (four blanks after a blank line: `    [[x]]` is listed), a
 * code span over two lines of a paragraph, an HTML block, a link inside a
 * link's label (`[[[x]]](y)` lists both), and the addresses GFM makes links
 * of without brackets (`https://…`, `www.…`, `a@b.cc`, `<https://…>`): they name no
 * note, and are not listed.
 */

/** What a backslash escapes in Markdown: ASCII punctuation, nothing else. */
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
export const escapes = (text: string, at: number): boolean => text[at] === "\\" && at + 1 < text.length && ESCAPABLE.includes(text[at + 1]);

/** A stretch of the source with its backslash escapes taken out, and where each character stands. */
export interface Unescaped {
  text: string;
  /** Per character: where it begins in the source — at its backslash, if it has one. */
  starts: number[];
  /** Per character: the offset behind it. */
  ends: number[];
}

export function unescaped(text: string, from: number, to: number): Unescaped {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let at = from; at < to; ) {
    const char = escapes(text, at) && at + 1 < to ? at + 1 : at;
    chars.push(text[char]);
    starts.push(at);
    ends.push(char + 1);
    at = char + 1;
  }
  return { text: chars.join(""), starts, ends };
}

/**
 * The destination of an inline link whose label ends in front of `from - 2`:
 * behind `](`, in angle brackets or bare, up to `limit`. Null where none can
 * stand there.
 */
export function destinationAt(text: string, from: number, limit: number): { start: number; end: number; angle: boolean } | null {
  let at = from;
  while (at < limit && (text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r")) at++;
  if (text[at] === "<") {
    for (let end = at + 1; end < limit; end++) {
      if (escapes(text, end)) end++;
      else if (text[end] === ">") return { start: at + 1, end, angle: true };
      else if (text[end] === "<" || text[end] === "\n" || text[end] === "\r") return null;
    }
    return null;
  }
  let depth = 0;
  let end = at;
  for (; end < limit; end++) {
    const char = text[end];
    if (escapes(text, end)) end++;
    // A blank or a control character ends a bare destination.
    else if (char <= " " || char === "\x7f") break;
    else if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return { start: at, end: Math.min(end, limit), angle: false };
}

interface Point {
  line: number;
  column: number;
  offset: number;
}

/** A link as the parser makes one: a wiki link with its value, or a Markdown link with its URL and its label. */
export interface TextReadLinkNode {
  type: "wikiLink" | "link";
  value?: string;
  embed?: boolean;
  url?: string;
  children?: Array<{ type: "text"; value: string; position: { start: Point; end: Point } }>;
  position: { start: Point; end: Point };
}

/**
 * The links of `text[from, to)` as parser nodes, every place a place in
 * `text`. `lineAt(offset)` gives the 1-based line and the offset that line
 * starts at.
 */
export function textReadLinkNodes(text: string, from: number, to: number, lineAt: (offset: number) => { line: number; start: number }): TextReadLinkNode[] {
  const found: TextReadLinkNode[] = [];
  const point = (offset: number): Point => {
    const { line, start } = lineAt(offset);
    return { line, column: offset - start + 1, offset };
  };
  // A fenced code block inside the stretch is code: its lines hold no link (`fence`: the marker that closes it).
  let fence: string | null = null;
  for (let line = from; line < to; ) {
    let end = text.indexOf("\n", line);
    if (end < 0 || end > to) end = to;
    const marker = fenceOf(text.slice(line, Math.min(end, line + 256)).replace(/^[ \t>]*(?:[-+*]|\d{1,9}[.)])?[ \t]*/, ""));
    if (fence !== null) {
      if (marker && marker.run[0] === fence[0] && marker.run.length >= fence.length && marker.rest.trim() === "") fence = null;
    } else if (marker && !(marker.run[0] === "`" && marker.rest.includes("`"))) fence = marker.run;
    else linksOfLine(text, line, end, found, point);
    line = end + 1;
  }
  return found;
}

/** The opening or closing marker of a fenced code block at the start of `line` (three backticks or tildes or more), and what follows it. */
function fenceOf(line: string): { run: string; rest: string } | null {
  const char = line[0];
  if (char !== "`" && char !== "~") return null;
  let end = 1;
  while (line[end] === char) end++;
  return end >= 3 ? { run: line.slice(0, end), rest: line.slice(end) } : null;
}

/**
 * The links of one line. A run of backticks opens a code span only where a
 * run of the same length closes it further on the line, as the parser reads
 * it; an unmatched run is text (a code span over two lines of a paragraph is
 * not followed, a named limit: its links are listed). `missing` remembers
 * the lengths that close nowhere behind the place they were asked at, so that
 * no run is searched for twice.
 */
function linksOfLine(text: string, from: number, to: number, found: TextReadLinkNode[], point: (offset: number) => Point): void {
  let label = -1;
  const missing = new Set<number>();
  for (let at = from; at < to; at++) {
    const char = text[at];
    if (escapes(text, at)) {
      at++;
      continue;
    }
    if (char === "`") {
      let run = at;
      while (run < to && text[run] === "`") run++;
      const length = run - at;
      const close = missing.has(length) ? -1 : closingRun(text, run, to, length);
      if (close < 0) missing.add(length);
      at = (close < 0 ? run : close + length) - 1;
      continue;
    }
    if (char === "[" && text[at + 1] === "[") {
      const close = text.indexOf("]]", at + 2);
      if (close < 0 || close + 2 > to || close === at + 2) continue;
      const embed = at > from && text[at - 1] === "!" && !escapes(text, at - 2);
      const start = embed ? at - 1 : at;
      found.push({ type: "wikiLink", value: text.slice(start, close + 2), embed, position: { start: point(start), end: point(close + 2) } });
      at = close + 1;
      label = -1;
    } else if (char === "[") label = at;
    else if (char === "]" && text[at + 1] === "(" && label >= 0) {
      const destination = destinationAt(text, at + 2, to);
      const closing = destination ? destination.end + (destination.angle ? 1 : 0) : -1;
      if (!destination || text[closing] !== ")") continue;
      const children = at > label + 1 ? [{ type: "text" as const, value: text.slice(label + 1, at), position: { start: point(label + 1), end: point(at) } }] : [];
      found.push({ type: "link", url: unescaped(text, destination.start, destination.end).text, children, position: { start: point(label), end: point(closing + 1) } });
      at = closing;
      label = -1;
    }
  }
}

/** Where a run of exactly `length` backticks starts in `text[from, to)`, or -1. */
function closingRun(text: string, from: number, to: number, length: number): number {
  for (let at = text.indexOf("`", from); at >= 0 && at < to; at = text.indexOf("`", at)) {
    let run = at;
    while (run < to && text[run] === "`") run++;
    if (run - at === length) return at;
    at = run;
  }
  return -1;
}
