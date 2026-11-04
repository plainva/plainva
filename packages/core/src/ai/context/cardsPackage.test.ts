import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "../../frontmatter-surgical.js";
import type { EgressRecipient } from "../egressGate.js";
import { DEFAULT_AI_POLICY, effectivePolicy, notePolicyFrom } from "../policy.js";
import { buildContextPackage, type ContextBuildHost, type SituationInput } from "./package.js";
import type { Candidate } from "./ranking.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };

const files: Record<string, string> = {
  "Projects/Offer.md": "# Offer\n\nIntro.\n\n## Costs\n\nWe talked for a while. The rate stays at 95 EUR per hour until 31.12.2026. Everyone liked the coffee.",
  "Projects/Contract.md": "# Contract\n\nSigned in spring. Travel is not included. The weather was nice.",
  "Private/Diary.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Diary\n\nThe rate worried me on 02.10.",
  "Journal/2026-09-30.md": "# Tuesday\n\n- 09:12 Walk to the studio\n📍 52.5200, 13.4050\n- 11:00 The rate is fine.",
};

const host: ContextBuildHost = {
  async policyOf(path, content) {
    const source = content ?? files[path] ?? "";
    const plainva = readFrontmatterPath(source, ["plainva"]);
    return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), [], DEFAULT_AI_POLICY);
  },
  resolveLink: async () => null,
  async readNote(path) {
    const text = files[path];
    return text === undefined ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
  },
};

const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

const weak = (path: string, signals: Candidate["signals"]): Candidate => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), signals, snippet: "a search excerpt" });

/** Plan KI-Harness P2b-2: a source further down goes as its context card, verbatim. */
describe("context cards in the package", () => {
  it("sends the section's first sentence and its protected sentences instead of the search excerpt", async () => {
    const pack = await buildContextPackage(
      { question: "what does the rate say", recipient: cloud, situation, candidates: [[weak("Projects/Offer.md", { lexical: 0.2 }), weak("Projects/Contract.md", { edited: 0.9 })]], pins: [] },
      host,
    );
    const offer = pack.refs.find((r) => r.path === "Projects/Offer.md")!;
    expect(offer).toMatchObject({ tier: "card", section: "Offer > Costs" });
    expect(pack.part.text).toContain("[[Offer]] (Projects/Offer.md) › Offer > Costs");
    expect(pack.part.text).toContain("We talked for a while. The rate stays at 95 EUR per hour until 31.12.2026.");
    expect(pack.part.text).not.toContain("Everyone liked the coffee");
    expect(pack.part.text).not.toContain("a search excerpt");
    // Without the question's words, the note's first section: its protected sentence goes along.
    expect(pack.part.text).toContain("Signed in spring. Travel is not included.");
    expect(pack.part.text).not.toContain("The weather was nice");
  });

  it("never carries a place stamp, though its digits would make it a protected line", async () => {
    const pack = await buildContextPackage(
      { question: "what does the rate say", recipient: cloud, situation, candidates: [[weak("Journal/2026-09-30.md", { lexical: 0.2 })]], pins: [] },
      host,
    );
    expect(pack.refs.find((r) => r.path === "Journal/2026-09-30.md")?.tier).toBe("card");
    expect(pack.part.text).toContain("- 11:00 The rate is fine.");
    expect(pack.part.text).not.toMatch(/52[.,]52/);
    expect(pack.redactions.places).toBe(1);
  });

  it("cards nothing of a note its own rule keeps from the cloud", async () => {
    const pack = await buildContextPackage(
      { question: "what does the rate say", recipient: cloud, situation, candidates: [[weak("Private/Diary.md", { lexical: 0.2 })]], pins: [] },
      host,
    );
    expect(pack.refs.find((r) => r.path === "Private/Diary.md")).toBeUndefined();
    expect(pack.part.text).not.toContain("02.10.");
    expect(pack.excluded.map((e) => e.path)).toEqual(["Private/Diary.md"]);
  });
});
