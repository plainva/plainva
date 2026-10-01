import { describe, expect, it } from "vitest";
import type { EgressRecipient } from "../egressGate.js";
import { DEFAULT_AI_POLICY, effectivePolicy } from "../policy.js";
import { buildContextPackage, type ContextBuildHost, type SituationInput } from "./package.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

const OFFER = `# Offer\n\nIntro.\n\n## Costs\n\nThe rate stays at 95 EUR per hour.\n\n## History\n\n${"Long background. ".repeat(60)}`;
const files: Record<string, string> = {
  "Offer.md": OFFER,
  "Contract.md": "# Contract\n\nSigned in spring. Travel is not included.",
  "Garden.md": "# Garden\n\nWater the tomatoes.",
};

const host = (sizes?: Record<string, number>): ContextBuildHost => ({
  policyOf: async (path) => effectivePolicy(path, {}, [], DEFAULT_AI_POLICY),
  resolveLink: async () => null,
  readNote: async (path) => (files[path] === undefined ? null : { title: path.replace(/\.md$/, ""), text: files[path]! }),
  ...(sizes ? { noteSizes: async (paths: readonly string[]) => new Map(paths.filter((p) => p in sizes).map((p) => [p, sizes[p]!])) } : {}),
});

/** Plan KI-Harness P2b-5: what a package saves, for "View context". */
describe("the material of a package", () => {
  const candidates = [
    [
      { path: "Offer.md", title: "Offer", signals: { lexical: 1 } },
      { path: "Contract.md", title: "Contract", signals: { lexical: 0.2 } },
      { path: "Garden.md", title: "Garden", signals: { edited: 0.1 } },
    ],
  ];

  it("counts what goes against the whole notes it stands for", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [] }, host());
    const offer = pack.refs.find((r) => r.path === "Offer.md")!;
    expect(offer.tier).toBe("evidence");
    expect(offer.noteChars).toBeGreaterThan(offer.chars);
    expect(pack.material.sentChars).toBe(pack.refs.reduce((sum, r) => sum + r.chars, 0));
    expect(pack.material.sourceChars).toBeGreaterThan(pack.material.sentChars);
    // Without note sizes there is no naive comparison.
    expect(pack.material.candidateChars).toBeNull();
  });

  it("knows what every proposed note would have cost when the host knows their sizes", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [] }, host({ "Offer.md": 1300, "Contract.md": 60, "Garden.md": 30 }));
    expect(pack.material.candidateChars).toBe(1390);
  });
});
