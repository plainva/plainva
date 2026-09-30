import { beforeEach, describe, expect, it } from "vitest";
import { createTrigramEmbeddingEngine, type EmbeddingEngine } from "../src/ai/embeddings/engine.js";
import { EmbeddingIndexer } from "../src/ai/embeddings/pipeline.js";
import { resetEmbeddingStores } from "../src/ai/embeddings/store.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { sha256Hex, utf8Encode } from "../src/workspace/encoding.js";
import { realSqlite } from "./helpers/realSqlite.js";

/** The trigram engine, counting the texts it was asked to embed. */
function countingEngine(): EmbeddingEngine & { texts: string[] } {
  const inner = createTrigramEmbeddingEngine(64);
  const texts: string[] = [];
  return {
    id: inner.id,
    dim: inner.dim,
    texts,
    async embed(batch, kind, signal) {
      if (kind === "document") texts.push(...batch);
      return inner.embed(batch, kind, signal);
    },
    dispose: () => inner.dispose(),
  };
}

describe("EmbeddingIndexer", () => {
  let db: IDatabaseAdapter;
  let disk: Map<string, string>;
  let engine: ReturnType<typeof countingEngine>;
  let indexer: EmbeddingIndexer;

  /** What the vault indexer would write for a note (or an attachment). */
  async function indexed(path: string, content: string, mtime: number, mode = "obsidian") {
    disk.set(path, content);
    await db.execute(`DELETE FROM files WHERE path = ?`, [path]);
    await db.execute(
      `INSERT INTO files (id, path, title, sha256, mtime_local, mode) VALUES (?, ?, ?, ?, ?, ?)`,
      [path, path, path.replace(/^.*\//, "").replace(/\.md$/, ""), sha256Hex(utf8Encode(content)), mtime, mode],
    );
  }

  const indexerFor = () => new EmbeddingIndexer({ db, engine, readText: async (path) => disk.get(path) ?? null });

  beforeEach(async () => {
    resetEmbeddingStores();
    db = await realSqlite();
    disk = new Map();
    engine = countingEngine();
    indexer = indexerFor();
    await indexed("Budget.md", "## Costs\n\nThe quarterly budget review is on Friday.\n\n## Travel\n\nTrain to Lisbon.", 3000);
    await indexed("Garden.md", "Water the tomatoes every morning.", 2000);
    await indexed("Old.md", "Minutes of a meeting long ago.", 1000);
    await indexed("photo.png", "", 4000, "attachment");
    await indexed("Tasks.base", "views: []", 4000);
  });

  it("plans the notes without vectors, most recently changed first", async () => {
    const plan = await indexer.plan();
    expect(plan.pending.map((work) => work.path)).toEqual(["Budget.md", "Garden.md", "Old.md"]);
    expect(plan.pending[0]!.title).toBe("Budget");
    expect(plan.total).toBe(3);
    expect(plan.orphans).toEqual([]);
  });

  it("embeds notes and has nothing left to do", async () => {
    const outcome = await indexer.embed((await indexer.plan()).pending);
    expect([...outcome.values()]).toEqual(["embedded", "embedded", "embedded"]);
    expect((await indexer.plan()).pending).toEqual([]);
    expect(engine.texts).toContain("Budget › Costs\n\nThe quarterly budget review is on Friday.");
    const [hit] = await indexer.search("budget review", 1);
    expect(hit!.path).toBe("Budget.md");
  });

  it("re-embeds only the chunks an edit touched", async () => {
    await indexer.embed((await indexer.plan()).pending);
    engine.texts.length = 0;
    await indexed("Budget.md", "## Costs\n\nThe quarterly budget review is on Friday.\n\n## Travel\n\nTrain to Porto.", 5000);
    const plan = await indexer.plan();
    expect(plan.pending.map((work) => work.path)).toEqual(["Budget.md"]);
    await indexer.embed(plan.pending);
    expect(engine.texts).toEqual(["Budget › Travel\n\nTrain to Porto."]);
  });

  it("keeps vectors across a restart and reuses them", async () => {
    await indexer.embed((await indexer.plan()).pending);
    const restarted = indexerFor();
    expect((await restarted.plan()).pending).toEqual([]);
    expect((await restarted.search("tomatoes", 1))[0]!.path).toBe("Garden.md");
    engine.texts.length = 0;
    await indexed("Budget.md", "## Costs\n\nThe quarterly budget review is on Friday.\n\n## Travel\n\nTrain to Porto.", 6000);
    await restarted.embed((await restarted.plan()).pending);
    expect(engine.texts).toEqual(["Budget › Travel\n\nTrain to Porto."]);
  });

  it("leaves a note that changed on disk since the index read it, and one that is gone", async () => {
    const plan = await indexer.plan();
    disk.set("Garden.md", "Changed behind the index's back.");
    disk.delete("Old.md");
    const outcome = await indexer.embed(plan.pending);
    expect(Object.fromEntries(outcome)).toEqual({ "Budget.md": "embedded", "Garden.md": "changed", "Old.md": "gone" });
    expect((await indexer.plan()).pending.map((work) => work.path)).toEqual(["Garden.md", "Old.md"]);
  });

  // Never stale: a note whose text moved on answers only by its words until it is embedded again.
  it("never answers from a note's old text", async () => {
    await indexer.embed((await indexer.plan()).pending);
    await indexed("Budget.md", "Nothing about money any more.", 7000);
    expect((await indexer.search("quarterly budget review", 3)).map((hit) => hit.path)).not.toContain("Budget.md");
    await indexer.embed((await indexer.plan()).pending);
    expect((await indexer.search("money any more", 1))[0]!.path).toBe("Budget.md");
  });

  it("forgets the vectors of notes that left the index", async () => {
    await indexer.embed((await indexer.plan()).pending);
    await db.execute(`DELETE FROM files WHERE path = ?`, ["Garden.md"]);
    const plan = await indexer.plan();
    expect(plan.orphans).toEqual(["Garden.md"]);
    await indexer.forget(plan.orphans);
    expect((await indexer.search("tomatoes", 5)).map((hit) => hit.path)).not.toContain("Garden.md");
    expect([...(await indexer.store.noteStates(engine.id)).keys()].sort()).toEqual(["Budget.md", "Old.md"]);
  });

  it("narrows a search to the notes the caller accepts", async () => {
    await indexer.embed((await indexer.plan()).pending);
    expect((await indexer.search("budget review", 5, (path) => path !== "Budget.md")).map((hit) => hit.path)).not.toContain("Budget.md");
  });
});
