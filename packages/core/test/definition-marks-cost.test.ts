import { afterAll, describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { NOTE_BUDGET, overBudgetInlineRanges, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";

/**
 * A reading asks of each row of a table over its budget, and of each piece of
 * a block read as text, whether the note holds a definition outside it, and
 * asks of the row's or the piece's own text which it holds. With one remembered
 * answer, every row's question pushed the note's out, and the next row searched
 * the whole note for `]:` again: 30 000 rows of a table with wiki links took
 * 40 s where `main` took 4 s (review of L14, round four). Counted, not timed:
 * how often a search for `]:` runs over the whole note while it is read.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

function searchesOfWholeNote(note: string, read: () => void): number {
  const original = String.prototype.indexOf;
  let searches = 0;
  String.prototype.indexOf = function (this: string, search: string, position?: number): number {
    if (search === "]:" && position === undefined && this.length === note.length) searches++;
    return original.call(this, search, position);
  };
  try {
    read();
  } finally {
    String.prototype.indexOf = original;
  }
  return searches;
}

describe("the search of a note for its definitions", () => {
  it("runs once for a table read row by row, not once a row", () => {
    expect.hasAssertions();
    const note = `# T\n\n| a | b |\n|---|---|\n${Array.from({ length: 5_000 }, (_, i) => `| p${i} [[A]] [[A]] [[A]] end | z |`).join("\n")}\n`;
    setNoteBudget(NOTE_BUDGET);
    expect(overBudgetInlineRanges(note).some((range) => range.table), "the table is read row by row").toBe(true);
    let links = 0;
    const searches = searchesOfWholeNote(note, () => {
      links = extractLinksAndTags(parseMarkdownAst(note), note).links.length;
    });
    expect(links).toBe(15_000);
    expect(searches).toBeLessThanOrEqual(2);
  }, 120_000);

  it("runs once for a block read in pieces, not once a piece", () => {
    expect.hasAssertions();
    const note = `${Array.from({ length: 12_000 }, (_, i) => `- item ${i} **b** _c_ \`d\` [[Other${i}]] <e> &amp; ~~s~~ words`).join("\n")}\n\n[^1]: a footnote\n`;
    setNoteBudget(NOTE_BUDGET);
    expect(readAsTextParts(note).pieces.length, "the list is read in pieces").toBeGreaterThan(10);
    let links = 0;
    const searches = searchesOfWholeNote(note, () => {
      links = extractLinksAndTags(parseMarkdownAst(note), note).links.length;
    });
    expect(links).toBe(12_000);
    expect(searches).toBeLessThanOrEqual(2);
  }, 120_000);
});
