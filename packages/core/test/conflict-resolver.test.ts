import { describe, it, expect } from "vitest";
import { containsTextChanges, mergeText, mergeEditorText } from "../src/conflict-resolver.js";

describe("editor input during a confirmed write", () => {
  it("keeps independent words and trailing input on the same line", () => {
    expect(mergeEditorText("Welcome to the vault!", "Welcome to the vault! More writing.", "Welcome to the garden!"))
      .toEqual({ mergedText: "Welcome to the garden! More writing.", hasConflicts: false });
  });
  it("does not invent a combined word from conflicting edits to the same word", () => {
    expect(mergeEditorText("A cat.", "A bat.", "A car.").hasConflicts).toBe(true);
  });
  it("retains Unicode and whitespace exactly in a same-line merge", () => {
    expect(mergeEditorText("Hier  steht ein Baum 🌳.", "Hier  steht ein Baum 🌳.\tWeiter!", "Hier  steht ein Haus 🏠."))
      .toEqual({ mergedText: "Hier  steht ein Haus 🏠.\tWeiter!", hasConflicts: false });
  });
  it("keeps competing insertions at the same place as a conflict", () => {
    expect(mergeEditorText("A B", "A X B", "A Y B").hasConflicts).toBe(true);
  });
  it("trims large shared context but bounds divergent fallback work", () => {
    const prefix = "same word ".repeat(5000);
    expect(mergeEditorText(prefix + "old end", prefix + "old end more", prefix + "new end"))
      .toEqual({ mergedText: prefix + "new end more", hasConflicts: false });
    const many = Array.from({ length: 1600 }, (_, i) => `word${i}`).join(" ");
    expect(mergeEditorText(many, many.replaceAll("word", "left"), many.replaceAll("word", "right")).hasConflicts).toBe(true);
  });
});

describe("Conflict Resolver", () => {
  it("should merge changes from different parts of the document cleanly", () => {
    const base = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    const yours = "Line 1\nLine 2 changed\nLine 3\nLine 4\nLine 5";
    const theirs = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5 changed";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("Line 1\nLine 2 changed\nLine 3\nLine 4\nLine 5 changed");
  });

  it("should detect conflicts when changes overlap", () => {
    const base = "Line 1\nLine 2\nLine 3";
    const yours = "Line 1\nLine 2 yours\nLine 3";
    const theirs = "Line 1\nLine 2 theirs\nLine 3";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(true);
    expect(result.mergedText).toContain("<<<<<<<");
    expect(result.mergedText).toContain("Line 2 yours");
    expect(result.mergedText).toContain("=======");
    expect(result.mergedText).toContain("Line 2 theirs");
    expect(result.mergedText).toContain(">>>>>>>");
  });

  it("should cleanly apply identical changes", () => {
    const base = "Line 1\nLine 2\nLine 3";
    const yours = "Line 1\nLine 2 changed\nLine 3";
    const theirs = "Line 1\nLine 2 changed\nLine 3";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("Line 1\nLine 2 changed\nLine 3");
  });

  it("should handle empty documents", () => {
    const base = "";
    const yours = "New Line";
    const theirs = "";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("New Line");
  });

  it("returns the remote text unchanged when only theirs changed (no echo of base)", () => {
    const base = "Line 1\nLine 2";
    const theirs = "Line 1\nLine 2 remote";

    const result = mergeText(base, base, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe(theirs);
  });

  it("merges multiple disjoint hunks from both sides", () => {
    const base = "A\nB\nC\nD\nE\nF\nG";
    const yours = "A changed\nB\nC\nD\nE\nF\nG";
    const theirs = "A\nB\nC\nD changed\nE\nF\nG changed";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("A changed\nB\nC\nD changed\nE\nF\nG changed");
  });

  it("merges a local prepend with a remote append", () => {
    const base = "Middle";
    const yours = "Intro\nMiddle";
    const theirs = "Middle\nOutro";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("Intro\nMiddle\nOutro");
  });

  it("treats edits on adjacent lines as a conflict (documented diff3 granularity)", () => {
    // Frontmatter fields sit on neighboring lines, so a local title edit and a
    // remote tag edit overlap for diff3 — this is why simultaneous edits of
    // adjacent frontmatter fields surface as a .CONFLICT instead of auto-merging.
    const base = "---\ntitle: Alt\ntags: []\n---\nBody";
    const yours = "---\ntitle: Neu\ntags: []\n---\nBody";
    const theirs = "---\ntitle: Alt\ntags: [wissen]\n---\nBody";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(true);
    expect(result.mergedText).toContain("<<<<<<<");
  });

  it("merges a frontmatter edit with a body edit cleanly", () => {
    const base = "---\ntitle: Alt\ntags: []\n---\n\nBody Zeile";
    const yours = "---\ntitle: Neu\ntags: []\n---\n\nBody Zeile";
    const theirs = "---\ntitle: Alt\ntags: []\n---\n\nBody Zeile geändert";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("---\ntitle: Neu\ntags: []\n---\n\nBody Zeile geändert");
  });

  // Until 2026-10-09 this test read "normalizes CRLF input to LF in the merged
  // output (documented behavior)". The behaviour was a side effect of joining
  // lines with "\n", and it rewrote every line end of a file that two devices
  // had changed. A merge changes the lines that were changed.
  it("keeps CRLF in the merged output", () => {
    const base = "Line 1\r\nLine 2\r\nLine 3";
    const yours = "Line 1 changed\r\nLine 2\r\nLine 3";
    const theirs = "Line 1\r\nLine 2\r\nLine 3 changed";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("Line 1 changed\r\nLine 2\r\nLine 3 changed");
  });
});

describe("a merge and the shape of the file", () => {
  // Built at run time: the mark is never typed into this file.
  const MARK = String.fromCharCode(0xfeff);

  it("merges a file with a byte order mark and keeps the mark", () => {
    const base = `${MARK}one\r\ntwo\r\nthree\r\n`;
    const result = mergeText(base, `${MARK}one here\r\ntwo\r\nthree\r\n`, `${MARK}one\r\ntwo\r\nthree there\r\n`);
    expect(result).toEqual({ mergedText: `${MARK}one here\r\ntwo\r\nthree there\r\n`, hasConflicts: false });
  });

  it("does not take a mark only one version carries for a change of the first line", () => {
    // What a pull used to hand over: the remote version decoded without its
    // mark, the local one with it. Both "changed" the first line, and a file
    // with a mark could not be merged — every change from two sides ended in
    // a conflict copy.
    const base = "one\ntwo\nthree\n";
    const result = mergeText(base, `${MARK}one\ntwo\nthree here\n`, "one there\ntwo\nthree\n");
    expect(result).toEqual({ mergedText: `${MARK}one there\ntwo\nthree here\n`, hasConflicts: false });
  });

  it("lets a side turn the line ends, and merges the other side's lines into the turned file", () => {
    const base = "one\r\ntwo\r\nthree\r\n";
    expect(mergeText(base, "one\ntwo\nthree\n", "one\r\ntwo\r\nthree there\r\n"))
      .toEqual({ mergedText: "one\ntwo\nthree there\n", hasConflicts: false });
    expect(mergeText(base, "one here\r\ntwo\r\nthree\r\n", "one\ntwo\nthree\n"))
      .toEqual({ mergedText: "one here\ntwo\nthree\n", hasConflicts: false });
  });

  it("brings a file with a stray line end to its majority, as an editor's save does", () => {
    const base = "one\r\ntwo\r\nthree\nfour\r\n";
    const result = mergeText(base, "one here\r\ntwo\r\nthree\nfour\r\n", "one\r\ntwo\r\nthree\nfour there\r\n");
    expect(result).toEqual({ mergedText: "one here\r\ntwo\r\nthree\r\nfour there\r\n", hasConflicts: false });
  });

  it("keeps the shape through the same-line merge of an editor's save", () => {
    const base = `${MARK}Welcome to the vault!\r\nSecond line.\r\n`;
    const yours = `${MARK}Welcome to the vault! More writing.\r\nSecond line.\r\n`;
    const theirs = `${MARK}Welcome to the garden!\r\nSecond line.\r\n`;
    // The two edits share a line, so the line merge conflicts and the words decide.
    expect(mergeText(base, yours, theirs).hasConflicts).toBe(true);
    expect(mergeEditorText(base, yours, theirs))
      .toEqual({ mergedText: `${MARK}Welcome to the garden! More writing.\r\nSecond line.\r\n`, hasConflicts: false });
    // …and a line end written two ways is no difference between the words around it.
    expect(mergeEditorText(base, yours, "Welcome to the garden!\nSecond line.\n"))
      .toEqual({ mergedText: "Welcome to the garden! More writing.\nSecond line.\n", hasConflicts: false });
  });

  it("hands a side back byte for byte where the merge took nothing from the other one", () => {
    // A file with a stray line end that only THIS side changed: the result is
    // this side as it lies there. Put together anew it came back with the
    // stray line end turned — a write, and an upload, of a file nobody edited.
    const base = "one\r\ntwo\r\nthree\r\n";
    const mine = "one\r\ntwo\r\nthree\r\nfour\nfive\r\n";
    expect(mergeText(base, mine, base)).toEqual({ mergedText: mine, hasConflicts: false });
    // The other way round: only the other side changed, with a stray line end of its own.
    expect(mergeText(base, base, mine)).toEqual({ mergedText: mine, hasConflicts: false });
    // Both changed: the lines are put together, and the file goes to its majority.
    expect(mergeText(base, "one!\r\ntwo\r\nthree\r\n", mine))
      .toEqual({ mergedText: "one!\r\ntwo\r\nthree\r\nfour\r\nfive\r\n", hasConflicts: false });
  });

  it("answers a real conflict as before, whatever the line ends", () => {
    const result = mergeText("one\r\ntwo\r\n", "one mine\r\ntwo\r\n", "one theirs\r\ntwo\r\n");
    expect(result.hasConflicts).toBe(true);
    expect(result.mergedText).toContain("one mine");
    expect(result.mergedText).toContain("one theirs");
  });

  it("finds an intended change in a read-back whose line ends are not uniform", () => {
    // The file reads back exactly as written, with one line end of the other
    // kind in it — and another program added a line meanwhile.
    const before = "one\r\ntwo\nthree\r\n";
    expect(containsTextChanges(before, "one!\r\ntwo\r\nthree\r\n", "one!\r\ntwo\nthree\r\nfour\r\n")).toBe(true);
    expect(containsTextChanges(before, "one!\r\ntwo\r\nthree\r\n", "one\r\ntwo\nthree\r\nfour\r\n")).toBe(false);
  });
});
