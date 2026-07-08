import { parseMarkdownAst, extractFrontmatter } from "../src/index.js";
const content = "---\ntype: \"\"\n---\n";
const ast = parseMarkdownAst(content);
const result = extractFrontmatter(ast);
console.log(result);
