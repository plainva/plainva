import { describe, expect, it } from "vitest";
import { answerCoverage, answerStatements } from "./coverage.js";

/** Plan KI-Harness P2b-5: coverage after the answer — how many statements name a note. */
describe("answer coverage", () => {
  it("counts paragraphs and list items of prose, not headings, code, tables or short phrases", () => {
    const answer = [
      "## Rates",
      "",
      "Here is what your notes say about the rate:",
      "",
      "- The rate stays at 95 EUR per hour until the end of the year [[Offer 2026]].",
      "- Travel is not included in the framework contract [[Framework contract]].",
      "",
      "```",
      "rate = 95",
      "```",
      "",
      "| a | b |",
      "Sources:",
    ].join("\n");
    expect(answerStatements(answer)).toEqual([
      "Here is what your notes say about the rate:",
      "The rate stays at 95 EUR per hour until the end of the year [[Offer 2026]].",
      "Travel is not included in the framework contract [[Framework contract]].",
    ]);
    expect(answerCoverage(answer)).toEqual({ statements: 3, cited: 2, level: "partial" });
  });

  it("is high when nearly every statement names a note, low when almost none does", () => {
    const cited = "The rate stays at 95 EUR per hour [[Offer 2026]].\n\nTravel is not included in the contract [[Framework contract]].";
    expect(answerCoverage(cited).level).toBe("high");
    const bare = "The rate is probably about 95 EUR per hour.\n\nTravel is usually not included in such contracts.\n\nAsk the client [[Offer 2026]] to be sure of it.";
    expect(answerCoverage(bare).level).toBe("low");
  });

  it("has no level for an answer without a statement", () => {
    expect(answerCoverage("Sure!")).toEqual({ statements: 0, cited: 0, level: null });
  });
});
