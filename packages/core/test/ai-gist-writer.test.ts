import { describe, expect, it } from "vitest";
import { turns } from "../src/ai/context/cards.js";
import { gistSections, protectedTokens } from "../src/ai/context/gists.js";
import { GistStore, resetGistStores } from "../src/ai/context/gistStore.js";
import { GistReader, GistWriter, type GistModel } from "../src/ai/context/gistWriter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

const filler = (topic: string) => `${`The team talked about ${topic} at length and agreed to keep going. `.repeat(12)}`;

const NOTES: Record<string, string> = {
  "Projects/Offer.md": `# Offer\n\n## Costs\n\n${filler("the offer")}The rate stays at 95 EUR per hour until 31.12.2026. Travel is not included.\n\n## Team\n\n${filler("the crew")}Ask @tom about [[Studio Harbour]].`,
  "Projects/Plan.md": `# Plan\n\n${filler("the plan")}Shoot in spring 2027.`,
  "Private/Diary.md": `---\nplainva:\n  ai:\n    cloud: deny\n---\n# Diary\n\n${filler("the diary")}A private line from 02.10.`,
  "Private/Health.md": `# Health\n\n${filler("health")}Check-up on 12.11.`,
  "Short.md": "# Short\n\nA short note.",
};

/** A stand-in model: keeps every protected token and a negation, nothing else — so every check passes. */
function model(): GistModel & { asked: string[] } {
  const asked: string[] = [];
  return {
    id: "ollama/m",
    asked,
    async complete(instruction, text) {
      asked.push(instruction.slice(0, 30));
      const tokens = instruction.includes("note section") ? protectedTokens(text) : [];
      return `${["Summary", ...tokens].join(" ")}${instruction.includes("note section") && turns(text) ? " not" : ""}.`;
    },
  };
}

/** File times in milliseconds: every write moves the vault's clock on by one. */
const START = 1_700_000_000_000;

async function vault(notes: Record<string, string> = NOTES) {
  resetGistStores();
  const db = await realSqlite();
  const files = new MemoryVaultAdapter(START);
  for (const [path, text] of Object.entries(notes)) await files.writeTextFile(path, text);
  await new VaultIndexer(files, db).indexVaultFull();
  const disk = { ...notes };
  const clock = { now: START + 100 };
  const host = {
    db,
    readText: async (path: string) => disk[path] ?? null,
    // The diary's own rule keeps it from a cloud.
    cloudAllowed: async (_path: string, text: string) => !text.includes("cloud: deny"),
    now: () => clock.now,
  };
  return { db, disk, host, files, clock };
}

/** Plan KI-Harness P2b-3: one pass writes what is missing, checks it, and keeps the hierarchy current. */
describe("the gist writer", () => {
  it("writes the long sections, the notes, the areas and the vault, and nothing twice", async () => {
    const { db, host } = await vault();
    const m = model();
    const pass = await new GistWriter(host, m).run(new AbortController().signal);
    // Long sections: Offer's two, Plan's, Diary's, Health's; the short note has none.
    expect(pass.sections).toBe(5);
    expect(pass.covered).toBe(5);
    expect(pass.rejected).toBe(0);
    const reader = new GistReader(db, "ollama/m");
    const costs = gistSections(NOTES["Projects/Offer.md"]!).find((s) => s.chain === "Offer > Costs")!;
    expect(await reader.section(costs.key)).toBe("Summary 95 31.12.2026 not.");
    expect(await reader.note("Projects/Offer.md")).toBe("Summary.");
    expect(await reader.area("Projects")).toBe("Summary.");
    // Private holds the diary (kept from a cloud) and health: one part is not enough for an area's gist.
    expect(await reader.area("Private")).toBeNull();
    const asked = m.asked.length;
    const again = await new GistWriter(host, m).run(new AbortController().signal);
    expect(again.written).toBe(0);
    expect(m.asked.length).toBe(asked);
  });

  it("writes a changed section again, leaves the old gist behind, and never serves a stale note gist", async () => {
    const { db, host, disk, files, clock } = await vault();
    const m = model();
    // The first pass right after the notes were written.
    clock.now = START + Object.keys(NOTES).length;
    await new GistWriter(host, m).run(new AbortController().signal);
    const old = gistSections(NOTES["Projects/Plan.md"]!)[0]!;
    disk["Projects/Plan.md"] = NOTES["Projects/Plan.md"]!.replace("spring 2027", "autumn 2028");
    await files.writeTextFile("Projects/Plan.md", disk["Projects/Plan.md"]!);
    await new VaultIndexer(files, db).indexVaultFull();
    const reader = new GistReader(db, "ollama/m");
    // Changed after its gist was written: left out until the next pass.
    expect(await reader.note("Projects/Plan.md")).toBeNull();
    clock.now = START + 1_000;
    await new GistWriter(host, m).run(new AbortController().signal);
    expect(await reader.section(old.key)).toBeNull();
    const fresh = gistSections(disk["Projects/Plan.md"]!)[0]!;
    expect(await reader.section(fresh.key)).toBe("Summary 2028.");
    expect(await reader.note("Projects/Plan.md")).toBe("Summary 2028.");
  });

  it("keeps a rejected answer as a mark, so the same text is not asked again", async () => {
    const { db, host } = await vault({ "Plan.md": NOTES["Projects/Plan.md"]! });
    const lazy: GistModel & { calls: number } = {
      id: "ollama/m",
      calls: 0,
      async complete() {
        this.calls++;
        return "A plan.";
      },
    };
    const first = await new GistWriter(host, lazy).run(new AbortController().signal);
    expect(first).toMatchObject({ written: 0, rejected: 1, covered: 0 });
    await new GistWriter(host, lazy).run(new AbortController().signal);
    expect(lazy.calls).toBe(1);
    expect((await new GistStore(db).counts("ollama/m")).section).toEqual({ ok: 0, rejected: 1 });
  });
});
