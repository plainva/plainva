/**
 * Notes whose GFM tables are hard to read right, and a digest of what the
 * parser makes of them (Gesamtplan Leistung L13, `gfm-table-parse.test.ts`).
 *
 * The digest covers the whole tree as JSON — every node, every value, every
 * position — through both entry points that read tables
 * (`parseMarkdownAst(…, { preserveObsidianSyntax: true })` for the index pass and
 * `parseMarkdownTree` for the note source). Two parsers that agree on every
 * digest made the same trees, byte for byte.
 */
import { createHash } from "node:crypto";
import { parseMarkdownAst, parseMarkdownTree } from "../src/markdown-parser.ts";

const rows = (n: number, cell: (i: number) => string) => Array.from({ length: n }, (_, i) => cell(i)).join("\n");

/** Each case one note. Names are stable: the pins in the test are keyed by them. */
export const NASTY_TABLES: Record<string, string> = {
  plain: "| a | b |\n|---|---|\n| 1 | 2 |\n",
  alignmentRow: "| left | centre | right | none |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |\n",
  escapedPipes: "| a \\| b | c |\n|---|---|\n| x \\| y | \\|z\\| |\n",
  codeWithPipes: "| code | text |\n|---|---|\n| `a | b` | `|` |\n| ``x | `y` | z`` | w |\n",
  linksAndTasksInCells: "| link | task | tag | block |\n|---|---|---|---|\n| [[Note A]] | - [ ] not a task | #tag | text ^block-1 |\n| [[Note B#Head|alias]] | [x] done? | #nested/tag | ![[Embed.png]] |\n| [md](Note%20C.md) | <https://example.com> | https://bare.example.org | $x$ |\n",
  wikiLinkPipeInCell: "| a | b |\n|---|---|\n| [[Target|Shown]] | [[Other\\|Alias]] |\n",
  directlyAfterParagraph: "A paragraph line\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  paragraphInterruptedTwice: "Text\n| a |\n|---|\nmore text\n| b |\n|---|\n",
  inList: "- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- second\n  | c | d |\n  |---|---|\n  | 3 | 4 |\n",
  inOrderedList: "1. one\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n",
  inBlockquote: "> | a | b |\n> |---|---|\n> | 1 | 2 |\n>\n> after\n",
  inCallout: "> [!info] Title\n> | a | b |\n> |---|---|\n> | [[Link]] | - [ ] x |\n",
  nestedQuoteLazy: "> | a | b |\n> |---|---|\n| lazy | row |\n",
  noOuterPipes: "a | b\n--- | ---\n1 | 2\n3 | 4\n",
  mixedOuterPipes: "| a | b\n--- | --- |\n1 | 2 |\n| 3 | 4\n",
  lastLineWithoutNewline: "| a | b |\n|---|---|\n| 1 | 2 |",
  crlf: "# Head\r\n\r\n| a | b |\r\n|---|---|\r\n| [[x]] | 2 |\r\n| 3 | 4 |\r\n\r\nafter\r\n",
  byteOrderMark: "﻿| a | b |\n|---|---|\n| 1 | 2 |\n",
  frontmatterThenTable: "---\ntitle: T\ntags: [a]\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  malformedDelimiter: "| a | b |\n|-x-|---|\n| 1 | 2 |\n",
  delimiterCountMismatch: "| a | b | c |\n|---|---|\n| 1 | 2 | 3 |\n",
  delimiterWithoutDash: "| a | b |\n|:|:|\n| 1 | 2 |\n",
  delimiterIndentedCode: "| a |\n    |---|\n",
  raggedRows: "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |\n||||\n",
  emptyCells: "| | |\n|-|-|\n| | |\n",
  singleColumn: "| a |\n|---|\n| 1 |\n| 2 |\n",
  delimiterLikeBodyRow: "| a | b |\n|---|---|\n|---|---|\n| 1 | 2 |\n",
  inlineMarkupInCells: "| **b** | _i_ | ~~s~~ |\n|---|---|---|\n| <br> | <span>x</span> | ==mark== |\n",
  htmlCommentAround: "<!-- c -->\n| a | b |\n|---|---|\n| 1 | 2 |\n<!-- d -->\n",
  tableThenHeadingThenTable: "| a |\n|---|\n| 1 |\n# H\n| b |\n|---|\n| 2 |\n",
  adjacentTables: "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n| c |\n|---|\n",
  tableInFencedCode: "```\n| a | b |\n|---|---|\n```\n| real | table |\n|---|---|\n",
  tabsInCells: "|\ta\t|\tb\t|\n|---|---|\n|\t1\t|\t2\t|\n",
  unicodeCells: "| 名前 | Größe | ✓ |\n|---|---|---|\n| 東京 | Übersicht | 🙂 |\n",
  thousandRows: "| n | link | note |\n|---|:---:|---:|\n" + rows(1000, (i) => `| ${i} | [[Note ${i}]] | text \\| ${i} \`a|b\` |`) + "\n",
  manyTablesInList: rows(30, (i) => `- item ${i}\n  | a | b |\n  |---|---|\n  | ${i} | [[N${i}]] |`) + "\n",
  manyTablesInQuotes: rows(30, (i) => `> [!note]\n> | a | b |\n> |---|---|\n> | ${i} | - [ ] t${i} |\n`) + "\n",
};

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One digest of both trees of `text`. */
export function treeDigest(text: string): string {
  return sha([parseMarkdownAst(text, { preserveObsidianSyntax: true }), parseMarkdownTree(text)]);
}
