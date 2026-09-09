import { describe, it, expect } from "vitest";
import { mergeText, mergeEditorText } from "../src/conflict-resolver.js";

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

  it("normalizes CRLF input to LF in the merged output (documented behavior)", () => {
    const base = "Line 1\r\nLine 2\r\nLine 3";
    const yours = "Line 1 changed\r\nLine 2\r\nLine 3";
    const theirs = "Line 1\r\nLine 2\r\nLine 3 changed";

    const result = mergeText(base, yours, theirs);

    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("Line 1 changed\nLine 2\nLine 3 changed");
  });
});
