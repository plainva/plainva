import { frontmatterSpan } from "../frontmatter-block.js";
import { createFenceTracker, readQuoteDepth, type FenceTracker } from "../markdownFence.js";

/**
 * The fenced code of a whole note that every renderer shows as code (strand 6,
 * Nr. 12): where a check of what an assistant writes may leave the text as it
 * stands. A check reads less as code, never more, so only a fence CommonMark
 * is sure of in its place counts —
 *
 * - its run stands at the very start of its line, or right behind quote
 *   markers that start the line, each with at most one space behind it: a run
 *   behind blanks may be a list item's content, an indented code block's text
 *   or nothing;
 * - it stands in the note's text — not in its properties block, and not in an
 *   HTML block, where a run is the block's text;
 * - no run before it only might open a fence: whether a later run then closes
 *   one or opens one depends on where the first stood — in a list item, or at
 *   the top behind a few blanks —, which a line does not say. From the first
 *   such run on, no fence is sure, and the rest of the note is read as text.
 *
 * Once open, the fence closes by the one rule of `markdownFence.ts` (which
 * never closes later than CommonMark for a fence that opens at the start of its
 * line), or ends with the quote it stands in. The ranges hold whole lines with
 * their line breaks: `from` is a line's start, `to` the start of the line after.
 */
export function sureFencedCode(text: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const head = frontmatterSpan(text);
  let offset = head ? head.end : 0;
  let fence: FenceTracker | null = null;
  let opened = 0;
  let html: HtmlBlock | null = null;
  // A run that only might have opened a fence came: from here on, no fence is sure.
  let unsure = false;
  while (offset < text.length) {
    const lineEnd = text.indexOf("\n", offset);
    const next = lineEnd < 0 ? text.length : lineEnd + 1;
    const raw = text.slice(offset, lineEnd < 0 ? text.length : lineEnd);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (fence) {
      const kind = fence.step(line);
      if (kind === "close") {
        out.push({ from: opened, to: next });
        fence = null;
        offset = next;
        continue;
      }
      if (kind === "code") {
        offset = next;
        continue;
      }
      // The quote it stood in ended, and the fence with it: this line is read on its own.
      out.push({ from: opened, to: offset });
      fence = null;
    }
    if (html) {
      if (htmlEnds(html, line, false)) html = null;
      offset = next;
      continue;
    }
    const start = htmlStart(line);
    if (start) {
      html = htmlEnds(start, line, true) ? null : start;
      offset = next;
      continue;
    }
    const run = fenceRunOf(line);
    if (run) {
      if (!run.sure) unsure = true;
      else if (!unsure) {
        fence = createFenceTracker();
        fence.step(line);
        opened = offset;
      }
    }
    offset = next;
  }
  if (fence) out.push({ from: opened, to: text.length });
  return out;
}

interface FenceRun {
  marker: string;
  length: number;
  /** At the very start of the line, or right behind quote markers that start it. */
  sure: boolean;
}

/** A run of three or more backticks or tildes, where a renderer could read one; null where no renderer could. */
function fenceRunOf(line: string): FenceRun | null {
  let at = 0;
  while (line[at] === ">") {
    at += 1;
    if (line[at] === " ") at += 1;
  }
  const strict = runAt(line, at);
  if (strict) return { ...strict, sure: true };
  // Leniently: behind any blanks and quote markers, and behind a list item's marker.
  let k = 0;
  for (;;) {
    while (line[k] === " " || line[k] === "\t") k += 1;
    if (line[k] !== ">") break;
    k += 1;
  }
  let m = k;
  if (line[m] === "-" || line[m] === "*" || line[m] === "+") m += 1;
  else {
    let digits = 0;
    while (digits < 9 && line[m] !== undefined && line[m]! >= "0" && line[m]! <= "9") {
      m += 1;
      digits += 1;
    }
    m = digits > 0 && (line[m] === "." || line[m] === ")") ? m + 1 : k;
  }
  if (m > k && (line[m] === " " || line[m] === "\t")) {
    k = m;
    while (line[k] === " " || line[k] === "\t") k += 1;
  }
  const loose = runAt(line, k);
  return loose ? { ...loose, sure: false } : null;
}

function runAt(line: string, at: number): Omit<FenceRun, "sure"> | null {
  const marker = line[at];
  if (marker !== "`" && marker !== "~") return null;
  let end = at;
  while (line[end] === marker) end += 1;
  if (end - at < 3) return null;
  const behind = line.slice(end);
  // A backtick in what follows a run of backticks makes it a code span: no fence opens there, and none closes.
  if (marker === "`" && behind.includes("`")) return null;
  return { marker, length: end - at };
}

interface HtmlBlock {
  /** What ends it: a mark on a line, or a blank line. */
  end: string;
  depth: number;
  /** Where the mark may first stand on the block's first line: behind the one that opened it. */
  from: number;
}

/** What may stand before a block's first character on its line: blanks, quote markers and list items' markers. */
const CONTAINER_MARK = /^(?:[ \t]+|>|(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t]|$))/;

/**
 * An HTML block's first line, as CommonMark starts one — read leniently, at any
 * depth of indentation, in a quote and in a list item: a block taken for one
 * where the renderer sees none only keeps a fence from opening, which a check
 * may do, and has more of a note read together.
 */
function htmlStart(line: string): HtmlBlock | null {
  const { depth, rest } = readQuoteDepth(line);
  let s = rest;
  for (let m = CONTAINER_MARK.exec(s); m && m[0].length > 0; m = CONTAINER_MARK.exec(s)) s = s.slice(m[0].length);
  if (s[0] !== "<") return null;
  const lead = rest.length - s.length;
  const lower = s.toLowerCase();
  if (lower.startsWith("<!--")) return { end: "-->", depth, from: lead + 4 };
  if (lower.startsWith("<?")) return { end: "?>", depth, from: lead + 2 };
  if (lower.startsWith("<![cdata[")) return { end: "]]>", depth, from: lead + 9 };
  if (/^<![a-z]/.test(lower)) return { end: ">", depth, from: lead + 2 };
  const raw = /^<(script|pre|style|textarea)(?=[\s>]|$)/.exec(lower);
  if (raw) return { end: `</${raw[1]}>`, depth, from: lead + 1 + raw[1]!.length };
  if (/^<\/?[a-z]/.test(lower)) return { end: "", depth, from: 0 };
  return null;
}

/** A blank line as CommonMark has one: spaces and tabs only — a line of other blanks goes on with its paragraph. */
const isBlankLine = (line: string): boolean => /^[ \t]*$/.test(line);

/** Whether a block ends on this line — its mark stands in it, or it is blank, or the quote the block stood in ended. */
function htmlEnds(block: HtmlBlock, line: string, first: boolean): boolean {
  const { depth, rest } = readQuoteDepth(line);
  if (depth < block.depth) return true;
  if (block.end === "") return !first && isBlankLine(rest);
  return rest.toLowerCase().indexOf(block.end, first ? block.from : 0) >= 0;
}

export interface TextRange {
  from: number;
  to: number;
}

/** A tag a write must not leave unread before it: one that gives the rest of the note a context, or `<base>`, which gives the whole note one. */
export interface ArmedTag {
  at: number;
  /** `<base>`: every relative address of the note, wherever it stands, resolves against it. */
  global: boolean;
}

/**
 * Where a check of what an assistant changed in a whole note must read beyond
 * the paragraphs the change touched (strand 6, Nr. 12) — read on the note with
 * its properties block and its sure code blanked out, which no renderer shows
 * as HTML:
 *
 * - `together`: what a renderer reads as one across blank lines. An HTML block
 *   that runs to an end mark — a comment, `<pre>`, `<style>`, `<?…?>`,
 *   `<![CDATA[…]]>`, `<!X…>` — keeps its text raw over blank lines, from its
 *   first line to the line of its mark; a browser may even leave the comment
 *   early (`--!>`) and read the rest as markup. And a tag left open at the end
 *   of its paragraph — its quote not closed, its ">" not come — takes what
 *   follows into it, as far as the end of the note.
 * - `armed`: tags that change how what follows them is read — `<style>` (what
 *   follows is a style sheet, until a `</style>` a browser may not see where
 *   this reading does), `<form>` (a button that follows sends it) — and
 *   `<base>`, which changes every relative address in the note.
 */
export function lintReach(text: string): { together: TextRange[]; armed: ArmedTag[] } {
  const read = blankedOut(text);
  const together: TextRange[] = [];
  let offset = 0;
  while (offset < read.length) {
    const lineEnd = read.indexOf("\n", offset);
    const next = lineEnd < 0 ? read.length : lineEnd + 1;
    const raw = read.slice(offset, lineEnd < 0 ? read.length : lineEnd);
    const start = htmlStart(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    if (start && start.end !== "" && !htmlEnds(start, raw, true)) {
      let end = next;
      while (end < read.length) {
        const after = read.indexOf("\n", end);
        const following = after < 0 ? read.length : after + 1;
        const line = read.slice(end, after < 0 ? read.length : after);
        end = following;
        if (htmlEnds(start, line.endsWith("\r") ? line.slice(0, -1) : line, false)) break;
      }
      together.push({ from: offset, to: end });
      offset = end;
      continue;
    }
    offset = next;
  }
  for (const m of read.matchAll(/<\/?[A-Za-z]/g)) {
    if (tagLeftOpen(read, m.index)) {
      together.push({ from: read.lastIndexOf("\n", m.index) + 1, to: read.length });
      break;
    }
  }
  const armed: ArmedTag[] = [];
  for (const m of read.matchAll(/<(style|form|base)(?=[\t\n\f\r />]|$)/gi)) armed.push({ at: m.index, global: m[1]!.toLowerCase() === "base" });
  return { together, armed };
}

/** The note with its properties block and its sure code made blanks, line breaks kept: what lies where it did, read as nothing. */
function blankedOut(text: string): string {
  const head = frontmatterSpan(text);
  const ranges = [...(head ? [{ from: 0, to: head.end }] : []), ...sureFencedCode(text)];
  if (ranges.length === 0) return text;
  const chars = text.split("");
  for (const { from, to } of ranges) {
    for (let i = from; i < to; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
  return chars.join("");
}

/** How much of a tag's name, attribute names and unquoted values is read before the tag counts as left open. */
const TAG_SCAN_MAX = 8192;
const isTagBlank = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";

/**
 * Whether the tag that begins at `at` goes on past the end of its paragraph, as
 * a browser reads it: to the ">" that stands outside a quoted value, across
 * lines, past a "<". One that reaches a blank line first, or the end of the
 * note, is left open.
 */
function tagLeftOpen(text: string, at: number): boolean {
  let i = at + 1;
  let budget = TAG_SCAN_MAX;
  const crossesBlankLine = (from: number, to: number): boolean => /\n[ \t]*\r?\n/.test(text.slice(from, to));
  const step = (stop: (c: string) => boolean): void => {
    while (i < text.length && budget > 0 && !stop(text[i]!)) {
      i += 1;
      budget -= 1;
    }
  };
  if (text[i] === "/") i += 1;
  step((c) => isTagBlank(c) || c === "/" || c === ">");
  for (;;) {
    step((c) => !(isTagBlank(c) || c === "/"));
    if (i >= text.length || budget <= 0) return true;
    if (text[i] === ">") return crossesBlankLine(at, i);
    i += 1;
    step((c) => isTagBlank(c) || c === "/" || c === ">" || c === "=");
    step((c) => !isTagBlank(c));
    if (i >= text.length || budget <= 0) return true;
    if (text[i] !== "=") continue;
    i += 1;
    step((c) => !isTagBlank(c));
    if (i >= text.length || budget <= 0) return true;
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1);
      if (close < 0) return true;
      i = close + 1;
    } else if (quote === ">") {
      return crossesBlankLine(at, i);
    } else {
      step((c) => isTagBlank(c) || c === ">");
    }
  }
}
