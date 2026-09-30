import { describe, expect, it } from "vitest";
import { MAX_ANCHOR_QUOTE_BYTES } from "@plainva/core";
import { askMessage, passageOf, relocate, selectionChunks, selectionInstruction, type SuggestionChunk } from "@plainva/ui";

/** The note after every chunk of a round was accepted. */
function accepted(doc: string, chunks: readonly SuggestionChunk[]): string {
  let out = doc;
  for (const chunk of [...chunks].sort((a, b) => b.fromA - a.fromA)) out = out.slice(0, chunk.fromA) + chunk.replacement + out.slice(chunk.toA);
  return out;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Plan KI-Harness P1.5: what the AI does with a selected passage. */
describe("the AI at a selection", () => {
  it("asks in English and names the target language of a translation", () => {
    expect(selectionInstruction("translate", "German")).toContain("into German");
    expect(selectionInstruction("rewrite")).toContain("its language");
    expect(selectionInstruction("tasks")).toContain("- [ ]");
    expect(askMessage("explain")).toBe("Explain the selected passage.");
    expect(askMessage("ask")).toBeNull();
  });

  it("takes the passage out of a fence or one pair of quotation marks, and leaves quotes inside alone", () => {
    expect(passageOf("```markdown\nThe new text.\n```")).toBe("The new text.");
    expect(passageOf("  “The new text.”  ")).toBe("The new text.");
    expect(passageOf("„Der neue Text.“")).toBe("Der neue Text.");
    expect(passageOf('"One" and "two"')).toBe('"One" and "two"');
    expect(passageOf("Plain.")).toBe("Plain.");
    expect(passageOf("```\n```")).toBe("");
  });

  it("finds the passage where it was, or at its one occurrence; a changed or repeated passage is lost", () => {
    const doc = "Intro.\n\nThe contract runs a year.\n";
    const from = doc.indexOf("The contract");
    const text = "The contract runs a year.";
    expect(relocate(doc, from, from + text.length, text)).toEqual({ from, to: from + text.length });
    const moved = `New line.\n${doc}`;
    expect(relocate(moved, from, from + text.length, text)).toEqual({ from: from + 10, to: from + 10 + text.length });
    expect(relocate(`${doc}${text}`, from + 1, from + 1 + text.length, text)).toBeNull();
    expect(relocate("Something else.", from, from + text.length, text)).toBeNull();
  });

  it("lays a rewrite on the whole note as clause-sized changes that give the rewrite when accepted", () => {
    const doc = "# Offer\n\nThe contract runs until the end of the year and renews itself.\n\nRates follow.\n";
    const text = "The contract runs until the end of the year and renews itself.";
    const from = doc.indexOf(text);
    const rewrite = "The contract runs until the end of the year; then it renews itself.";
    const chunks = selectionChunks(doc, from, from + text.length, rewrite, "replace");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.fromA).toBeGreaterThanOrEqual(from);
      expect(chunk.toA).toBeLessThanOrEqual(from + text.length);
    }
    expect(accepted(doc, chunks)).toBe(doc.replace(text, rewrite));
    expect(selectionChunks(doc, from, from + text.length, text, "replace")).toEqual([]);
  });

  it("puts tasks after the passage as a paragraph of their own", () => {
    const doc = "Call Tom about the rates.\nMore.";
    const to = "Call Tom about the rates.".length;
    const chunks = selectionChunks(doc, 0, to, "  - [ ] Call Tom\n", "insert");
    expect(chunks).toEqual([{ fromA: to, toA: to, replacement: "\n\n- [ ] Call Tom\n" }]);
    expect(accepted(doc, chunks)).toBe("Call Tom about the rates.\n\n- [ ] Call Tom\n\nMore.");
    expect(selectionChunks(doc, 0, to, "  \n", "insert")).toEqual([]);
  });

  it("never quotes more than an anchor holds: a long change is cut at whitespace into pieces", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const doc = `Start.\n\n${long}\n\nEnd.\n`;
    const from = doc.indexOf(long);
    const chunks = selectionChunks(doc, from, from + long.length, "Short.", "replace");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(bytes(doc.slice(chunk.fromA, chunk.toA))).toBeLessThanOrEqual(MAX_ANCHOR_QUOTE_BYTES);
    expect(accepted(doc, chunks)).toBe(doc.replace(long, "Short."));
  });

  it("never splits a character between two pieces", () => {
    const long = "😀".repeat(400);
    const doc = `A\n${long}\nB`;
    const from = doc.indexOf(long);
    const chunks = selectionChunks(doc, from, from + long.length, "x", "replace");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const quote = doc.slice(chunk.fromA, chunk.toA);
      // A lone surrogate cannot be URI-encoded: the quote holds whole characters only.
      expect(() => encodeURIComponent(quote)).not.toThrow();
      expect(bytes(quote)).toBeLessThanOrEqual(MAX_ANCHOR_QUOTE_BYTES);
    }
    expect(accepted(doc, chunks)).toBe("A\nx\nB");
  });
});
