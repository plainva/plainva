import { describe, expect, it } from "vitest";
import { wordDiff } from "@plainva/ui";

/** The word diff behind a suggestion card (K5). */
describe("wordDiff", () => {
  it("keeps untouched words and the spacing around a change", () => {
    expect(wordDiff("bis Ende des Jahres", "bis zum 31.12.2026")).toEqual([
      { kind: "same", text: "bis " },
      { kind: "del", text: "Ende des Jahres" },
      { kind: "ins", text: "zum 31.12.2026" },
    ]);
  });

  it("shows a deletion as struck words and an unchanged passage as plain", () => {
    expect(wordDiff("der Termin steht noch nicht fest.", "")).toEqual([{ kind: "del", text: "der Termin steht noch nicht fest." }]);
    expect(wordDiff("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    expect(wordDiff("", "")).toEqual([]);
  });

  it("falls back to the plain pair beyond the cap", () => {
    const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    const result = wordDiff(long, long + " tail");
    expect(result.map((s) => s.kind)).toEqual(["del", "ins"]);
  });
});
