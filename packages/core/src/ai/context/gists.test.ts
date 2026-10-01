import { describe, expect, it } from "vitest";
import { checkGist, gistKey, gistOfGists, gistSections, protectedTokens } from "./gists.js";
import { noteBody, sectionAt } from "./sections.js";

const NOTE = [
  "---",
  "status: draft",
  "---",
  "# Offer",
  "",
  "Intro text.",
  "",
  "## Costs",
  "",
  "The rate stays at 95 EUR per hour until 31.12.2026. Travel is not included. See [[Framework contract]] and https://example.org/terms.",
  "",
  "## Next",
  "",
  "Send it to @tom with the tag #offer.",
].join("\n");

/** Plan KI-Harness P2b-3: gists keep what a summary must never change, or they are not used. */
describe("gists", () => {
  it("cuts a note's sections the way a context card does, under the key of their exact text", () => {
    const sections = gistSections(NOTE);
    // "Offer" holds further headings: left to the note's gist.
    expect(sections.map((s) => s.chain)).toEqual(["Offer > Costs", "Offer > Next"]);
    const costs = sectionAt(noteBody(NOTE), 7);
    expect(sections.find((s) => s.chain === "Offer > Costs")!.key).toBe(gistKey(costs.text));
  });

  it("names what a section's gist must keep word for word", () => {
    const costs = gistSections(NOTE).find((s) => s.chain === "Offer > Costs")!.text;
    expect(protectedTokens(costs).sort()).toEqual(["31.12.2026", "95", "[[Framework contract]]", "https://example.org/terms"].sort());
    expect(protectedTokens("Send it to @tom with the tag #offer.").sort()).toEqual(["#offer", "@tom"].sort());
  });

  it("takes a section's gist only when it keeps every protected token and every negation, and is shorter", () => {
    const source = "The rate stays at 95 EUR per hour until 31.12.2026, as agreed in the long meeting. Travel is not included in it.";
    expect(checkGist("section", source, "Rate 95 EUR/h until 31.12.2026; travel not included.").ok).toBe(true);
    expect(checkGist("section", source, "Rate 95 EUR/h until the end of 2026; travel not included.")).toMatchObject({ ok: false, problems: ["31.12.2026"] });
    expect(checkGist("section", source, "Rate 95 EUR/h until 31.12.2026; travel included.")).toMatchObject({ ok: false, problems: ["(negation)"] });
    expect(checkGist("section", source, `${source} And more.`).ok).toBe(false);
    expect(checkGist("section", source, "   ").ok).toBe(false);
  });

  it("takes a gist of gists only when it makes up nothing its parts do not hold", () => {
    const parts = gistOfGists([
      { label: "Costs", key: "k1", gist: "Rate 95 EUR/h until 31.12.2026." },
      { label: "Next", key: "k2", gist: "Send it to @tom." },
    ]);
    expect(parts.text).toBe("Costs: Rate 95 EUR/h until 31.12.2026.\nNext: Send it to @tom.");
    expect(checkGist("note", parts.text, "An offer at 95 EUR/h, to be sent to @tom.").ok).toBe(true);
    expect(checkGist("note", parts.text, "An offer at 120 EUR/h.")).toMatchObject({ ok: false, problems: ["120"] });
    // The key of the whole follows its parts' keys, not their wording.
    expect(gistOfGists([{ label: "Costs", key: "k1", gist: "other words" }]).key).toBe(gistOfGists([{ label: "Costs", key: "k1", gist: "Rate 95." }]).key);
  });
});
