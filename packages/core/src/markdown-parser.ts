import { markdownAstSchema, type MarkdownAst } from "./markdown-ast.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkObsidianPreserve from "./remark-obsidian-preserve.ts";
import { remarkWikiLinks } from "./wikiLinkSyntax.ts";
import { unified, type Processor } from "unified";
import { boundMarkdownForParse, COMMONMARK_READING, NOTE_READING, restoreBoundedTree, type BoundedRange, type MarkdownReading, type ReadAsTextParts, type ReadPiece } from "./inlineParseBudget.ts";

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
  if (text.charCodeAt(0) !== BYTE_ORDER_MARK) {
    const tree = parse(bounded.text);
    restoreBoundedTree(tree, bounded);
    if (rowLinks) readRowLinks(tree as unknown as LinkNode, text, bounded.ranges, parse, reading);
    return tree;
  }
  const tree = parse(bounded.text);
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
  if (rowLinks) readRowLinks(tree as unknown as LinkNode, text, bounded.ranges, parse, reading);
  return tree;
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
function readRowLinks<Tree>(tree: LinkNode, text: string, ranges: readonly BoundedRange[], parse: (text: string) => Tree, reading: MarkdownReading): void {
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
      const mini = alone ? `${head}\n${delimiter}` : `${head}\n${delimiter}\n${row}`;
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

interface PieceNode {
  type: string;
  label?: string;
  identifier?: string;
  children?: PieceNode[];
  position?: { start?: Partial<MarkdownTreePoint>; end?: Partial<MarkdownTreePoint> };
}

/**
 * The definitions a piece read alone must know to read its references as the
 * note does — link reference definitions and footnote definitions are the
 * note's, wherever they stand —, as lines to append behind it: each reads as
 * a definition and names nothing (`#`, `.`).
 */
function definitionsOf(tree: PieceNode, labels: Set<string>, within?: { from: number; to: number }): boolean {
  let found = false;
  const visit = (node: PieceNode): void => {
    if ((node.type === "definition" || node.type === "footnoteDefinition") && (node.label ?? node.identifier)) {
      const at = node.position?.start?.offset ?? -1;
      if (!within || (at >= within.from && at < within.to)) {
        const line = node.type === "definition" ? `[${(node.label ?? node.identifier)!.replace(/\s+/g, " ")}]: #` : `[^${(node.label ?? node.identifier)!.replace(/\s+/g, " ")}]: .`;
        if (!labels.has(line)) {
          labels.add(line);
          found = true;
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return found;
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
export function forEachReadPiece(text: string, parts: ReadAsTextParts, tree: unknown, options: { preserveObsidianSyntax?: boolean; places?: boolean }, visit: (tree: MarkdownTreeNode, piece: ReadPiece) => void): void {
  if (parts.pieces.length === 0) return;
  const read = (piece: string): MarkdownTreeNode =>
    (options.places ? parseMarkdownTree(piece, PIECE_READING) : parseMarkdownAst(piece, { preserveObsidianSyntax: options.preserveObsidianSyntax, reading: PIECE_READING })) as unknown as MarkdownTreeNode;
  const labels = new Set<string>();
  definitionsOf(tree as PieceNode, labels);
  // A blank line between them: behind a footnote's definition the next line would be its text.
  const appendix = () => (labels.size > 0 ? `\n\n${[...labels].join("\n\n")}\n` : "");
  // Definitions inside the pieces: read first, so that every piece knows them. A piece without `]:` holds none.
  let marker = -1;
  for (const piece of parts.pieces) {
    if (marker < piece.from) marker = text.indexOf("]:", piece.from);
    if (marker < 0) break;
    if (marker >= piece.to) continue;
    const own = read(`\n${text.slice(piece.from, piece.to)}`);
    definitionsOf(own as unknown as PieceNode, labels, { from: 1, to: 1 + piece.to - piece.from });
  }
  const tail = appendix();
  // The places of the note's lines, counted as the parser counts them, from piece to piece.
  let line = 1;
  let counted = 0;
  for (const piece of parts.pieces) {
    for (; counted < piece.from; counted++) {
      const code = text.charCodeAt(counted);
      if (code === 0x0a || (code === 0x0d && text.charCodeAt(counted + 1) !== 0x0a)) line++;
    }
    const length = piece.to - piece.from;
    const own = read(`\n${text.slice(piece.from, piece.to)}${tail}`) as unknown as PieceNode;
    // What stands behind the piece is the appendix: none of it is the note's.
    own.children = (own.children ?? []).filter((child) => (child.position?.start?.offset ?? 0) < 1 + length);
    const moved = new WeakSet<object>();
    const move = (point: Partial<MarkdownTreePoint> | undefined): void => {
      if (!point || moved.has(point)) return;
      moved.add(point);
      if (typeof point.offset === "number") point.offset += piece.from - 1;
      if (typeof point.line === "number") point.line += line - 2;
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
