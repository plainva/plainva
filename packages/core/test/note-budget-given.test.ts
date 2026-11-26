import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, pieceLimit, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.ts";
import { NOTE_FORMS } from "../scripts/perf/note-budget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";

const CORE = new URL("..", import.meta.url).pathname;

/**
 * A definition read as text that a reference in formatted text names is given
 * back to the note's tree, a line of its own, so that the reference reads as
 * in the note read whole (`givenDefinitions`). The note's budget weighs those
 * lines again (review of L14, 2026-11-26): before, it read a note's
 * definitions as text, weighed them gone, and kept every reference formatted —
 * and the tree held every definition again, as heavy as the note unread by the
 * budget, which ran out of 128 MB where the budget weighed it read. Now the
 * references are read as text as well, until what stays formatted and what is
 * given back is in the budget. `--check` holds the forms under the heap
 * (`refsdefs`, `sharedrefs`); this holds the choice, with the budget of each
 * shell.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

for (const [shell, budget] of [["phone", NOTE_BUDGET], ["desktop", DESKTOP_NOTE_BUDGET]] as const) {
  describe(`references beside their definitions, on the ${shell}`, () => {
    for (const form of ["refsdefs", "sharedrefs"] as const) {
      it(`${form}: over the budget, its references are read as text with their definitions`, () => {
        expect.hasAssertions();
        setNoteBudget(budget);
        const make = NOTE_FORMS[form];
        let n = 500;
        while (!readAsTextParts(make(n)).ranges.some((range) => range.block)) n = Math.ceil(n * 1.25);
        const note = make(Math.ceil(n * 1.5));
        const { ranges } = readAsTextParts(note);
        const inText = (at: number) => ranges.some((range) => range.from <= at && at < range.to);
        const definitions = [...note.matchAll(/^\[d\d+\]:/gm)].map((match) => match.index);
        const references = [...note.matchAll(form === "refsdefs" ? /\[x\]\[d\d+\]/g : /see \[d\d+\]/g)].map((match) => match.index);
        expect(definitions.every(inText), "the definitions are read as text").toBe(true);
        // Formatted, each would hold a given definition: a fifth of them and more are read as text (before: none).
        expect(references.filter(inText).length).toBeGreaterThan(references.length / 5);
      }, 120_000);
    }
  });
}

/**
 * A piece is read with a definition behind it for each label in brackets in
 * it that the note defines (`forEachReadPiece`). Weighed without them, a
 * paragraph of thousands of references was a piece within its share and, with
 * its definitions behind it, ran the phone's index out of 128 MB (the hunt of
 * the performance workflow, 2026-11-26, note `gen:936455:12`, 890 KB with
 * 18 740 definitions): the definitions it is read with count to its weight.
 */
describe("a piece and the definitions it is read with", () => {
  it("weigh together: paragraphs of references too heavy with their definitions are not read, every piece is within its share", () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    // Three paragraphs of 3 000 references, their definitions in a block of their own: over the note's budget.
    const n = 3_000;
    const note = (behind: string) => `# T\n\n${Array.from({ length: n }, (_, i) => `[d${i}]: T${i}.md`).join("\n")}\n\n${[0, 1, 2].map(() => Array.from({ length: n }, (_, i) => `[x][d${i}]${behind}`).join("\n")).join("\n\nbetween\n\n")}\n`;
    const paragraphs = (text: string) => [...text.matchAll(/^\[x\]\[d0\]/gm)].map((match) => match.index);
    // Running into a `(`, each reference is read with its definition behind its piece: too heavy, a paragraph read as
    // text is not read.
    const into = note("(u.md)");
    const parts = readAsTextParts(into);
    const asText = paragraphs(into).filter((at) => parts.ranges.some((range) => range.block && range.from <= at && at < range.to));
    expect(asText.length).toBeGreaterThan(0);
    expect(asText.every((at) => parts.unread.some((range) => range.from <= at && at < range.to)), "read as text, each is not read").toBe(true);
    expect(parts.pieces.every((piece) => (piece.weight ?? 0) <= pieceLimit())).toBe(true);
    // Without, a reference's definition is no link of the index: the paragraphs are read in pieces, as the note read whole.
    const alone = note("");
    const aloneParts = readAsTextParts(alone);
    expect(paragraphs(alone).some((at) => aloneParts.pieces.some((piece) => piece.from <= at && at < piece.to)), "read in pieces").toBe(true);
    const head = extractLinksAndTags(parseMarkdownAst(alone, { preserveObsidianSyntax: true }), alone);
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    const whole = extractLinksAndTags(parseMarkdownAst(alone, { preserveObsidianSyntax: true }), alone);
    setNoteBudget(NOTE_BUDGET);
    expect(head).toEqual(whole);
  }, 120_000);

  // Notes the performance workflow's hunt found on 2026-11-26, each of which ran the phone's index out of 128 MB:
  // `:12` a piece weighed without the definitions it is read with; `:27` pieces of 2 000 definitions read with all of
  // them again behind them; `:13` pieces read with the definitions of every label in brackets; `gen:382803:4` a
  // definition in a part not read, parsed with the paragraph of megabytes beside it.
  for (const note of ["gen:936455:12", "gen:936455:27", "gen:936455:13", "gen:382803:4"]) {
    it(`the note the hunt found, ${note}, is read by the phone's index and note source under 128 MB`, () => {
      expect.hasAssertions();
      for (const parse of ["index", "tree"]) {
        const run = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "scripts/perf/note-budget.ts", "--child", note, "0", "1", parse, "bounded"], { cwd: CORE, encoding: "utf8", timeout: 240_000 });
        expect(run.status, `${parse}: ${(run.stderr ?? "").slice(-300)}`).toBe(0);
        expect(run.stdout).toMatch(/^ok \d+/m);
      }
    }, 300_000);
  }
});
