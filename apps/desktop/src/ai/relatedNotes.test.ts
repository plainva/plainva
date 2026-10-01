import { describe, expect, it } from "vitest";
import { AI_EMBEDDING_PROFILE, createTrigramEmbeddingEngine, DEFAULT_AI_APP_SETTINGS, SEMANTIC_BY_PROVIDER, semanticSourceOf, type AiEgress } from "@plainva/core";
import { createAiVaultStores, createVaultPolicy, LocalEmbeddings, type AiFileStore, type LocalModelBridge, type RelatedFeedbackStore } from "@plainva/ui";
import { until, vaultWith } from "./embeddingTestVault";

/** A vault with a band: the kick-off, a schedule close to its production section, the linked budget, and notes about other things. */
const NOTES: Record<string, string> = {
  "Film/Kickoff.md": "# Kick-off\n\nTen episodes, budget per episode.\n\n## Production\n\nTom suggests two shooting blocks of two days, editing between blocks.",
  "Film/Schedule.md": "# Schedule\n\nShooting blocks: two days each, editing between blocks, Tom decides.",
  "Film/Budget.md": "# Budget\n\nBudget per episode for ten episodes.",
  "People/Tom.md": "Director.",
  "Garden.md": "Water the tomatoes every morning.",
  "Kitchen.md": "Bake rye bread with salt.",
  "Travel.md": "Train tickets to Lisbon are booked for March.",
  "Bikes.md": "Oil the chain and pump the tyres.",
  "Music.md": "Practise scales on the piano at night.",
  "Books.md": "Return the library novel before Friday.",
  "Health.md": "Walk along the river after lunch.",
  "Cats.md": "Feed the cat salmon.",
  "Taxes.md": "File receipts in the green folder.",
  "Chess.md": "Study openings and endgames.",
  "Moving.md": "Pack boxes and label fragile ones.",
};

/** Letter trigrams as a stand-in model: dense like a real one, texts sharing words land close. */
const stand = createTrigramEmbeddingEngine(384);

const egress: AiEgress = {
  async send(_id, spec, onChunk) {
    const input = (spec.body as { input: string[] }).input;
    const vectors = await stand.embed(input, "document");
    onChunk({ type: "data", text: JSON.stringify({ data: vectors.map((vector, index) => ({ index, embedding: [...vector] })) }) });
    onChunk({ type: "done" });
  },
  cancel: async () => undefined,
  setKey: async () => undefined,
  hasKey: async () => true,
  deleteKey: async () => undefined,
  addEndpoint: async () => true,
  removeEndpoint: async () => undefined,
};

const noPackages: LocalModelBridge = {
  status: async (_model, files) => files.map(() => false),
  download: async () => undefined,
  cancel: async () => undefined,
  freeSpace: async () => 5e9,
  remove: async () => undefined,
  readText: async () => "{}",
  load: async () => "h",
  run: async () => ({ vectors: "", dim: 0 }),
  unload: async () => undefined,
};

function memoryFiles(): AiFileStore {
  const files = new Map<string, string>();
  return { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t), remove: async (p) => void files.delete(p), removeDir: async () => undefined };
}

/** A server on this computer computes: no approval, no request for the hints themselves. */
async function controllerFor(related?: RelatedFeedbackStore) {
  const vault = await vaultWith(NOTES);
  // The kick-off links the budget and Tom; the schedule links Tom too.
  const link = (from: string, to: string) =>
    vault.db.execute(`INSERT INTO links (source_id, target_path, target_raw, link_type, line_number) VALUES (?, ?, ?, 'wikilink', 1)`, [from, to, to]);
  await link("Film/Kickoff.md", "Budget");
  await link("Film/Kickoff.md", "Tom");
  await link("Film/Schedule.md", "Tom");
  const stores = createAiVaultStores(memoryFiles(), "vtest");
  const controller = new LocalEmbeddings({
    bridge: noPackages,
    ...vault,
    related: related ?? stores.related,
    provider: {
      egress,
      policy: createVaultPolicy({ readFile: async (path) => NOTES[path] ?? null, resolveLink: async () => null, encrypted: () => false }),
      encrypted: () => false,
      approvals: stores.approvals,
      ledger: stores.ledger,
      newId: () => Math.random().toString(36).slice(2),
      now: () => new Date("2026-10-01T09:00:00Z"),
    },
  });
  const source = semanticSourceOf({ ...DEFAULT_AI_APP_SETTINGS, enabled: true, semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId: "ollama", model: "m" } } })!;
  await controller.update({ source, mode: "both", related: true });
  const count = Object.keys(NOTES).length;
  expect(await until(() => controller.snapshot().progress.state === "idle" && controller.snapshot().progress.current === count)).toBe(true);
  return { controller, vault, source };
}

/** Plan KI-Harness P2b-4: related notes in both shells come from the controller. */
describe("related notes", () => {
  it("offers the note close in meaning and not linked, with its pair of sections and the links both set", async () => {
    const { controller } = await controllerFor();
    const answer = await controller.related("Film/Kickoff.md");
    expect(answer.kind).toBe("hints");
    if (answer.kind !== "hints") return;
    expect(answer.hints.map((hint) => hint.path)).toEqual(["Film/Schedule.md"]);
    const [hint] = answer.hints;
    expect(hint).toMatchObject({ title: "Schedule", from: { chain: "Kick-off › Production", line: 7 }, to: { chain: "Schedule", line: 3 } });
    expect(hint!.from.excerpt).toContain("Tom suggests two shooting blocks");
    expect(hint!.shared).toEqual([{ path: "People/Tom.md", title: "Tom" }]);
    await controller.close();
  });

  it("hides a pair marked not helpful, on this device and after a restart, until it is brought back", async () => {
    const files = memoryFiles();
    const store = createAiVaultStores(files, "vtest").related;
    const first = await controllerFor(store);
    await first.controller.dismissRelated("Film/Kickoff.md", "Film/Schedule.md");
    expect(await first.controller.related("Film/Kickoff.md")).toEqual({ kind: "hints", hints: [] });
    // The pair is one pair from both ends.
    const back = await first.controller.related("Film/Schedule.md");
    expect(back.kind === "hints" && back.hints.some((hint) => hint.path === "Film/Kickoff.md")).toBe(false);
    await first.controller.close();
    const second = await controllerFor(store);
    expect(second.controller.snapshot().related.dismissed).toBe(1);
    await second.controller.restoreRelated();
    const again = await second.controller.related("Film/Kickoff.md");
    expect(again.kind === "hints" && again.hints.map((hint) => hint.path)).toEqual(["Film/Schedule.md"]);
    await second.controller.close();
  });

  it("pauses a note and the vault, and follows the setting", async () => {
    const { controller, source } = await controllerFor();
    await controller.pauseRelated("Film/Kickoff.md");
    expect(await controller.related("Film/Kickoff.md")).toEqual({ kind: "paused" });
    await controller.resumeRelated("Film/Kickoff.md");
    await controller.setRelatedVaultPaused(true);
    expect(await controller.related("Film/Kickoff.md")).toEqual({ kind: "vaultPaused" });
    await controller.setRelatedVaultPaused(false);
    const version = controller.snapshot().related.version;
    await controller.update({ source, mode: "both", related: false });
    expect(controller.snapshot().engine.kind).toBe("ready");
    expect(controller.snapshot().related.version).toBeGreaterThan(version);
    expect(await controller.related("Film/Kickoff.md")).toEqual({ kind: "off" });
    await controller.close();
  });

  it("waits while the note's vectors are older than its text", async () => {
    const { controller, vault } = await controllerFor();
    await vault.db.execute(`UPDATE files SET sha256 = 'changed' WHERE path = ?`, ["Film/Kickoff.md"]);
    expect(await controller.related("Film/Kickoff.md")).toEqual({ kind: "pending" });
    await controller.close();
  });
});
