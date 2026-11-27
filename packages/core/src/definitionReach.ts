import type { BoundedRange } from "./inlineParseBudget.ts";

/**
 * Where a reading of a note may read what a definition elsewhere in the note
 * changes — the rule every reader of a note over its budget keeps before it
 * takes a place for a link (`Note_Budget_Readings.md`, "What a definition
 * reaches").
 *
 * A note over its budget is read in parts: the note's tree holds a block read
 * as text as stand-ins, each piece of such a block is parsed alone, each row
 * of a table over its budget alone under its header. A part parsed alone does
 * not see the definitions that stand outside it (`[label]: …`, `[^label]: …`),
 * and what the parser makes of brackets depends on them: `[foo][bar](x.md)` is
 * a reference and the text `(x.md)` where `bar` is defined, a link to `x.md`
 * where not. A reading that wrote or listed what it read there wrote into text
 * the note read whole has no link in (reviews of L14, 2026-11-19 and
 * 2026-11-26, three times over: each pattern of definitions found by hand was
 * closed, and the next review found another).
 *
 * So no reading is handed definitions, and none guesses which there are. It
 * asks of each place instead whether its reading could change under ANY set
 * of defined labels, and gives a place it cannot answer no for as not read:
 * no link of the index there, nothing written there, counted where a rename
 * leaves it, and named by the note's notice. The rule, at the text:
 *
 * 1. A reading is exact where the note holds no `]:` outside the text it
 *    parses: a definition ends its label with `]:`, so without one outside
 *    there is no definition it does not see. Every other reading is open.
 * 2. In an open reading each paragraph, heading and table cell is read from
 *    the left. Code spans, HTML, autolinks and wiki links are read as a whole
 *    by the tokenizer before any bracket, and so is a backslash with what it
 *    escapes: nothing in them counts. Every other `[` opens a bracket.
 * 3. A `]` that ends the text of an inline link the reading made — its opener
 *    the bracket open last, a `(` behind it, the text not beginning with `^` —
 *    is read alike under every definition (the destination is read as written)
 *    and closes that bracket. A `]` with no bracket open is text.
 * 4. Every other `]` asks the parser whether a label is defined. Where it
 *    closes the only bracket open, is not followed by `[`, and is not a `[^…]`
 *    followed by `(`, what it changes is the bracket itself: a reference or
 *    text, and with it what stands inside. That stretch is open, and the
 *    reading goes on behind it as under every other definition. So is it for
 *    `[text][label]` and `[text][]` with a label of plain characters behind
 *    which no `(` or `[` follows.
 * 5. Any other such `]` — behind another bracket still open, or one that may
 *    take the brackets behind it for its label — may change all that follows:
 *    the container is open from its first bracket still open to its end.
 * 6. In a container that asks the parser anything, a tag is read only where
 *    its reading is the same under every definition (`fixedTag`): in a text
 *    whose characters are the note's own, behind a blank, outside what is
 *    open, its name without `_` and ending where the note's name ends. What
 *    the parser makes a reference of moves the edges of the text around it
 *    (`[a]#tag` is a tag beside a reference, none beside text), and emphasis
 *    pairs otherwise across it (`#a_b_`).
 *
 * The rule reads the parser's own tree, before any plugin works on it (a
 * callout's `[!note]` is a reference then, not the HTML the Obsidian plugin
 * makes of it afterwards): `parsedInText` asks it there.
 *
 * `definitionReach.test.ts` checks the rule itself: paragraphs full of
 * brackets, read whole under many sets of defined labels, every place the
 * rule calls fixed read alike in all of them.
 */

interface PlacedNode {
  type: string;
  children?: PlacedNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** Where the parser reads a stretch of inline text on its own. */
const CONTAINERS = new Set(["paragraph", "heading", "tableCell"]);
/** What the tokenizer reads as a whole, from the left, before any bracket. */
const WHOLE = new Set(["inlineCode", "html", "wikiLink", "inlineMath"]);

/** The longest label the parser reads (`[label]`, CommonMark: 999 characters). */
const LABEL_MOST = 999;

/** What the reading of one note's places found: open stretches, and which containers give no tags. */
export interface DefinitionReach {
  /** In text order, apart: where a link, a wiki link or a rename is not taken. */
  open: BoundedRange[];
  /** The containers (by their stretch) that ask the parser for a label: only fixed tags from them (`fixedTag`). */
  untagged: BoundedRange[];
}

/**
 * The marks of the texts asked last, the latest first. Two: a reading asks of
 * the note and of each row or piece it reads in turn, and one entry gave each
 * row's question the note's place, so that every row searched the whole note
 * again — 30 000 rows of a table with wiki links took 40 s where they took 4 s
 * (review of L14, round four).
 */
const lastMarks: Array<{ text: string; marks: number[] }> = [];

/** Every `]:` of `text`, by its place: where a definition may end its label. */
export function definitionMarks(text: string): number[] {
  for (let k = 0; k < lastMarks.length; k++) {
    if (lastMarks[k].text !== text) continue;
    const [hit] = lastMarks.splice(k, 1);
    lastMarks.unshift(hit);
    return hit.marks;
  }
  const marks: number[] = [];
  for (let at = text.indexOf("]:"); at >= 0; at = text.indexOf("]:", at + 2)) marks.push(at);
  lastMarks.unshift({ text, marks });
  if (lastMarks.length > 2) lastMarks.pop();
  return marks;
}

/** Whether `text` holds a `]:` before `from` or from `to` on: a definition the reading of `text[from, to)` does not see. */
export function definitionsOutside(text: string, from: number, to: number): boolean {
  const marks = definitionMarks(text);
  return marks.length > 0 && (marks[0] < from || marks[marks.length - 1] >= to);
}

/** Whether `text` holds a `]:` in one of `ranges` (in text order): a definition a reading without them does not see. */
export function definitionsWithin(text: string, ranges: readonly BoundedRange[]): boolean {
  const marks = definitionMarks(text);
  let k = 0;
  for (const range of ranges) {
    while (k < marks.length && marks[k] < range.from) k++;
    if (k < marks.length && marks[k] < range.to) return true;
  }
  return false;
}

/**
 * The places of `tree` (positions in `text`) a definition outside it may
 * change, by the rule above. `skip` holds stretches whose containers are not
 * the reading's own (blocks read as text stand in there): they are not read.
 */
export function definitionReach(text: string, tree: unknown, skip: readonly BoundedRange[] = []): DefinitionReach {
  const reach: DefinitionReach = { open: [], untagged: [] };
  const visit = (node: PlacedNode): void => {
    if (CONTAINERS.has(node.type)) {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (typeof from === "number" && typeof to === "number" && !skip.some((range) => range.from <= from && from < range.to)) readContainer(text, node, from, to, reach);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree as PlacedNode);
  reach.open.sort((a, b) => a.from - b.from);
  reach.untagged.sort((a, b) => a.from - b.from);
  return reach;
}

function readContainer(text: string, container: PlacedNode, from: number, to: number, reach: DefinitionReach): void {
  const close = text.indexOf("]", from);
  if (close < 0 || close >= to) return;
  // What is read as a whole, and where the inline links the reading made begin and end.
  const whole: Array<[number, number]> = [];
  const links = new Map<number, number>();
  const collect = (node: PlacedNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      if (WHOLE.has(node.type)) {
        whole.push([start, end]);
        return;
      }
      if (node.type === "link") {
        // An autolink (`<…>`, a bare address) is read as a whole; an inline link by its brackets.
        if (text.charCodeAt(start) !== 0x5b) {
          whole.push([start, end]);
          return;
        }
        if (text.charCodeAt(start + 1) !== 0x5e) links.set(start, end);
      }
    }
    for (const child of node.children ?? []) collect(child);
  };
  for (const child of container.children ?? []) collect(child);
  whole.sort((a, b) => a[0] - b[0]);
  // The brackets open: where each opens (its `[`), and where its stretch begins (an image's `!`).
  const open: Array<{ at: number; start: number }> = [];
  let asked = false;
  let next = 0;
  for (let i = from; i < to; i++) {
    while (next < whole.length && whole[next][1] <= i) next++;
    if (next < whole.length && whole[next][0] <= i) {
      i = whole[next][1] - 1;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code === 0x5c) {
      i++;
      continue;
    }
    if (code === 0x5b) {
      open.push({ at: i, start: i > from && text.charCodeAt(i - 1) === 0x21 ? i - 1 : i });
      continue;
    }
    if (code !== 0x5d || open.length === 0) continue;
    const opener = open[open.length - 1];
    const after = text.charCodeAt(i + 1);
    const link = links.get(opener.at);
    if (link !== undefined && after === 0x28 && i < link) {
      // The end of an inline link's text: read alike under every definition; its destination is read as written.
      open.pop();
      i = link - 1;
      continue;
    }
    asked = true;
    const caret = text.charCodeAt(opener.at + 1) === 0x5e;
    let end = i + 1;
    let contained = open.length === 1 && !(caret && after === 0x28);
    if (contained && after === 0x5b) {
      // `[text][label]`: contained where the label is plain characters and nothing that reads on behind it follows.
      const label = plainLabelEnd(text, i + 2, to);
      const behind = label < 0 ? -1 : text.charCodeAt(label + 1);
      contained = label >= 0 && behind !== 0x28 && behind !== 0x5b;
      if (contained) end = label + 1;
    }
    if (!contained) {
      reach.open.push({ from: open[0].start, to });
      reach.untagged.push({ from, to });
      return;
    }
    reach.open.push({ from: opener.start, to: end });
    open.pop();
    i = end - 1;
  }
  if (asked) reach.untagged.push({ from, to });
}

/** Where a label of plain characters (or none, `[]`) that begins at `from` ends (its `]`), or -1: no bracket, backslash, backtick or `<` in it. */
function plainLabelEnd(text: string, from: number, to: number): number {
  for (let i = from; i < to && i - from <= LABEL_MOST; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5d) return i;
    if (code === 0x5b || code === 0x5c || code === 0x60 || code === 0x3c) return -1;
  }
  return -1;
}

/** What a tag's name is made of (`tagRule.ts`): letters, digits, `_`, `/`, `-`. */
const TAG_NAME = /[\p{L}\p{N}_/-]/u;

/**
 * Whether the tag at `from`..`to` of a text node's `value`, the node starting at `start` in `text`, reads alike under
 * every set of definitions (rule 6): the node holds the note's own characters up to the tag's end, a blank stands in front of the
 * `#` in the note, nothing of the tag is open, its name holds no `_` and ends where the note's name ends.
 */
export function fixedTag(text: string, start: number | undefined, value: string, from: number, to: number, open: readonly BoundedRange[]): boolean {
  // The node's characters up to the tag's end are the note's own: its places are the note's there.
  if (typeof start !== "number" || text.slice(start, start + to) !== value.slice(0, to)) return false;
  const at = start + from;
  const end = start + to;
  if (at === 0 || !/\s/.test(text[at - 1])) return false;
  if (open.some((range) => range.from < end && range.to > at)) return false;
  const name = value.slice(from + 1, to);
  return !name.includes("_") && !(end < text.length && TAG_NAME.test(text[end]));
}
