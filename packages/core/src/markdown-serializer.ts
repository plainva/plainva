import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { MarkdownAst } from "./markdown-ast.js";

const processor = unified()
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "_",
    strong: "*",
    rule: "-",
    ruleSpaces: false,
    listItemIndent: "one"
  })
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"]);

/**
 * Markdown from a tree, in this serializer's own form: `-` for a list item,
 * `_` for emphasis, `| - |` for a table rule, a blank line between blocks and
 * a line end at the end.
 *
 * That makes it a writer of NEW text only. A note that is already there is
 * never written back from its tree — it would come back reformatted, which
 * the product rules out (ADR 0003, addendum 2026-10-12). Plainva's own code
 * changes a note where the change stands (`rewriteNoteLinks`, the task and
 * property writers); `markdownSerializerUse.test.ts` fails a shipped file that
 * calls this function. It stays in the package for tools that build a note
 * from a tree of their own.
 */
export function serializeMarkdownAst(ast: MarkdownAst): string {
  // remark-stringify outputs 'html' nodes as raw text without escaping.
  // Since our remark-obsidian-preserve plugin parsed wikilinks and embeds into 'html' nodes,
  // they will naturally be preserved here.
  return processor.stringify(ast as any);
}

/**
 * One new Markdown link, `[label](destination)`, with the label written so
 * that it reads as the text it is — a `*`, a `[` or a backtick in it is
 * escaped. `destination` is taken as it is and has to be encoded already
 * (`encodeMarkdownLinkPath`). In a table cell a `|` is written `\|`, in the
 * label and in the destination: bare, it would end the cell.
 */
export function serializeMarkdownLink(label: string, destination: string, options: { inTable?: boolean } = {}): string {
  const link = { type: "link", url: destination, title: null, children: label ? [{ type: "text", value: label }] : [] };
  const written = processor.stringify({ type: "root", children: [{ type: "paragraph", children: [link] }] } as any).replace(/\n$/, "");
  if (!options.inTable || !written.includes("|")) return written;
  let out = "";
  for (let at = 0; at < written.length; at++) {
    // A backslash escapes the character behind it: both are taken as they are.
    if (written[at] === "\\" && at + 1 < written.length) out += written[at] + written[++at];
    else out += written[at] === "|" ? "\\|" : written[at];
  }
  return out;
}
