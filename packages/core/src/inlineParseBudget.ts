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

/** The most `inlineParseCost` a stretch may have and still be parsed as Markdown. */
export const INLINE_PARSE_BUDGET = 15_000_000;

/** A range of a text, in UTF-16 units: `from` inclusive, `to` exclusive. */
export interface BoundedRange {
  from: number;
  to: number;
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

interface Line {
  from: number;
  /** End of the line's text, before its line break. */
  to: number;
  text: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
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
function opensHtmlBlock(text: string): boolean {
  if (text[0] !== "<") return false;
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(text)) return true;
  if (text.startsWith("<!--") || text.startsWith("<?") || text.startsWith("<![CDATA[") || /^<![A-Za-z]/.test(text)) return true;
  const named = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:[ \t>]|\/>|$)/.exec(text);
  if (named && HTML_BLOCK_NAMES.has(named[1].toLowerCase())) return true;
  return LONE_TAG.test(text);
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
function endsTable(row: string, indent = indentOf(row)): boolean {
  if (isBlank(row) || indent > 3) return true;
  const text = row.slice(textStart(row));
  if (text[0] === ">" || isAtxHeading(text) || fenceOpening(text)) return true;
  if (/^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(text)) return true;
  if (/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text)) return true;
  if (/^\[\^[^\]\s]+\]:/.test(text)) return true;
  return opensHtmlBlock(text);
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
export function tableLineStart(line: string, first: boolean): { depth: number; at: number; prefix: number[] } {
  let at = 0;
  let depth = 0;
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
      const footnote = /^\[\^[^\]\s]+\]:[ \t]*/.exec(line.slice(at));
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
function exactRow(line: string, prefix: readonly number[]): { at: number; indent: number } | null {
  let at = 0;
  let column = 0;
  // The column the content of the innermost block starts at.
  let content = 0;
  const advance = () => {
    column = line[at] === "\t" ? column + 4 - (column % 4) : column + 1;
    at++;
  };
  for (const need of prefix) {
    if (need < 0) {
      let blanks = 0;
      while (line[at] === " " && blanks < 3) {
        advance();
        blanks++;
      }
      if (line[at] !== ">") return null;
      advance();
      content = column;
      if (line[at] === " " || line[at] === "\t") {
        content = column + 1;
        advance();
      }
    } else {
      // The item's content starts `need` columns behind where its marker's block began.
      const from = content;
      while (column < from + need && (line[at] === " " || line[at] === "\t")) advance();
      if (column < from + need) return isBlank(line.slice(at)) ? { at, indent: 0 } : null;
      content = from + need;
    }
  }
  const start = at;
  while (line[at] === " " || line[at] === "\t") advance();
  return { at: start, indent: column - content };
}

/** The cells of a table line as the table parser counts them (`tableRowParts`). A header without a pipe has one: `a` over `|-` is a table. */
function tableCells(line: string): number {
  return tableRowParts(line, 0, line.length).cells;
}

/** A table's delimiter row: cells of `-` with an optional `:` on either side, at least one `|`. */
function delimiterRowCells(line: string): number | null {
  if (indentOf(line) > 3) return null;
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|");
  for (const cell of cells) {
    const c = cell.trim();
    let at = 0;
    if (c[at] === ":") at++;
    const dashes = at;
    while (c[at] === "-") at++;
    if (at === dashes) return null;
    if (c[at] === ":") at++;
    if (at !== c.length) return null;
  }
  return cells.length;
}

/** The characters of inline syntax a table's weight counts (`tableReadCost`): each opens or closes a construct the parser keeps events for. */
const TABLE_SYNTAX = "\\[]*_~`<&!$";

/** What a row weighs against a character: each row is a node of its own, with its own events. */
export const TABLE_ROW_WEIGHT = 8;

/** What a cell weighs against a character, filled or empty: each cell's content is a parse of its own, with its own events. */
export const TABLE_CELL_WEIGHT = 34;

/** What a character of inline syntax weighs against a plain one. */
export const TABLE_SYNTAX_WEIGHT = 9;

/** What each block marker in front of a table line weighs: a quote's `>`, a list item's or a footnote's indent; each is events of its own on every line. */
export const TABLE_MARKER_WEIGHT = 9;

/**
 * What the markers in front of a table line weigh (`prefix`, the line up to
 * its row): one per character, and `TABLE_MARKER_WEIGHT` for each quote
 * marker and once for a list item's or a footnote's marker or indent.
 */
export function tableMarkerCost(prefix: string): number {
  let quotes = 0;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] === ">") quotes++;
  const other = prefix.replace(/>[ \t]?/g, "").length > 0 ? 1 : 0;
  return prefix.length + TABLE_MARKER_WEIGHT * (quotes + other);
}

/**
 * The parts of the table row `text[from, to)` its weight is made of, its
 * cells counted the way the table parser counts them: a `|` is a cell
 * boundary unless an odd number of backslashes stands right in front of it
 * (`\|` is a pipe in the cell, `\\|` a backslash and a boundary, `\\\|` again
 * a pipe), also inside a code span; every stretch between two boundaries is a
 * cell, empty or not; the stretch before the first and after the last
 * boundary is one only when it holds something (a row without outer pipes
 * has one cell more than boundaries). `text[from, to)` is the row behind its
 * container markers (`tableLineStart`).
 */
export function tableRowParts(text: string, from: number, to: number): { chars: number; boundaries: number; cells: number; syntax: number } {
  let boundaries = 0;
  let cells = 0;
  let syntax = 0;
  let backslashes = 0;
  // Whether the stretch since the last boundary (or the row's start) holds anything.
  let held = false;
  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === "|" && backslashes % 2 === 0) {
      // A stretch between two boundaries is a cell; the one before the first only when it holds something.
      if (boundaries > 0 || held) cells++;
      boundaries++;
      held = false;
    } else {
      if (TABLE_SYNTAX.includes(ch)) syntax++;
      if (ch !== " " && ch !== "\t") held = true;
    }
    backslashes = ch === "\\" ? backslashes + 1 : 0;
  }
  if (held) cells++;
  return { chars: to - from, boundaries, cells, syntax };
}

/**
 * What reading the table row `text[from, to)` weighs: `TABLE_ROW_WEIGHT`,
 * one per character, `TABLE_CELL_WEIGHT` per cell, `TABLE_SYNTAX_WEIGHT` per
 * character of inline syntax; the markers in front of it weigh on their own
 * (`tableMarkerCost`). The weights are an upper bound, not a fit (`scripts/perf/table-budget.ts`,
 * measured 2026-11-13 over 54 shapes): they are chosen so that the largest table the parse reads
 * under a capped heap weighs at least `TABLE_READ_BUDGET / 0.9` for every
 * measured shape — the costliest shape of each part decides its weight.
 */
export function tableReadCost(text: string, from: number, to: number): number {
  const parts = tableRowParts(text, from, to);
  return TABLE_ROW_WEIGHT + parts.chars + TABLE_CELL_WEIGHT * parts.cells + TABLE_SYNTAX_WEIGHT * parts.syntax;
}

/**
 * The most `tableReadCost` a table may have and still be read as a table;
 * over it the whole table is read as written. The criterion
 * (`pnpm --filter @plainva/core perf:tables -- --calibrate`, then `--check`):
 * a table of every measured and every generated shape at the budget is read by
 * the index parse and by the note-source parse each under
 * `node --max-old-space-size=128`, and every measured shape's largest such
 * table weighs at least the budget / 0.9. That is the parse alone; the heap a
 * WebView gives the app is not known here, so raising the budget needs a
 * measurement in the phone's WebView first. In rows (2026-11-13): about
 * 5 000 rows of a word and a link, 3 300 rows of four short cells and a link,
 * 2 650 rows of four cells of words, 1 050 rows with links and emphasis in
 * every cell, 1 150 rows of sixteen one-character cells, 15 000 rows of one
 * short cell or of a line without a pipe, 4 700 rows of a word and a link in
 * a quote or a list item, 10 000 rows of one short cell in two quotes, 150
 * rows of 400 unclosed `[` and `*`.
 * Before GFM tables 2.1.2 the rule was rows times length (5 × 10⁸), about
 * 2 500 short rows, for the time a quadratic parse took.
 */
export const TABLE_READ_BUDGET = 680_000;

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

/** What `overBudgetInlineRanges` can report about its scan, by line (counted from 0): the tests hold it against the parser. */
export interface InlineScanObserver {
  /** Every table the scan weighs: its header and its last line. */
  table?: (first: number, last: number, exact: boolean) => void;
  /** Every run of lines the scan measures as one paragraph. */
  run?: (first: number, last: number) => void;
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
export function overBudgetInlineRanges(text: string, observe?: InlineScanObserver): BoundedRange[] {
  // Nothing in a text this short can reach either budget.
  if (!observe && text.length * text.length <= INLINE_PARSE_BUDGET) return [];
  const ranges: BoundedRange[] = [];
  const lines = splitLines(text);
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
    const head = tableLineStart(header.text, true);
    const rest = header.text.slice(head.at);
    const delimiter = lines[index + 1];
    // Exact: behind the quotes of the header, the indent as the parser counts it; generous: behind every blank and `>`.
    const startOf = (line: string): { at: number; indent: number } | null => (exact ? exactRow(line, head.prefix) : { at: behindMarkers(line), indent: 0 });
    const under = startOf(delimiter.text);
    if (!under) return -1;
    const delimiterCells = under.indent > 3 ? null : delimiterRowCells(delimiter.text.slice(under.at));
    if (exact) {
      // A heading, a fence, an HTML block or a thematic break is no table's header, and neither is a line under one that opens a list item or the like (`- |-`).
      // A line that may underline a heading, or an empty list item that may be text, is left to the generous reading.
      if (endsTable(rest) || /^(?:=+|-+)[ \t]*$/.test(rest) || endsTable(delimiter.text.slice(under.at), under.indent) || tableCells(rest) !== delimiterCells) return -1;
    } else {
      // Any line may be one, read behind its block markers or with them: the parser reads `-` behind indented code as a header.
      if (isBlank(header.text) || delimiterCells === null) return -1;
      if (tableCells(rest) !== delimiterCells && tableCells(header.text.slice(behindMarkers(header.text))) !== delimiterCells) return -1;
    }
    const content: BoundedRange[] = [
      { from: header.from + head.at, to: header.to },
      { from: delimiter.from + under.at, to: delimiter.to },
    ];
    let cost = tableReadCost(text, content[0].from, content[0].to) + tableMarkerCost(header.text.slice(0, head.at));
    const costly: BoundedRange[] = [];
    if (exceedsInlineParseBudget(text, content[0].from, content[0].to)) costly.push(content[0]);
    let last = index + 1;
    for (let at = index + 2; at < lines.length; at++) {
      const line = lines[at];
      const start = startOf(line.text);
      if (!start) break;
      const row = line.text.slice(start.at);
      // A deeper quote, a list item, a heading, indented code and the like end the table; a line without a pipe does not.
      if (endsTable(row, start.indent)) break;
      const range = { from: line.from + start.at, to: line.to };
      content.push(range);
      cost += tableReadCost(text, range.from, range.to) + tableMarkerCost(line.text.slice(0, start.at));
      if (exceedsInlineParseBudget(text, range.from, range.to)) costly.push(range);
      last = at;
    }
    observe?.table?.(index, last, exact);
    if (cost > TABLE_READ_BUDGET) {
      // One range where only blanks, line ends and markers that are no markup lie between two lines.
      for (const range of content) {
        const previous = ranges[ranges.length - 1];
        const between = previous && previous.to <= range.from ? text.slice(previous.to, range.from) : null;
        if (previous && between !== null && previous.from >= content[0].from && ![...between].some((ch) => MARKUP.includes(ch))) previous.to = range.to;
        else ranges.push({ ...range });
      }
    } else {
      ranges.push(...costly);
    }
    return last;
  };
  let fence: Fence | null = null;
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
    const marks = PLAIN_START.exec(line)![0];
    const head = tableLineStart(line, true);
    if (head.at !== marks.length || head.prefix.some((need) => need >= 0)) return -1;
    const content = line.slice(marks.length);
    if (itemStart(content) || /^\[\^[^\]\s]+\]:/.test(content)) return -1;
    return head.depth;
  };
  /**
   * The quote depth of a line that opens a list item (or items, one in the
   * other) behind quote markers only, without a tab among its markers, its
   * first marker behind at most three blanks — or -1. Such a line opens the
   * item wherever it stands, unless it is an ordered item other than 1 under
   * a paragraph, which is text of the paragraph.
   */
  const itemDepth = (line: string): number => {
    const marks = PLAIN_START.exec(line)![0];
    const content = line.slice(marks.length);
    const head = tableLineStart(line, true);
    const items = head.prefix.slice(head.depth);
    if (items.length === 0 || items.some((need) => need < 0) || head.prefix.slice(0, head.depth).some((need) => need >= 0)) return -1;
    if (/\t/.test(line.slice(0, head.at)) || /^\[\^/.test(content.trimStart()) || indentOf(content) > 3) return -1;
    const first = /^ *(\d+)[.)]/.exec(content);
    if (first && run && Number(first[1]) !== 1) return -1;
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
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
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
    if (!fence && !html) html = htmlBlockOpening(line.text.slice(tableLineStart(line.text, true).at));
    else if (html && html !== HTML_ENDS_AT_BLANK && html.test(line.text)) html = HTML_ENDED;
    const plain = fence || html ? -1 : plainDepth(line.text);
    const opensItemHere = fence || html || plain >= 0 ? -1 : itemDepth(line.text);
    if (html === HTML_ENDED) html = null;
    const depthHere = plain >= 0 ? plain : opensItemHere;
    const sure = depthHere >= 0 && (chain === -2 || (chain >= 0 && chain <= depthHere));
    // Behind a list item the next line may continue it lazily.
    chain = sure && plain >= 0 ? plain : -1;
    if (index > tableUntil) {
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
    const { depth, content } = peelQuotes(line.text);
    if (isBlank(content)) {
      // A quote line with nothing behind its markers ends the paragraph in the quote.
      flush();
      list = null;
      continue;
    }
    if (isAtxHeading(content)) {
      flush();
      list = null;
      run = { from: line.from, to: line.to, first: index, last: index };
      flush();
      continue;
    }
    // A thematic break, or a heading's underline below a paragraph, ends the paragraph; the underline belongs to its heading.
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|-+[ \t]*|=+[ \t]*)$/.test(content) && (run || !/^ {0,3}(?:-[ \t]*|=+[ \t]*)$/.test(content))) {
      if (run) {
        run.to = line.to;
        run.last = index;
      }
      flush();
      list = null;
      continue;
    }
    const item = itemStart(content);
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
  const merged: BoundedRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from < previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * The characters that make Markdown of text, and what each stands for while a
 * stretch is read as written: a noncharacter of its own (U+FDD0 onwards),
 * which Unicode keeps free for exactly this — standing in for something
 * inside a program. One UTF-16 unit each, so every place in the text stays
 * where it was.
 */
const MARKUP = "\\[]*_~`<&!$|";
const STAND_IN_BASE = 0xfdd0;
const STAND_IN_LAST = 0xfdef;
const REPLACEMENT = String.fromCharCode(0xfffd);

/** A text made safe to parse, and how to give a parsed value back its characters. */
export interface BoundedMarkdown {
  /** The text to hand the parser: as long as the original, character for character, except inside `ranges`. */
  text: string;
  /** The stretches read as written. */
  ranges: BoundedRange[];
}

/**
 * `text` with every stretch over the budget read as written: inside such a
 * stretch, each character of Markdown syntax stands in for itself as a
 * noncharacter, so the parser reads plain text there — in linear time — and
 * `restoreBoundedValue` gives it back. A noncharacter that was in such a
 * stretch already becomes U+FFFD (none shows as anything). Outside the
 * stretches nothing changes; a note a person writes comes back as it is.
 */
export function boundMarkdownForParse(text: string): BoundedMarkdown {
  const ranges = overBudgetInlineRanges(text);
  if (ranges.length === 0) return { text, ranges };
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.from);
    for (let i = range.from; i < range.to; i++) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      const markup = MARKUP.indexOf(ch);
      if (markup >= 0) out += String.fromCharCode(STAND_IN_BASE + markup);
      else if (code >= STAND_IN_BASE && code <= STAND_IN_LAST) out += REPLACEMENT;
      else out += ch;
    }
    at = range.to;
  }
  out += text.slice(at);
  return { text: out, ranges };
}

/** A value read from a bounded text, with its stand-ins turned back into the characters they stood for. */
export function restoreBoundedValue(value: string): string {
  let out = "";
  let changed = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= STAND_IN_BASE && code < STAND_IN_BASE + MARKUP.length) {
      out += MARKUP[code - STAND_IN_BASE];
      changed = true;
    } else {
      out += value[i];
    }
  }
  return changed ? out : value;
}

interface PlacedTreeNode {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PlacedTreeNode[];
  [key: string]: unknown;
}

/**
 * Gives every string a parsed tree holds from inside `ranges` back its
 * characters (`restoreBoundedValue`): a text, a code value, an address read
 * from a bare `www.`. Nodes outside every range are left alone, so a
 * noncharacter written elsewhere in the note stays what it is. Offsets are
 * those of the text the ranges were measured in.
 */
export function restoreBoundedTree(tree: unknown, ranges: readonly BoundedRange[]): void {
  if (ranges.length === 0) return;
  const touches = (node: PlacedTreeNode): boolean => {
    const from = node.position?.start?.offset;
    const to = node.position?.end?.offset;
    if (typeof from !== "number" || typeof to !== "number") return true;
    return ranges.some((range) => from < range.to && to > range.from);
  };
  // A node without a place is judged by the node it stands in.
  const open: Array<{ node: PlacedTreeNode; inside: boolean }> = [{ node: tree as PlacedTreeNode, inside: false }];
  for (let next = open.pop(); next; next = open.pop()) {
    const { node } = next;
    const inside = node.position ? touches(node) : next.inside;
    if (!inside) continue;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string") node[key] = restoreBoundedValue(value);
    }
    for (const child of node.children ?? []) open.push({ node: child, inside });
  }
}
