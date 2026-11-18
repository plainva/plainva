import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { overBudgetInlineRanges } from "../src/inlineParseBudget.js";
import { renameNoteLinks } from "../src/linkRewrite.js";
import { markdownAstSchema } from "../src/markdown-ast.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import remarkObsidianPreserve from "../src/remark-obsidian-preserve.js";
import { remarkWikiLinks } from "../src/wikiLinkSyntax.js";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * A table over the parse budget is text for the reading view, and its links
 * are still the note's links (review, 2026-11-17): a price table of 2 000
 * rows gave the index 2 links where `main` gave 2 002, so the backlinks and
 * the graph lost them, and a rename of the notes they lead to left them
 * behind. The index and a rename read each row of such a table on its own.
 */

const SECONDS = 1000;
/** A table of `rows` rows, each with a price, a wiki link, a tag and a Markdown link, between two links of the note. */
const priceTable = (rows: number, prefix = "") =>
  `# T\n\nintro [[Top]]\n\n${prefix}| a | b | c |\n${prefix}|---|---|---|\n` +
  Array.from({ length: rows }, (_, i) => `${prefix}| $${i}.50 per month | [[Note ${i}]] #t${i} | [m](x${i}.md) |`).join("\n") +
  `\n\nafter [[End]]\n`;

describe("the links of a table over the parse budget", () => {
  it("are read row by row for the index, in a table and in a quote, at their places", () => {
    for (const prefix of ["", "> "]) {
      const text = priceTable(2000, prefix);
      expect(overBudgetInlineRanges(text).some((range) => range.table), "the table is over the budget").toBe(true);
      const { links, tags } = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }));
      expect(links.filter((link) => link.type === "wikilink").map((link) => link.target)).toEqual(["Top", ...Array.from({ length: 2000 }, (_, i) => `Note ${i}`), "End"]);
      expect(links.filter((link) => link.type === "markdown-link")).toHaveLength(2000);
      expect(new Set(tags.map((tag) => tag.name)).size).toBe(2000);
      // Each link at its line: the table's first row is the note's seventh line.
      expect(links.find((link) => link.target === "Note 0")?.line).toBe(7);
      expect(links.find((link) => link.target === "Note 1999")?.line).toBe(2006);
    }
  }, 120 * SECONDS);

  it("are each read once, as the parser reads them in a table (URLs, e-mail addresses, Markdown links)", () => {
    // Review, 2026-11-18: the parse of such a table as text makes a link of
    // every URL and e-mail address it meets, and the rows gave each again —
    // 2 400 rows of URLs stood in the index with 19 202 links where main,
    // reading them as a table, has 9 602. What the index reads must be what
    // the parser reads of the same table as a table, link for link and line
    // for line: the parse without the budget is that reading.
    const asTable = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks).use(remarkObsidianPreserve);
    const shapes: Record<string, (i: number) => string> = {
      url: (i) => `| https://example.com/p${i} | <https://auto.com/${i}> | www.w${i}.com and me${i}@mail.com |`,
      mdlink: (i) => `| [m](x${i}.md) | [ext](https://e.com/${i}) | [s](<sp ace${i}.md>) |`,
      mixed: (i) => `| W${i} | $12.50 | [[Widgets ${i}]] #w${i} | uses \`$CFG\`, see [docs](http://d/$v) and ![[e${i}]] |`,
      quoted: (i) => `> | q [[Q ${i}]] https://q.org/${i} | #qt${i} | [m](q${i}.md) |`,
    };
    for (const [name, row] of Object.entries(shapes)) {
      const note = (rows: number) => {
        const lines = Array.from({ length: rows }, (_, i) => row(i));
        const quote = lines[0].startsWith("> ") ? "> " : "";
        const columns = (lines[0].match(/(?<!\\)\|/g)?.length ?? 2) - 1;
        return `# T\n\nintro [[Top]] https://top.org\n\n${quote}|${" h |".repeat(columns)}\n${quote}|${"---|".repeat(columns)}\n${lines.join("\n")}\n\nafter [[End]]\n`;
      };
      // The fewest rows the scan reads as written, and a few more.
      let rows = 64;
      while (!overBudgetInlineRanges(note(rows)).some((range) => range.table)) rows *= 2;
      for (let step = rows / 4; step >= 1; step /= 2) if (overBudgetInlineRanges(note(rows - step)).some((range) => range.table)) rows -= step;
      const text = note(rows + 20);
      expect(overBudgetInlineRanges(text).some((range) => range.table), `${name}: over the budget`).toBe(true);
      const read = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }));
      const table = extractLinksAndTags(markdownAstSchema.parse(asTable.runSync(asTable.parse(text))));
      expect(read.links.length, `${name}: links`).toBe(table.links.length);
      expect(read.links, `${name}: each link, its target and its line`).toEqual(table.links);
      expect(read.tags, `${name}: tags`).toEqual(table.tags);
    }
  }, 240 * SECONDS);

  it("are rewritten where they stand when the notes they lead to are renamed", () => {
    const text = priceTable(2000);
    const renames = new Map(Array.from({ length: 2000 }, (_, i) => [`Note ${i}`, `Moved ${i}`] as [string, string]));
    const { content, renamed, unplaced } = renameNoteLinks(text, renames);
    expect(renamed).toBe(2000);
    expect(unplaced).toBe(0);
    expect(content).toBe(text.replace(/\[\[Note (\d+)\]\]/g, "[[Moved $1]]"));
  }, 120 * SECONDS);

  it("are all read under 128 MB for 2 000 and 5 000 rows, and 2 400 rows of URLs", () => {
    // In a child process whose V8 old space is capped: an allocation over it ends the process.
    const PRICE = `"| $" + i + ".50 per month | [[Note " + i + "]] | [m](x" + i + ".md) |"`;
    const URLS = `"| https://example.com/p" + i + " | <https://auto.com/" + i + "> | www.w" + i + ".com and me" + i + "@mail.com |"`;
    const index = (rows: number, row = PRICE) => {
      const script =
        `const P = await import(${JSON.stringify(new URL("../src/markdown-parser.ts", import.meta.url).pathname)});` +
        `const S = await import(${JSON.stringify(new URL("../src/ast-scanner.ts", import.meta.url).pathname)});` +
        `const rows = Array.from({ length: ${rows} }, (_, i) => ${row});` +
        `const text = "# T\\n\\n| a | b | c |\\n|---|---|---|\\n" + rows.join("\\n") + "\\n";` +
        `console.log("links " + S.extractLinksAndTags(P.parseMarkdownAst(text, { preserveObsidianSyntax: true })).links.length);`;
      return spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 120 * SECONDS });
    };
    for (const rows of [2000, 5000]) {
      const run = index(rows);
      expect(run.stdout.trim(), run.stderr.slice(-300)).toBe(`links ${2 * rows}`);
      expect(run.status).toBe(0);
    }
    // Four links a row, each once (review, 2026-11-18: twice, and 131 MB).
    const urls = index(2400, URLS);
    expect(urls.stdout.trim(), urls.stderr.slice(-300)).toBe(`links ${4 * 2400}`);
    expect(urls.status).toBe(0);
  }, 360 * SECONDS);
});
