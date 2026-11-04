import { describe, expect, it } from "vitest";
import {
  AI_EMBEDDING_PROFILE,
  DEFAULT_AI_APP_SETTINGS,
  SEMANTIC_BY_PROVIDER,
  semanticSourceOf,
  type AiEgress,
  type EgressRecipient,
  type HttpRequestSpec,
} from "@plainva/core";
import { createAiVaultStores, createVaultPolicy, gatherCandidates, LocalEmbeddings, type AiFileStore, type LocalModelBridge } from "@plainva/ui";
import { until, vaultWith } from "./embeddingTestVault";

/** A question sharing words with the kick-off's section (the stand-in model only knows words). */
const QUESTION = "two blocks of two days with editing";

/** A vault large enough to have a band: meaning counts a hit by how far it stands out of it. */
const NOTES: Record<string, string> = {
  "Film/Kickoff.md": "# Kick-off\n\n## Production\n\nTom suggests two blocks of two days, with editing in between.",
  "Garden.md": "Water the tomatoes every morning.",
  "Kitchen.md": "Bake bread with rye flour and salt.",
  "Travel.md": "Train tickets to Lisbon are booked for March.",
  "Bikes.md": "Oil the chain and pump the tyres.",
  "Music.md": "Practise scales on the piano at night.",
  "Books.md": "Return the library novel before Friday.",
  "Health.md": "Walk ten thousand steps along the river.",
  "Cats.md": "Feed the cat salmon and fresh water.",
  "Taxes.md": "File the receipts in the green folder.",
  "Chess.md": "Study openings and endgames with a friend.",
  "Moving.md": "Pack the boxes and label the fragile ones.",
};

/** Words hashed into 64 buckets: texts sharing words land close. */
function wordVector(text: string): number[] {
  const out = new Array<number>(64).fill(0);
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    out[(hash >>> 0) % 64]! += 1;
  }
  out[63]! += 0.01;
  return out;
}

function fakeEgress() {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      const input = (spec.body as { input: string[] }).input;
      onChunk({ type: "data", text: JSON.stringify({ data: input.map((text, index) => ({ index, embedding: wordVector(text) })) }) });
      onChunk({ type: "done" });
    },
    cancel: async () => undefined,
    setKey: async () => undefined,
    hasKey: async () => true,
    deleteKey: async () => undefined,
    addEndpoint: async () => true,
    removeEndpoint: async () => undefined,
  };
  return { egress, sent, questions: () => sent.map((spec) => (spec.body as { input: string[] }).input).filter((input) => input.length === 1 && input[0] === QUESTION) };
}

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

async function controllerFor(providerId: string, notes: Record<string, string> = NOTES) {
  const vault = await vaultWith(notes);
  const net = fakeEgress();
  const stores = createAiVaultStores(memoryFiles(), "vtest");
  const controller = new LocalEmbeddings({
    bridge: noPackages,
    ...vault,
    provider: {
      egress: net.egress,
      policy: createVaultPolicy({ readFile: async (path) => notes[path] ?? null, resolveLink: async () => null, encrypted: () => false }),
      encrypted: () => false,
      approvals: stores.approvals,
      ledger: stores.ledger,
      newId: () => Math.random().toString(36).slice(2),
      now: () => new Date("2026-10-01T09:00:00Z"),
    },
  });
  const source = semanticSourceOf({ ...DEFAULT_AI_APP_SETTINGS, enabled: true, semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId, model: "m" } } })!;
  await controller.update({ source, mode: "both" });
  if (controller.snapshot().engine.kind === "approval") await controller.approve();
  const count = Object.keys(notes).length;
  expect(await until(() => controller.snapshot().progress.state === "idle" && controller.snapshot().progress.current === count)).toBe(true);
  return { controller, net };
}

const cloudChat: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const localChat: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };

/** Plan KI-Harness P2b-1: the vault's search by meaning as a candidate source of the context package. */
describe("candidates by meaning for the context of a message", () => {
  it("finds the note and its closest section, strong by how far it stands out", async () => {
    const { controller } = await controllerFor("ollama");
    const found = await controller.semanticCandidates(QUESTION, 5, { cloudQuestion: false });
    expect(found[0]).toMatchObject({ path: "Film/Kickoff.md" });
    expect(found[0]!.score).toBeGreaterThanOrEqual(0.5);
    expect(found[0]!.hash).toMatch(/^[0-9a-f]{32}$/);
    // Only what stands out of the band takes part — not every note the question was compared with.
    expect(found.length).toBeLessThan(Object.keys(NOTES).length);
    await controller.close();
  });

  it("adds nothing in a vault too small to have a band", async () => {
    const small = { "Film/Kickoff.md": NOTES["Film/Kickoff.md"]!, "Garden.md": NOTES["Garden.md"]! };
    const { controller } = await controllerFor("ollama", small);
    expect(await controller.semanticCandidates(QUESTION, 5, { cloudQuestion: false })).toEqual([]);
    await controller.close();
  });

  it("asks a cloud embedding model only when the conversation goes to a cloud itself", async () => {
    const { controller, net } = await controllerFor("openai");
    expect(await controller.semanticCandidates(QUESTION, 5, { cloudQuestion: false })).toEqual([]);
    expect(net.questions()).toEqual([]);
    const found = await controller.semanticCandidates(QUESTION, 5, { cloudQuestion: true });
    expect(found.map((c) => c.path)).toContain("Film/Kickoff.md");
    expect(net.questions()).toHaveLength(1);
    await controller.close();
  });

  it("joins the other sources, and a local conversation never sends the question to a cloud", async () => {
    const { controller, net } = await controllerFor("openai");
    const retrieval = {
      searchCandidates: async () => [],
      linkNeighbors: async () => [],
      recentlyChanged: async () => [],
      recentlyOpened: async () => [],
      now: () => Date.parse("2026-10-01T09:00:00Z"),
      semanticCandidates: (question: string, limit: number, options: { cloudQuestion: boolean }) => controller.semanticCandidates(question, limit, options),
    };
    const local = await gatherCandidates(retrieval, QUESTION, null, localChat);
    expect(local.flat().filter((c) => c.signals.semantic !== undefined)).toEqual([]);
    const cloud = await gatherCandidates(retrieval, QUESTION, null, cloudChat);
    const meaning = cloud.flat().find((c) => c.path === "Film/Kickoff.md")!;
    expect(meaning.signals.semantic).toBeGreaterThanOrEqual(0.5);
    expect(meaning.chunk).toMatchObject({ ordinal: expect.any(Number) });
    expect(net.questions()).toHaveLength(1);
    await controller.close();
  });
});
