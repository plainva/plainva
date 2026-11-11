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
 * events of a large table take hundreds of megabytes while it is read. Each of
 * these is recognised only where every Markdown reader agrees it is what it
 * looks like; anything less certain is measured with the lines around it — a
 * mistake there can only make a stretch be read as written, never let one
 * through that costs more.
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
  let from = 0;
  for (let at = 0; at <= text.length; at++) {
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

/**
 * Whether a line could begin a block of its own — a quote, a heading, a list
 * item, a break, HTML, indented code — rather than be text or a table row.
 * Read generously: a line taken for such a start is measured with the lines
 * around it, which only ever makes the measure stricter.
 */
function mayStartBlock(line: string): boolean {
  if (indentOf(line) > 3) return true;
  const first = line[textStart(line)];
  if (first === undefined) return false;
  if (first === ">" || first === "#" || first === "<" || first === "*" || first === "_" || first === "-" || first === "+" || first === "=") return true;
  return itemStart(line) !== null;
}

/** The cells of a table line: split at each `|` without a backslash in front, the outer pipes dropped. */
function tableCells(line: string): number | null {
  const trimmed = line.trim();
  let cells = 1;
  let pipes = 0;
  for (let at = 0; at < trimmed.length; at++) {
    if (trimmed[at] === "\\") {
      at++;
      continue;
    }
    if (trimmed[at] === "|") {
      pipes++;
      cells++;
    }
  }
  if (pipes === 0) return null;
  if (trimmed.startsWith("|")) cells--;
  if (trimmed.endsWith("|") && trimmed.length > 1 && trimmed[trimmed.length - 2] !== "\\") cells--;
  return cells;
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

/** What a cell boundary weighs against a character: a cell is a parse of its own, with its own events. */
export const TABLE_CELL_WEIGHT = 20;

/** What a character of inline syntax weighs against a plain one. */
export const TABLE_SYNTAX_WEIGHT = 4;

/**
 * What reading the table rows in `text[from, to)` weighs: one per character,
 * `TABLE_CELL_WEIGHT` per `|`, `TABLE_SYNTAX_WEIGHT` per character of inline
 * syntax. Fitted to what the parse holds at its peak (L13, measured
 * 2026-11-12 on the desktop, short rows, wide rows, links and emphasis in
 * every cell, openers without closers): about 0.33 MB per 1 000 of weight,
 * within a factor of 1.5 for every shape; the tree that stays afterwards is
 * a tenth of that for the index and a quarter for the reading view.
 */
export function tableReadCost(text: string, from: number, to: number): number {
  let cost = to - from;
  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === "|") cost += TABLE_CELL_WEIGHT;
    else if (TABLE_SYNTAX.includes(ch)) cost += TABLE_SYNTAX_WEIGHT;
  }
  return cost;
}

/**
 * The most `tableReadCost` a table may have and still be read as a table;
 * over it the whole table is read as written. At the budget the parse holds
 * about 400 MB at its peak on the desktop (the process's resident memory;
 * the live heap is about two thirds of it) and takes one to two seconds: a
 * phone's WebView carries that with room for the rest of the app, and a
 * crash in the index pass would come back at the next start with the same
 * note. In rows: about 12 000 short rows of a link and a word, 8 500 rows of
 * four short cells, 6 000 rows of four cells of words, 2 300 rows with
 * links and emphasis in every cell, 550 rows of 400 unclosed `[` and `*`.
 * Before GFM tables 2.1.2 the rule was rows times length (5 × 10⁸), about
 * 2 500 short rows, for the time a quadratic parse took.
 */
export const TABLE_READ_BUDGET = 1_200_000;

/**
 * The stretches of `text` a parser would spend more than the budget on:
 * paragraphs (runs of lines without a blank line, fenced code and table rows
 * left out), single table rows, and whole tables. In text order, never
 * overlapping; empty for every note a person writes.
 */
export function overBudgetInlineRanges(text: string): BoundedRange[] {
  // Nothing in a text this short can reach either budget.
  if (text.length * text.length <= INLINE_PARSE_BUDGET) return [];
  const ranges: BoundedRange[] = [];
  const lines = splitLines(text);
  let run: { from: number; to: number } | null = null;
  const flush = () => {
    if (run && exceedsInlineParseBudget(text, run.from, run.to)) ranges.push({ ...run });
    run = null;
  };
  // The table being read: where it starts and ends, what it weighs, the rows over the budget.
  let table: { from: number; to: number; cost: number; costly: BoundedRange[] } | null = null;
  const endTable = () => {
    if (!table) return;
    if (table.cost > TABLE_READ_BUDGET) ranges.push({ from: table.from, to: table.to });
    else ranges.push(...table.costly);
    table = null;
  };
  const addRow = (line: Line) => {
    if (!table) return;
    table.to = line.to;
    table.cost += tableReadCost(text, line.from, line.to);
    if (exceedsInlineParseBudget(text, line.from, line.to)) table.costly.push({ from: line.from, to: line.to });
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
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      // A line less indented than an indented fence may have left the list item the fence stood in.
      if (fence.indent > 0 && !isBlank(line.text) && indentOf(line.text) < fence.indent) {
        fence = null;
      } else {
        if (closesFence(line.text, fence)) fence = null;
        continue;
      }
    }
    if (isBlank(line.text)) {
      flush();
      endTable();
      list = null;
      continue;
    }
    const opening = fenceOpening(line.text);
    if (opening) {
      flush();
      endTable();
      list = null;
      fence = opening;
      continue;
    }
    if (table) {
      // A row; a line without a pipe is measured with what follows, whatever a parser makes of it.
      if (!mayStartBlock(line.text) && line.text.includes("|")) {
        addRow(line);
        continue;
      }
      endTable();
    }
    if (!run && !mayStartBlock(line.text) && index + 1 < lines.length) {
      const header = tableCells(line.text);
      const delimiter = delimiterRowCells(lines[index + 1].text);
      if (header !== null && delimiter !== null && header === delimiter) {
        table = { from: line.from, to: line.to, cost: 0, costly: [] };
        list = null;
        addRow(line);
        // The delimiter row holds nothing but `|`, `-`, `:` and blanks.
        index++;
        table.to = lines[index].to;
        continue;
      }
    }
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
      run = { from: line.from, to: line.to };
      flush();
      continue;
    }
    const item = itemStart(content);
    if (item && opensItem(item, depth)) {
      flush();
      list = { depth, content: item.content, orderedIndent: item.ordered ? item.indent : list?.depth === depth ? list.orderedIndent : null };
    }
    if (run) run.to = line.to;
    else run = { from: line.from, to: line.to };
  }
  flush();
  endTable();
  return ranges;
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
