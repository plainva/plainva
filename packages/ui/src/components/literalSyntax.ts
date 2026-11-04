import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Markdown nodes whose text is shown as it is written: code, comments and HTML blocks. */
const LITERAL_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CommentBlock", "HTMLBlock"]);

/**
 * Whether the text at `pos` stands inside code, a comment or an HTML block —
 * where `![[skizze.svg|240]]` is an example of the syntax, not a picture
 * (TestFlight build 136: the tour's own example drew the picture in the
 * middle of its sentence). Every live-preview widget that turns embed
 * syntax into something else asks this first.
 *
 * An HTML block is one of them, for every embed (open-items plan 3.131 no. 6,
 * decision E12). Obsidian renders no Markdown inside an HTML element — its
 * help says so on the page "HTML content" (obsidian.md/help/html) — and an
 * embed is Markdown. Note embeds and the desktop's reading view always left
 * such an embed as text; only a picture was drawn in the editor, so a note
 * read differently in the editor (the phone's reading too) than in the
 * reading view. A blank line inside the element ends the HTML block, as in
 * CommonMark and Obsidian: an embed behind it is drawn.
 */
export function isLiteralAt(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (LITERAL_NODES.has(node.name)) return true;
  }
  return false;
}

/**
 * Whether the character at `index` is escaped: an odd run of backslashes
 * before it. `\![[a.png]]` is text; `\\![[a.png]]` is a backslash and then
 * the embed.
 */
export function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
  return slashes % 2 === 1;
}
