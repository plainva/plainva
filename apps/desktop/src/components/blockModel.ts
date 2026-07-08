import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Top-level "block" model for the Notion-style block handles (#7). A block is a
// top-level markdown element (paragraph, heading, blockquote/callout, fenced
// code, table, horizontal rule) — and, for lists, each individual list item (so
// items can be moved/converted independently, like Notion). Boundaries come from
// the lezer syntax tree (robust for nested lists / multi-line blocks); handles
// are hover affordances, so a momentarily incomplete parse is harmless.

export type BlockType = "heading" | "paragraph" | "list" | "quote" | "code" | "table" | "hr" | "other";

export interface DocBlock {
  /** Document offset of the block's first line start. */
  from: number;
  /** Document offset of the block's last line end. */
  to: number;
  firstLine: number; // 1-based
  lastLine: number; // 1-based
  type: BlockType;
}

function classify(name: string): BlockType {
  if (/^ATXHeading/.test(name) || name === "SetextHeading") return "heading";
  if (name === "Paragraph") return "paragraph";
  if (name === "BulletList" || name === "OrderedList") return "list";
  if (name === "Blockquote") return "quote";
  if (name === "FencedCode" || name === "CodeBlock") return "code";
  if (name === "Table") return "table";
  if (name === "HorizontalRule") return "hr";
  return "other";
}

function mkBlock(state: EditorState, from: number, to: number, type: BlockType): DocBlock {
  const len = state.doc.length;
  const f = Math.max(0, Math.min(from, len));
  const t = Math.max(f, Math.min(to, len));
  const firstLine = state.doc.lineAt(f).number;
  // lezer node ends often include the trailing newline / reach the next block;
  // step back to the last line that actually belongs to this block.
  let lastLine = state.doc.lineAt(t > f ? t - 1 : t).number;
  while (lastLine > firstLine && state.doc.line(lastLine).text.trim() === "") lastLine--;
  return {
    from: state.doc.line(firstLine).from,
    to: state.doc.line(lastLine).to,
    firstLine,
    lastLine,
    type,
  };
}

/**
 * End offset of the leading YAML frontmatter (`---` … `---`), or 0 if none.
 * `@codemirror/lang-markdown` doesn't parse frontmatter as its own node — lezer
 * sees the `---` fences as thematic breaks / setext headings — so without this
 * the frontmatter would surface as phantom blocks (which the editor hides),
 * stacking handles at the top and corrupting move line numbers.
 */
function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text !== "---") return 0;
  for (let i = 2; i <= state.doc.lines; i++) {
    if (state.doc.line(i).text === "---") return state.doc.line(i).to;
  }
  return 0;
}

/**
 * All top-level blocks in document order. A whole bullet/ordered list is ONE
 * block (not per item), matching how users think about moving/converting a list.
 * Blocks inside the YAML frontmatter are excluded.
 */
export function listBlocks(state: EditorState): DocBlock[] {
  const blocks: DocBlock[] = [];
  const fmEnd = frontmatterEnd(state);
  const top = syntaxTree(state).topNode;
  let child = top.firstChild;
  while (child) {
    const name = child.name;
    if (name !== "FrontMatter" && name !== "Document" && child.from >= fmEnd) {
      blocks.push(mkBlock(state, child.from, child.to, classify(name)));
    }
    child = child.nextSibling;
  }
  return blocks;
}

/** The block containing document position `pos`, or null. */
export function blockAt(state: EditorState, pos: number): DocBlock | null {
  const blocks = listBlocks(state);
  for (const b of blocks) if (pos >= b.from && pos <= b.to) return b;
  return null;
}
