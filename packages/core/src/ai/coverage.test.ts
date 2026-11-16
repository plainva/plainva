import { describe, expect, it } from "vitest";
import { answerCoverage, answerStatements, unfoundedNoteCitations } from "./coverage.js";

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

/** Plan Oberfläche O7, E2: a warning only where the answer names a note as its source that the run never had. */
describe("unfounded note citations", () => {
  const grounding = { sent: ["Projects/Website relaunch.md"], read: ["Areas/Roadmap.md"] };

  it("finds nothing when every cited note went along or was read", () => {
    const answer = "The site gets three pages [[Website relaunch]].\n\n- Launch is in May [[Areas/Roadmap|the roadmap]].\n- Hero first [[Website relaunch#Goals]].";
    expect(unfoundedNoteCitations(answer, grounding)).toEqual([]);
  });

  it("names a cited note the run neither sent nor read, once, as the answer spelled it", () => {
    const answer = "Pricing is settled [[Pricing 2026]].\n\nSee also [[pricing 2026|prices]] and [[Website relaunch]].";
    expect(unfoundedNoteCitations(answer, grounding)).toEqual(["Pricing 2026"]);
  });

  it("an answer without any link earns no warning — the calm line says what it rests on", () => {
    expect(unfoundedNoteCitations("Three feature pages instead of six.\n\n- Screenshots are missing.", grounding)).toEqual([]);
  });

  it("matches by path, file name, `.md`, case and the title a note goes by", () => {
    const answer = "[[projects/website relaunch.md]] [[ROADMAP]] [[Relaunch plan]]";
    expect(unfoundedNoteCitations(answer, { ...grounding, titles: ["Relaunch plan"] })).toEqual([]);
  });

  it("ignores embeds, links in code and links into the note's own headings", () => {
    const answer = ["![[diagram.png]]", "`[[Not a citation]]`", "```", "[[Inside a fence]]", "```", "Back to [[#Goals]]."].join("\n");
    expect(unfoundedNoteCitations(answer, grounding)).toEqual([]);
  });

  it("says nothing when the tools read more than the run listed: an unknown is no finding", () => {
    expect(unfoundedNoteCitations("Pricing is settled [[Pricing 2026]].", { ...grounding, readMore: true })).toEqual([]);
  });

  it("a run that had no notes and cites one is warned about it", () => {
    expect(unfoundedNoteCitations("Your plan says so [[Plan]].", { sent: [] })).toEqual(["Plan"]);
  });
});
