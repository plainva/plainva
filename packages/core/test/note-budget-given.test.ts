import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.ts";
import { NOTE_FORMS } from "../scripts/perf/note-budget.ts";

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
