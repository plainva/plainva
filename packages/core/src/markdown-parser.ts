import { markdownAstSchema, type MarkdownAst } from "./markdown-ast.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkObsidianPreserve from "./remark-obsidian-preserve.ts";
import { remarkWikiLinks } from "./wikiLinkSyntax.ts";
import { unified, type Processor } from "unified";
import { normalizeIdentifier } from "micromark-util-normalize-identifier";
import { frontmatterSpan, opensUnclosedProperties } from "./frontmatter-block.ts";
import { boundMarkdownForParse, COMMONMARK_READING, forEachHeadingLine, mayBeginDefinition, NOTE_READING, onlyBlanksBetween, pieceLimit, pieceWeight, readAsTextParts, restoreBoundedTree, type BoundedMarkdown, type BoundedRange, type MarkdownReading, type ReadAsTextParts, type ReadPiece } from "./inlineParseBudget.ts";

export type ParseMarkdownAstOptions = {
  preserveObsidianSyntax?: boolean;
  /**
   * What the parse budget weighs (`inlineParseBudget.ts`): a note's reading
   * unless given. The calibration of the note's budget reads with the note's
   * budget off (`notes: false`) — the parse as it was before L14.
   */
  reading?: MarkdownReading;
};

/**
 * A note's Markdown: tables, task lists, the properties block — and wiki
 * links. `[[Note]]` and `![[Note]]` are read by the tokenizer, where a code
 * span is read, and reach the tree as nodes of their own (`wikiLinkSyntax.ts`).
 */
const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks);

/** The same, with a callout's marker (`[!info]`) kept as it is written for the serializer. */
const obsidianPreservingMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkWikiLinks)
  .use(remarkObsidianPreserve);

/** CommonMark alone: no tables, no bare addresses turned into links, no properties block, no wiki links. */
const commonMarkParser = unified().use(remarkParse);

/**
 * The reading view's parse without its formulas: GFM, no properties block, no
 * wiki links — the text it is handed has Markdown links for them.
 */
const readerTextParser = unified().use(remarkParse).use(remarkGfm);

/** The same, reading every backtick as the sign it is. */
const readerTextParserWithoutCodeSpans = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(function withoutCodeSpans(this: Processor) {
    const data = this.data() as unknown as { micromarkExtensions?: unknown[] };
    (data.micromarkExtensions ??= []).push({ disable: { null: ["codeText"] } });
  });

const BYTE_ORDER_MARK = 0xfeff;

/** A place in a text: `offset` counts UTF-16 units from its start, `line` and `column` are 1-based. */
export interface MarkdownTreePoint {
  line: number;
  column: number;
  offset: number;
}

/** A parsed node as a reader of PLACES sees it: what it is, and where it stands in the text. */
export interface MarkdownTreeNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  /** On a wiki link (`type: "wikiLink"`): written with a `!` in front. */
  embed?: boolean;
  children?: MarkdownTreeNode[];
  position?: { start: MarkdownTreePoint; end: MarkdownTreePoint };
}

/** What of a parsed node carries a place: its own position, and its children. */
interface PlacedNode {
  position?: { start?: Partial<MarkdownTreePoint>; end?: Partial<MarkdownTreePoint> };
  children?: PlacedNode[];
}

/**
 * Runs a Markdown parser over `text` and counts every place of its tree IN
 * `text` — the one way Markdown is parsed in this code.
 *
 * The parser skips a byte order mark at the start of what it is given and
 * counts from behind it: for a text that begins with one, each of its offsets
 * is one short of the place it means, and so is each column of the first
 * line. A reader that laid those offsets on the text again began every block
 * one character early — for a block at the start of a line, on the line above
 * it. In a note that starts with a mark the journal read no entry and refused
 * to write one, an outline led one line above each heading, an embedded
 * section began in front of its heading, the reading view kept the last `-`
 * of the properties block, and the import from Joplin left a link definition
 * unresolved (finding 2026-10-09). A file's text is its bytes decoded WITH
 * the mark (`textFileShape.ts`), so every reader of a file meets it.
 *
 * So the places are counted from the start of the text they belong to: the
 * one character the parser skipped is added back. Whoever takes a place from
 * a tree made here can lay it on the text it handed in; nobody has to
 * remember the mark, so nobody can forget it. Lines are not touched: a mark
 * stands in the first line and adds none.
 *
 * The parser skips ONE mark, and one is what is added back. A second one
 * behind it is a character of the text, as it is for an editor, which holds a
 * file without its first mark only: it is parsed as such and stands at its
 * place. (Cutting the mark off before the parse would hand the parser that
 * second one to skip.)
 */
function parsedInText<Tree>(parse: (text: string) => Tree, text: string, reading: MarkdownReading = NOTE_READING, rowLinks = false): Tree {
  // What is no text is the parser's to answer for, as it always was.
  if (typeof text !== "string") return parse(text);
  // A stretch whose inline syntax would cost the parser more than the budget
  // is read as written (`inlineParseBudget.ts`); every place stays where it is.
  const bounded = boundMarkdownForParse(text, reading);
  // The definitions that stand in blocks read as text, which the parse of the rest would not see (`noteDefinitions`).
  const given = bounded.ranges.some((range) => range.block) ? givenDefinitions(text, bounded, readAsTextDefinitions(text, reading), reading) : null;
  const bom = text.charCodeAt(0) === BYTE_ORDER_MARK;
  const tree = parse(given ? bounded.text.slice(0, given.at) + given.lines + bounded.text.slice(given.at) : bounded.text);
  if (given) withdrawGiven(tree as unknown as PlacedNode, given, bom ? 1 : 0);
  if (!bom) {
    restoreBoundedTree(tree, bounded);
    if (rowLinks) readRowLinks(tree as unknown as LinkNode, text, bounded.ranges, parse, reading, noteDefinitions(text, tree, reading));
    return tree;
  }
  // A point two nodes shared would otherwise be moved twice.
  const moved = new WeakSet<object>();
  const move = (point: Partial<MarkdownTreePoint> | undefined): void => {
    if (!point || moved.has(point)) return;
    moved.add(point);
    if (typeof point.offset === "number") point.offset += 1;
    if (point.line === 1 && typeof point.column === "number") point.column += 1;
  };
  const walk = (node: PlacedNode): void => {
    move(node.position?.start);
    move(node.position?.end);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree as unknown as PlacedNode);
  restoreBoundedTree(tree, bounded);
  if (rowLinks) readRowLinks(tree as unknown as LinkNode, text, bounded.ranges, parse, reading, noteDefinitions(text, tree, reading));
  return tree;
}

/**
 * The definitions of blocks read as text that the rest of the note refers to,
 * as lines the parse of the note is given behind its properties block: a
 * reference `[x][label]` reads as one where the label is defined anywhere in
 * the note, and the parse of the note sees a block read as text as one
 * paragraph of stand-ins. Without them `[foo][bar](x.md)` read as a link to
 * `x.md` where the note read whole reads a reference and the text `(x.md)`,
 * and a rename wrote into that text (review of L14, 2026-11-26). A definition
 * names nothing to the index; a given line only makes its label defined.
 */
interface GivenDefinitions {
  /** Where they stand in the text handed to the parser: behind the properties block, or behind the `---` of an unclosed one. */
  at: number;
  lines: string;
  /** How many lines they take. */
  count: number;
}

function givenDefinitions(text: string, bounded: BoundedMarkdown, definitions: ReadonlyMap<string, NoteDefinition>, reading: MarkdownReading): GivenDefinitions | null {
  if (definitions.size === 0) return null;
  // The labels the text outside the blocks read as text refers to: inside them every character stands in.
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const match of bounded.text.matchAll(BRACKETED)) {
    for (const key of keysOf(match[1])) {
      if (seen.has(key) || !definitions.has(key)) continue;
      seen.add(key);
      wanted.push(definitions.get(key)!.line);
    }
  }
  if (wanted.length === 0) return null;
  const bom = text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  let at = bom;
  if (reading.properties) {
    const span = frontmatterSpan(text);
    // Behind an unclosed `---` the parser opens no blocks within blocks; a definition behind its line keeps it so.
    if (span) at = span.end;
    else if (opensUnclosedProperties(text)) at = text.indexOf("\n", bom) + 1;
  }
  if (at > 0 && text.charCodeAt(at - 1) !== 0x0a) return null;
  const lines = `${wanted.join("\n\n")}\n\n`;
  return { at, lines, count: 2 * wanted.length };
}

/** The tree without the given definitions: their nodes gone, every place behind them moved back onto the text. */
function withdrawGiven(tree: PlacedNode, given: GivenDefinitions, skipped: number): void {
  // The parser counts its places from behind a byte order mark it skipped.
  const from = given.at - skipped;
  const to = from + given.lines.length;
  tree.children = (tree.children ?? []).filter((child) => {
    const at = child.position?.start?.offset;
    return typeof at !== "number" || at < from || at >= to;
  });
  const moved = new WeakSet<object>();
  const move = (point: Partial<MarkdownTreePoint> | undefined): void => {
    if (!point || moved.has(point) || typeof point.offset !== "number" || point.offset < to) return;
    moved.add(point);
    point.offset -= given.lines.length;
    if (typeof point.line === "number") point.line -= given.count;
  };
  const walk = (node: PlacedNode): void => {
    move(node.position?.start);
    move(node.position?.end);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
}

/**
 * The definitions the reading view's parse is given in front of the text it
 * shows (`boundReaderMarkdown`): those of the original's blocks read as text
 * and parts not read that the shown text outside them refers to, each with
 * its destination and title, so that a reference reads and leads as in the
 * note read whole. `shown` is the text handed to the reading view's parser,
 * its blocks read as text standing in. Null where there are none.
 */
export function readerGivenDefinitions(original: string, shown: string): { lines: string; count: number } | null {
  const definitions = readAsTextDefinitions(original, NOTE_READING);
  if (definitions.size === 0) return null;
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const match of shown.matchAll(BRACKETED)) {
    for (const key of keysOf(match[1])) {
      if (seen.has(key) || !definitions.has(key)) continue;
      seen.add(key);
      wanted.push(definitions.get(key)!.shown);
    }
  }
  return wanted.length > 0 ? { lines: `${wanted.join("\n\n")}\n\n`, count: 2 * wanted.length } : null;
}

/** The reading view's tree without the definitions it was given in front of its text (`readerGivenDefinitions`). */
export function withdrawReaderDefinitions(tree: unknown, given: { lines: string; count: number }): void {
  withdrawGiven(tree as PlacedNode, { at: 0, lines: given.lines, count: given.count }, 0);
}

/** Every definition of the note by key: those of its tree, and those of what is read as text (`readAsTextDefinitions`). */
function noteDefinitions(text: string, tree: unknown, reading: MarkdownReading): Map<string, NoteDefinition> {
  const definitions = new Map<string, NoteDefinition>(readAsTextDefinitions(text, reading));
  definitionsOf(tree as PieceNode, definitions);
  return definitions;
}

/** What the index and a rename read of a line: wiki and Markdown links, images, and their references. */
const LINK_TYPES = new Set(["wikiLink", "link", "image", "linkReference", "imageReference"]);

interface LinkNode {
  type: string;
  children?: LinkNode[];
  position?: { start: MarkdownTreePoint; end: MarkdownTreePoint };
}

/**
 * A table over the parse budget is text for the reading view, but its links
 * are the note's links (review, 2026-11-17): without them a backlink and the
 * graph lose them, and a rename of the note they lead to leaves them behind.
 * So for the index and a rename each row of such a table is read on its own,
 * under the table's own header and delimiter row — the reader of every other
 * table, one row at a time — and of each row only its links are kept. They
 * join the node the table stands in as text, at their places in `text`.
 * A block over the note's budget is read in pieces by the readers of its
 * facts (`forEachReadPiece`), its tables with it; a paragraph over the inline
 * budget is not read for its links, as before, and the note's notice says so.
 */
function readRowLinks<Tree>(tree: LinkNode, text: string, ranges: readonly BoundedRange[], parse: (text: string) => Tree, reading: MarkdownReading, definitions: ReadonlyMap<string, NoteDefinition>): void {
  let counted = 0;
  let line = 1;
  // The line of `at`, counted on from the last one asked: the ranges come in the order of the text.
  const lineOf = (at: number): number => {
    for (let i = text.indexOf("\n", counted); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) line++;
    counted = Math.max(counted, at);
    return line;
  };
  const endOf = (at: number): number => {
    const end = text.indexOf("\n", at);
    return end < 0 ? text.length : end;
  };
  for (const range of tablesWhole(text, ranges)) {
    // A block read as text is read in pieces by the readers of its facts (`forEachReadPiece`), its tables with it.
    if (!range.table || range.block) continue;
    const headStart = text.lastIndexOf("\n", range.from - 1) + 1;
    const headEnd = endOf(headStart);
    if (headEnd + 1 >= range.to) continue;
    const head = text.slice(headStart, headEnd);
    const delimiter = text.slice(headEnd + 1, endOf(headEnd + 1));
    const found: LinkNode[] = [];
    // One row in its table: what of it the parser makes a link, moved to the row's place in `text`.
    const take = (row: string, rowStart: number, rowLine: number, alone: boolean) => {
      // With the definitions it refers to behind it, as a piece is read: its references read as in the note.
      const mini = (alone ? `${head}\n${delimiter}` : `${head}\n${delimiter}\n${row}`) + appendixFor(row, definitions);
      const at = alone ? 0 : head.length + delimiter.length + 2;
      const miniLine = alone ? 1 : 3;
      const parsed = parsedInText(parse, mini, reading) as unknown as LinkNode;
      const shift = (node: LinkNode) => {
        for (const point of [node.position?.start, node.position?.end]) {
          if (!point) continue;
          point.offset += rowStart - at;
          point.line += rowLine - miniLine;
        }
        for (const child of node.children ?? []) shift(child);
      };
      const open = [parsed];
      for (let node = open.pop(); node; node = open.pop()) {
        const from = node.position?.start.offset;
        if (LINK_TYPES.has(node.type) && from !== undefined && from >= at && from < at + row.length) {
          shift(node);
          found.push(node);
          continue;
        }
        for (const child of node.children ?? []) open.push(child);
      }
    };
    const headLine = lineOf(headStart);
    take(head, headStart, headLine, true);
    let rowLine = headLine + 1;
    for (let rowStart = endOf(headEnd + 1) + 1; rowStart < range.to && rowStart <= text.length; ) {
      const rowEnd = endOf(rowStart);
      take(text.slice(rowStart, rowEnd), rowStart, ++rowLine, false);
      rowStart = rowEnd + 1;
    }
    if (found.length === 0) continue;
    found.sort((a, b) => (a.position?.start.offset ?? 0) - (b.position?.start.offset ?? 0));
    joinLinks(tree, range, found);
  }
}

/**
 * The ranges with the rows of one table as one range: the scan reads the rows
 * of a table in a quote or a list each behind its markers, which stay as they
 * are (`inlineParseBudget.ts`), and the rows of a table are read under its
 * header (`readRowLinks`).
 */
function tablesWhole(text: string, ranges: readonly BoundedRange[]): BoundedRange[] {
  const whole: BoundedRange[] = [];
  for (const range of ranges) {
    const previous = whole[whole.length - 1];
    if (previous?.table && range.table && !range.block && !previous.block && previous.to <= range.from && /^\r?\n[ \t>]*$/.test(text.slice(previous.to, range.from))) previous.to = range.to;
    else whole.push({ ...range });
  }
  return whole;
}

/**
 * Each link of `found` joins the node its place stands in: the deepest one
 * with children around its first character — the paragraph a stretch read as
 * text became, which may stand in a list item or a quote whose markers the
 * stretch kept. Found by halving the children at each level, so that a note
 * of many blocks is not walked once a link.
 */
function joinLinks(tree: LinkNode, range: BoundedRange, found: LinkNode[]): void {
  const holderAt = (at: number): LinkNode => {
    let holder = tree;
    for (;;) {
      const children = holder.children ?? [];
      let lo = 0;
      let hi = children.length - 1;
      let next: LinkNode | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const from = children[mid].position?.start.offset ?? 0;
        const to = children[mid].position?.end.offset ?? 0;
        if (to <= at) lo = mid + 1;
        else if (from > at) hi = mid - 1;
        else {
          next = children[mid];
          break;
        }
      }
      if (!next?.children || LINK_TYPES.has(next.type)) return holder;
      holder = next;
    }
  };
  const holders = new Map<LinkNode, LinkNode[]>();
  for (const link of found) {
    const holder = holderAt(link.position?.start.offset ?? range.from);
    const list = holders.get(holder);
    if (list) list.push(link);
    else holders.set(holder, [link]);
  }
  for (const [holder, links] of holders) {
    // What the parse of a table as text made a link (an autolink literal: a URL, an e-mail address)
    // is a link the rows give again: it gives up its place to its text, so that no link counts twice
    // (review, 2026-11-18: each URL of such a table stood in the index twice).
    unwrapLinksIn(holder, range.from, range.to);
    holder.children = [...(holder.children ?? []), ...links];
  }
}

/** Each link under `node` that starts in `from`..`to` replaced by its children (an image, which has none, goes). */
function unwrapLinksIn(node: LinkNode, from: number, to: number): void {
  if (!node.children) return;
  const kept: LinkNode[] = [];
  for (const child of node.children) {
    const at = child.position?.start.offset;
    if (LINK_TYPES.has(child.type) && at !== undefined && at >= from && at < to) {
      unwrapLinksIn(child, from, to);
      kept.push(...(child.children ?? []));
      continue;
    }
    unwrapLinksIn(child, from, to);
    kept.push(child);
  }
  node.children = kept;
}

export function parseMarkdownAst(
  markdown: string,
  options: ParseMarkdownAstOptions = {}
): MarkdownAst {
  const processor = options.preserveObsidianSyntax
    ? obsidianPreservingMarkdownParser
    : markdownParser;
  // With the links of a table over the budget, read row by row (`readRowLinks`): the index and a rename read them.
  const tree = parsedInText((text) => processor.parse(text), markdown, options.reading ?? NOTE_READING, true);
  const transformedTree = options.preserveObsidianSyntax ? processor.runSync(tree) : tree;

  return markdownAstSchema.parse(transformedTree);
}

/**
 * The tree of a note for a reader of places: tables, task lists, the
 * properties block and wiki links as `parseMarkdownAst` reads them, without
 * the check of the tree's shape that function runs. Every position is a place
 * in `text`.
 */
export function parseMarkdownTree(text: string, reading: MarkdownReading = NOTE_READING): MarkdownTreeNode {
  return parsedInText((source) => markdownParser.parse(source), text, reading) as unknown as MarkdownTreeNode;
}

/**
 * The tree of a text that is CommonMark and nothing more — what another
 * program wrote before it was a note here; `[[` opens no wiki link in it.
 * Every position is a place in `text`.
 */
export function parseCommonMarkTree(text: string): MarkdownTreeNode {
  // Weighed for CommonMark: its tables are paragraphs, and the measure of a paragraph must see their lines.
  return parsedInText((source) => commonMarkParser.parse(source), text, COMMONMARK_READING) as unknown as MarkdownTreeNode;
}

/**
 * A stretch of the text the reading view is handed, read as that view reads
 * it without its formula plugin (`remarkFormulasYieldToLinks`): what stands
 * between dollar signs once they open no formula. `codeSpans: false` reads
 * every backtick as itself. Every position is a place in `text`.
 */
export function parseReaderTextTree(text: string, options: { codeSpans?: boolean } = {}): MarkdownTreeNode {
  const parser = options.codeSpans === false ? readerTextParserWithoutCodeSpans : readerTextParser;
  return parsedInText((source) => parser.parse(source), text) as unknown as MarkdownTreeNode;
}

/** How a piece of a block read as text is read (`forEachReadPiece`): no properties block (it is not the note's start), no note's budget (it is within a piece's share). */
const PIECE_READING: MarkdownReading = { tables: true, properties: false, notes: false };

/**
 * What a piece is read behind, and with which reading: a blank line, so that
 * no properties block opens there — or, in a note that begins with a `---`
 * nothing closes, a `---` of its own and the properties block's reading, so
 * that the parser reads it in the mode it reads the note in (no blocks within
 * blocks; the note has no line that would close it).
 */
function pieceLead(parts: ReadAsTextParts): { lead: string; reading: MarkdownReading } {
  return parts.behindUnclosedProperties ? { lead: "---\n\n", reading: { ...PIECE_READING, properties: true } } : { lead: "\n", reading: PIECE_READING };
}

interface PieceNode {
  type: string;
  label?: string;
  identifier?: string;
  children?: PieceNode[];
  position?: { start?: Partial<MarkdownTreePoint>; end?: Partial<MarkdownTreePoint> };
}

/**
 * A label as the parser matches it: micromark's own `normalizeIdentifier` over
 * the label as written, escapes and all, lower case — mdast's `identifier`.
 * (`ß` is `SS` there, and `[b\\]c]` the label `b\\]c`: a fold of its own
 * or the label with its escapes read gave a piece no definition the note had,
 * review of L14, 2026-11-26.)
 */
const labelKey = (label: string): string => normalizeIdentifier(label).toLowerCase();

/** The keys a label in brackets may be defined under: a link's, and with a leading `^` a footnote's. */
function keysOf(label: string): string[] {
  return label.startsWith("^") ? [`^${labelKey(label.slice(1))}`, labelKey(label)] : [labelKey(label)];
}

/** A definition of the note, by its key: a line that defines its label and names nothing (`#`, `.`), and where the note has it. */
interface NoteDefinition {
  line: string;
  at: number;
  /** The line for the reading view: a link's own destination and title, so that its reference leads where it leads. */
  shown: string;
}

/** `[label]: <dest> "title"` for the reading view, the destination and the title as the parser gave them. */
function shownDefinition(node: PieceNode & { url?: string; title?: string | null }): string {
  const url = (node.url ?? "").replace(/[<>\n\r]/g, (ch) => encodeURIComponent(ch));
  const title = node.title ? ` "${node.title.replace(/["\\]/g, "\\$&").replace(/[\n\r]+/g, " ")}"` : "";
  return `[${node.identifier}]: <${url}>${title}`;
}

/**
 * The definitions in `tree` — link reference definitions and footnote
 * definitions, which are the note's wherever they stand — by key, each as a
 * line that defines it; the first one in the note wins, as in the parser.
 * `shift` lays a place of the tree onto the note; `within` keeps those that
 * stand there.
 */
function definitionsOf(tree: PieceNode, into: Map<string, NoteDefinition>, shift = 0, within?: { from: number; to: number }): void {
  const visit = (node: PieceNode): void => {
    if ((node.type === "definition" || node.type === "footnoteDefinition") && node.identifier) {
      const start = node.position?.start?.offset ?? -1;
      if (!within || (start >= within.from && start < within.to)) {
        const key = node.type === "definition" ? node.identifier : `^${node.identifier}`;
        const at = start + shift;
        const known = into.get(key);
        if (!known || at < known.at) {
          const line = node.type === "definition" ? `[${node.identifier}]: #` : `[^${node.identifier}]: .`;
          into.set(key, { line, at, shown: node.type === "definition" ? shownDefinition(node) : line });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

/** What may be a label in brackets — `[text]`, `[^note]` —: which definitions a piece is given, nothing more. */
const BRACKETED = /\[((?:[^[\]\\]|\\.){1,999})\]/g;

/**
 * Labels in brackets side by side that run into a `(`: `[t][l](x)`,
 * `[l][](x)`, `![a][l](x)`, `[^n](x)`. Only there does a definition change
 * what the index and a rename read of the brackets — defined, a reference and
 * the text `(x)`; not, a link to `x` —: anywhere else a label without its
 * definition is text, and a reference is no link. Read for them, a piece is
 * given the definitions of these labels alone. Read for the note's source, also
 * those of the labels on a line that may be a heading's content
 * (`forEachHeadingLine`): the text of a heading is a reference's text where its
 * label is defined (a setext heading `[use [[R]]][ref]` reads "use [[R]]").
 * The note's budget weighs a piece with as many (`pieceWeight`).
 */
function labelsRunningIntoLink(piece: string): string[] {
  const labels: string[] = [];
  const escaped = (at: number): boolean => {
    let backslashes = 0;
    while (at - 1 - backslashes >= 0 && piece.charCodeAt(at - 1 - backslashes) === 0x5c) backslashes++;
    return backslashes % 2 === 1;
  };
  // From each `](` back over the groups of brackets side by side: each group is read once, in one run.
  for (let at = piece.indexOf("]("); at >= 0; at = piece.indexOf("](", at + 2)) {
    let close = at;
    while (close >= 0 && piece.charCodeAt(close) === 0x5d && !escaped(close)) {
      let open = close - 1;
      while (open >= 0 && close - open <= 1000) {
        const code = piece.charCodeAt(open);
        if ((code === 0x5b || code === 0x5d) && !escaped(open)) break;
        open--;
      }
      if (open < 0 || piece.charCodeAt(open) !== 0x5b || close - open > 1000) break;
      if (close - open > 1) labels.push(piece.slice(open + 1, close));
      close = open - 1;
    }
  }
  return labels;
}

/**
 * The lines of `definitions` a piece may refer to: those whose label stands in
 * brackets in it that run into a `(` (`labelsRunningIntoLink`). A label it does not
 * hold cannot be one of its references; one it holds and does not refer to is
 * given and changes nothing. Every definition behind every piece made a note
 * of 5 000 footnotes quadratic; every label in brackets, 100 paragraphs that
 * refer to the same 2 000 definitions.
 */
function appendixFor(piece: string, definitions: ReadonlyMap<string, NoteDefinition>, from = -1, headings = false): string {
  if (definitions.size === 0) return "";
  // A definition that stands in the piece itself is read there: behind it again, a piece of 2 000 definitions was read
  // with 4 000, and ran the index out of 128 MB (review of L14, 2026-11-26, the hunt's note `gen:936455:27`).
  const to = from + piece.length;
  const lines: string[] = [];
  const seen = new Set<string>();
  const labels = labelsRunningIntoLink(piece);
  if (headings) forEachHeadingLine(piece, 0, piece.length, (lineFrom, lineTo) => {
    for (const match of piece.slice(lineFrom, lineTo).matchAll(BRACKETED)) labels.push(match[1]);
  });
  for (const label of labels) {
    for (const key of keysOf(label)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const definition = definitions.get(key);
      if (definition && !(from <= definition.at && definition.at < to)) lines.push(definition.line);
    }
  }
  // A blank line between them: behind a footnote's definition the next line would be its text.
  return lines.length > 0 ? `\n\n${lines.join("\n\n")}\n` : "";
}

/** How many lines of a stretch read as text, around one that may hold a definition, are read with it for it (`readAsTextDefinitions`). */
const DEFINITION_WINDOW_LINES = 400;
/** The longest line of a part not read that is read for a definition: a label of 999 characters, a long address, a title. */
const DEFINITION_LINE_MOST = 4_096;

/**
 * The definitions that stand in what the note's budget reads as text, by key
 * (`definitionsOf`), read by the parser itself. In a block read in pieces,
 * each piece that holds `]:` is read for them. Where a stretch is not read in
 * pieces (`ReadAsTextParts.unread`), each line that holds `]:` is read with
 * the line before and after it: a definition spans at most these as people
 * write them, and a line read so as a definition that the note read whole
 * would not take for one (in a fence, inside a paragraph) only makes its
 * label defined — a reference `[x][label]` then reads as one, and no link
 * is made of it that the note does not have.
 */
function readAsTextDefinitions(text: string, reading: MarkdownReading): Map<string, NoteDefinition> {
  const key = `${reading.tables} ${reading.properties} ${reading.notes}`;
  if (lastDefinitions && lastDefinitions.text === text && lastDefinitions.key === key) return lastDefinitions.definitions;
  const parts = readAsTextParts(text, reading);
  const definitions = new Map<string, NoteDefinition>();
  const { lead, reading: pieceReading } = pieceLead(parts);
  const readFor = (from: number, to: number) => {
    const tree = parseMarkdownTree(`${lead}${text.slice(from, to)}`, pieceReading) as unknown as PieceNode;
    definitionsOf(tree, definitions, from - lead.length, { from: lead.length, to: lead.length + to - from });
  };
  let marker = -1;
  for (const piece of parts.pieces) {
    if (marker < piece.from) marker = text.indexOf("]:", piece.from);
    if (marker < 0) break;
    if (marker < piece.to) readFor(piece.from, piece.to);
  }
  const blocks = parts.ranges.filter((range) => range.block);
  for (const stretch of parts.unread) {
    if (!blocks.some((block) => block.from <= stretch.from && stretch.from < block.to)) continue;
    // The starts of the stretch's lines; each line that holds `]:` is read with its neighbours, runs of them together.
    const starts: number[] = [];
    for (let at = stretch.from; at < stretch.to; ) {
      starts.push(at);
      const next = text.indexOf("\n", at);
      at = next < 0 || next >= stretch.to ? stretch.to : next + 1;
    }
    starts.push(stretch.to);
    let window: [number, number] | null = null;
    const flush = () => {
      if (window) readFor(starts[window[0]], starts[window[1] + 1]);
      window = null;
    };
    // A line read for its definitions is short: a part is not read because the parser may not read it, and a window
    // around a definition beside a paragraph of megabytes ran the index out of 128 MB (review of L14, 2026-11-26, the
    // hunt's note `gen:382803:4`). A definition on a longer line is not seen there.
    const short = (line: number) => starts[line + 1] - starts[line] <= DEFINITION_LINE_MOST;
    const opens = (line: number) => short(line) && mayBeginDefinition(text, starts[line], starts[line + 1] - 1);
    for (let k = 0; k + 1 < starts.length; k++) {
      const from = starts[k];
      const marker = text.indexOf("]:", from);
      if (marker < 0) break;
      if (marker >= starts[k + 1]) {
        // No `]:` in this line: jump to the line that holds the next one.
        let line = k + 1;
        while (line + 1 < starts.length && starts[line + 1] <= marker) line++;
        if (line > k + 1) k = line - 1;
        continue;
      }
      // Where a definition may begin: this line, or the line before (a label over two lines).
      const first = opens(k) ? k : k > 0 && opens(k - 1) ? k - 1 : -1;
      if (first < 0) continue;
      // With the short lines behind it that may hold its title.
      let last = first;
      while (last < first + 2 && last + 1 < starts.length - 1 && short(last + 1)) last++;
      const open = window as [number, number] | null;
      if (open && first <= open[1] + 1 && last - open[0] < DEFINITION_WINDOW_LINES) open[1] = Math.max(open[1], last);
      else {
        flush();
        window = [first, last];
      }
    }
    flush();
  }
  lastDefinitions = { text, key, definitions };
  return definitions;
}

/** The last note `readAsTextDefinitions` read: the parse of a note and the reading of its facts ask for the same one. */
let lastDefinitions: { text: string; key: string; definitions: Map<string, NoteDefinition> } | null = null;

/** How many lines of appendix a piece may carry before the pieces beside it are read with it (`withSharedAppendix`). */
const SHARED_APPENDIX_LINES = 64;

/**
 * The pieces as they are read: pieces that stand side by side — only blank
 * lines between them — and carry a long appendix are read as one, up to what
 * a piece may weigh (`pieceLimit`). Two thousand definitions that every
 * paragraph refers to were read again behind every paragraph: 3 MB of them
 * took the index 25 s (review of L14, 2026-11-26). Read together they are
 * read as they stand in the note, and each run of pieces once with its
 * appendix.
 */
function withSharedAppendix(text: string, pieces: readonly ReadPiece[], definitions: ReadonlyMap<string, NoteDefinition>, definitionsCount: number, headings: boolean): ReadPiece[] {
  if (definitions.size < SHARED_APPENDIX_LINES) return pieces as ReadPiece[];
  const limit = pieceLimit();
  const read: ReadPiece[] = [];
  for (const piece of pieces) {
    const last = read[read.length - 1];
    const long = () => appendixFor(text.slice(piece.from, piece.to), definitions, piece.from, headings).split("\n\n").length > SHARED_APPENDIX_LINES;
    // Read as one, the two share their definitions: what they weigh together is their own weight and the definitions
    // of their references once (`pieceWeight`).
    const together = () => pieceWeight((last!.own ?? last!.weight ?? 0) + (piece.own ?? piece.weight ?? 0), (last!.references ?? 0) + (piece.references ?? 0), definitionsCount);
    if (last && together() <= limit && onlyBlanksBetween(text, last.to, piece.from) && long()) {
      last.to = piece.to;
      last.own = (last.own ?? last.weight ?? 0) + (piece.own ?? piece.weight ?? 0);
      last.references = (last.references ?? 0) + (piece.references ?? 0);
      last.weight = pieceWeight(last.own, last.references, definitionsCount);
    } else read.push({ ...piece });
  }
  return read;
}

/**
 * Each piece of the blocks `parts` reads as text (`readAsTextParts`), parsed
 * alone by the note's own parser and handed to `visit` with every position a
 * place in `text` — L14, Weg A: the note's tree holds a block read as text
 * as one paragraph of its characters, and the readers of its facts (the
 * index, a rename, its block ids) read them from the pieces instead, one at a
 * time, and let each go. A piece begins where the note does
 * (`readAsTextParts`); it is read behind a blank line, so that no properties
 * block opens there, with the definitions of the note behind it, so that its
 * references read as in the note. `tree` is the note's tree, for the
 * definitions outside the pieces; a piece that holds definitions of its own
 * is read for them first.
 */
export function forEachReadPiece(text: string, parts: ReadAsTextParts, tree: unknown, options: { preserveObsidianSyntax?: boolean; places?: boolean; reading?: MarkdownReading }, visit: (tree: MarkdownTreeNode, piece: ReadPiece) => void): void {
  if (parts.pieces.length === 0) return;
  const { lead: behind, reading } = pieceLead(parts);
  // A piece that begins with the note's own unclosed `---` holds it: behind a `---` of its own, the two would close a
  // properties block, and the rest would be read in the other mode (review of L14, 2026-11-26).
  const leadOf = (from: number): string => (parts.behindUnclosedProperties && (from === 0 || (from === 1 && text.charCodeAt(0) === BYTE_ORDER_MARK)) ? "" : behind);
  const read = (piece: string): MarkdownTreeNode =>
    (options.places ? parseMarkdownTree(piece, reading) : parseMarkdownAst(piece, { preserveObsidianSyntax: options.preserveObsidianSyntax, reading })) as unknown as MarkdownTreeNode;
  // Every definition of the note, wherever it stands: those of the note's tree, and those of what is read as text.
  const definitions = noteDefinitions(text, tree, options.reading ?? NOTE_READING);
  // The places of the note's lines, counted as the parser counts them, from piece to piece.
  let line = 1;
  let counted = 0;
  // Read for its headings (`places`, the note's source), a piece is given the definitions of its headings' labels too.
  const headings = options.places === true;
  for (const piece of withSharedAppendix(text, parts.pieces, definitions, parts.definitions ?? definitions.size, headings)) {
    for (; counted < piece.from; counted++) {
      const code = text.charCodeAt(counted);
      if (code === 0x0a || (code === 0x0d && text.charCodeAt(counted + 1) !== 0x0a)) line++;
    }
    const length = piece.to - piece.from;
    const body = text.slice(piece.from, piece.to);
    const lead = leadOf(piece.from);
    const leadLines = lead.split("\n").length - 1;
    const own = read(`${lead}${body}${appendixFor(body, definitions, piece.from, headings)}`) as unknown as PieceNode;
    // What stands before the piece is its lead, behind it the appendix: none of it is the note's.
    own.children = (own.children ?? []).filter((child) => {
      const at = child.position?.start?.offset ?? 0;
      return at >= lead.length && at < lead.length + length;
    });
    const moved = new WeakSet<object>();
    const move = (point: Partial<MarkdownTreePoint> | undefined): void => {
      if (!point || moved.has(point)) return;
      moved.add(point);
      if (typeof point.offset === "number") point.offset += piece.from - lead.length;
      if (typeof point.line === "number") point.line += line - 1 - leadLines;
    };
    const walk = (node: PieceNode): void => {
      move(node.position?.start);
      move(node.position?.end);
      for (const child of node.children ?? []) walk(child);
    };
    walk(own);
    visit(own as unknown as MarkdownTreeNode, piece);
  }
}
