import { describe, expect, it } from "vitest";
import { NOTE_EDIT_LIMITS, appendToNote, applyNoteEdits, noteBodyStart } from "./edits.js";

const NOTE = ["---", "status: open", "tags: [a]", "---", "# Plan", "", "The roof is done in May.", "", "## Costs", "", "Roof: 4,000", "", "## Next", "", "- Call the roofer"].join("\n") + "\n";

describe("a model's edits to a note (applyNoteEdits)", () => {
  it("replaces the one passage it names and nothing else", () => {
    const outcome = applyNoteEdits(NOTE, [{ find: "in May", replace: "in June" }]);
    expect(outcome).toEqual({ ok: true, text: NOTE.replace("in May", "in June") });
  });

  it("takes several passages in any order", () => {
    const outcome = applyNoteEdits(NOTE, [
      { find: "- Call the roofer", replace: "- Call the roofer\n- Order the tiles" },
      { find: "Roof: 4,000", replace: "Roof: 4,500" },
    ]);
    expect(outcome.ok && outcome.text).toBe(NOTE.replace("Roof: 4,000", "Roof: 4,500").replace("- Call the roofer", "- Call the roofer\n- Order the tiles"));
  });

  it("removes a passage with an empty replacement", () => {
    const outcome = applyNoteEdits(NOTE, [{ find: "\nRoof: 4,000\n", replace: "" }]);
    expect(outcome.ok && outcome.text).toBe(NOTE.replace("\nRoof: 4,000\n", ""));
  });

  it("says which edit names a passage the note does not have", () => {
    expect(applyNoteEdits(NOTE, [{ find: "Roof: 4,000", replace: "x" }, { find: "in April", replace: "in June" }])).toEqual({ ok: false, problem: "not-found", edit: 1 });
  });

  it("guesses nothing where the passage is there twice", () => {
    const twice = `${NOTE}\nRoof: 4,000\n`;
    expect(applyNoteEdits(twice, [{ find: "Roof: 4,000", replace: "Roof: 1" }])).toEqual({ ok: false, problem: "ambiguous", edit: 0 });
  });

  it("never looks for a passage in the properties", () => {
    // "open" is in the properties and nowhere in the text.
    expect(applyNoteEdits(NOTE, [{ find: "status: open", replace: "status: done" }])).toEqual({ ok: false, problem: "not-found", edit: 0 });
    // A passage that is in both counts once: the one in the text.
    const both = NOTE.replace("# Plan", "# Plan [a]");
    const outcome = applyNoteEdits(both, [{ find: "[a]", replace: "[b]" }]);
    expect(outcome.ok && outcome.text).toBe(both.replace("# Plan [a]", "# Plan [b]"));
    expect(noteBodyStart(NOTE)).toBe(NOTE.indexOf("# Plan"));
    expect(noteBodyStart("No properties here")).toBe(0);
  });

  it("refuses passages that touch", () => {
    expect(applyNoteEdits(NOTE, [{ find: "The roof is done", replace: "x" }, { find: "done in May", replace: "y" }])).toEqual({ ok: false, problem: "overlap", edit: 1 });
  });

  it("refuses what changes nothing, what names nothing and what is too much", () => {
    expect(applyNoteEdits(NOTE, [{ find: "in May", replace: "in May" }])).toEqual({ ok: false, problem: "unchanged" });
    expect(applyNoteEdits(NOTE, [])).toEqual({ ok: false, problem: "empty" });
    expect(applyNoteEdits(NOTE, [{ find: "", replace: "x" }])).toEqual({ ok: false, problem: "empty", edit: 0 });
    expect(applyNoteEdits(NOTE, Array.from({ length: NOTE_EDIT_LIMITS.edits + 1 }, () => ({ find: "a", replace: "b" })))).toEqual({ ok: false, problem: "too-many" });
    expect(applyNoteEdits(NOTE, [{ find: "in May", replace: "x".repeat(NOTE_EDIT_LIMITS.replace + 1) }])).toEqual({ ok: false, problem: "too-long", edit: 0 });
  });

  it("gives a note written with CRLF its line endings back", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const outcome = applyNoteEdits(crlf, [{ find: "Roof: 4,000\n\n## Next", replace: "Roof: 4,500\n\n## Then" }]);
    expect(outcome.ok && outcome.text).toBe(crlf.replace("Roof: 4,000\r\n\r\n## Next", "Roof: 4,500\r\n\r\n## Then"));
    expect(outcome.ok && /[^\r]\n/.test(outcome.text)).toBe(false);
  });

  it("finds a passage a comment's markers run through, and takes the whole of it", () => {
    const marked = NOTE.replace("is done in May", "is <!--pv#1a2b-->done<!--/pv#1a2b--> in May");
    const outcome = applyNoteEdits(marked, [{ find: "The roof is done in May.", replace: "The roof is done in June." }]);
    expect(outcome.ok && outcome.text).toBe(marked.replace("The roof is <!--pv#1a2b-->done<!--/pv#1a2b--> in May.", "The roof is done in June."));
    // Quoted with its markers, it is found as written.
    const literal = applyNoteEdits(marked, [{ find: "<!--pv#1a2b-->done<!--/pv#1a2b--> in May", replace: "<!--pv#1a2b-->done<!--/pv#1a2b--> in June" }]);
    expect(literal.ok && literal.text).toBe(marked.replace("in May", "in June"));
  });
});

describe("a paragraph added to a note (appendToNote)", () => {
  it("goes to the end, behind one blank line", () => {
    const outcome = appendToNote(NOTE, "Decided on 7 October.");
    expect(outcome.ok && outcome.text).toBe(`${NOTE}\nDecided on 7 October.\n`);
  });

  it("touches no line break that is there", () => {
    const open = NOTE.trimEnd();
    expect(appendToNote(open, "More.")).toEqual({ ok: true, text: `${open}\n\nMore.\n` });
    const airy = `${NOTE}\n\n`;
    expect(appendToNote(airy, "More.")).toEqual({ ok: true, text: `${airy}More.\n` });
    expect(appendToNote("", "First words.")).toEqual({ ok: true, text: "First words.\n" });
    expect(appendToNote("---\na: 1\n---\n", "First words.")).toEqual({ ok: true, text: "---\na: 1\n---\n\nFirst words.\n" });
  });

  it("goes to the end of a section, in front of the next one", () => {
    const outcome = appendToNote(NOTE, "Gutter: 600", "Costs");
    expect(outcome.ok && outcome.text).toBe(NOTE.replace("Roof: 4,000\n\n## Next", "Roof: 4,000\n\nGutter: 600\n\n## Next"));
    // By its chain as get_outline writes it, and case-blind.
    expect(appendToNote(NOTE, "Gutter: 600", "plan > costs")).toEqual(outcome);
    // The last section ends with the note.
    expect(appendToNote(NOTE, "- Order the tiles", "Next")).toEqual({ ok: true, text: `${NOTE}\n- Order the tiles\n` });
  });

  it("keeps a section's subsections inside it", () => {
    const outcome = appendToNote(NOTE, "All of it by June.", "Plan");
    // "Plan" is the first heading and everything is below it: its end is the note's.
    expect(outcome.ok && outcome.text).toBe(`${NOTE}\nAll of it by June.\n`);
  });

  it("says so where there is no such section, or two of the name", () => {
    expect(appendToNote(NOTE, "x", "Budget")).toEqual({ ok: false, problem: "no-section" });
    const two = `${NOTE}\n## Costs\n\nAgain\n`;
    expect(appendToNote(two, "x", "Costs")).toEqual({ ok: false, problem: "ambiguous" });
    expect(appendToNote(two, "x", "Plan > Costs")).toEqual({ ok: false, problem: "ambiguous" });
    // The chain tells two sections of one name apart where it differs.
    const apart = `${NOTE}\n# Later\n\n## Costs\n\nAgain\n`;
    expect(appendToNote(apart, "x", "Costs")).toEqual({ ok: false, problem: "ambiguous" });
    expect(appendToNote(apart, "Paint: 300", "Later > Costs")).toEqual({ ok: true, text: `${apart}\nPaint: 300\n` });
  });

  it("refuses nothing to add, and too much", () => {
    expect(appendToNote(NOTE, "  \n ")).toEqual({ ok: false, problem: "empty" });
    expect(appendToNote(NOTE, "x".repeat(NOTE_EDIT_LIMITS.append + 1))).toEqual({ ok: false, problem: "too-long" });
  });

  it("adds in the note's own line endings and drops the addition's own blank lines around it", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    expect(appendToNote(crlf, "\n\nOne\nTwo\n\n")).toEqual({ ok: true, text: `${crlf}\r\nOne\r\nTwo\r\n` });
  });
});
