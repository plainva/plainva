import { describe, expect, it } from "vitest";
import type { EgressRecipient } from "../egressGate.js";
import { chunkNote } from "../embeddings/chunks.js";
import { DEFAULT_AI_POLICY, effectivePolicy } from "../policy.js";
import { buildContextPackage, type ContextBuildHost, type SituationInput } from "./package.js";
import { rankCandidates, type Candidate } from "./ranking.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };

const files: Record<string, string> = {
  "Film/Kickoff.md": "# Kick-off\n\nTen episodes are set.\n\n## Production\n\nTom suggests two blocks of two days, with editing in between.\n\n## Open\n\nAsk the studio about block two.",
  "Film/Kickoff copy.md": "# Kick-off\n\nTen episodes are set.\n\n## Production\n\nTom suggests two blocks of two days, with editing in between.",
  "Film/Budget.md": "# Budget\n\nThe quarterly budget review is on Friday.",
  "Film/Blocks.md": "Tom suggests two blocks of two days, with editing in between.",
  "Film/Blocks pinned.md": "Tom suggests two blocks of two days, with editing in between.",
};

const host: ContextBuildHost = {
  policyOf: async (path) => effectivePolicy(path, {}, [], DEFAULT_AI_POLICY),
  resolveLink: async () => null,
  async readNote(path) {
    const text = files[path];
    return text === undefined ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
  },
};

const situation: SituationInput = {
  now: "2026-10-01 09:00",
  weekday: "Thursday",
  calendarDay: "2026-10-01",
  journalDay: "2026-10-01",
  active: null,
  tabs: [],
  tasks: [],
  events: [],
  dailyNote: null,
};

/** The candidate search by meaning hands in: the note and its closest section. */
function byMeaning(path: string, chain: string, score = 1): Candidate {
  const chunk = chunkNote(path.replace(/^.*\//, "").replace(/\.md$/, ""), files[path]!).find((c) => c.chain === chain)!;
  return { path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), signals: { semantic: score }, chunk: { ordinal: chunk.ordinal, hash: chunk.hash } };
}

/** Plan KI-Harness P2b-1: meaning joins the words in the context of a message. */
describe("hybrid retrieval in the context package", () => {
  it("weighs meaning as much as the words, both above the graph, and words and meaning together above either", () => {
    const ranked = rankCandidates([
      { path: "a.md", title: "a", signals: { semantic: 1 } },
      { path: "b.md", title: "b", signals: { lexical: 1 } },
      { path: "c.md", title: "c", signals: { graph: 1 } },
      { path: "d.md", title: "d", signals: { lexical: 0.6, semantic: 0.6 } },
    ]);
    expect(ranked[0]!.path).toBe("d.md");
    expect(ranked.slice(1, 3).map((c) => c.score)).toEqual([ranked[1]!.score, ranked[1]!.score]);
    expect(ranked[3]!.path).toBe("c.md");
    expect(ranked.find((c) => c.path === "a.md")!.reasons).toEqual(["semantic"]);
  });

  it("sends the section a note was found by meaning in, not its beginning", async () => {
    const pack = await buildContextPackage(
      { question: "how do we split the shooting days", recipient: cloud, situation, candidates: [[byMeaning("Film/Kickoff.md", "Kick-off > Production")]], pins: [] },
      host,
    );
    const ref = pack.refs.find((r) => r.path === "Film/Kickoff.md")!;
    expect(ref).toMatchObject({ tier: "evidence", section: "Kick-off > Production", reasons: ["semantic"] });
    expect(pack.part.text).toContain("Tom suggests two blocks of two days");
    expect(pack.part.text).not.toContain("Ask the studio");
  });

  it("keeps a word's section when the words found the note too", async () => {
    const both: Candidate = { ...byMeaning("Film/Kickoff.md", "Kick-off > Production"), signals: { semantic: 1, lexical: 1 } };
    const pack = await buildContextPackage({ question: "studio", recipient: cloud, situation, candidates: [[both]], pins: [] }, host);
    expect(pack.refs.find((r) => r.path === "Film/Kickoff.md")!.section).toBe("Kick-off > Open");
  });

  it("sends the same section once, however many notes hold it", async () => {
    const pack = await buildContextPackage(
      {
        question: "how do we split the shooting days",
        recipient: cloud,
        situation,
        candidates: [[byMeaning("Film/Kickoff.md", "Kick-off > Production", 1), byMeaning("Film/Kickoff copy.md", "Kick-off > Production", 0.99)]],
        pins: [],
      },
      host,
    );
    expect(pack.refs.filter((r) => r.tier === "evidence").map((r) => r.path)).toEqual(["Film/Kickoff.md"]);
    // The copy is named, not sent again.
    expect(pack.refs.find((r) => r.path === "Film/Kickoff copy.md")?.tier).toBe("map");
    expect(pack.part.text.split("Tom suggests two blocks").length).toBe(2);
  });

  it("never drops a pinned note for repeating a found one", async () => {
    // Words and meaning together rank the found note above the pin; the pin still goes.
    const found: Candidate = { path: "Film/Blocks.md", title: "Blocks", signals: { lexical: 1, semantic: 1 } };
    const pinned: Candidate = { path: "Film/Blocks pinned.md", title: "Blocks pinned", signals: { pinned: 1 } };
    const pack = await buildContextPackage({ question: "blocks", recipient: cloud, situation, candidates: [[found, pinned]], pins: [] }, host);
    expect(pack.refs.filter((r) => r.tier === "evidence").map((r) => r.path)).toEqual(["Film/Blocks.md", "Film/Blocks pinned.md"]);
  });

  it("leaves a weak meaning hit out of the evidence", async () => {
    const pack = await buildContextPackage(
      { question: "how do we split the shooting days", recipient: cloud, situation, candidates: [[byMeaning("Film/Kickoff.md", "Kick-off > Production", 0.4)]], pins: [] },
      host,
    );
    expect(pack.refs.find((r) => r.path === "Film/Kickoff.md")?.tier).toBe("card");
  });
});
