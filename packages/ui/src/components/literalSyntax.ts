import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Markdown nodes whose text is shown as it is written: code and comments. */
const CODE_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CommentBlock"]);

/**
 * Whether the text at `pos` stands inside code or a comment — where
 * `![[skizze.svg|240]]` is an example of the syntax, not a picture
 * (TestFlight build 136: the tour's own example drew the picture in the
 * middle of its sentence). Every live-preview widget that turns embed
 * syntax into something else asks this first.
 *
 * An HTML block counts only when `html` says so: note embeds have always
 * left it alone, while a picture inside `<p align="center">` or `<details>`
 * has always been drawn in the editor — and the phone reads in the editor.
 */
export function isLiteralAt(state: EditorState, pos: number, options: { html?: boolean } = {}): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name) || (options.html && node.name === "HTMLBlock")) return true;
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
