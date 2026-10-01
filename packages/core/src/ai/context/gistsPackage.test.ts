import { describe, expect, it } from "vitest";
import type { EgressRecipient } from "../egressGate.js";
import { DEFAULT_AI_POLICY, effectivePolicy } from "../policy.js";
import { gistSections } from "./gists.js";
import { buildContextPackage, type ContextBuildHost, type PackageGists, type SituationInput } from "./package.js";
import type { Candidate } from "./ranking.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

const COSTS = `We talked about the offer for a long while and agreed on the main points. The rate stays at 95 EUR per hour until 31.12.2026. Travel is not included. ${"Everyone liked the coffee and the view over the harbour. ".repeat(4)}`;
const files: Record<string, string> = {
  "Projects/Offer.md": `# Offer\n\n## Costs\n\n${COSTS}`,
  "Projects/Plan.md": "# Plan\n\nShoot in spring.",
  "Areas/Garden.md": "# Garden\n\nWater the tomatoes.",
};
const costsKey = gistSections(files["Projects/Offer.md"]!).find((s) => s.chain === "Offer > Costs")!.key;

function gistsWith(sections: Record<string, string>, notes: Record<string, string> = {}, areas: Record<string, string> = {}, vault: string | null = null): PackageGists {
  return {
    section: async (key) => sections[key] ?? null,
    note: async (path) => notes[path] ?? null,
    area: async (area) => areas[area] ?? null,
    vault: async () => vault,
  };
}

const host = (gists?: PackageGists): ContextBuildHost => ({
  policyOf: async (path) => effectivePolicy(path, {}, [], DEFAULT_AI_POLICY),
  resolveLink: async () => null,
  readNote: async (path) => (files[path] === undefined ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text: files[path]! }),
  ...(gists ? { gists } : {}),
});

/** A card candidate (weak words), a map candidate (recent) — what a message brings in. */
const candidates: Candidate[][] = [
  [
    { path: "Projects/Offer.md", title: "Offer", signals: { lexical: 0.2 } },
    { path: "Projects/Plan.md", title: "Plan", signals: { edited: 0.1 } },
  ],
];

/** Plan KI-Harness P2b-3: a checked gist goes instead of the verbatim card, and only then. */
describe("gists in the package", () => {
  it("sends a section's checked gist instead of its card, marked as a gist", async () => {
    const gist = "Rate 95 EUR/h until 31.12.2026; travel not included.";
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [], budget: { cards: 1, evidence: 0 } }, host(gistsWith({ [costsKey]: gist })));
    expect(pack.refs.find((r) => r.path === "Projects/Offer.md")).toMatchObject({ tier: "card", gist: true, chars: gist.length });
    expect(pack.part.text).toContain(`(gist) ${gist}`);
    expect(pack.part.text).toContain("A card marked (gist) is a checked summary");
    expect(pack.part.text).not.toContain("Everyone liked the coffee");
  });

  it("sends the verbatim card when the gist drops a protected fact, or when the reader asks for the original", async () => {
    const dropped = gistsWith({ [costsKey]: "Rate 95 EUR/h until the end of the year." });
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [], budget: { cards: 1, evidence: 0 } }, host(dropped));
    expect(pack.refs.find((r) => r.path === "Projects/Offer.md")!.gist).toBeUndefined();
    expect(pack.part.text).toContain("The rate stays at 95 EUR per hour until 31.12.2026.");
    const original = await buildContextPackage(
      { question: "what is the rate", recipient: cloud, situation, candidates, pins: [], budget: { cards: 1, evidence: 0 }, originals: new Set(["Projects/Offer.md"]) },
      host(gistsWith({ [costsKey]: "Rate 95 EUR/h until 31.12.2026; travel not included." })),
    );
    expect(original.refs.find((r) => r.path === "Projects/Offer.md")!.gist).toBeUndefined();
  });

  it("gives a map handle its note's gist and names the areas and the vault", async () => {
    const pack = await buildContextPackage(
      { question: "what is the rate", recipient: cloud, situation, candidates, pins: [], budget: { cards: 0, evidence: 0 } },
      host(gistsWith({}, { "Projects/Plan.md": "A plan to shoot in spring." }, { Projects: "Film projects of the studio." }, "Notes of a small film studio.")),
    );
    expect(pack.part.text).toContain("- [[Plan]] (Projects/Plan.md) — (gist) A plan to shoot in spring.");
    expect(pack.part.text).toContain("- Projects/ — Film projects of the studio.");
    expect(pack.part.text).toContain("- The vault — Notes of a small film studio.");
  });

  it("sends no gist at all without a model on this computer", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [], budget: { cards: 1, evidence: 0 } }, host());
    expect(pack.refs.some((r) => r.gist)).toBe(false);
    expect(pack.part.text).not.toContain("(gist)");
  });
});
