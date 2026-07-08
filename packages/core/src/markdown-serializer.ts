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

export function serializeMarkdownAst(ast: MarkdownAst): string {
  // remark-stringify outputs 'html' nodes as raw text without escaping.
  // Since our remark-obsidian-preserve plugin parsed wikilinks and embeds into 'html' nodes,
  // they will naturally be preserved here.
  return processor.stringify(ast as any);
}
