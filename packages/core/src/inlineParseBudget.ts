/**
 * How much inline Markdown a parser is given to read at once — the ONE rule
 * for every parse of a note's text: the index, the note source (outline,
 * journal, embedded sections), the reading view and the editor.
 *
 * The parsers do not read inline syntax in linear time. At each `]` the
 * CommonMark parser (micromark) looks back over everything it has read in the
 * paragraph for a `[` to close; at each `*`, `_` and `~` it looks back for an
 * opener of the same kind. Where there is none, every one of those characters
 * walks the whole paragraph again: a line of 100 000 `]` took the reading view
 * minutes (open-items plan 3.133 no. 4), and so did 1 250 lines of 80 `]`
 * without a blank line between them — the work belongs to a PARAGRAPH, not to
 * a line. The editor's parser (Lezer) does the same for emphasis. A note that
 * syncs in from someone else could hold such a paragraph on purpose.
 *
 * So the work of a paragraph is bounded by what it can cost
 * (`inlineParseCost`): how far the parser looks back, summed over every `]`,
 * `*`, `_` and `~` that makes it look — to the opener it finds, or to the
 * start of the paragraph where it finds none — read in one linear pass with
 * CommonMark's rules for what can open and close. Written Markdown costs
 * little by that measure, however long: a link or an emphasis finds its
 * opener a few characters back. A stretch over the budget is read as WRITTEN
 * — its characters are text, nothing in it is a link, a picture or emphasis
 * — and everything else in the note is read as before. At the budget, the
 * slowest paragraph found takes the desktop's parser a quarter of a second.
 *
 * What a paragraph is, is read line by line and in linear time, without a
 * parse: a run of lines without a blank line between them, up to the next
 * heading or list item (each begins inline content of its own; block quote
 * markers are read past). Two kinds of lines inside such a run are no
 * paragraph text and are measured on their own or not at all: the lines of
 * fenced code (no inline syntax is read in them) and the rows of a table
 * (each cell is read for itself). A table as a whole has a budget of its
 * own (`TABLE_READ_BUDGET`), for the memory its parse takes: since GFM
 * tables 2.1.2 the table parser reads a table in time linear in its cells
 * (Gesamtplan Leistung L13), but every cell is a parse of its own, and the
 * events of a large table are held until its tree is built. Fenced code is
 * recognised only where every Markdown reader agrees it is what it looks
 * like; anything less certain is measured with the lines around it. A table
 * is recognised wherever one can stand — behind quote markers at any depth
 * (an Obsidian callout), in a list item, in a footnote, right behind a
 * paragraph line — and read generously. Either mistake can only make a
 * stretch be read as written, never let one through that costs more.
 *
 * Before 2026-11 the index alone had a rule, a line of more than 10 000
 * characters (`VaultIndexer`); it stays, because the index's rows depend on
 * it. It neither caught the paragraph of short lines nor did it need to stop
 * a long line of plain text.
 */

import { frontmatterSpan, opensUnclosedProperties } from "./frontmatter-block.js";
import { readerWikiLink, readerWikiLinkLead } from "./readerWikiLink.js";

/** The most `inlineParseCost` a stretch may have and still be parsed as Markdown. */
export const INLINE_PARSE_BUDGET = 15_000_000;

/** A range of a text, in UTF-16 units: `from` inclusive, `to` exclusive. */
export interface BoundedRange {
  from: number;
  to: number;
  /** A table read as written: its range starts behind the markers of each line, and every character of it stands in. */
  table?: true;
  /** A block read as text to keep the note in its budget (`NOTE_BUDGET`): every character stands in, its markers too, and it is read as a paragraph. */
  block?: true;
}

const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** How a character next to a delimiter run is classed: white space (and the edge of the paragraph), punctuation, other. */
function classOf(ch: string | undefined): "space" | "punct" | "other" {
  if (ch === undefined || WHITESPACE.test(ch)) return "space";
  return PUNCTUATION.test(ch) ? "punct" : "other";
}

/** A run of `*`, `_` or `~` that may still close a later one. */
interface Opener {
  marker: string;
  at: number;
  length: number;
  original: number;
  canClose: boolean;
}

/**
 * What reading `text[from, to)` as one paragraph can cost a parser: for each
 * `]`, the distance back to the `[` it closes, or to the start where there
 * is none; for each run of `*`, `_`, `~` that can close, the distance back to
 * the run it closes, or to the start. CommonMark's flanking rules decide what
 * can open and close; where its rule of three — or a run of another length,
 * for `~` — keeps the nearest opener from matching, the run counts as one
 * that finds none, which can only make the measure larger than the parser's
 * work. A backslash escape is no delimiter.
 */
export function inlineParseCost(text: string, from = 0, to = text.length): number {
  let cost = 0;
  const brackets: number[] = [];
  const openers: Opener[] = [];
  for (let at = from; at < to; at++) {
    const ch = text[at];
    if (ch === "\\") {
      if (at + 1 < to && ASCII_PUNCTUATION.test(text[at + 1])) at++;
      continue;
    }
    if (ch === "[") {
      brackets.push(at);
      continue;
    }
    if (ch === "]") {
      const open = brackets.pop();
      cost += at - (open ?? from);
      continue;
    }
    if (ch !== "*" && ch !== "_" && ch !== "~") continue;
    let end = at;
    while (end < to && text[end] === ch) end++;
    const length = end - at;
    const before = classOf(at > from ? text[at - 1] : undefined);
    const after = classOf(end < to ? text[end] : undefined);
    const left = after !== "space" && (after !== "punct" || before !== "other");
    const right = before !== "space" && (before !== "punct" || after !== "other");
    const canOpen = ch === "_" ? left && (!right || before === "punct") : left;
    const canClose = ch === "_" ? right && (!left || after === "punct") : right;
    let rest = length;
    if (ch === "~" && length > 2) {
      // Three or more tildes are text to the strikethrough reader.
      at = end - 1;
      continue;
    }
    if (canClose) {
      while (rest > 0) {
        const top = openers[openers.length - 1];
        const matches = top !== undefined && top.marker === ch && (ch === "~"
          ? top.original === length
          : !((top.canClose || canOpen) && (top.original + length) % 3 === 0 && !(top.original % 3 === 0 && length % 3 === 0)));
        if (!matches) {
          cost += at - from;
          break;
        }
        cost += at - top.at;
        const use = ch === "~" ? rest : top.length >= 2 && rest >= 2 ? 2 : 1;
        top.length -= use;
        rest -= use;
        if (top.length <= 0) openers.pop();
      }
    }
    if (rest > 0 && canOpen) openers.push({ marker: ch, at, length: rest, original: length, canClose });
    at = end - 1;
  }
  return cost;
}

/**
 * The fewest characters of a note that may hold a part not read
 * (`ReadAsTextParts.unread`): each character adds to a paragraph's cost at
 * most its distance from the paragraph's start (`inlineParseCost`), so a
 * paragraph of n characters costs at most n(n − 1)/2, and over the budget it is
 * from 5 478 characters (a paragraph of `]`); a block the note's budget cannot
 * cut needs a note far larger. A rename reads the notes this large that may
 * name the renamed one (`notesThatMayNameUnread`).
 */
export const SMALLEST_UNREAD_CHARS = Math.ceil((1 + Math.sqrt(1 + 8 * INLINE_PARSE_BUDGET)) / 2);

/** Whether `text[from, to)`, read as one paragraph, costs more than the budget. */
export function exceedsInlineParseBudget(text: string, from = 0, to = text.length): boolean {
  // A stretch too short to reach the budget even if every character looked back to its start.
  const length = to - from;
  if (length * length <= INLINE_PARSE_BUDGET) return false;
  let closing = 0;
  for (let at = from; at < to; at++) if (text.charCodeAt(at) === 0x5d) closing++;
  return closing > MAX_CLOSING_BRACKETS || inlineParseCost(text, from, to) > INLINE_PARSE_BUDGET;
}

/**
 * The most `]` a stretch may hold and still be parsed as Markdown. The
 * editor's parser (Lezer) looks back over everything it has read in the block
 * each time a link closes, even one that finds its `[` next to it: a block of
 * 24 000 lines, each with a link and a wiki link, took it eleven seconds, 6 000 a
 * fifth of a second. No paragraph a person writes holds this many.
 */
export const MAX_CLOSING_BRACKETS = 20_000;

export interface ScanLine {
  from: number;
  /** End of the line's text, before its line break. */
  to: number;
  text: string;
}

function splitLines(text: string): ScanLine[] {
  const lines: ScanLine[] = [];
  // A byte order mark is no character of the first line: the parser leaves it out, so a table may start right behind it.
  let from = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let at = from; at <= text.length; at++) {
    const code = at < text.length ? text.charCodeAt(at) : -1;
    if (code === 0x0a || code === 0x0d || code === -1) {
      lines.push({ from, to: at, text: text.slice(from, at) });
      if (code === 0x0d && text.charCodeAt(at + 1) === 0x0a) at++;
      from = at + 1;
    }
  }
  return lines;
}

const isBlank = (line: string): boolean => {
  for (let at = 0; at < line.length; at++) {
    const code = line.charCodeAt(at);
    if (code !== 0x20 && code !== 0x09) return false;
  }
  return true;
};

/** The column a line's text starts at, a tab advancing to the next multiple of four, as CommonMark counts. */
const indentOf = (line: string): number => {
  let column = 0;
  for (let at = 0; at < line.length; at++) {
    if (line[at] === " ") column++;
    else if (line.charCodeAt(at) === 0x09) column += 4 - (column % 4);
    else break;
  }
  return column;
};

/** Where a line's text starts behind its blanks. */
const textStart = (line: string): number => {
  let at = 0;
  while (line[at] === " " || line.charCodeAt(at) === 0x09) at++;
  return at;
};

interface Fence {
  marker: "`" | "~";
  length: number;
  indent: number;
}

/** The fence a line opens: at most three blanks, three or more backticks or tildes; a backtick fence's info has no backtick. */
function fenceOpening(line: string): Fence | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const start = textStart(line);
  const marker = line[start];
  if (marker !== "`" && marker !== "~") return null;
  let end = start;
  while (line[end] === marker) end++;
  const length = end - start;
  if (length < 3) return null;
  if (marker === "`" && line.indexOf("`", end) >= 0) return null;
  return { marker, length, indent };
}

/** Whether `line` closes `fence`: at most three blanks, the same character at least as often, then only blanks. */
function closesFence(line: string, fence: Fence): boolean {
  if (indentOf(line) > 3) return false;
  const start = textStart(line);
  let end = start;
  while (line[end] === fence.marker) end++;
  return end - start >= fence.length && isBlank(line.slice(end));
}

/**
 * The line behind its block quote markers, each `>` with at most three blanks
 * before it and one after it — four blanks make indented code, or text that
 * continues a paragraph.
 */
function peelQuotes(line: string): { depth: number; content: string } {
  let at = 0;
  let depth = 0;
  for (;;) {
    let k = at;
    let blanks = 0;
    while (line[k] === " " && blanks < 4) {
      k++;
      blanks++;
    }
    if (blanks > 3 || line[k] !== ">") return { depth, content: line.slice(at) };
    k++;
    if (line[k] === " " || line.charCodeAt(k) === 0x09) k++;
    at = k;
    depth++;
  }
}

/** A list item's first line: where its marker stands, whether it is ordered and with which number, where its content starts. */
interface ItemStart {
  indent: number;
  ordered: boolean;
  first: boolean;
  content: number;
}

/**
 * The list item a line opens, with something written behind the marker (an
 * empty item opens nothing inside a paragraph). Columns as CommonMark counts
 * them: content begins behind the marker and up to four blanks, and behind
 * one blank where five or more follow (then the content is indented code).
 */
function itemStart(line: string): ItemStart | null {
  const indent = indentOf(line);
  let at = textStart(line);
  let ordered = false;
  let first = false;
  const ch = line[at];
  if (ch === "-" || ch === "+" || ch === "*") {
    at++;
  } else if (ch !== undefined && ch >= "0" && ch <= "9") {
    const digits = at;
    while (line[at] !== undefined && line[at] >= "0" && line[at] <= "9") at++;
    if (at - digits > 9 || (line[at] !== "." && line[at] !== ")")) return null;
    ordered = true;
    first = Number(line.slice(digits, at)) === 1;
    at++;
  } else {
    return null;
  }
  const markerEnd = indent + (at - textStart(line));
  let blanks = 0;
  while (line[at] === " " || line.charCodeAt(at) === 0x09) {
    blanks++;
    at++;
  }
  if (blanks === 0 || at >= line.length) return null;
  return { indent, ordered, first, content: markerEnd + (blanks > 4 ? 1 : blanks) };
}

/** An ATX heading: at most three blanks, one to six `#`, then a blank or the end. */
function isAtxHeading(line: string): boolean {
  if (indentOf(line) > 3) return false;
  let at = textStart(line);
  const start = at;
  while (line[at] === "#") at++;
  const marks = at - start;
  return marks >= 1 && marks <= 6 && (at === line.length || line[at] === " " || line.charCodeAt(at) === 0x09);
}

/** The tag names of HTML blocks that begin with any tag of that name (CommonMark's sixth kind). */
const HTML_BLOCK_NAMES = new Set(
  ("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset " +
    "h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul").split(" "),
);

/** An open or closing tag with nothing but blanks behind it (CommonMark's seventh kind of HTML block). */
const LONE_TAG = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;

/** Whether `text`, a line behind its blanks, opens an HTML block. */
function opensHtmlBlock(text: string, loneTag = true): boolean {
  if (text[0] !== "<") return false;
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(text)) return true;
  if (text.startsWith("<!--") || text.startsWith("<?") || text.startsWith("<![CDATA[") || /^<![A-Za-z]/.test(text)) return true;
  const named = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:[ \t>]|\/>|$)/.exec(text);
  if (named && HTML_BLOCK_NAMES.has(named[1].toLowerCase())) return true;
  // A lone tag opens a block of its own only where no paragraph is open: it cannot interrupt one.
  return loneTag && LONE_TAG.test(text);
}

/**
 * Whether `content` (a line behind the quote markers of the paragraph before
 * it) ends that paragraph, as the parser reads it: a heading, a fence, a
 * thematic break of `*`, `_` or `- - -`, an HTML block of the first six kinds,
 * and — where the parser opens blocks within blocks — a list item with
 * something written in it, numbered from 1 if numbered, and a footnote
 * definition. The test "ends a paragraph where the parser ends it" holds it
 * against the parser line by line. Every other line
 * continues the paragraph, and `---` or `===` underlines it as a heading.
 */
export function interruptsParagraph(content: string, containers = true): boolean {
  if (isBlank(content)) return true;
  if (indentOf(content) > 3) return false;
  const text = content.slice(textStart(content));
  if (isAtxHeading(text) || fenceOpening(text) || opensHtmlBlock(text, false)) return true;
  if (/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text)) return true;
  if (/^(?:-[ \t]*){3,}$/.test(text) && !/^-+[ \t]*$/.test(text)) return true;
  // A footnote definition is a container of its own, and it may interrupt a paragraph (micromark's GFM footnotes).
  return containers && (text[0] === ">" || /^(?:[-+*]|1[.)])[ \t]+[^ \t]/.test(text) || /^\[\^(?:\\[^]|[^\]\\ \t])+\]:/.test(text));
}

/**
 * Whether a line behind the markers of the blocks a table stands in
 * (`exactRow`) ends the table, as the table parser reads it: a
 * blank line, indented code, a quote, a heading, a fence, a list item (empty
 * or not, numbered from anything), a thematic break, a footnote, an HTML
 * block. Every other line is a row of the table, with or without a pipe —
 * `bar` under a table is a row of one cell. Exact, not generous, in both
 * directions: a row the scan ends too early escapes the table's weight, and
 * one it reads on too far escapes the measure of the paragraph it is in. The
 * test "ends a table where the table parser ends it" holds it against the
 * parser line by line.
 */
function endsTable(row: string, indent = indentOf(row), containers = true): boolean {
  if (isBlank(row) || indent > 3) return true;
  const start = textStart(row);
  // A row that starts with a pipe or a letter starts no block: the common row is asked nothing more.
  const first = row.charCodeAt(start);
  if (first === 0x7c || (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a)) return false;
  const text = row.slice(start);
  if (isAtxHeading(text) || fenceOpening(text)) return true;
  if (/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text)) return true;
  // Where the parser opens no blocks within blocks (`opensNoContainers`), a quote, a list item and a footnote are text, and rows.
  if (containers && (text[0] === ">" || /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(text) || /^\[\^(?:\\[^]|[^\]\\ \t])+\]:/.test(text))) return true;
  return opensHtmlBlock(text);
}

/**
 * Whether the parser opens no quote, list item or footnote anywhere in
 * `text`: a note whose first line is `---` (behind a byte order mark, with
 * blanks after it) and no later line closes it (`opensUnclosedProperties`). The properties reader of
 * `remark-frontmatter` takes that line for the start of a properties block
 * that never ends, and from then on the parser reads `> b` and `- a` as text,
 * also behind a blank line — and as rows under a table.
 */
export function opensNoContainers(text: string): boolean {
  // The one definition of the properties block decides where one opens and closes.
  return opensUnclosedProperties(text);
}

/**
 * Where a table line's content starts behind the markers of the blocks it
 * stands in, and how many block quotes those are: blanks, `>` at any depth,
 * and — on a table's first line only, where a block can open — a list
 * marker or a footnote label. A table stands wherever these stand: in a
 * quote or an Obsidian callout, in a list item, in a quote in a list, in a
 * list in a quote, in a footnote. Read generously: a line taken for a table
 * row that the parser reads otherwise only makes the measure stricter.
 */
export function tableLineStart(line: string, first: boolean, containers = true): { depth: number; at: number; prefix: number[] } {
  let at = 0;
  let depth = 0;
  if (!containers) {
    while (line[at] === " " || line[at] === "\t") at++;
    return { depth, at, prefix: [] };
  }
  // What every later line of the table must repeat: -1 a quote marker, n >= 0 an indent of n blanks.
  const prefix: number[] = [];
  for (;;) {
    const lead = at;
    while (line[at] === " " || line[at] === "\t") at++;
    if (line[at] === ">") {
      at++;
      depth++;
      prefix.push(-1);
      if (line[at] === " " || line[at] === "\t") at++;
      continue;
    }
    if (first) {
      const item = /^(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(line.slice(at));
      if (item) {
        // The item's content column: behind the marker and its blanks, or one blank where more than four follow.
        const marker = item[0].length - item[1].length;
        prefix.push(at - lead + marker + (item[1].length > 4 ? 1 : item[1].length));
        at += item[0].length;
        continue;
      }
      const footnote = /^\[\^(?:\\[^]|[^\]\\ \t])+\]:[ \t]*/.exec(line.slice(at));
      if (footnote) {
        // A footnote's later lines are indented by four.
        prefix.push(at - lead + 4);
        at += footnote[0].length;
        continue;
      }
    }
    return { depth, at, prefix };
  }
}

/**
 * Where a line of a table starts behind the markers of the blocks it stands
 * in (`prefix`, from `tableLineStart` on its header: -1 a quote marker, n >= 0
 * the n columns of a list item's or a footnote's content), and how far its
 * text is indented behind them, in columns as CommonMark counts them: a tab
 * to the next multiple of four, and a tab right behind a `>` gives one column
 * to the marker and the rest to the indent. `null` where the line leaves one
 * of the blocks: a quote without its marker, an item less indented than its
 * content (such a line is lazy, and a lazy line ends a table).
 */
/** The column behind `line[at]`, standing at `column`: a tab runs to the next multiple of four. */
function columnAfter(line: string, at: number, column: number): number {
  return line.charCodeAt(at) === 0x09 ? column + 4 - (column % 4) : column + 1;
}

function exactRow(line: string, prefix: readonly number[]): { at: number; indent: number } | null {
  let at = 0;
  let column = 0;
  // The column the content of the innermost block starts at.
  let content = 0;
  // Each step to the right written out (`columnAfter`), not a closure: the scan asks this of every row.
  for (const need of prefix) {
    if (need < 0) {
      let blanks = 0;
      while (line[at] === " " && blanks < 3) {
        column = columnAfter(line, at++, column);
        blanks++;
      }
      if (line[at] !== ">") return null;
      column = columnAfter(line, at++, column);
      content = column;
      if (line[at] === " " || line[at] === "\t") {
        content = column + 1;
        column = columnAfter(line, at++, column);
      }
    } else {
      // The item's content starts `need` columns behind where its marker's block began.
      const from = content;
      while (column < from + need && (line[at] === " " || line[at] === "\t")) column = columnAfter(line, at++, column);
      if (column < from + need) return isBlank(line.slice(at)) ? { at, indent: 0 } : null;
      content = from + need;
    }
  }
  const start = at;
  while (line[at] === " " || line[at] === "\t") column = columnAfter(line, at++, column);
  return { at: start, indent: column - content };
}

/** The cells of a table line as the table parser counts them (`tableRowParts`). A header without a pipe has one: `a` over `|-` is a table. */
function tableCells(line: string): number {
  // A header of a lone `|` has no cell (a row of one has one): the parser reads no table there.
  if (trimBlanks(line) === "|") return 0;
  return tableRowParts(line, 0, line.length).cells;
}

/** `text` without the blanks and tabs at either end: the only white space Markdown's blocks know (`String.trim` also takes a no-break space, the parser does not). */
const trimBlanks = (text: string): string => {
  // A loop, not `/[ \t]+$/`: that pattern tries every blank of a long run against the end, in the square of the run.
  let from = 0;
  let to = text.length;
  while (from < to && (text[from] === " " || text[from] === "\t")) from++;
  while (to > from && (text[to - 1] === " " || text[to - 1] === "\t")) to--;
  return text.slice(from, to);
};

/**
 * A table's delimiter row: cells of `-` with an optional `:` on either side.
 * Without a `|` it needs a `:` (`:-` is one, `--` underlines a heading).
 */
/** Whether `line[at]` is a blank or a tab. */
function blankAt(line: string, at: number): boolean {
  const code = line.charCodeAt(at);
  return code === 0x20 || code === 0x09;
}

function delimiterRowCells(line: string): number | null {
  if (indentOf(line) > 3) return null;
  // In place, without a copy of the line or of its cells: the scan asks it of every line under one with a pipe.
  let from = 0;
  let to = line.length;
  while (from < to && blankAt(line, from)) from++;
  while (to > from && blankAt(line, to - 1)) to--;
  let marked = false;
  for (let at = from; at < to && !marked; at++) marked = line.charCodeAt(at) === 0x7c || line.charCodeAt(at) === 0x3a;
  if (!marked) return null;
  // One pipe in front and one behind are no cell boundaries.
  if (line.charCodeAt(from) === 0x7c) from++;
  if (to > from && line.charCodeAt(to - 1) === 0x7c) to--;
  let cells = 0;
  for (let start = from; ; ) {
    let end = start;
    while (end < to && line.charCodeAt(end) !== 0x7c) end++;
    let a = start;
    let b = end;
    while (a < b && blankAt(line, a)) a++;
    while (b > a && blankAt(line, b - 1)) b--;
    if (a < b && line.charCodeAt(a) === 0x3a) a++;
    const dashes = a;
    while (a < b && line.charCodeAt(a) === 0x2d) a++;
    if (a === dashes) return null;
    if (a < b && line.charCodeAt(a) === 0x3a) a++;
    if (a !== b) return null;
    cells++;
    if (end >= to) return cells;
    start = end + 1;
  }
}

/** The characters of inline syntax a table's weight counts (`tableReadCost`): each opens or closes a construct the parser keeps events for. */
const TABLE_SYNTAX = "\\[]*_~`<&!$";

/** What a row weighs against a character: each row is a node of its own, with its own events. */
export const TABLE_ROW_WEIGHT = 832;

/** What a cell weighs against a character, filled or empty: each cell's content is a parse of its own, with its own events. */
export const TABLE_CELL_WEIGHT = 204;

/** What a character of inline syntax weighs against a plain one. */
export const TABLE_SYNTAX_WEIGHT = 122;

/** What each autolink literal a row may hold weighs (`tableRowParts`): a link node of its own, without a character of syntax. */
export const TABLE_LITERAL_WEIGHT = 160;

/** What each start of a run of address characters weighs (`tableRowParts`): the parser tries an address there and holds the cell's text in pieces. */
export const TABLE_WORD_WEIGHT = 171;

/**
 * What each `[^` weighs: a footnote reference where a definition exists.
 * Low since 2026-11-15: the calibration lifts each shape by the part that
 * lifts it most for what it costs a word and a link, and the measured
 * reference shapes reach the budget / 0.9 mostly by their syntax and words.
 * A reference glued to the word before it (`[^1][^1]…`) counts as a word of
 * its own, and so does a link or image (`tableRowParts`): without that, 120
 * of them in a cell were one word and ran the parse out of memory at the
 * budget (review, 2026-11-16).
 */
export const TABLE_REFERENCE_WEIGHT = 63;

/**
 * What each `](` (and each `[[`, which the reading view shows as a Markdown
 * link) weighs: the destination of a link or image, a node with a child and
 * many events (151 rows of 80 such links fill 128 MB).
 */
export const TABLE_LINK_WEIGHT = 316;

/**
 * What the reading view's own plugins make of a row: a tag pill and a
 * highlight are covered by the word weight (`readerTableBudget.test.tsx`
 * holds them). A formula weighs nothing here: the table budget weighs what
 * the parsers make of a table's structure; what KaTeX lays out of a formula
 * is the desktop reading view's, unbounded as on `main`, and the memory of a
 * whole note there is L14's (coordination, 2026-11-18).
 */
export const TABLE_TAG_WEIGHT = 0;
export const TABLE_MARK_WEIGHT = 0;

/** What each block marker in front of a table line weighs: a quote's `>`, a list item's or a footnote's indent; each is events of its own on every line. */
export const TABLE_MARKER_WEIGHT = 72;

/**
 * What the markers in front of a table line weigh (`prefix`, the line up to
 * its row): one per character, and `TABLE_MARKER_WEIGHT` for each quote
 * marker and once for a list item's or a footnote's marker or indent.
 */
export function tableMarkerCost(prefix: string): number {
  return prefix.length + TABLE_MARKER_WEIGHT * tableMarkerCount(prefix);
}

/**
 * The blocks a table line's prefix opens or continues, one per level: each
 * `>`, each list marker, and for the indent of a list item's later lines one
 * per two blanks (a quote twelve deep is twelve, an item twelve deep, whose
 * rows are indented by 24, twelve as well). Each level is events of its own
 * on every line: a table twelve quotes deep ran the parse out of memory at
 * the budget while its markers weighed nothing.
 */
export function tableMarkerCount(prefix: string): number {
  let levels = 0;
  let blanks = 0;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === ">" || ch === "-" || ch === "+" || ch === "*" || ch === ")" || ch === ".") {
      // A quote marker or a list marker (`-`, `+`, `*`, or the `.`/`)` behind an item's number): the blank behind it belongs to it.
      if (ch === ">" || ch === "-" || ch === "+" || ch === "*" || /\d/.test(prefix[i - 1] ?? "")) levels++;
      if (prefix[i + 1] === " " || prefix[i + 1] === "\t") i++;
    } else if (ch === " " || ch === "\t") {
      blanks += ch === "\t" ? 4 : 1;
    }
  }
  return levels + Math.floor(blanks / 2);
}

/**
 * The parts of the table row `text[from, to)` its weight is made of, its
 * cells counted the way the table parser counts them: a `|` is a cell
 * boundary unless an odd number of backslashes stands right in front of it
 * (`\|` is a pipe in the cell, `\\|` a backslash and a boundary, `\\\|` again
 * a pipe), also inside a code span; every stretch between two boundaries is a
 * cell, empty or not; the stretch before the first and after the last
 * boundary is one only when it holds something (a row without outer pipes
 * has one cell more than boundaries), and a row is at least one cell (`|`
 * alone is one). `literals` counts what may start a link without any
 * syntax around it (GFM's autolink literals): each `@`, `www.`, `://`,
 * `mailto:` and `xmpp:`. `links` counts each `](`, a Markdown link's or
 * image's destination. A row with a wiki link weighs, part by part, the more
 * of the row as written and the row as the reading view writes it
 * (`shownRow`), so that the index never decides with the lighter reading;
 * `asRead: false` weighs it as written only. `words` counts the words of a row — runs of
 * characters other than blanks and cell boundaries, in any script: the text
 * of a cell is held in a piece for each until the cell is read (at an ASCII
 * one the parser also tries an e-mail address), and `| a a a … |`, a row of
 * numbers, or `中文 中文 …` costs the parser more than its characters say
 * (measured 2026-11-13: 999, 1 498 and 1 443 rows under 128 MB). `references` counts `[^`, a
 * footnote reference where a definition exists. `tags` and `marks` count
 * what the reading view's own plugins make nodes of: a `#` that may start a
 * tag, a `==`. Each `[` glued to the word
 * before it — a reference, a link, a reference link, an image not at the
 * word's start, not a wiki link's second — counts as a word as well, and an
 * `@date` the reading view writes anew as what it writes
 * (`RELATIVE_DATE_SHOWN_CHARS`). `text[from, to)` is the row behind its
 * container markers (`tableLineStart`).
 */
export function tableRowParts(text: string, from: number, to: number, asRead = true): TableRowParts {
  const written = rowParts(text, from, to);
  if (!asRead) return written;
  // A row heavier than the whole budget as written puts its table over the budget either way: the reading view's
  // writing of it, as long as the row or longer, is not built (review, 2026-11-16: a row of 1.5 MB of `[[x` ran the
  // scan out of memory there, where main took 36 ms).
  if (partsCost(written, 0) > TABLE_READ_BUDGET) return written;
  const links = wikiLinksOfRow(text, from, to);
  if (links === undefined) return written;
  // Nor is it built where it is longer than the budget at the least (review, 2026-11-16: a cell of five million
  // characters of CJK in a wiki link, light as written, is ten times as long with its target encoded): the row
  // weighs that length, and its table is over the budget.
  const atLeast = shownLengthAtLeast(links);
  if (TABLE_ROW_WEIGHT + atLeast > TABLE_READ_BUDGET) return { ...written, chars: Math.max(written.chars, atLeast) };
  const shown = shownRow(links);
  // The reading view reads the row as it writes it: each part weighs the more of the two.
  const read = rowParts(shown, 0, shown.length);
  return {
    chars: Math.max(written.chars, read.chars),
    boundaries: Math.max(written.boundaries, read.boundaries),
    cells: Math.max(written.cells, read.cells),
    syntax: Math.max(written.syntax, read.syntax),
    literals: Math.max(written.literals, read.literals),
    words: Math.max(written.words, read.words),
    references: Math.max(written.references, read.references),
    links: Math.max(written.links, read.links),
    tags: Math.max(written.tags, read.tags),
    marks: Math.max(written.marks, read.marks),
  };
}

/** The wiki links of a table row (`wikiLinksOfRow`): the row, and for each link its `[[`, its `]]` and whether it is an embed (`![[`), three numbers a link. */
interface RowWikiLinks {
  row: string;
  links: number[];
}

/**
 * The wiki links of the row `text[from, to)`, as the parser finds them in a
 * table: the row is split into cells at each bar no backslash stands in front
 * of, before anything else is read; in a cell, an escaped character and a code
 * span come first, and a link runs from a `[[` (a `![[`) to the first `]]` of
 * its cell (`wikiLinkSyntax.ts`). `undefined` for a row without one.
 */
function wikiLinksOfRow(text: string, from: number, to: number): RowWikiLinks | undefined {
  // Most rows hold no `[[`: looked for in place, with no copy of the row and no search past its end.
  let opens = false;
  for (let i = from + 1; i < to && !opens; i++) opens = text.charCodeAt(i) === 0x5b && text.charCodeAt(i - 1) === 0x5b;
  if (!opens) return undefined;
  // The row on its own, so that no search runs past its end (a table of many rows stays linear).
  const row = text.slice(from, to);
  const links: number[] = [];
  // The cell's end: the next bar without a backslash in front of it.
  let cellEnd = -1;
  const endOfCell = (at: number) => {
    let i = at;
    while (i < row.length && !(row.charCodeAt(i) === 0x7c && !escaped(row, i))) i++;
    return i;
  };
  // A run of backticks closes at the next run as long in the cell: where each run of a length stands, found once.
  // Each list is walked once per cell by its cursor, as the places asked for only move right (a row of many spans stays linear).
  let ticksCell = -1;
  let ticks = new Map<number, number[]>();
  let cursors = new Map<number, number>();
  const closingRun = (at: number, length: number) => {
    if (ticksCell !== cellEnd) {
      ticksCell = cellEnd;
      ticks = new Map();
      cursors = new Map();
      for (let i = at; i < cellEnd; i++) {
        if (row[i] !== "`" || row[i - 1] === "`") continue;
        let run = 1;
        while (row[i + run] === "`") run++;
        const list = ticks.get(run) ?? [];
        list.push(i);
        ticks.set(run, list);
      }
    }
    const list = ticks.get(length);
    if (!list) return -1;
    let next = cursors.get(length) ?? 0;
    while (next < list.length && list[next] <= at) next++;
    cursors.set(length, next);
    return next < list.length ? list[next] : -1;
  };
  // Where each `]]` of the row stands, found once; a cursor walks them to the right.
  const closes: number[] = [];
  for (let at = row.indexOf("]]"); at >= 0; at = row.indexOf("]]", at + 1)) closes.push(at);
  let nextClose = 0;
  let closeCell = -1;
  let close = -1;
  for (let i = 0; i < row.length; i++) {
    if (i > cellEnd) cellEnd = endOfCell(i);
    const c = row.charCodeAt(i);
    if (c === 0x5c) i++;
    else if (c === 0x60) {
      let run = 1;
      while (row.charCodeAt(i + run) === 0x60) run++;
      const end = closingRun(i, run);
      i = end < 0 ? i + run - 1 : end + run - 1;
    } else if (c === 0x5b && row.charCodeAt(i + 1) === 0x5b) {
      if (closeCell !== cellEnd || close < i + 2) {
        closeCell = cellEnd;
        while (nextClose < closes.length && closes[nextClose] < i + 2) nextClose++;
        close = nextClose < closes.length ? closes[nextClose] : -1;
        if (close + 2 > cellEnd) close = -1;
      }
      if (close < 0) {
        // No `]]` in the cell: no `[[` of it opens a link.
        i = cellEnd;
        continue;
      }
      if (close > i + 2) links.push(i, close, i > 0 && row[i - 1] === "!" && !escaped(row, i - 1) ? 1 : 0);
      i = close + 1;
    }
  }
  return links.length === 0 ? undefined : { row, links };
}

/**
 * The row as the reading view writes it: each wiki link the Markdown link
 * `readerWikiLink` makes of it, its label spelled out and its target encoded
 * (`[[中文]]` is `[中文](wiki://%E4%B8%AD%E6%96%87)`).
 */
function shownRow({ row, links }: RowWikiLinks): string {
  const pieces: string[] = [];
  let copied = 0;
  for (let k = 0; k < links.length; k += 3) {
    const [open, close, embed] = [links[k], links[k + 1], links[k + 2] === 1];
    pieces.push(row.slice(copied, embed ? open - 1 : open), readerWikiLinkLead(row, embed ? open - 1 : open, embed), readerWikiLink(row.slice(open + 2, close), embed, undefined, false).text);
    copied = close + 2;
  }
  pieces.push(row.slice(copied));
  return pieces.join("");
}

/**
 * The fewest characters `shownRow` can write, counted without writing them:
 * the row less its wiki links, and for each link at least its label and its
 * target percent-encoded behind `](wiki://` (an embed at least
 * `![img](wiki-image://` and its target).
 */
function shownLengthAtLeast({ row, links }: RowWikiLinks): number {
  let length = row.length;
  for (let k = 0; k < links.length; k += 3) {
    const [open, close, embed] = [links[k], links[k + 1], links[k + 2] === 1];
    const inner = open + 2;
    // The name ends in front of the first bar of the link, and in front of the backslash that keeps the bar in its cell (`wikiLinkParts`).
    let bar = row.indexOf("|", inner);
    if (bar >= close) bar = -1;
    const headEnd = bar < 0 ? close : row[bar - 1] === "\\" ? bar - 1 : bar;
    const label = bar < 0 ? close - inner : close - bar - 1;
    const target = encodedLength(row, inner, headEnd);
    length -= close + 2 - (embed ? open - 1 : open);
    length += embed ? "![img](wiki-image://)".length + target : "[](wiki://)".length + label + target;
    // The comment in front of a link behind a `]` is written too.
    length += readerWikiLinkLead(row, embed ? open - 1 : open, embed).length;
  }
  return length;
}

/** How long `encodeURIComponent` (and `readerWikiLink`'s encoding of `()!'*`) writes `text[from, to)`, counted without writing it. */
function encodedLength(text: string, from: number, to: number): number {
  let length = 0;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x2d || code === 0x2e || code === 0x5f || code === 0x7e) length += 1;
    else if (code < 0x80) length += 3;
    else if (code < 0x800) length += 6;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < to) {
      // A pair of surrogates is one character of four bytes.
      length += 12;
      i++;
    } else length += 9;
  }
  return length;
}

/** Whether a backslash stands in front of `text[at]` that is not itself escaped. */
function escaped(text: string, at: number): boolean {
  let backslashes = 0;
  while (at - backslashes - 1 >= 0 && text[at - backslashes - 1] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

/** What `rowParts` does at an ASCII character: 1 counts it as inline syntax (`TABLE_SYNTAX`), 2 looks closer at it. */
const ROW_CHAR = (() => {
  const table = new Uint8Array(128);
  for (const ch of TABLE_SYNTAX) table[ch.charCodeAt(0)] |= 1;
  for (const ch of "@:wWmMxX[]=#") table[ch.charCodeAt(0)] |= 2;
  return table;
})();

function rowParts(text: string, from: number, to: number): TableRowParts {
  let boundaries = 0;
  let cells = 0;
  let syntax = 0;
  let literals = 0;
  let words = 0;
  let references = 0;
  let links = 0;
  let tags = 0;
  let marks = 0;
  let inWord = false;
  let wordStart = -1;
  // What the reading view writes for an `@date` beyond the characters it stands in.
  let shownChars = 0;
  let backslashes = 0;
  // Whether the stretch since the last boundary (or the row's start) holds anything.
  let held = false;
  // Character codes and a table of what to do with each: the scan runs at every pause in typing (review, 2026-11-17).
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x7c && (backslashes & 1) === 0) {
      // A stretch between two boundaries is a cell; the one before the first only when it holds something.
      if (boundaries > 0 || held) cells++;
      boundaries++;
      held = false;
      inWord = false;
      backslashes = 0;
      continue;
    }
    if (c === 0x20 || c === 0x09) {
      inWord = false;
      backslashes = 0;
      continue;
    }
    held = true;
    const what = c < 128 ? ROW_CHAR[c] : 0;
    if (what !== 0) {
      if (what & 1) syntax++;
      if (what & 2) {
        switch (c) {
          case 0x40: // @
            literals++;
            if (isRelativeDate(text, i, to)) {
              shownChars += RELATIVE_DATE_SHOWN_CHARS;
              words += RELATIVE_DATE_SHOWN_WORDS;
            }
            break;
          case 0x3a: // :
            if (text.charCodeAt(i + 1) === 0x2f && text.charCodeAt(i + 2) === 0x2f) literals++;
            break;
          // The parser links `www.`, `mailto:` and `xmpp:` in any case: `WWW.a.b` is a link.
          case 0x77:
          case 0x57:
            if (lowerIs(text, i + 1, "ww.")) literals++;
            break;
          case 0x6d:
          case 0x4d:
            if (lowerIs(text, i + 1, "ailto:")) literals++;
            break;
          case 0x78:
          case 0x58:
            if (lowerIs(text, i + 1, "mpp:")) literals++;
            break;
          case 0x5b: // [
            // A reference or a link glued to the word before it starts a piece of the cell's text as a word does:
            // `[^1][^1]…`, `[l](u)[l](u)…` and `[r][r]…` are one word but as many pieces. Not the second `[` of a wiki
            // link, nor the `[` of an image that opens the word.
            if (inWord && text.charCodeAt(i - 1) !== 0x5b && !(wordStart === i - 1 && text.charCodeAt(i - 1) === 0x21)) words++;
            if (text.charCodeAt(i + 1) === 0x5e) references++;
            break;
          case 0x5d: // ]
            if (text.charCodeAt(i + 1) === 0x28) links++;
            break;
          case 0x3d: // =
            if (text.charCodeAt(i + 1) === 0x3d) marks++;
            break;
          case 0x23: { // #
            const before = i === from ? -1 : text.charCodeAt(i - 1);
            const after = text.charCodeAt(i + 1);
            if ((before === -1 || before === 0x20 || before === 0x09 || before === 0x7c) && i + 1 < to && after !== 0x20 && after !== 0x23) tags++;
            break;
          }
        }
      }
    }
    // A word: a run of characters other than blanks and cell boundaries, in any script.
    if (!inWord) {
      words++;
      wordStart = i;
      inWord = true;
    }
    backslashes = c === 0x5c ? backslashes + 1 : 0;
  }
  if (held) cells++;
  // A row is at least one cell: `|` alone is one, empty.
  if (cells === 0 && boundaries > 0) cells = 1;
  return { chars: to - from + shownChars, boundaries, cells, syntax, literals, words, references, links, tags, marks };
}

/**
 * What the reading view writes for an `@2026-03-04` beyond the eleven
 * characters and one word it stands in (`formatRelativeDate` in
 * packages/ui): a word for a day up to two away or the date, in the app's
 * language — at most "depois de amanhã" (16 characters, three words) and
 * "2026. 03. 04." (three words).
 */
const RELATIVE_DATE_SHOWN_CHARS = 5;
const RELATIVE_DATE_SHOWN_WORDS = 2;

/** Whether `text[at]` is the `@` of a date the reading view writes anew (`relativeDates` in noteSource.ts): not glued to a word or an escape. */
function isRelativeDate(text: string, at: number, to: number): boolean {
  if (at + 11 > to || /[\w\\]/.test(text[at - 1] ?? "")) return false;
  return /^\d{4}-\d{2}-\d{2}(?!\w)/.test(text.slice(at + 1, at + 12));
}

/** The parts of a table row's weight (`tableRowParts`). */
export interface TableRowParts {
  chars: number;
  boundaries: number;
  cells: number;
  syntax: number;
  literals: number;
  words: number;
  references: number;
  links: number;
  tags: number;
  marks: number;
}

/** Whether `text` holds `lower` at `at`, its letters in either case. */
function lowerIs(text: string, at: number, lower: string): boolean {
  for (let k = 0; k < lower.length; k++) {
    const code = text.charCodeAt(at + k);
    const want = lower.charCodeAt(k);
    if (code !== want && !(want >= 0x61 && want <= 0x7a && code === want - 0x20)) return false;
  }
  return true;
}


/**
 * The parts of the table rows the latest two scans weighed, by the row and
 * the character in front of it and the six behind it (all `tableRowParts`
 * reads): the scan runs at every pause in typing, and the rows of a table
 * mostly stay as they were (review, 2026-11-17: a table of 1 MB with a wiki
 * link in each row took 115 ms a scan, `main` 5 ms). Two scans, so that what
 * is kept is the rows of at most two texts.
 */
let rowsWeighed = new Map<string, TableRowParts>();
let rowsWeighedBefore = new Map<string, TableRowParts>();

/** `tableRowParts(text, from, to)`, from the latest two scans where the row was weighed there. */
function rememberedRowParts(text: string, from: number, to: number): TableRowParts {
  // The row and what `tableRowParts` reads around it: the character in front, and up to `mailto:` behind its end.
  const key = text.slice(Math.max(0, from - 1), to + 7);
  let parts = rowsWeighed.get(key);
  if (parts === undefined) {
    parts = rowsWeighedBefore.get(key) ?? tableRowParts(text, from, to);
    rowsWeighed.set(key, parts);
  }
  return parts;
}

/**
 * What reading the table row `text[from, to)` weighs: `TABLE_ROW_WEIGHT`,
 * one per character, `TABLE_CELL_WEIGHT` per cell, `TABLE_SYNTAX_WEIGHT` per
 * character of inline syntax; the markers in front of it weigh on their own
 * (`tableMarkerCost`). The weights are an upper bound, not a fit (`scripts/perf/table-budget.ts`,
 * measured 2026-11-13 over 119 shapes and three parses): they are chosen so that the largest table the parse reads
 * under a capped heap weighs at least `TABLE_READ_BUDGET / 0.9` for every
 * measured shape — the costliest shape of each part decides its weight.
 */
export function tableReadCost(text: string, from: number, to: number, columns = 0): number {
  return partsCost(tableRowParts(text, from, to), columns);
}

/** What a row of `parts` weighs (`tableReadCost`). */
function partsCost(parts: TableRowParts, columns: number): number {
  // The reading view fills every row up to the header's columns (`mdast-util-to-hast`): a row weighs at least that many cells.
  return (
    TABLE_ROW_WEIGHT +
    parts.chars +
    TABLE_CELL_WEIGHT * Math.max(parts.cells, columns) +
    TABLE_SYNTAX_WEIGHT * parts.syntax +
    TABLE_LITERAL_WEIGHT * parts.literals +
    TABLE_WORD_WEIGHT * parts.words +
    TABLE_REFERENCE_WEIGHT * parts.references +
    TABLE_LINK_WEIGHT * parts.links +
    TABLE_TAG_WEIGHT * parts.tags +
    TABLE_MARK_WEIGHT * parts.marks
  );
}

/**
 * The most `tableReadCost` a table may have and still be read as a table;
 * over it the whole table is read as written. The criterion
 * (`pnpm --filter @plainva/core perf:tables -- --calibrate`, then `--check`):
 * a table of every measured and every generated shape at the budget, alone in
 * an otherwise empty note, is read by the index parse and by the note-source
 * parse each under `node --max-old-space-size=128`, and every measured
 * shape's largest such table weighs at least the budget / 0.9. It holds one
 * table, not a note, and the reading view as the core can run it (the note
 * prepared, GFM, remark-math with KaTeX) — not React and the DOM, not a note
 * embedded in a cell, code blocks or Mermaid in cells
 * (Performance_Notes.md, "What the criterion covers"): the memory of a parse adds up over the tables of a note,
 * and two tables at the budget in one note do not fit that heap
 * (Performance_Notes.md, "One note, many tables"); nothing bounds a whole
 * note. That is the parse alone; the heap a WebView gives the app is not
 * known here, so raising the budget needs a measurement in the phone's
 * WebView first. In rows (2026-11-15): about
 * 2 530 rows of a word and a link, 2 090 rows of four short cells and a link,
 * 1 370 rows of four cells of words, 1 010 rows of sixteen one-character
 * cells, 5 760 rows of one short cell, 2 630 rows of a word and a link in a
 * quote or a list item, 2 590 rows of one short cell twenty quotes deep, 200
 * rows of a hundred e-mail addresses, 258 rows of 150 one-letter words, 377
 * rows of a hundred numbers, 141 rows of a hundred footnote references, 115
 * rows of 80 Markdown links, 63 rows of a hundred formulas, 71 rows of a
 * matrix of sixty cells. The shapes the fifth and sixth reviews found the
 * weight short of (2026-11-16: formulas between two `$` on each side or
 * behind an escaped `$` or a code span with one, references and links of
 * every kind without blanks) are weighed since and pass at 1.3 × the budget,
 * the formula shapes at 1.4 × (`--margin`), as their neighbours do.
 * The budget is the calibration's 8 160 000 set
 * lower so that the lightest measured shape sits about 30 % above it (decided
 * 2026-11-13, kept by the maintainer 2026-11-15): 128 MB is an assumption
 * measured on Node's heap and the WebView carries the DOM and React besides;
 * four reviews found shapes the weight lacked. L14 calibrates the whole note
 * with a measurement in the phone's WebView, where it may rise.
 * Before GFM tables 2.1.2 the rule was rows times length (5 × 10⁸), about
 * 2 500 short rows, for the time a quadratic parse took.
 */
export const TABLE_READ_BUDGET = 6_970_000;

/** An HTML block of tags (CommonMark's sixth and seventh kind): it ends at a blank line. */
const HTML_ENDS_AT_BLANK = /$^/;
/** An HTML block that ended on the line just read. */
const HTML_ENDED = /^$/;

/**
 * The HTML block `text` (a line behind its block markers) opens, by what ends
 * it: the line that holds the closing marker of a script, a comment, a
 * processing instruction, a declaration or CDATA — which may be the opening
 * line itself, then `HTML_ENDED` — or a blank line for a block of tags.
 * `null` for a line that opens none.
 */
function htmlBlockOpening(text: string): RegExp | null {
  const kinds: Array<[RegExp, RegExp, number]> = [
    [/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, /<\/(?:script|pre|style|textarea)>/i, 1],
    [/^<!--/, /-->/, 4],
    [/^<\?/, /\?>/, 2],
    [/^<!\[CDATA\[/, /\]\]>/, 9],
    [/^<![A-Za-z]/, />/, 2],
  ];
  for (const [opens, ends, from] of kinds) {
    if (opens.test(text)) return ends.test(text.slice(from)) ? HTML_ENDED : ends;
  }
  return opensHtmlBlock(text) ? HTML_ENDS_AT_BLANK : null;
}

/**
 * Which parser a text is weighed for: the parsers that read a note differ in
 * what they read, and a stretch weighed for one may cost another more. The
 * index and the note source read tables and the properties block
 * (`NOTE_READING`), the reading view tables without the block
 * (`READER_READING`: behind an unclosed `---` it opens quotes and lists, the
 * others do not), an import of another program's CommonMark neither
 * (`COMMONMARK_READING`: its tables are paragraphs).
 */
export interface MarkdownReading {
  /** GFM tables. */
  tables: boolean;
  /** The note's budget over all its blocks (`NOTE_BUDGET`); off only for a reading of one block or one line. */
  notes?: boolean;
  /** The properties block (`remark-frontmatter`), with its mode behind an unclosed `---` (`opensNoContainers`). */
  properties: boolean;
}
export const NOTE_READING: MarkdownReading = { tables: true, properties: true };
export const READER_READING: MarkdownReading = { tables: true, properties: false };
export const COMMONMARK_READING: MarkdownReading = { tables: false, properties: false };

/** Whether `line` may be a table's delimiter row: it holds a `-` and a `|` or a `:` (`delimiterRowCells` asks the rest). */
const mayDelimit = (line: string): boolean => line.includes("-") && (line.includes("|") || line.includes(":"));

/** Whether the last character of `line` before its blanks is one a thematic break or a heading's underline ends in. */
function endsInRuleCharacter(line: string): boolean {
  let at = line.length - 1;
  while (at >= 0 && (line[at] === " " || line[at] === "\t")) at--;
  const ch = line[at];
  return ch === "-" || ch === "*" || ch === "_" || ch === "=";
}

/** Ranges of two readings as one: in order, overlapping ones joined, a table's flag kept. */
export function unitedRanges(...lists: BoundedRange[][]): BoundedRange[] {
  const all = lists.flat().sort((x, y) => x.from - y.from);
  const merged: BoundedRange[] = [];
  for (const range of all) {
    const previous = merged[merged.length - 1];
    if (previous && range.from < previous.to) {
      previous.to = Math.max(previous.to, range.to);
      if (range.table) previous.table = true;
      if (range.block) previous.block = true;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** What `overBudgetInlineRanges` can report about its scan, by line (counted from 0): the tests hold it against the parser. */
export interface InlineScanObserver {
  /** Every table the scan weighs: its header and its last line, whether it read it exactly, and what it weighs. */
  table?: (first: number, last: number, exact: boolean, cost: number) => void;
  /** Every run of lines the scan measures as one paragraph. */
  run?: (first: number, last: number) => void;
  /** What the whole note weighs to the note's budget, before any block is read as text (the calibration reads it). */
  note?: (total: number) => void;
  /** The blocks the note's budget reads as text, with the lines the scan read them from (`readAsTextParts`). */
  blocks?: (scan: NoteScan) => void;
}

/** What the scan of a note over its budget leaves for the reading of its blocks read as text (`readAsTextParts`). */
export interface NoteScan {
  /** The blocks read as text, in text order, blocks with only blank lines between them joined. */
  blocks: BoundedRange[];
  lines: ScanLine[];
  /** What each line is to the note's budget (`LINE_CODE`, `LINE_BREAK`, `LINE_HEADING`, 0 for text). */
  kinds: Uint8Array;
  /** What each line weighs to the note's budget; a table's weight stands on its header. */
  weights: Float64Array;
  /** Whether the note has blocks within blocks (`opensNoContainers`). */
  containers: boolean;
  /** The paragraphs over the inline budget, read as written by their own budget. */
  inline: BoundedRange[];
  /** The references each line holds (`noteLineCost`; a table's stand on its header). */
  references: Float64Array;
  /** The labels each line holds whose definitions a piece is given (`appendixFor`): at most its references. */
  pieceLabels: Float64Array;
  /** How many lines of the note begin with a definition. */
  definitions: number;
}

/** A line whose only block markers are `>`, each with at most one blank behind it, and no blank before its text. */
const PLAIN_START = /^(?:>[ \t]?)*/;

/** Where a line's text starts behind every blank and `>` in front of it: generous, for a table whose blocks the scan does not follow. */
const behindMarkers = (line: string): number => {
  let at = 0;
  while (line[at] === " " || line[at] === "\t" || line[at] === ">") at++;
  return at;
};

/**
 * Where a table row starts in `line` (`overBudgetInlineRanges`): exact, behind
 * the quotes of the header (`prefix`) with the indent as the parser counts
 * it; generous, behind every blank and `>`.
 */
function rowStart(line: string, exact: boolean, prefix: readonly number[], containers: boolean): { at: number; indent: number } | null {
  return exact ? exactRow(line, prefix) : { at: containers ? behindMarkers(line) : textStart(line), indent: 0 };
}

/**
 * `previous`: the stretches an earlier decision on this text read as text,
 * its places moved with the edits since — the editor's, while it is typed in
 * (`NOTE_HYSTERESIS`). Every reader of facts decides from the text alone.
 *
 * The stretches of `text` a parser would spend more than the budget on:
 * paragraphs (runs of lines without a blank line, fenced code and table rows
 * left out), single table rows, and whole tables. In text order, never
 * overlapping; empty for every note a person writes. `observe` hears every
 * table and run the scan weighs, also in a text too short to reach a budget.
 *
 * A table and a paragraph are measured each by its own rule, and neither may
 * hide lines from the other: a table read where the parser reads a
 * paragraph would split the paragraph's measure, one missed would escape
 * the table's weight. Where the scan is sure of the blocks — a table at the
 * start of a line or behind quote markers only, outside a list and a
 * footnote, starting a paragraph or interrupting one in the same quote —
 * it follows the table parser exactly (`endsTable`) and the table's lines
 * leave the paragraph measure. Everywhere else (a list item, a footnote, a
 * line that may continue a paragraph lazily) it weighs a table generously,
 * over every line that could be one of its rows, and measures the same
 * lines as paragraph text as well.
 */
export function overBudgetInlineRanges(text: string, observe?: InlineScanObserver, reading: MarkdownReading = NOTE_READING, previous?: readonly BoundedRange[]): BoundedRange[] {
  // Nothing in a text this short can reach the paragraph budget — but a short
  // table can reach its own: the reading view fills each row to the header's
  // columns, and 4 KB of header and rows of `|` make a million cells. A table
  // needs a delimiter row, and every delimiter row holds a `-` next to a `|` or a `:`, blanks between allowed.
  if (!observe && text.length * text.length <= INLINE_PARSE_BUDGET && !/[|:][ \t]*-|-[ \t]*[|:]/.test(text)) return [];
  const ranges: BoundedRange[] = [];
  // The rows weighed in the scan before this one stay at hand; the rest go.
  rowsWeighedBefore = rowsWeighed;
  rowsWeighed = new Map();
  const lines = splitLines(text);
  const containers = !(reading.properties && opensNoContainers(text));
  let run: { from: number; to: number; first: number; last: number } | null = null;
  const flush = () => {
    if (run) {
      observe?.run?.(run.first, run.last);
      if (exceedsInlineParseBudget(text, run.from, run.to)) ranges.push({ from: run.from, to: run.to });
    }
    run = null;
  };
  /**
   * The table whose header row is `lines[index]`, if one starts there: its
   * last line, and what it weighs. A table may stand in a quote, a list item
   * or a footnote, and may follow a paragraph line directly (it interrupts
   * the paragraph). `exact`: its rows are the lines behind it inside the same
   * blocks that begin no other block (`endsTable`), with or without a pipe.
   * Otherwise its rows are every line behind it that begins no other block
   * behind all its blanks and `>`. Over the budget its lines are read as
   * written behind their markers, which stay as they are: the quote or list
   * around the table stays a quote or a list.
   */
  const tableAt = (index: number, exact: boolean): number => {
    if (index + 1 >= lines.length) return -1;
    const header = lines[index];
    const head = tableLineStart(header.text, true, containers);
    const rest = header.text.slice(head.at);
    const delimiter = lines[index + 1];
    // Exact: behind the quotes of the header, the indent as the parser counts it; generous: behind every blank and `>` (`rowStart`).
    const under = rowStart(delimiter.text, exact, head.prefix, containers);
    if (!under) return -1;
    const delimiterCells = under.indent > 3 ? null : delimiterRowCells(delimiter.text.slice(under.at));
    if (exact) {
      // A heading, a fence, an HTML block or a thematic break is no table's header, and neither is a line under one that opens a list item or the like (`- |-`).
      // A line that may underline a heading, or an empty list item that may be text, is left to the generous reading.
      if (endsTable(rest, indentOf(rest), containers) || /^(?:=+|-+)[ \t]*$/.test(rest) || endsTable(delimiter.text.slice(under.at), under.indent, containers) || tableCells(rest) !== delimiterCells) return -1;
    } else {
      // Any line may be one, read behind its block markers or with them: the parser reads `-` behind indented code as a header.
      if (isBlank(header.text) || delimiterCells === null) return -1;
      if (tableCells(rest) !== delimiterCells && tableCells(header.text.slice(behindMarkers(header.text))) !== delimiterCells) return -1;
    }
    const content: BoundedRange[] = [
      { from: header.from + head.at, to: header.to },
      { from: delimiter.from + under.at, to: delimiter.to },
    ];
    const headerParts = rememberedRowParts(text, content[0].from, content[0].to);
    let cost = partsCost(headerParts, 0) + tableMarkerCost(header.text.slice(0, head.at));
    // What the table weighs to the note's budget: what stays of each row once the table is resolved (`noteTableRowCost`).
    let noteCost = noteTableRowCost(headerParts, 0, header.text.slice(0, head.at));
    const costly: BoundedRange[] = [];
    if (exceedsInlineParseBudget(text, content[0].from, content[0].to)) costly.push(content[0]);
    let last = index + 1;
    for (let at = index + 2; at < lines.length; at++) {
      const line = lines[at];
      const start = rowStart(line.text, exact, head.prefix, containers);
      if (!start) break;
      const row = line.text.slice(start.at);
      // A deeper quote, a list item, a heading, indented code and the like end the table; a line without a pipe does not.
      if (endsTable(row, start.indent, containers)) break;
      const range = { from: line.from + start.at, to: line.to };
      content.push(range);
      const parts = rememberedRowParts(text, range.from, range.to);
      cost += partsCost(parts, delimiterCells ?? 0) + tableMarkerCost(line.text.slice(0, start.at));
      noteCost += noteTableRowCost(parts, delimiterCells ?? 0, line.text.slice(0, start.at));
      if (exceedsInlineParseBudget(text, range.from, range.to)) costly.push(range);
      last = at;
    }
    observe?.table?.(index, last, exact, cost);
    // The note's budget weighs a table the scan reads exactly by its own weight; read as written, by what text costs.
    // At most a share of its own weight (`NOTE_TABLE_SHARE`): a note of one table the table budget reads as a table
    // is never read as text for the note's budget, whatever stands around it in a few lines.
    if (exact) tablesRead.set(index, { last, cost: cost > TABLE_READ_BUDGET ? -1 : Math.min(noteCost, cost * NOTE_TABLE_SHARE), peak: cost });
    if (cost > TABLE_READ_BUDGET) {
      // One range where only blanks, line ends and markers that are no markup lie between two lines.
      // Read as written, the table is a paragraph, and the lines behind it
      // that end a table but not a paragraph continue it — indented code, a
      // lone tag, a numbered item from 2, an empty item — or underline it as
      // a heading (`---`, `===`). They are read as written with it, so the
      // paragraph stays text and nothing becomes a heading.
      const depth = containers ? peelQuotes(header.text).depth : 0;
      for (let at = last + 1; at < lines.length; at++) {
        const line = lines[at];
        const peeled = containers ? peelQuotes(line.text) : { depth: 0, content: line.text };
        if (peeled.depth > depth || interruptsParagraph(peeled.content, containers)) break;
        content.push({ from: line.from + line.text.length - peeled.content.length, to: line.to });
      }
      for (const range of content) {
        const previous = ranges[ranges.length - 1];
        const between = previous && previous.to <= range.from ? text.slice(previous.to, range.from) : null;
        // Rows joined only across a line end: the markers between two rows of a table in a quote or list stay as they are.
        if (previous && between !== null && previous.from >= content[0].from && /^[ \t]*\r?\n$/.test(between)) previous.to = range.to;
        else ranges.push({ ...range, table: true });
      }
    } else {
      ranges.push(...costly);
    }
    return last;
  };
  let fence: Fence | null = null;
  // What the note's budget needs of the scan (`noteBudgetRanges`): the tables read exactly, by their header line;
  // the lines of fenced code; the blank lines that end a block; the lines of headings.
  const tablesRead = new Map<number, { last: number; cost: number; peak: number }>();
  const lineKinds = new Uint8Array(lines.length);
  // The list the current run stands in: where the content of its last item
  // begins, and where its ordered items stand. `null` outside a list.
  // Declared through a cast, so that the type checker does not narrow it to `null` for the reads in the loop.
  let list = null as { depth: number; content: number; orderedIndent: number | null } | null;
  /**
   * Whether `item` begins a new item where it stands, rather than continue
   * the paragraph before it. Outside a list, a bulleted item does, and an
   * ordered one starting at 1, with at most three blanks in front. Inside one,
   * so does an item no deeper than the last item's content plus three — an
   * ordered one only beside an ordered item before it, or starting at 1. A
   * line at another quote depth than the list is read as outside it.
   */
  const opensItem = (item: ItemStart, depth: number): boolean => {
    if (!list || list.depth !== depth) return item.indent <= 3 && (!item.ordered || item.first);
    if (item.indent > list.content + 3) return false;
    if (!item.ordered) return true;
    return item.first || item.indent === list.orderedIndent;
  };
  /**
   * The quote depth of a line that starts plainly — behind quote markers
   * only, each with at most one blank after it, its text not a list item or
   * a footnote — or -1. Such a line stands in no list item and no footnote.
   */
  const plainDepth = (line: string): number => {
    // Without blocks within blocks every line stands in the note itself; four blanks make it code or lazy text.
    if (!containers) return indentOf(line) > 3 ? -1 : 0;
    // Most lines start with a letter or another character no block marker starts with: plain, in no quote.
    const first = line.charCodeAt(0);
    if (first > 0x7f || (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a) || first === 0x7c || first === 0x23) return 0;
    const marks = PLAIN_START.exec(line)![0];
    const head = tableLineStart(line, true);
    if (head.at !== marks.length || head.prefix.some((need) => need >= 0)) return -1;
    const content = line.slice(marks.length);
    if (itemStart(content) || /^\[\^(?:\\[^]|[^\]\\ \t])+\]:/.test(content)) return -1;
    return head.depth;
  };
  /**
   * The quote depth of a line that opens a list item (or items, one in the
   * other, and quotes in them: `> - > - |h|`), without a tab or a footnote
   * among its markers, its first marker behind at most three blanks and none
   * behind more than four, so that nothing among them is indented code — or
   * -1. Such a line opens the item wherever it stands, unless it is an
   * ordered item other than 1 under a paragraph, which is text of the
   * paragraph. Its later lines are held to its markers by `exactRow`.
   */
  const itemDepth = (line: string): number => {
    if (!containers) return -1;
    const marks = PLAIN_START.exec(line)![0];
    const content = line.slice(marks.length);
    const head = tableLineStart(line, true);
    if (!head.prefix.some((need) => need >= 0)) return -1;
    const markers = line.slice(0, head.at);
    if (/\t/.test(markers) || /\[\^/.test(markers) || /^[ \t]*\[\^/.test(content) || indentOf(content) > 3) return -1;
    // More than four blanks behind a marker make the item's content indented code, and so do more than three in front of a quote's.
    if (/(?:^|[ >])(?:[-+*]|\d{1,9}[.)]) {5,}/.test(markers) || /> {5,}/.test(markers)) return -1;
    // Under a paragraph every item the line opens interrupts it, the inner ones as well: an ordered one opens only as `1` (not `01`, not `2`), or the line is text of the paragraph.
    if (run && /(?:^|[^\d])(?!1[.)])\d{1,9}[.)]/.test(markers)) return -1;
    return head.depth;
  };
  /**
   * What the lines so far say about the blocks of the next one: -2 after a
   * blank line (or at the start), the quote depth of the line before where
   * the scan is sure of its blocks, -1 where it is not. A line is sure of its
   * blocks where it starts plainly (`plainDepth`) and the line before was sure
   * at no more quote depth — after a deeper quote, a list item, indented code,
   * a fence or anything the scan does not follow, a line may continue those
   * blocks lazily, and no table starts on such a line.
   */
  let chain = -2;
  // The last line of the latest table weighed generously: its lines are measured as paragraph text as well.
  let tableUntil = -1;
  // The HTML block open at the current line, by what ends it; `null` where none is (`htmlBlockOpening`).
  let html: RegExp | null = null;
  // The properties block is YAML, read by its own reader: nothing in it opens a fence, an HTML block or a table.
  const propertiesEnd = reading.properties ? (frontmatterSpan(text)?.end ?? 0) : 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.to <= propertiesEnd) continue;
    if (fence) {
      lineKinds[index] = LINE_CODE;
      // A line less indented than an indented fence may have left the list item the fence stood in.
      if (fence.indent > 0 && !isBlank(line.text) && indentOf(line.text) < fence.indent) {
        fence = null;
      } else if (closesFence(line.text, fence)) {
        flush();
        fence = null;
        chain = -1;
        continue;
      }
    }
    if (isBlank(line.text)) {
      // A blank line ends a block of the note's budget, except in fenced code and in HTML that runs on to its end (a comment, a script).
      if (!fence && (!html || html === HTML_ENDS_AT_BLANK)) lineKinds[index] = LINE_BREAK;
      flush();
      list = null;
      // A blank line ends an HTML block of tags; one of a comment, a script and the like runs on to its end.
      if (html === HTML_ENDS_AT_BLANK) html = null;
      chain = fence || html ? -1 : -2;
      continue;
    }
    // Inside HTML a fence is HTML.
    if (!fence && !html) {
      const opening = fenceOpening(line.text);
      if (opening) {
        lineKinds[index] = LINE_CODE;
        flush();
        list = null;
        fence = opening;
        chain = -1;
        continue;
      }
    }
    // Inside fenced code and HTML the scan is not sure of the blocks: a table
    // there is weighed generously (one the parser reads as code costs it
    // nothing, and one read as written inside code is given back as it stood).
    // Lines in HTML are measured as paragraph text as well; fenced code is not.
    if (!fence && !html) html = line.text.includes("<") ? htmlBlockOpening(line.text.slice(tableLineStart(line.text, true, containers).at)) : null;
    else if (html && html !== HTML_ENDS_AT_BLANK && html.test(line.text)) html = HTML_ENDED;
    const plain = fence || html ? -1 : plainDepth(line.text);
    // A table needs a delimiter row under its header: every other line is asked nothing more (the scan's cost for an ordinary note).
    const candidate = reading.tables && index > tableUntil && index + 1 < lines.length && mayDelimit(lines[index + 1].text);
    const opensItemHere = !candidate || fence || html || plain >= 0 ? -1 : itemDepth(line.text);
    if (html === HTML_ENDED) html = null;
    const depthHere = plain >= 0 ? plain : opensItemHere;
    const sure = depthHere >= 0 && (chain === -2 || (chain >= 0 && chain <= depthHere));
    // Behind a list item the next line may continue it lazily.
    chain = plain >= 0 && (chain === -2 || (chain >= 0 && chain <= plain)) ? plain : -1;
    if (candidate) {
      // Sure of the blocks: a table starts here, or interrupts the paragraph before it in the same quote, as the table parser reads it.
      if (sure) {
        const last = tableAt(index, true);
        if (last >= 0) {
          flush();
          list = null;
          index = last;
          continue;
        }
      }
      // Where the scan is not sure, or the exact reading finds no table: the parser has quirks of its own (`-` behind indented code is a header).
      tableUntil = Math.max(tableUntil, tableAt(index, false));
    }
    if (fence) continue;
    // Inside a run, a heading and a list item begin inline content of their
    // own: the paragraph before them ends there. Read behind the quote markers.
    const { depth, content } = containers ? peelQuotes(line.text) : { depth: 0, content: line.text };
    if (isBlank(content)) {
      // A quote line with nothing behind its markers ends the paragraph in the quote.
      flush();
      list = null;
      continue;
    }
    if (isAtxHeading(content)) {
      // Inside HTML that runs on, a line that looks like a heading is HTML: no block of the note's budget starts there.
      if (!html) lineKinds[index] = LINE_HEADING;
      flush();
      list = null;
      run = { from: line.from, to: line.to, first: index, last: index };
      flush();
      continue;
    }
    // A thematic break, or a heading's underline below a paragraph, ends the paragraph; the underline belongs to its heading.
    if (endsInRuleCharacter(content) && /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|-+[ \t]*|=+[ \t]*)$/.test(content) && (run || !/^ {0,3}(?:-[ \t]*|=+[ \t]*)$/.test(content))) {
      if (run) {
        run.to = line.to;
        run.last = index;
      }
      flush();
      list = null;
      continue;
    }
    const item = containers ? itemStart(content) : null;
    if (item && opensItem(item, depth)) {
      flush();
      list = { depth, content: item.content, orderedIndent: item.ordered ? item.indent : list?.depth === depth ? list.orderedIndent : null };
    }
    if (run) {
      run.to = line.to;
      run.last = index;
    } else {
      run = { from: line.from, to: line.to, first: index, last: index };
    }
  }
  flush();
  // A table weighed generously overlaps the runs measured over the same lines: one range where they meet.
  ranges.sort((x, y) => x.from - y.from);
  // Then the note's budget, over the blocks the stretches above leave: the heaviest are read as text until the note is in it.
  if (reading.notes !== false && text.length > NOTE_SCAN_FROM) {
    const weights = new Float64Array(lines.length);
    const references = new Float64Array(lines.length);
    const pieceLabels = new Float64Array(lines.length);
    const counted = { definitions: 0 };
    const blocks = noteBudgetRanges(text, lines, lineKinds, tablesRead, ranges, reading, weights, references, pieceLabels, counted, observe, previous);
    observe?.blocks?.({ blocks, lines, kinds: lineKinds, weights, containers, inline: ranges.filter((range) => !range.table), references, pieceLabels, definitions: counted.definitions });
    if (blocks.length > 0) {
      ranges.push(...blocks);
      ranges.sort((x, y) => x.from - y.from);
    }
  }
  const merged: BoundedRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from < previous.to) {
      previous.to = Math.max(previous.to, range.to);
      if (range.table) previous.table = true;
      if (range.block) previous.block = true;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** What a line is to the note's budget (`noteBudgetRanges`), where it is not text (0): a line of fenced code, a blank line that ends a block, a heading. */
const LINE_CODE = 1;
const LINE_BREAK = 2;
const LINE_HEADING = 3;

/**
 * The most a whole note may weigh and still be read as it is written, in the
 * unit of the table budget (L14, Gesamtplan Leistung § 3a): a parse holds the
 * events of the whole note until its tree is built, so the peak adds up over
 * its blocks — two tables at the table budget did not fit 128 MB together,
 * nor did a list of 9 500 linked items or a paragraph of 1.5 MB of words
 * (`scripts/perf/note-budget.ts`). A tenth over the table budget, so that a
 * table at its own budget fits with the text around it: the parse of N
 * tables adds up, at about 1.0 to 1.75 times their weights' share of the
 * budget (Gesamtplan Leistung § 3a.1), and each weight keeps 30 % to its
 * shape's limit.
 */
export const NOTE_BUDGET = 25_710_000;

/**
 * The desktop's note budget: four times `NOTE_BUDGET`, calibrated on a heap of
 * 512 MB with its reading view among its readers (2026-11-25,
 * `noteBudgetShells.json`): of seven forms measured exactly, code spans and
 * lines of inline HTML bind it (at four times the budget `main` reads 1.56 and
 * 1.60 times their threshold under 512 MB), and every other form keeps 1.13
 * or more. 512 MB is a named assumption for a computer of 8 GB with several
 * windows, no limit of the platform.
 */
export const DESKTOP_NOTE_BUDGET = 4 * NOTE_BUDGET;

/**
 * The note's budget this app reads with: `NOTE_BUDGET`, calibrated on 128 MB,
 * unless the shell sets another at its start (`setNoteBudget`). One value for
 * every reader of a shell — the index, the note-source parse, the editor and
 * the reading view —, so that they decide alike: the phone sets `NOTE_BUDGET`,
 * the desktop `DESKTOP_NOTE_BUDGET`, each calibrated with `perf:notes` under
 * its heap; the weights are the same.
 */
let noteBudget = NOTE_BUDGET;

/** The shell's note budget, set once at its start (Gesamtplan Leistung § 3a, L14). */
export function setNoteBudget(budget: number): void {
  noteBudget = budget;
}

/** The note budget this shell reads with (`setNoteBudget`). */
export function currentNoteBudget(): number {
  return noteBudget;
}

/**
 * How far under the note's budget the blocks an earlier decision read as text
 * stay text (`overBudgetInlineRanges` with `previous`, the editor while it is
 * typed in): a tenth.
 */
export const NOTE_HYSTERESIS = 0.1;

/** A note no longer than this cannot reach the note's budget: no character weighs more than about 2 500. */
const NOTE_SCAN_FROM = 5_000;

/**
 * The weights of a line of text to the note's budget (`noteLineCost`): a
 * line on its own, a list item it opens, a block (the lines between two blank
 * lines), a heading, a start of a word, a character of inline syntax, a link
 * or wiki link. Calibrated 2026-11-19 against `main` under 128 MB, held per
 * shell on 2026-11-25 (`scripts/perf/note-budget.ts`, `noteBudgetShells.json`,
 * Performance_Notes.md): on the phone every one of 42 forms keeps `main`'s
 * limit at 1.14 times its threshold or more, the latest at 2.82. Weights a
 * linear program fits to the forms alone bring the latest to 2.27, but read
 * what stays formatted of a mixed note over its budget too light: footnote
 * definitions beside the paragraphs that refer to them ran the parse out of
 * 128 MB at 1.4 times the threshold. Those weights wait for forms of each part.
 */
export const NOTE_LINE_WEIGHT = 1049;
export const NOTE_ITEM_WEIGHT = 3402;
/** What each level of quote or list a line stands in weighs (`tableMarkerCount`): three quotes deep, 21 000 lines filled 128 MB. */
export const NOTE_MARKER_WEIGHT = 592;
export const NOTE_BLOCK_WEIGHT = 1360;
export const NOTE_HEADING_WEIGHT = 275;
export const NOTE_WORD_WEIGHT = 188;
/**
 * What a run of one character of inline syntax weighs (`**`, `]]`, a single `*`): micromark reads a run of
 * `*`, `_` or `~` as one sequence, and a closing `]` with nothing open is text; 14 500 paragraphs of eighty `]` passed.
 */
export const NOTE_SYNTAX_WEIGHT = 35;
/** What each `[` weighs beyond its run: every one opens a label the parser keeps until it closes or the paragraph ends. */
export const NOTE_OPEN_WEIGHT = 14;
/**
 * What a run of `*`, `_` or `~` weighs beyond `NOTE_SYNTAX_WEIGHT`: an attention sequence the parser matches
 * against every other one of the paragraph (1 687 paragraphs of `*a*a…` filled 128 MB, 14 500 of `]]]…` did not).
 */
export const NOTE_EMPHASIS_WEIGHT = 569;
/** What a run of backticks weighs beyond `NOTE_SYNTAX_WEIGHT`: a code span the parser looks for a closing run to. */
export const NOTE_CODE_SPAN_WEIGHT = 322;
/** What a `<` weighs beyond `NOTE_SYNTAX_WEIGHT`: the start of inline HTML or an autolink. */
export const NOTE_ANGLE_WEIGHT = 36;
/** What a `&` weighs beyond `NOTE_SYNTAX_WEIGHT`: the start of a character reference. */
export const NOTE_ENTITY_WEIGHT = 353;
/** What a `\` weighs beyond `NOTE_SYNTAX_WEIGHT`: an escape is a construct of its own. */
export const NOTE_ESCAPE_WEIGHT = 0;
export const NOTE_LINK_WEIGHT = 214;
/** What each line of fenced code weighs beyond its characters (80 000 short lines of code fill 128 MB). */
export const NOTE_CODE_LINE_WEIGHT = 377;
/** What a thematic break weighs beyond its line and its characters (`isThematicBreak`). */
export const NOTE_RULE_WEIGHT = 0;
/**
 * What a line read as written weighs beyond its characters, where its line
 * end stays (a paragraph or a table over its own budget): a line of
 * stand-ins is events of its own. A block read as text for the note's budget
 * becomes one line and weighs its characters.
 */
export const NOTE_TEXT_LINE_WEIGHT = 410;
/**
 * What a table weighs to the note's budget. The table weight is what reading one table holds at its peak; most of
 * that is let go once the table is resolved — two tables at the table budget run 128 MB out, 101 tables of 50 rows
 * do not, and 26 of 50 rows of sixteen cells do. So each row weighs what stays of it, by its own weights, a row and
 * each cell of it (filled up to the header's columns) and its content as a line of text weighs; and the heaviest
 * table's peak, in percent of its table weight, comes on top once.
 */
export const NOTE_TABLE_ROW_WEIGHT = 1085;
export const NOTE_TABLE_CELL_WEIGHT = 1547;
export const NOTE_TABLE_PEAK_WEIGHT = 6;
/**
 * The most a table read as a table weighs to the note's budget, per unit of
 * its own weight: nine tenths of the note's budget at the table budget. The
 * table budget is calibrated for one table alone under the same heap, and
 * `main` reads such a table as a table; the note's budget must not read it as
 * text where little else stands beside it (the hunt of the table budget, seed
 * 956860: 18 of 200 tables at the budget became text before this held).
 */
export const NOTE_TABLE_SHARE = (0.9 * NOTE_BUDGET) / TABLE_READ_BUDGET;
/**
 * What each autolink literal and each reference weighs to the note's budget: a
 * footnote's (`[^label]`) and one to a link's definition (`[text][label]`,
 * `[label][]`, `[label]`, by its brackets: more than the parser resolves, never
 * fewer). A resolved reference holds what a link holds, and on the phone
 * `main` reads 9 787 definitions alone under 128 MB, 5 742 beside a reference
 * each (`defs`, `refsdefs`).
 */
export const NOTE_LITERAL_WEIGHT = 324;
export const NOTE_REFERENCE_WEIGHT = 888;
/**
 * What a line that begins with a definition weighs beyond its characters — a
 * link reference definition `[label]: …` or a footnote's `[^label]: …`, behind
 * the markers its line begins with. micromark keeps about forty events of a
 * definition until the end of the parse (10 000 of them, 0.18 MB of note, held
 * 99 MB), where a line of prose of the same length holds a handful: 20 000 of
 * them ran the index out of 128 MB, and the budget weighed them as prose
 * (review of L14, 2026-11-26). Calibrated with the forms `defs`, `footdefs`
 * and `refsdefs` (`scripts/perf/note-budget.ts`): on the phone `main` reads
 * 9 729 link definitions and 6 030 footnote definitions under 128 MB, which
 * the budget weighed as 16 830 and 9 191 lines of text; with this weight the
 * forms are read as text from 6 650 and 5 010 (2026-11-26).
 */
export const NOTE_DEFINITION_WEIGHT = 2330;

/**
 * The weights the note's budget weighs by, as one object: the constants
 * above. Only the calibration changes them, for the length of one scan
 * (`withNoteWeights`, `perf:notes -- --calibrate`); the app reads with these.
 */
const W = {
  line: NOTE_LINE_WEIGHT,
  item: NOTE_ITEM_WEIGHT,
  marker: NOTE_MARKER_WEIGHT,
  block: NOTE_BLOCK_WEIGHT,
  heading: NOTE_HEADING_WEIGHT,
  word: NOTE_WORD_WEIGHT,
  syntax: NOTE_SYNTAX_WEIGHT,
  open: NOTE_OPEN_WEIGHT,
  emphasis: NOTE_EMPHASIS_WEIGHT,
  codeSpan: NOTE_CODE_SPAN_WEIGHT,
  angle: NOTE_ANGLE_WEIGHT,
  entity: NOTE_ENTITY_WEIGHT,
  escape: NOTE_ESCAPE_WEIGHT,
  link: NOTE_LINK_WEIGHT,
  codeLine: NOTE_CODE_LINE_WEIGHT,
  rule: NOTE_RULE_WEIGHT,
  textLine: NOTE_TEXT_LINE_WEIGHT,
  tableRow: NOTE_TABLE_ROW_WEIGHT,
  tableCell: NOTE_TABLE_CELL_WEIGHT,
  tablePeak: NOTE_TABLE_PEAK_WEIGHT,
  literal: NOTE_LITERAL_WEIGHT,
  reference: NOTE_REFERENCE_WEIGHT,
  definition: NOTE_DEFINITION_WEIGHT,
};
export type NoteWeights = typeof W;

/**
 * `run` with the note's weights `weights` in place of the calibrated ones, and
 * the calibrated ones back afterwards: the calibration's way to learn what a
 * note weighs by each of its parts (each weight 1 and the rest 0). Nothing in
 * the app calls it.
 */
/** The weights the note's budget weighs by now (a copy). */
export function noteWeights(): NoteWeights {
  return { ...W };
}

export function withNoteWeights<T>(weights: Partial<NoteWeights>, run: () => T): T {
  const kept = { ...W };
  Object.assign(W, weights);
  weightsVersion++;
  try {
    return run();
  } finally {
    Object.assign(W, kept);
    weightsVersion++;
  }
}

/** Counts every change of the weights, so that a remembered scan (`readAsTextParts`) is not read with other ones. */
let weightsVersion = 0;

/**
 * What a table row of `parts`, behind `prefix`, weighs to the note's budget
 * (`NOTE_TABLE_ROW_WEIGHT`). A `$` is a character of inline syntax and nothing
 * more, as in the table's own weight (twelfth review of L13, 2026-11-18): the
 * note's budget weighs what both shells parse, not KaTeX's layout of the
 * desktop's reading view, which lays out every formula as `main` does.
 */
function noteTableRowCost(parts: TableRowParts, columns: number, prefix: string): number {
  return (
    W.tableRow +
    parts.chars +
    W.tableCell * Math.max(parts.cells, columns) +
    W.syntax * parts.syntax +
    W.literal * parts.literals +
    W.word * parts.words +
    W.reference * parts.references +
    W.link * parts.links +
    prefix.length +
    W.marker * tableMarkerCount(prefix)
  );
}

/**
 * Whether `text[at, to)` begins with what may be a definition: `[label]:`,
 * the label without an unescaped bracket and at most 999 characters, as the
 * parser reads one; a footnote's `[^label]:` too. A line of a paragraph that
 * reads so is weighed as one as well — the measure may be heavier than the
 * parser's work, never lighter.
 */
function beginsWithDefinition(text: string, at: number, to: number): boolean {
  if (text.charCodeAt(at) !== 0x5b) return false;
  const end = Math.min(to, at + 1001);
  for (let i = at + 1; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5c) i++;
    else if (code === 0x5b) return false;
    else if (code === 0x5d) return i > at + 1 && text.charCodeAt(i + 1) === 0x3a;
  }
  return false;
}

/**
 * Whether the line `text[from, to)` may begin a definition behind its quote
 * and list markers — its label may run on over the line's end, as the
 * parser's may (`readAsTextDefinitions` reads a part that is not read only
 * where one may stand).
 */
export function mayBeginDefinition(text: string, from: number, to: number): boolean {
  const kept = keptPrefix(text, from, to);
  return beginsWithDefinition(text, from + kept, Math.min(text.length, from + kept + 1002));
}

/**
 * What an ASCII character is to `noteLineCost`, by its code: a blank, a
 * character of inline syntax (`TABLE_SYNTAX`), one that may begin a link
 * literal (`@`, `:`, `w`, `m`, `x`), or nothing more (0) — a lookup for the
 * note's budget, which reads every character of a long note.
 */
const CHAR_BLANK = 1;
const CHAR_SYNTAX = 2;
const CHAR_LITERAL = 3;
const LINE_CHAR = new Uint8Array(128);
LINE_CHAR[0x20] = CHAR_BLANK;
LINE_CHAR[0x09] = CHAR_BLANK;
for (const ch of TABLE_SYNTAX) LINE_CHAR[ch.charCodeAt(0)] = CHAR_SYNTAX;
for (const ch of "@:wWmMxX") LINE_CHAR[ch.charCodeAt(0)] = CHAR_LITERAL;

/** Whether `text[from, to)` is a thematic break: three or more of one of `-`, `*`, `_`, and blanks between them. */
function isThematicBreak(text: string, from: number, to: number): boolean {
  let mark = 0;
  let count = 0;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0d) continue;
    if (code !== 0x2d && code !== 0x2a && code !== 0x5f) return false;
    if (mark === 0) mark = code;
    else if (code !== mark) return false;
    count++;
  }
  return count >= 3;
}

/**
 * What a line of text, `text[from, to)`, weighs to the note's budget: its
 * markers, a list item it opens, and its content by the parts a table row's
 * content is weighed by (`tableRowParts`) without the row's and the cells'
 * own weight — characters, inline syntax, starts of words (and a link glued
 * to a word), link literals, links and wiki links, footnote references (a `$`
 * is inline syntax, nothing more). One pass over character codes: it reads every line of a long
 * note, where the scan otherwise asks most lines nothing.
 */
/**
 * Each line of `text[from, to)` that may be a heading's content, by its start
 * and end: one that opens with `#` behind its quote and list markers, and each
 * line of a paragraph a setext underline (`===`, `---`) stands behind. A
 * heading's text is a reference's text where its label is defined, so the
 * note's source is given the definitions of the labels on these lines
 * (`appendixFor`); more lines than the parser takes for headings, never fewer.
 */
export function forEachHeadingLine(text: string, from: number, to: number, visit: (lineFrom: number, lineTo: number) => void): void {
  let paragraph: number[] = [];
  for (let at = from; at < to; ) {
    let end = text.indexOf("\n", at);
    if (end < 0 || end > to) end = to;
    const lineEnd = end > at && text.charCodeAt(end - 1) === 0x0d ? end - 1 : end;
    const kept = keptPrefix(text, at, lineEnd);
    const content = text.slice(at + kept, lineEnd);
    if (/^\s*$/.test(content)) paragraph = [];
    else if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(content) && paragraph.length > 0) {
      for (let k = 0; k < paragraph.length; k += 2) visit(paragraph[k], paragraph[k + 1]);
      paragraph = [];
    } else if (/^#{1,6}(?:[ \t]|$)/.test(content)) {
      visit(at, lineEnd);
      paragraph = [];
    } else paragraph.push(at, lineEnd);
    at = end + 1;
  }
}

/** The most a given definition's line weighs: `[label]: #`, its label at most 999 characters. */
function givenLineMost(): number {
  return W.line + W.definition + 1003 + 2 * W.word + 3 * W.syntax + W.open;
}

/** The closing brackets of `text[from, to)` that may end a reference: no link's (`](`), no wiki link's, no definition's label (`]:`). */
function closingBrackets(text: string, from: number, to: number): number {
  let count = 0;
  // Within the range alone: `indexOf` would read to the note's end for each table without a bracket.
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) !== 0x5d) continue;
    const next = text.charCodeAt(i + 1);
    if (next !== 0x28 && next !== 0x5d && next !== 0x3a && text.charCodeAt(i - 1) !== 0x5d) count++;
  }
  return count;
}

/**
 * What the last `noteLineCost` read: whether its line begins with a definition, how many references it holds, and how
 * many labels in brackets it holds that run into a `(` (`runsIntoLink`).
 */
let lineDefinition = false;
let lineReferences = 0;
let lineRunsIntoLink = 0;

function noteLineCost(text: string, from: number, to: number): number {
  lineDefinition = false;
  lineReferences = 0;
  lineRunsIntoLink = 0;
  const kept = keptPrefix(text, from, to);
  let cost = W.line;
  if (kept > 0) {
    const prefix = text.slice(from, from + kept);
    cost += prefix.length + W.marker * tableMarkerCount(prefix);
    if (/(?:^|[ \t>])(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(prefix)) cost += W.item;
  }
  // A thematic break (`---`, `***`, `_ _ _`) is one node, whatever its characters: no line of text, no emphasis, no
  // syntax — its characters and its markers alone.
  if (isThematicBreak(text, from + kept, to)) return cost - W.line + (to - from - kept) + W.rule;
  lineDefinition = beginsWithDefinition(text, from + kept, to);
  if (lineDefinition) cost += W.definition;
  let syntax = 0;
  let opens = 0;
  let emphasis = 0;
  let codeSpans = 0;
  let angles = 0;
  let entities = 0;
  let escapes = 0;
  let previous = -1;
  let words = 0;
  let literals = 0;
  let links = 0;
  let references = 0;
  let inWord = false;
  let wordStart = -1;
  // Brackets: how many plain ones are open and where the last opened, whether a footnote reference's or the label of a
  // full reference (`][`) is open.
  let plainOpen = 0;
  let plainAt = -1;
  let footnoteOpen = false;
  let labelOpen = false;
  // Groups of brackets side by side so far, and the labels of those that ran into a `(`.
  let groups = 0;
  let runsIntoLink = 0;
  const content = from + kept;
  for (let i = from + kept; i < to; i++) {
    const code = text.charCodeAt(i);
    // Most characters are letters: one look into the table, and on.
    const kind = code < 128 ? LINE_CHAR[code] : 0;
    if (kind === CHAR_BLANK) {
      inWord = false;
      previous = code;
      continue;
    }
    if (!inWord) {
      words++;
      wordStart = i;
    }
    if (kind === CHAR_SYNTAX) {
      if (code !== previous) {
        syntax++;
        if (code === 0x2a || code === 0x5f || code === 0x7e) emphasis++;
        else if (code === 0x60) codeSpans++;
        else if (code === 0x3c) angles++;
        else if (code === 0x26) entities++;
      }
      if (code === 0x5c) escapes++;
      if (code === 0x5b) {
        opens++;
        const next = text.charCodeAt(i + 1);
        const before = text.charCodeAt(i - 1);
        if (next === 0x5b) {
          links++;
          // Behind a `]` the reading view writes a comment in front of the link, as the table's weight counts it.
          if (before === 0x5d) cost += readerWikiLinkLead(text, i, false).length;
        } else if (next === 0x5e) {
          references++;
          footnoteOpen = true;
        } else if (before === 0x5d && i - 1 > content) labelOpen = true;
        else if (before !== 0x5b) {
          plainOpen++;
          plainAt = i;
        }
        // A link glued to the word before it is a piece of its own.
        if (inWord && wordStart !== i && before !== 0x5b && !(wordStart === i - 1 && before === 0x21)) words++;
      } else if (code === 0x5d) {
        const next = text.charCodeAt(i + 1);
        if (next === 0x5b) groups++;
        else if (next === 0x28) {
          runsIntoLink += groups + 1;
          groups = 0;
        } else groups = 0;
        if (next === 0x28) {
          links++;
          if (labelOpen) labelOpen = false;
          else if (plainOpen > 0) plainOpen--;
        } else if (next === 0x5d || text.charCodeAt(i - 1) === 0x5d) {
          // A wiki link's end.
        } else if (footnoteOpen) footnoteOpen = false;
        else if (labelOpen) labelOpen = false;
        else if (plainOpen > 0) {
          plainOpen--;
          // A reference to a definition: `[text][label]`, `[label][]`, `[label]` — resolved, it holds what a link
          // holds, and its definition, read as text elsewhere, is given back to the tree (`givenDefinitions`). Not the
          // label of a definition, a task's box or a callout's type at the line's start.
          const opener = plainAt === content;
          const box = opener && i === content + 2 && /[ xX]/.test(text[content + 1]) && (next === 0x20 || next === 0x09 || i + 1 >= to);
          const callout = opener && text.charCodeAt(content + 1) === 0x21;
          if (next !== 0x3a && !box && !callout) references++;
        }
      }
    } else if (kind === CHAR_LITERAL) {
      if (code === 0x40) {
        literals++;
        if (isRelativeDate(text, i, to)) cost += RELATIVE_DATE_SHOWN_CHARS + W.word * RELATIVE_DATE_SHOWN_WORDS;
      } else if (code === 0x3a) {
        if (text.charCodeAt(i + 1) === 0x2f && text.charCodeAt(i + 2) === 0x2f) literals++;
      } else if ((code | 0x20) === 0x77) {
        if (lowerIs(text, i + 1, "ww.")) literals++;
      } else if ((code | 0x20) === 0x6d) {
        if (lowerIs(text, i + 1, "ailto:")) literals++;
      } else if (lowerIs(text, i + 1, "mpp:")) literals++;
    }
    inWord = true;
    previous = code;
  }
  // A footnote's definition is no reference to it.
  lineReferences = lineDefinition && text.charCodeAt(content + 1) === 0x5e ? references - 1 : references;
  lineRunsIntoLink = runsIntoLink;
  return (
    cost +
    (to - from - kept) +
    W.syntax * syntax +
    W.open * opens +
    W.emphasis * emphasis +
    W.codeSpan * codeSpans +
    W.angle * angles +
    W.entity * entities +
    W.escape * escapes +
    W.literal * literals +
    W.word * words +
    W.reference * references +
    W.link * links
  );
}

/**
 * The blocks of a note to read as text so that the whole note weighs no more
 * than `NOTE_BUDGET`, the heaviest first: a block is the lines between two
 * blank lines (fenced code and HTML that runs on to its end stay one block,
 * blank lines and all); headings are blocks of their own, read as text only
 * where the rest cannot bring the note into its budget, and the properties
 * block is never read as text. Each weighs its lines
 * (`noteLineCost`), its tables by the table weight, and what `ranges`
 * already reads as written, its stretches, by what text costs. The choice
 * depends on the text alone, so every device makes the same.
 */
function noteBudgetRanges(text: string, lines: ScanLine[], kinds: Uint8Array, tables: Map<number, { last: number; cost: number; peak: number }>, ranges: BoundedRange[], reading: MarkdownReading, weights: Float64Array, references: Float64Array, pieceLabels: Float64Array, counted: { definitions: number }, observe?: InlineScanObserver, previous?: readonly BoundedRange[]): BoundedRange[] {
  const properties = reading.properties ? frontmatterSpan(text) : null;
  const propertiesEnd = properties ? properties.end : 0;
  // `definitions`: what the block's lines that begin with a definition weigh; `references`: the references it holds.
  type NoteBlock = { from: number; to: number; weight: number; asText: number; headings: boolean; definitions: number; references: number };
  const blocks: NoteBlock[] = [];
  let block: NoteBlock | null = null;
  // What the line `add` is given holds of definitions and references (`noteLineCost`).
  let lineDefinitions = 0;
  let lineRefs = 0;
  let lineRuns = 0;
  // Which lines may be a heading's content: their references' definitions are given to a piece (`appendixFor`).
  const headingLine = new Uint8Array(lines.length);
  forEachHeadingLine(text, 0, text.length, (from) => {
    headingLine[lineAt(lines, from)] = 1;
  });
  // What the definitions of what the paragraph and table budgets read as written weigh: read as text from the start.
  let writtenDefinitions = 0;
  const weighLine = (from: number, to: number): number => {
    const cost = noteLineCost(text, from, to);
    lineDefinitions = lineDefinition ? cost : 0;
    if (lineDefinition) counted.definitions++;
    lineRefs = lineReferences;
    lineRuns = lineRunsIntoLink;
    return cost;
  };
  let total = 0;
  let written = 0;
  let heaviestTable = 0;
  // Whether a blank line ended the block before the current line, and the characters of the blank lines since;
  // whether the last line that was no blank line was indented by four blanks or more.
  let deepBefore = false;
  let broken = false;
  let blankChars = 0;
  const close = () => {
    if (block) blocks.push(block);
    block = null;
  };
  const add = (index: number, from: number, to: number, weight: number, asText: number, headings = false, lastIndex = index) => {
    // A block whose first line is indented, behind a blank line, may stand in the list item or the footnote of the
    // block before it — an item's second paragraph, indented code in it, a fence in it across a blank line: it is
    // part of that block, so that every block begins where a parser reading it alone reads what it reads in the note
    // (`readAsTextParts`). Behind a heading nothing continues; there it is a block of its own.
    // So is a block behind a line that may be indented code (four blanks or more): micromark holds the code open
    // across the blank line, and the next line is read as interrupting it — `2.` opens no list there, `[a]: b` is
    // no definition. A heading is read alike either way.
    const previous = blocks[blocks.length - 1];
    if (!block && broken && previous && !previous.headings && (text.charCodeAt(from) === 0x20 || text.charCodeAt(from) === 0x09 || (deepBefore && !headings))) {
      block = blocks.pop()!;
      block.asText += blankChars;
      headings = false;
    }
    broken = false;
    blankChars = 0;
    if (block && block.headings !== headings) close();
    if (!block) {
      block = { from, to, weight: 0, asText: 0, headings, definitions: 0, references: 0 };
      weight += W.block;
    }
    block.definitions += lineDefinitions;
    block.references += lineRefs;
    references[index] += lineRefs;
    pieceLabels[index] += headingLine[index] ? lineRefs : lineRuns;
    lineDefinitions = 0;
    lineRefs = 0;
    lineRuns = 0;
    total += weight;
    weights[index] += weight;
    deepBefore = indentOf(lines[lastIndex].text) >= 4;
    block.to = to;
    block.weight += weight;
    block.asText += asText;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.to <= propertiesEnd) continue;
    const kind = kinds[index];
    if (kind === LINE_BREAK) {
      close();
      broken = true;
      blankChars += line.to - line.from + 1;
      continue;
    }
    // A block read as text is one line of stand-ins: it weighs its characters.
    const asText = line.to - line.from + 1;
    // An indented heading may stand in a list item: it stays in the block around it, so that every block begins where
    // the note itself does (`readAsTextParts`).
    if (kind === LINE_HEADING && text.charCodeAt(line.from) !== 0x20 && text.charCodeAt(line.from) !== 0x09) {
      // Headings are blocks of their own, read as text last: the outline and the links to them hang on them.
      add(index, line.from, line.to, W.heading + weighLine(line.from, line.to), asText, true);
      continue;
    }
    while (written < ranges.length && ranges[written].to <= line.from) written++;
    const table = tables.get(index);
    if (table) {
      const end = lines[table.last].to;
      const written = end - line.from + W.textLine * (table.last - index + 1);
      if (table.cost >= 0) heaviestTable = Math.max(heaviestTable, table.peak);
      // A table's references, by its closing brackets that are no link's and no wiki link's: more than it holds, never fewer.
      if (table.cost >= 0) lineRuns = lineRefs = closingBrackets(text, line.from, end);
      add(index, line.from, end, table.cost < 0 ? written : table.cost, end - line.from + 1, false, table.last);
      index = table.last;
      continue;
    }
    if (written < ranges.length && ranges[written].from < line.to) {
      // Read as written already: what text costs, its line end kept. A definition in it is read as text from the start
      // (a block of 30 000 definitions is one paragraph over the paragraph's budget on the desktop).
      const kept = keptPrefix(text, line.from, line.to);
      if (beginsWithDefinition(text, line.from + kept, line.to)) {
        writtenDefinitions += W.line + W.definition + (line.to - line.from);
        counted.definitions++;
      }
      add(index, line.from, line.to, line.to - line.from + W.textLine, asText);
      continue;
    }
    add(index, line.from, line.to, kind === LINE_CODE ? line.to - line.from + W.codeLine : weighLine(line.from, line.to), asText);
  }
  close();
  // The peak of the heaviest table while it is resolved, on top of what stays: it is there whichever blocks are read as text.
  total += (heaviestTable * W.tablePeak) / 100;
  observe?.note?.(total);
  // Held: the blocks an earlier decision on this text read as text (the editor's, while it is typed in). Within a
  // tenth under the budget they stay text, and they are the first chosen over it: one keystroke at the threshold
  // turns no block back and forth, and among blocks of about the same weight the one read as text stays the one.
  // A definition read as text that a reference in formatted text names is given back to the note's tree, a line of
  // its own (`givenDefinitions`): what the definitions read as text weigh, at most one given line for each reference
  // still formatted, is weighed again (review of L14, 2026-11-26: references formatted beside their definitions read
  // as text held all the definitions again, and the note ran out of 128 MB where the budget weighed it read).
  let givenFrom = writtenDefinitions;
  let formattedReferences = 0;
  for (const each of blocks) formattedReferences += each.references;
  const given = (): number => Math.min(givenFrom, formattedReferences * givenLineMost());
  const held = (previous ?? []).filter((range) => range.block);
  if (total + given() <= noteBudget && (held.length === 0 || total + given() <= noteBudget * (1 - NOTE_HYSTERESIS))) return [];
  const isHeld = (i: number): boolean => {
    const { from, to } = blocks[i];
    let lo = 0;
    let hi = held.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (held[mid].to <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo < held.length && held[lo].from < to;
  };
  const chosen: BoundedRange[] = [];
  // The heaviest first; headings only where the rest cannot bring the note into its budget.
  // A block read as text is a paragraph of one line of stand-ins: alone, it weighs a line and a block besides its
  // characters; next to a block read as text it is part of that one's line, and between two it joins them into one.
  // (A note of footnotes, weighed by characters alone, read its references as text and kept 5 684 paragraphs of
  // stand-ins between its definitions, and ran out of 128 MB.)
  const paragraph = W.line + W.block;
  const asTextAt = new Uint8Array(blocks.length);
  const besideAsText = (i: number, j: number): boolean =>
    j >= 0 && j < blocks.length && asTextAt[j] === 1 && onlyBlanksBetween(text, blocks[Math.min(i, j)].to, blocks[Math.max(i, j)].from);
  const heaviest = blocks
    .map((_, i) => i)
    // A block lighter than the paragraph it would become alone still helps among others read as text: they join
    // into one line (a note of 56 000 thematic breaks between blank lines ran the index out of 128 MB, no block of
    // it heavy enough to be chosen alone).
    .filter((i) => blocks[i].weight > blocks[i].asText)
    .sort((x, y) => Number(blocks[x].headings) - Number(blocks[y].headings) || blocks[y].weight - blocks[x].weight || x - y);
  const order = held.length > 0 ? [...heaviest.filter(isHeld), ...heaviest.filter((i) => !isHeld(i))] : heaviest;
  for (const i of order) {
    if (total + given() <= noteBudget && !(held.length > 0 && isHeld(i))) break;
    const candidate = blocks[i];
    const before = besideAsText(i, i - 1);
    const after = besideAsText(i, i + 1);
    asTextAt[i] = 1;
    chosen.push({ from: candidate.from, to: candidate.to, block: true });
    total -= candidate.weight - candidate.asText - (before && after ? -paragraph : before || after ? 0 : paragraph);
    givenFrom += candidate.definitions;
    formattedReferences -= candidate.references;
  }
  // Blocks with only blank lines between them are one range, the blank lines standing in as well: one line, not a
  // paragraph a block (40 000 short paragraphs read as text still filled 128 MB).
  chosen.sort((x, y) => x.from - y.from);
  const joined: BoundedRange[] = [];
  for (const range of chosen) {
    const previous = joined[joined.length - 1];
    if (previous && onlyBlanksBetween(text, previous.to, range.from)) previous.to = range.to;
    else joined.push(range);
  }
  return joined;
}

/**
 * The share of the note's budget a piece of a block read as text may weigh
 * (`readAsTextParts`): the parse of the note holds its tree while a piece is
 * read beside it, and what stays of a parse is about a tenth of its peak
 * (Gesamtplan Leistung § 3a.1) — half the budget for the piece leaves the
 * rest to the tree. `perf:notes -- --check` reads notes far over the budget
 * as the index and a rename read them, pieces and all, under the heap.
 */
export const PIECE_SHARE = 0.5;
let pieceShare = PIECE_SHARE;
/**
 * The share of the note's budget pieces are gathered up to: units and items
 * follow each other into one piece up to this weight. Smaller pieces read
 * faster — the tree of a list is built in a pass per list (`prepareList` of
 * mdast-util-from-markdown) that grows faster than the list: 50 000 linked
 * items took 7.4 s in pieces of half the budget and 3.4 s in pieces of a
 * fiftieth, with a third of the heap.
 */
const PIECE_GATHER_SHARE = 0.02;
/*
 * No cap on what is read in pieces (2026-11-26). A cap of four budgets left
 * half the links of a mixed note of 1 MB unread on the phone, and saved no
 * time against the parse it replaced: in pieces a note is read in linear time,
 * 1 to 7 s a megabyte here, where `main`'s parse of the same note took 39 s
 * for 1 MB of mixed blocks and 190 s for 4 MB of list items (Performance_Notes.md).
 */

/**
 * The share of the note's budget a piece may weigh; only the tests and the
 * calibration change it. `apart`: every unit and every item of a list cut is
 * a piece of its own, whatever it weighs — the tests' way to read every cut
 * against the note read whole.
 */
export function setPieceShare(share: number, apart = false): void {
  pieceShare = share;
  piecesApart = apart;
}
let piecesApart = false;

/** A stretch of a block read as text that the parser reads on its own for the note's facts: whole lines, in the note's places. */
export interface ReadPiece {
  from: number;
  to: number;
  /** What it weighs to the note's budget, with the definitions it is read with: pieces that stand side by side may be read as one up to `pieceLimit`. */
  weight?: number;
  /** What it weighs without them, and the references it holds (`pieceWeight`). */
  own?: number;
  references?: number;
}

/**
 * What a piece of `own` weight weighs with the definitions it is read with: at
 * most one a reference of its `references`, never more than the note's
 * `definitions` — pieces read as one share theirs.
 */
export function pieceWeight(own: number, references: number, definitions: number): number {
  return own + Math.min(references, definitions) * givenLineMost();
}

/** What a piece read at once may weigh: the share of the note's budget a piece may take (`PIECE_SHARE`). */
export function pieceLimit(): number {
  return pieceShare * noteBudget;
}

/**
 * What the parse budget does with a note (L14, Weg A and B): the stretches it
 * reads as text (`overBudgetInlineRanges`); the pieces of the blocks read as
 * text, which the readers of a note's facts — the index, a rename, its block
 * ids — read one at a time with the parser itself, keep what they need of and
 * let go, so that a block shown as text keeps its links, tags and block ids;
 * and what is read as text and not read for facts at all — a paragraph over
 * the inline budget (as before L14), a block that cannot be cut into pieces
 * small enough —, which the note's notice names.
 */
export interface ReadAsTextParts {
  ranges: BoundedRange[];
  pieces: ReadPiece[];
  unread: BoundedRange[];
  /** How many lines of the note begin with a definition: what a piece's definitions weigh at most (`pieceWeight`). */
  definitions?: number;
  /**
   * Whether the note begins with a `---` that nothing closes: the parser then
   * reads no blocks within blocks anywhere in it, and the note has no `---`
   * line that would close it. A piece read behind a `---` of its own is read
   * as in the note (`forEachReadPiece`).
   */
  behindUnclosedProperties?: boolean;
}

/** Whether `content` (a line behind its quote markers) is a thematic break: `- - -` opens no list item. */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * Where the lines `[first, last]` of a unit of a block read as text can be
 * cut so that each part, read alone, is read as in the note: at the items of
 * its outermost list. The unit must begin with an item at most three blanks in
 * (behind the quote markers it stands in); a cut is an item of the same
 * kind at the same place and depth, outside fenced code and HTML — bulleted
 * items interrupt whatever stands before them, an ordered one only continues
 * its list, so the cuts of an ordered list end at the first line of the
 * list's own level that is no item of it. Fenced code and HTML are followed
 * generously: an opening that may stand in an item stops the cuts until it
 * closes, which only ever makes a part larger. `null` where the unit is no
 * list.
 */
function listCuts(lines: ScanLine[], first: number, last: number): number[] | null {
  const head = peelQuotes(lines[first].text);
  // An item may stand up to three blanks in (`  - [x] done …`); its siblings may stand anywhere from none to three, short
  // of its content (review of L14, 2026-11-26: a list indented by two was never cut, and lost its links from 3 500 items).
  const item = indentOf(head.content) <= 3 && !THEMATIC_BREAK.test(head.content) ? itemStart(head.content) : null;
  if (!item) return null;
  const delimiterOf = (content: string): string => content[/^\d*/.exec(content)![0].length];
  const delimiter = item.ordered ? delimiterOf(head.content) : null;
  // Fenced code and HTML at the list's own level stop the cuts until they end; inside an item — indented to its
  // content, or behind its marker — they end with the item, at the next cut, and only their own lines are theirs.
  let fence: Fence | null = null;
  let html: RegExp | null = null;
  let inner: { fence: Fence | null; html: RegExp | null } = { fence: null, html: null };
  let content = item.content;
  const opensInner = (text: string) => {
    inner = { fence: fenceOpening(text), html: null };
    if (!inner.fence && text.includes("<")) {
      const kind = htmlBlockOpening(text.slice(textStart(text)));
      if (kind && kind !== HTML_ENDED) inner.html = kind;
    }
  };
  opensInner(head.content.slice(atColumn(head.content, item.content)));
  let inList = true;
  const cuts: number[] = [];
  for (let at = first + 1; at <= last; at++) {
    const peeled = peelQuotes(lines[at].text);
    const text = peeled.content;
    if (fence) {
      if (closesFence(text, fence)) fence = null;
      continue;
    }
    if (html) {
      if (html === HTML_ENDS_AT_BLANK ? isBlank(text) : html.test(text)) html = null;
      continue;
    }
    if (isBlank(text)) {
      if (inner.html === HTML_ENDS_AT_BLANK) inner.html = null;
      continue;
    }
    // A line of the item: its fence and its HTML go on, end, or begin here.
    if (peeled.depth === head.depth && indentOf(text) >= content) {
      const own = text.slice(atColumn(text, content));
      if (inner.fence) {
        if (closesFence(own, inner.fence)) inner.fence = null;
      } else if (inner.html) {
        if (inner.html !== HTML_ENDS_AT_BLANK && inner.html.test(own)) inner.html = null;
      } else opensInner(own);
      continue;
    }
    // Less indented than the item's content, a line ends the item's fence or HTML and the item with them — no lazy
    // text continues either: what follows stands at the list's level, outside the list.
    const ended = inner.fence !== null || inner.html !== null;
    inner = { fence: null, html: null };
    const opening = fenceOpening(text);
    if (opening) {
      fence = opening;
      inList = false;
      continue;
    }
    if (indentOf(text) <= 3 && text.includes("<")) {
      const kind = htmlBlockOpening(text.slice(textStart(text)));
      if (kind && kind !== HTML_ENDED) {
        html = kind;
        inList = false;
        continue;
      }
    }
    if (peeled.depth !== head.depth || indentOf(text) > 3) {
      if (ended) inList = false;
      continue;
    }
    const next = THEMATIC_BREAK.test(text) ? null : itemStart(text);
    if (next && (item.ordered ? next.ordered && delimiterOf(text) === delimiter && inList : !next.ordered)) {
      cuts.push(at);
      content = next.content;
      opensInner(text.slice(atColumn(text, next.content)));
    } else if (!next || next.ordered !== item.ordered) inList = false;
  }
  return cuts;
}

/** Where in `line` its column `column` begins, its blanks and tabs counted as CommonMark counts them (a tab to the next multiple of four). */
function atColumn(line: string, column: number): number {
  let at = 0;
  let col = 0;
  while (col < column && at < line.length) {
    col = line.charCodeAt(at) === 0x09 ? col + 4 - (col % 4) : col + 1;
    at++;
  }
  return at;
}

/** The index of the first of `lines` that ends at or after `at`. */
function lineAt(lines: ScanLine[], at: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].to < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The parts of `text` the parse budget reads as text, and how its blocks read
 * as text are read for facts (`ReadAsTextParts`). A block read as text is cut
 * into units, each beginning where the note itself does — behind a blank line
 * at the start of its line, at a heading and behind one (`noteBudgetRanges`
 * keeps an indented block with the block before it) —, a unit heavier than a
 * piece may weigh into the items of its outermost list (`listCuts`); the units
 * and items follow each other into pieces up to that weight. What cannot be
 * cut that small is unread. Linear in the note, from the scan alone: no parse.
 */
export function readAsTextParts(text: string, reading: MarkdownReading = NOTE_READING, previous?: readonly BoundedRange[]): ReadAsTextParts {
  if (previous) return scannedParts(text, reading, previous);
  // The index parses a note and then reads its facts: one scan for both.
  const key = `${noteBudget} ${pieceShare} ${piecesApart} ${weightsVersion} ${reading.tables} ${reading.properties} ${reading.notes}`;
  if (lastParts && lastParts.text === text && lastParts.key === key) return lastParts.parts;
  const parts = scannedParts(text, reading);
  lastParts = { text, key, parts };
  return parts;
}

/** The last note `readAsTextParts` read, and what it found: one entry, so that a parse and the reading of its facts share a scan. */
let lastParts: { text: string; key: string; parts: ReadAsTextParts } | null = null;

function scannedParts(text: string, reading: MarkdownReading, previous?: readonly BoundedRange[]): ReadAsTextParts {
  let scan: NoteScan | null = null;
  const ranges = overBudgetInlineRanges(text, text.length > NOTE_SCAN_FROM && reading.notes !== false ? { blocks: (found) => (scan = found) } : undefined, reading, previous);
  const found = scan as NoteScan | null;
  if (!found || found.blocks.length === 0) return { ranges, pieces: [], unread: ranges.filter((range) => !range.table && !range.block) };
  // What of the blocks read as text is unread, in text order (`leaveUnread` joins neighbours); the paragraphs over
  // the inline budget are unread as well, and join it at the end.
  const unread: BoundedRange[] = [];
  const pieces: ReadPiece[] = [];
  const { lines, kinds, weights, pieceLabels: references } = found;
  const limit = pieceShare * noteBudget;
  // A piece is read with a definition behind it for each label in brackets in it that the note defines
  // (`forEachReadPiece`): at most one a reference, never more than the note has. It weighs them, so that a piece and its
  // definitions stay within a piece's share (review of L14, 2026-11-26: a paragraph of 9 000 references, read with
  // their definitions behind it, ran the index out of 128 MB at half the note's budget).
  const appendix = (refs: number): number => pieceWeight(0, refs, found.definitions);
  const gather = Math.min(limit, PIECE_GATHER_SHARE * noteBudget);
  const leaveUnread = (from: number, to: number) => {
    const last = unread[unread.length - 1];
    if (last && onlyBlanksBetween(text, last.to, from)) last.to = Math.max(last.to, to);
    else unread.push({ from, to });
  };
  // Behind an unclosed `---` the parser reads no blocks within blocks: a list is no list there, and a unit is not cut.
  const cutsOf = (from: number, to: number) => (found.containers ? listCuts(lines, from, to) : null);
  for (const block of found.blocks) {
    const first = lineAt(lines, block.from);
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].from < block.to) last++;
    // The units: [first line, last line, weight, references].
    const units: Array<[number, number, number, number]> = [];
    const indented = (at: number) => lines[at].text.charCodeAt(0) === 0x20 || lines[at].text.charCodeAt(0) === 0x09;
    const heading = (at: number) => kinds[at] === LINE_HEADING && !indented(at);
    // As `noteBudgetRanges` reads it: behind a line that may be indented code, the next block is part of the one before.
    let deep = false;
    for (let at = first; at <= last; at++) {
      if (isBlank(lines[at].text) && kinds[at] !== LINE_CODE) continue;
      const starts = units.length === 0 || (kinds[at - 1] === LINE_BREAK && !indented(at) && !deep) || heading(at - 1) || heading(at);
      deep = indentOf(lines[at].text) >= 4;
      if (starts) units.push([at, at, weights[at], references[at]]);
      else {
        const unit = units[units.length - 1];
        unit[1] = at;
        unit[2] += weights[at];
        unit[3] += references[at];
      }
    }
    type Gathered = { from: number; to: number; own: number; references: number };
    let piece: Gathered | null = null;
    const flush = () => {
      if (piece) pieces.push({ from: piece.from, to: piece.to, weight: pieceWeight(piece.own, piece.references, found.definitions), own: piece.own, references: piece.references });
      piece = null;
    };
    const take = (from: number, to: number, own: number, refs: number) => {
      const current = piece as Gathered | null;
      if (current && !piecesApart && pieceWeight(current.own + own, current.references + refs, found.definitions) <= gather) {
        current.to = lines[to].to;
        current.own += own;
        current.references += refs;
      } else {
        flush();
        piece = { from: lines[from].from, to: lines[to].to, own, references: refs };
      }
    };
    for (const [from, to, own, refs] of units) {
      const weight = own + appendix(refs);
      if (weight <= limit && !(piecesApart && cutsOf(from, to)?.length)) {
        take(from, to, own, refs);
        continue;
      }
      const cuts = cutsOf(from, to);
      if (!cuts) {
        flush();
        leaveUnread(lines[from].from, lines[to].to);
        continue;
      }
      const bounds = [from, ...cuts, to + 1];
      for (let k = 0; k + 1 < bounds.length; k++) {
        let end = bounds[k + 1] - 1;
        while (end > bounds[k] && isBlank(lines[end].text)) end--;
        let part = 0;
        let partRefs = 0;
        for (let at = bounds[k]; at <= end; at++) {
          part += weights[at];
          partRefs += references[at];
        }
        if (part + appendix(partRefs) <= limit || piecesApart) take(bounds[k], end, part, partRefs);
        else {
          flush();
          leaveUnread(lines[bounds[k]].from, lines[end].to);
        }
      }
    }
    flush();
  }
  return { ranges, pieces, unread: unitedRanges(unread, found.inline).map(({ from, to }) => ({ from, to })), definitions: found.definitions, ...(found.containers ? {} : { behindUnclosedProperties: true }) };
}

/** Whether the place `at` lies in one of `ranges` (in text order, apart), found by halving. */
export function inBoundedRanges(ranges: readonly BoundedRange[], at: number | undefined): boolean {
  if (typeof at !== "number") return false;
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid].to <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo].from <= at;
}

/** Whether `text[from, to)` holds nothing but blanks and line ends. */
export function onlyBlanksBetween(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
}

/**
 * What every character of a stretch read as written stands in for: one
 * noncharacter (U+FDD0), which Unicode keeps free for exactly this — standing
 * in for something inside a program. One UTF-16 unit, so every place in the
 * text stays where it was. Every character but a line end stands in, blanks
 * too, so the parser finds nothing to read there — no syntax, no link
 * literal, no word, no cell: GFM tries an address at every start of a run of
 * letters, and its table parser reads a long line as a header row, a piece
 * for each stretch between blanks; a paragraph of 1.5 MB of `x x …` ran a
 * parse out of 128 MB with nothing else in it, on main as well (L14).
 * The characters come back by their places (`restoreBoundedTree`).
 */
const STAND_IN = "\ufdd0";
/**
 * `text[from, to)` with every character but its line ends standing in, onto
 * `pieces`: a run of stand-ins for each line, one string of them repeated —
 * a replace by a pattern over 4 MB held 112 MB while it ran. A block read as
 * text (`BoundedRange.block`) stands in its line ends too, so that it is one
 * line: a line of stand-ins is events of its own, 60 000 lines of them filled
 * 128 MB where ten lines of the same length passed in 28 MB. The places in
 * the text stay as they are; `restoreBoundedTree` gives every node its line
 * and column back from them.
 */
function standInKeepingLineEnds(text: string, from: number, to: number, pieces: string[]): void {
  let at = from;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code !== 0x0a && code !== 0x0d) continue;
    if (i > at) pieces.push(STAND_IN.repeat(i - at));
    pieces.push(text[i]);
    at = i + 1;
  }
  if (to > at) pieces.push(STAND_IN.repeat(to - at));
}

/** A text made safe to parse, and how to give a parsed value back its characters. */
export interface BoundedMarkdown {
  /** The text to hand the parser: as long as the original, character for character, except inside `ranges`. */
  text: string;
  /** The stretches read as written. */
  ranges: BoundedRange[];
  /** The text the ranges were measured in, which `restoreBoundedTree` gives the characters back from. */
  original: string;
}

/**
 * `text` with every stretch over the budget read as written: inside such a
 * stretch every character but line ends stands in as one
 * noncharacter, so the parser reads plain text there — in linear time and
 * memory — and `restoreBoundedTree` gives the characters back by their
 * places. Outside the stretches nothing changes; a note a person writes
 * comes back as it is.
 */
export function boundMarkdownForParse(text: string, reading: MarkdownReading = NOTE_READING): BoundedMarkdown {
  return boundMarkdownInRanges(text, readAsTextParts(text, reading).ranges);
}

/**
 * How many characters at `at`, the start of a line of a range, stay as they
 * are: the blanks, `>` and list markers the line begins with, so that a
 * paragraph read as written keeps the quote or list item it stands in. A
 * table's range starts behind its markers already, and a block read as text
 * (`BoundedRange.block`) keeps none: it becomes a paragraph.
 */
function keptPrefix(text: string, at: number, to: number): number {
  let i = at;
  for (;;) {
    while (i < to && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === ">") {
      i++;
      continue;
    }
    let marker = i;
    if (text[marker] === "-" || text[marker] === "+" || text[marker] === "*") marker++;
    else {
      while (marker < to && marker - i < 9 && text.charCodeAt(marker) >= 0x30 && text.charCodeAt(marker) <= 0x39) marker++;
      if (marker === i || (text[marker] !== "." && text[marker] !== ")")) return i - at;
      marker++;
    }
    // A marker counts with a blank behind it, or at the line's end.
    if (marker < to && text[marker] !== " " && text[marker] !== "\t" && text[marker] !== "\n" && text[marker] !== "\r") return i - at;
    i = marker;
  }
}

/** Whether `range` keeps the markers its lines begin with (`keptPrefix`). */
const keepsMarkers = (range: BoundedRange): boolean => !range.table && !range.block;

/** `text` with `ranges` read as written (`boundMarkdownForParse`), for a caller that unites the ranges of more than one reading. */
export function boundMarkdownInRanges(text: string, ranges: BoundedRange[]): BoundedMarkdown {
  if (ranges.length === 0) return { text, ranges, original: text };
  // One replace a stretch, not a string grown by a character: a range of a million `[` held a million pieces (review, 2026-11-16).
  const pieces: string[] = [];
  let at = 0;
  for (const range of ranges) {
    pieces.push(text.slice(at, range.from));
    if (!keepsMarkers(range)) {
      if (range.block) pieces.push(STAND_IN.repeat(range.to - range.from));
      else standInKeepingLineEnds(text, range.from, range.to, pieces);
    } else {
      // Line by line: the markers a line begins with stay, the rest stands in.
      let line = range.from;
      while (line < range.to) {
        let end = text.indexOf("\n", line);
        end = end < 0 || end >= range.to ? range.to : end + 1;
        const kept = line === 0 || text[line - 1] === "\n" ? keptPrefix(text, line, end) : 0;
        pieces.push(text.slice(line, line + kept));
        standInKeepingLineEnds(text, line + kept, end, pieces);
        line = end;
      }
    }
    at = range.to;
  }
  pieces.push(text.slice(at));
  return { text: pieces.join(""), ranges, original: text };
}

/**
 * The characters a bounded text's stand-ins stood for, read from the place
 * `from` on in `original`: each stand-in of `value`, in order, is the next
 * character of a range that stood in (not a line end, not a marker a line
 * kept). The parser drops none of a stretch's characters, so the places line
 * up.
 */
function restoredFrom(value: string, from: number, bounded: BoundedMarkdown, cursor: { range: number }): string {
  const { ranges, original } = bounded;
  // Most values stand in the text as they are written: then they are the original's characters at their place, in one piece.
  if (bounded.text.startsWith(value, from)) return original.slice(from, from + value.length);
  const pieces: string[] = [];
  let copied = 0;
  let at = from;
  let range = cursor.range;
  while (range > 0 && ranges[range - 1].to > at) range--;
  while (range < ranges.length && ranges[range].to <= at) range++;
  // Where the markers of the line `at` stands in end: inside them nothing stood in.
  let lineKeptUntil = -1;
  for (let k = value.indexOf(STAND_IN); k >= 0; k = value.indexOf(STAND_IN, k + 1)) {
    for (;;) {
      if (range >= ranges.length) return pieces.join("") + value.slice(copied);
      const r = ranges[range];
      if (at >= r.to) {
        range++;
        continue;
      }
      if (at < r.from) at = r.from;
      const ch = original[at];
      if (keepsMarkers(r) && (at === r.from || original[at - 1] === "\n") && (at === 0 || original[at - 1] === "\n")) lineKeptUntil = at + keptPrefix(original, at, r.to);
      if (((ch === "\n" || ch === "\r") && !r.block) || at < lineKeptUntil) {
        at++;
        continue;
      }
      break;
    }
    // A run of stand-ins over characters that follow each other comes back as one slice.
    let end = at + 1;
    let next = k + 1;
    while (next < value.length && value[next] === STAND_IN && end < ranges[range].to && (ranges[range].block || (original[end] !== "\n" && original[end] !== "\r")) && end >= lineKeptUntil) {
      end++;
      next++;
    }
    pieces.push(value.slice(copied, k), original.slice(at, end));
    copied = next;
    at = end;
    k = next - 1;
  }
  cursor.range = range;
  return pieces.join("") + value.slice(copied);
}

interface PlacedPoint {
  offset?: number;
  line?: number;
  column?: number;
}

interface PlacedTreeNode {
  position?: { start?: PlacedPoint; end?: PlacedPoint };
  children?: PlacedTreeNode[];
  [key: string]: unknown;
}

/** Where each line of `text` begins: `\n`, `\r\n` and a lone `\r` end a line, as the parser counts them. */
function lineStartsOf(text: string): Int32Array {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || (code === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) count++;
  }
  const starts = new Int32Array(count);
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || (code === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) starts[line++] = i + 1;
  }
  return starts;
}

/** The line and column of `point` from its offset (`lineStartsOf`), counted from 1 as the parser counts them. */
function placeAgain(point: PlacedPoint | undefined, lineStarts: Int32Array): void {
  if (!point || typeof point.offset !== "number") return;
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= point.offset) lo = mid;
    else hi = mid - 1;
  }
  point.line = lo + 1;
  point.column = point.offset - lineStarts[lo] + 1;
}

/**
 * Gives every string a parsed tree holds from inside the ranges of
 * `bounded` back its characters: a text, a code value. Each comes back from
 * its node's place in `bounded.original` (`restoredFrom`). Nodes outside
 * every range are left alone. Offsets are those of the text the ranges were
 * measured in.
 */
export function restoreBoundedTree(tree: unknown, bounded: BoundedMarkdown): void {
  if (bounded.ranges.length === 0) return;
  const cursor = { range: 0 };
  // A block read as text is one line in the parsed text: every point gets its line and column back from its place in the original.
  const lineStarts = bounded.ranges.some((range) => range.block) ? lineStartsOf(bounded.original) : null;
  const open: PlacedTreeNode[] = [tree as PlacedTreeNode];
  for (let node = open.pop(); node; node = open.pop()) {
    if (lineStarts) {
      placeAgain(node.position?.start, lineStarts);
      placeAgain(node.position?.end, lineStarts);
    }
    const from = node.position?.start?.offset;
    if (typeof from === "number") {
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === "string" && value.includes(STAND_IN)) node[key] = restoredFrom(value, from, bounded, cursor);
      }
    }
    const children = node.children ?? [];
    // Children in reverse, so that they come off the stack in text order and the cursor only moves on.
    for (let i = children.length - 1; i >= 0; i--) open.push(children[i]);
  }
}
