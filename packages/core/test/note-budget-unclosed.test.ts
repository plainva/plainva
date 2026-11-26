import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { renameNoteLinks } from "../src/linkRewrite.ts";

/**
 * Behind a `---` in the first line that nothing closes, the parser opens no
 * list item, quote or footnote anywhere in the note: a line indented by four
 * under `- item` behind a blank line is indented code there, not the item's
 * second paragraph. Each piece of a block read as text is read in that mode,
 * behind a `---` of its own (`pieceLead`): read behind a blank line, a piece
 * read such a line as the item's text and gave the index links the note read
 * whole does not have, and a rename wrote into code.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));
const RENAMES = new Map([["Code", "Cobe"], ["Target", "Tbrget"]]);
const facts = (note: string) => ({ index: extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note), rename: renameNoteLinks(note, RENAMES).content });

for (const [shell, budget] of [["phone", NOTE_BUDGET], ["desktop", DESKTOP_NOTE_BUDGET]] as const) {
  describe(`a note behind an unclosed \`---\`, on the ${shell}`, () => {
    it("reads each piece in the note's mode: an indented line under an item is code", () => {
      expect.hasAssertions();
      setNoteBudget(budget);
      const make = (n: number) => `---\n${Array.from({ length: n }, (_, i) => `- item ${i} [[Target]] words ${i}\n\n    [[Code]] in code ${i}\n\n# Part ${i}`).join("\n\n")}\n`;
      // A heading behind each: an indented line, and the line behind it, belong to the block before them.
      let n = 500;
      while (readAsTextParts(make(n)).pieces.length === 0) n = Math.ceil(n * 1.5);
      const note = make(n);
      const parts = readAsTextParts(note);
      expect(parts.behindUnclosedProperties).toBe(true);
      expect(parts.unread).toEqual([]);
      const head = facts(note);
      setNoteBudget(Number.MAX_SAFE_INTEGER);
      const whole = facts(note);
      setNoteBudget(budget);
      expect(whole.index.links.some((link) => link.target === "Code"), "the note read whole reads code").toBe(false);
      expect(head.index).toEqual(whole.index);
      expect(head.rename).toBe(whole.rename);
    }, 120_000);
  });
}
