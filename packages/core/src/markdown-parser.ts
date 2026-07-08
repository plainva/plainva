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

export function parseMarkdownAst(
  markdown: string,
  options: ParseMarkdownAstOptions = {}
): MarkdownAst {
  const processor = options.preserveObsidianSyntax
    ? obsidianPreservingMarkdownParser
    : markdownParser;
  const tree = processor.parse(markdown);
  const transformedTree = options.preserveObsidianSyntax ? processor.runSync(tree) : tree;

  return markdownAstSchema.parse(transformedTree);
}
