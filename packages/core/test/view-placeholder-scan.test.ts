import { describe, expect, it } from "vitest";
import { ReaderView, carriesViewPlaceholder, rawChangeOf } from "../src/ai/index.ts";
import { within } from "./helpers/timeBudget.js";

/**
 * The placeholders of a view are found by a scan (code scanning #278, js/polynomial-redos): the expression it
 * replaces, kept here as the reference, read the rest of a line again from every `⟦withheld ` that never closed —
 * quadratic in a text a model or an app wrote. The scan finds exactly what the expression found.
 */
const REFERENCE = /⟦(?:withheld [^⟧\n]*|place withheld)⟧/u;
const N = 20_000;

describe("placeholders of a view", () => {
  it("finds the placeholders a view writes, and nothing else", () => {
    for (const text of ["⟦withheld note⟧", "a ⟦withheld link to a note⟧ b", "⟦place withheld⟧", "x⟦withheld ⟧", "⟦withheld a ⟦withheld b⟧"]) {
      expect(carriesViewPlaceholder(text), text).toBe(true);
    }
    for (const text of ["", "⟦withheld note", "⟦withheld note\n⟧", "⟦withheldnote⟧", "⟦place withheld ⟧", "withheld note⟧", "⟦Withheld note⟧"]) {
      expect(carriesViewPlaceholder(text), text).toBe(false);
    }
  });

  it("agrees with the expression it replaces on every text of its marks", () => {
    const parts = ["⟦", "⟧", "withheld ", "place withheld", "\n", "x", " "];
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let round = 0; round < 20_000; round++) {
      let text = "";
      for (let i = next() % 9; i > 0; i--) text += parts[next() % parts.length];
      expect(carriesViewPlaceholder(text), JSON.stringify(text)).toBe(REFERENCE.test(text));
    }
  });

  it("counts placeholders as the expression did when a change is weighed", () => {
    // Nothing withheld: a text that brings a placeholder in is refused, one that keeps the count is taken.
    const view = ReaderView.of("before ⟦withheld note⟧ after");
    expect(rawChangeOf(view, "before ⟦withheld note⟧ after, more")).toEqual({ ok: true, raw: "before ⟦withheld note⟧ after, more" });
    expect(rawChangeOf(view, "⟦place withheld⟧ before ⟦withheld note⟧ after")).toEqual({ ok: false, problem: "withheld-part" });
    expect(rawChangeOf(view, "⟦withheld ⟦withheld note⟧ x")).toEqual({ ok: true, raw: "⟦withheld ⟦withheld note⟧ x" });
  });

  it("stays linear on a long line of openings that never close", () => {
    const hostile = "⟦withheld ".repeat(N);
    within(1_000, () => expect(carriesViewPlaceholder(hostile)).toBe(false));
    within(1_000, () => expect(carriesViewPlaceholder(`${hostile}⟧`)).toBe(true));
    within(1_000, () => expect(rawChangeOf(ReaderView.of("a"), hostile)).toEqual({ ok: true, raw: hostile }));
  });
});
