import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { overBudgetInlineRanges } from "../src/inlineParseBudget.js";
import { renameNoteLinks } from "../src/linkRewrite.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";

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

  it("are rewritten where they stand when the notes they lead to are renamed", () => {
    const text = priceTable(2000);
    const renames = new Map(Array.from({ length: 2000 }, (_, i) => [`Note ${i}`, `Moved ${i}`] as [string, string]));
    const { content, renamed, unplaced } = renameNoteLinks(text, renames);
    expect(renamed).toBe(2000);
    expect(unplaced).toBe(0);
    expect(content).toBe(text.replace(/\[\[Note (\d+)\]\]/g, "[[Moved $1]]"));
  }, 120 * SECONDS);

  it("are all read under 128 MB for 2 000 and 5 000 rows", () => {
    // In a child process whose V8 old space is capped: an allocation over it ends the process.
    const index = (rows: number) => {
      const script =
        `const P = await import(${JSON.stringify(new URL("../src/markdown-parser.ts", import.meta.url).pathname)});` +
        `const S = await import(${JSON.stringify(new URL("../src/ast-scanner.ts", import.meta.url).pathname)});` +
        `const rows = Array.from({ length: ${rows} }, (_, i) => "| $" + i + ".50 per month | [[Note " + i + "]] | [m](x" + i + ".md) |");` +
        `const text = "# T\\n\\n| a | b | c |\\n|---|---|---|\\n" + rows.join("\\n") + "\\n";` +
        `console.log("links " + S.extractLinksAndTags(P.parseMarkdownAst(text, { preserveObsidianSyntax: true })).links.length);`;
      return spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 120 * SECONDS });
    };
    for (const rows of [2000, 5000]) {
      const run = index(rows);
      expect(run.stdout.trim(), run.stderr.slice(-300)).toBe(`links ${2 * rows}`);
      expect(run.status).toBe(0);
    }
  }, 240 * SECONDS);
});
