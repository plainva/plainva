import { updateFrontmatterString } from "./src/index.js";
import { parseMarkdownAst, extractFrontmatter } from "./src/index.js";

const original = "---\ntitle: test\n---";
const newContent = updateFrontmatterString(original, { date: "2026-06-26" });
console.log(newContent);

const ast = parseMarkdownAst(newContent);
console.log(extractFrontmatter(ast));
