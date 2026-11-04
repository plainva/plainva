import { beforeEach, describe, expect, it } from "vitest";
import { standingManifestOf } from "../src/ai/context/manifest.js";
import { gateDecision } from "../src/ai/egressGate.js";
import { createTrigramEmbeddingEngine, type EmbeddingEngine } from "../src/ai/embeddings/engine.js";
import { EmbeddingIndexer, embeddableNotes, type EmbeddingAdmission } from "../src/ai/embeddings/pipeline.js";
import { EmbeddingStore, resetEmbeddingStores } from "../src/ai/embeddings/store.js";
import { effectivePolicy, notePolicyFrom, type FolderPolicyRule } from "../src/ai/policy.js";
import { readFrontmatterPath } from "../src/frontmatter-surgical.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { sha256Hex, utf8Encode } from "../src/workspace/encoding.js";
import { realSqlite } from "./helpers/realSqlite.js";

/** The trigram engine, keeping every text that went to it — as a cloud would. */
function cloudEngine(): EmbeddingEngine & { texts: string[] } {
  const inner = createTrigramEmbeddingEngine(64, "provider:openai/text-embedding-3-small");
  const texts: string[] = [];
  return {
    id: inner.id,
    dim: inner.dim,
    texts,
    async embed(batch, kind, signal) {
      texts.push(...batch);
      return inner.embed(batch, kind, signal);
    },
    dispose: () => inner.dispose(),
  };
}

/** Plan KI-Harness P2a-5: the privacy rules decide what goes to a cloud engine (ADR 0018). */
describe("a cloud engine and the privacy rules", () => {
  let db: IDatabaseAdapter;
  let disk: Map<string, string>;
  let engine: ReturnType<typeof cloudEngine>;
  let rules: FolderPolicyRule[];
  let reads: string[];

  const run = { recipient: { kind: "cloud" as const, provider: "openai", model: "text-embedding-3-small" }, webTools: false };
  const policyOf = (path: string, text: string) => {
    const plainva = readFrontmatterPath(text, ["plainva"]);
    return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), rules);
  };
  const admission: EmbeddingAdmission = {
    rulesKey: async () => JSON.stringify(rules),
    async deniedByRules(paths) {
      return new Set(paths.filter((path) => !gateDecision(policyOf(path, ""), run).allowed));
    },
    admits: async (path, text) => gateDecision(policyOf(path, text), run).allowed,
  };

  async function indexed(path: string, content: string, mtime: number) {
    disk.set(path, content);
    await db.execute(`DELETE FROM files WHERE path = ?`, [path]);
    await db.execute(`INSERT INTO files (id, path, title, sha256, mtime_local, mode, size_bytes) VALUES (?, ?, ?, ?, ?, 'obsidian', ?)`, [
      path,
      path,
      path.replace(/^.*\//, "").replace(/\.md$/, ""),
      sha256Hex(utf8Encode(content)),
      mtime,
      utf8Encode(content).length,
    ]);
  }

  const indexer = () =>
    new EmbeddingIndexer({
      db,
      engine,
      admission,
      readText: async (path) => {
        reads.push(path);
        return disk.get(path) ?? null;
      },
    });

  beforeEach(async () => {
    resetEmbeddingStores();
    db = await realSqlite();
    disk = new Map();
    engine = cloudEngine();
    rules = [];
    reads = [];
    await indexed("Budget.md", "The quarterly budget review is on Friday.", 3000);
    await indexed("Private/Diary.md", "Dear diary, today I worried about the budget.", 2000);
    await indexed("Notes/Secret.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\nThe secret budget of the surprise party.", 1000);
  });

  it("sends nothing of a note its own rule keeps from the cloud, and counts it as withheld", async () => {
    const pipeline = indexer();
    const outcome = await pipeline.embed((await pipeline.plan()).pending);
    expect(Object.fromEntries(outcome)).toEqual({ "Budget.md": "embedded", "Private/Diary.md": "embedded", "Notes/Secret.md": "withheld" });
    expect(engine.texts.join("\n")).not.toContain("surprise party");
    const plan = await pipeline.plan();
    expect(plan).toMatchObject({ pending: [], total: 3, withheld: 1 });
    expect((await pipeline.search("secret budget party", 5)).map((hit) => hit.path)).not.toContain("Notes/Secret.md");
  });

  it("takes the vectors of notes a new folder rule denies, reading only those, and releases them when the rule goes", async () => {
    const pipeline = indexer();
    await pipeline.embed((await pipeline.plan()).pending);
    rules = [{ folder: "Private/", cloud: "deny" }];
    reads.length = 0;
    const plan = await pipeline.plan();
    // Only the note the new rule covers was read to be judged; its own-rule neighbour waits to be judged again.
    expect(reads).toEqual(["Private/Diary.md"]);
    expect(plan.withheld).toBe(1);
    expect(plan.pending.map((work) => work.path)).toEqual(["Notes/Secret.md"]);
    expect([...(await new EmbeddingStore(db).noteStates(engine.id)).keys()]).toEqual(["Budget.md"]);
    expect((await pipeline.search("diary worried", 5)).map((hit) => hit.path)).not.toContain("Private/Diary.md");
    await pipeline.embed(plan.pending);
    expect(await pipeline.plan()).toMatchObject({ pending: [], withheld: 2 });

    rules = [];
    const opened = await pipeline.plan();
    expect(opened.withheld).toBe(0);
    expect(opened.pending.map((work) => work.path)).toEqual(["Private/Diary.md", "Notes/Secret.md"]);
    expect(Object.fromEntries(await pipeline.embed(opened.pending))).toEqual({ "Private/Diary.md": "embedded", "Notes/Secret.md": "withheld" });
  });

  it("does not judge anything again while the rules stay as they are", async () => {
    const pipeline = indexer();
    await pipeline.embed((await pipeline.plan()).pending);
    reads.length = 0;
    await pipeline.plan();
    await pipeline.plan();
    expect(reads).toEqual([]);
  });

  it("lists what a standing approval covers: the notes the rules let go, their folders, and the questions", async () => {
    rules = [{ folder: "Private/", cloud: "deny" }];
    const notes = await embeddableNotes(db);
    const denied = await admission.deniedByRules(notes.map((note) => note.path));
    const going = notes.filter((note) => !denied.has(note.path));
    const manifest = standingManifestOf(
      { providerId: "openai", providerLabel: "OpenAI", model: "text-embedding-3-small", price: { input: 0.02, output: 0 } },
      { paths: going.map((note) => note.path), withheld: denied.size, bytes: going.reduce((sum, note) => sum + note.bytes, 0) },
    );
    expect(manifest).toMatchObject({
      providerId: "openai",
      model: "text-embedding-3-small",
      local: false,
      sources: [],
      standing: { notes: 2 },
      dataClasses: ["notes", "searches"],
      folders: ["", "Notes"],
      withheld: { notes: 1 },
    });
    expect(manifest.estimatedTokens).toBeGreaterThan(10);
    expect(manifest.estimatedCostUsd).toBeCloseTo((manifest.estimatedTokens / 1_000_000) * 0.02, 12);
  });
});

describe("the fingerprint of a provider's model", () => {
  it("is kept per engine and goes with its vectors", async () => {
    resetEmbeddingStores();
    const db = await realSqlite();
    const store = new EmbeddingStore(db);
    const probe = new Float32Array([0.6, -0.8, 0]);
    expect(await store.probeOf("provider:ollama/nomic-embed-text", 3)).toBeNull();
    await store.setProbe("provider:ollama/nomic-embed-text", probe);
    const kept = await store.probeOf("provider:ollama/nomic-embed-text", 3);
    expect(Array.from(kept!).map((v) => Math.round(v * 100) / 100)).toEqual([0.6, -0.8, 0]);
    expect(await store.probeOf("provider:ollama/nomic-embed-text", 4)).toBeNull();
    await store.dropEngine("provider:ollama/nomic-embed-text");
    expect(await store.probeOf("provider:ollama/nomic-embed-text", 3)).toBeNull();
  });
});
