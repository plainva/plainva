import { markdownAstSchema, type MarkdownAst } from "./markdown-ast.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkObsidianPreserve from "./remark-obsidian-preserve.ts";
import { unified } from "unified";

export type ParseMarkdownAstOptions = {
  preserveObsidianSyntax?: boolean;
};

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

const obsidianPreservingMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkObsidianPreserve);

/** CommonMark alone: no tables, no bare addresses turned into links, no properties block. */
const commonMarkParser = unified().use(remarkParse);

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
function parsedInText<Tree>(parse: (text: string) => Tree, text: string): Tree {
  // What is no text is the parser's to answer for, as it always was.
  if (typeof text !== "string" || text.charCodeAt(0) !== BYTE_ORDER_MARK) return parse(text);
  const tree = parse(text);
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
  return tree;
}

export function parseMarkdownAst(
  markdown: string,
  options: ParseMarkdownAstOptions = {}
): MarkdownAst {
  const processor = options.preserveObsidianSyntax
    ? obsidianPreservingMarkdownParser
    : markdownParser;
  const tree = parsedInText((text) => processor.parse(text), markdown);
  const transformedTree = options.preserveObsidianSyntax ? processor.runSync(tree) : tree;

  return markdownAstSchema.parse(transformedTree);
}

/**
 * The tree of a note for a reader of places: tables, task lists and the
 * properties block as `parseMarkdownAst` reads them, without the check of the
 * tree's shape that function runs. Every position is a place in `text`.
 */
export function parseMarkdownTree(text: string): MarkdownTreeNode {
  return parsedInText((source) => markdownParser.parse(source), text) as unknown as MarkdownTreeNode;
}

/**
 * The tree of a text that is CommonMark and nothing more — what another
 * program wrote before it was a note here. Every position is a place in `text`.
 */
export function parseCommonMarkTree(text: string): MarkdownTreeNode {
  return parsedInText((source) => commonMarkParser.parse(source), text) as unknown as MarkdownTreeNode;
}
