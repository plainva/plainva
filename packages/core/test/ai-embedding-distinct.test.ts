import { describe, expect, it } from "vitest";
import { createTrigramEmbeddingEngine } from "../src/ai/embeddings/engine.js";
import { EmbeddingIndexer } from "../src/ai/embeddings/pipeline.js";
import { VectorIndex } from "../src/ai/embeddings/search.js";
import { resetEmbeddingStores } from "../src/ai/embeddings/store.js";
import { quantizeInt8 } from "../src/ai/embeddings/vectors.js";
import { sha256Hex, utf8Encode } from "../src/workspace/encoding.js";
import { realSqlite } from "./helpers/realSqlite.js";

const unit = (values: number[]) => {
  const norm = Math.hypot(...values);
  return quantizeInt8(new Float32Array(values.map((v) => v / norm)));
};

/** Plan KI-Harness P2b-1: two copies of a paragraph make one source. */
describe("near-duplicates among hits by meaning", () => {
  it("measures how alike two stored sections are", () => {
    const index = new VectorIndex("e", 3);
    index.setNote("a.md", "sa", [{ ordinal: 0, hash: "ha", vector: unit([1, 0, 0]) }]);
    index.setNote("b.md", "sb", [{ ordinal: 0, hash: "hb", vector: unit([0.99, 0.1, 0]) }, { ordinal: 1, hash: "hc", vector: unit([0, 1, 0]) }]);
    expect(index.similarity({ path: "a.md", ordinal: 0 }, { path: "b.md", ordinal: 0 })!).toBeGreaterThan(0.99);
    expect(index.similarity({ path: "a.md", ordinal: 0 }, { path: "b.md", ordinal: 1 })!).toBeLessThan(0.05);
    expect(index.similarity({ path: "a.md", ordinal: 0 }, { path: "c.md", ordinal: 0 })).toBeNull();
  });

  it("keeps the best of near-identical hits and every hit that differs", async () => {
    resetEmbeddingStores();
    const db = await realSqlite();
    const notes: Record<string, string> = {
      "Kickoff.md": "Tom suggests two blocks of two days, with editing in between.",
      "Kickoff copy.md": "Tom suggests two blocks of two days, with editing in between!",
      "Garden.md": "Water the tomatoes every morning.",
    };
    for (const [path, content] of Object.entries(notes)) {
      await db.execute(`INSERT INTO files (id, path, title, sha256, mtime_local, mode) VALUES (?, ?, ?, ?, ?, 'obsidian')`, [path, path, "Same title", sha256Hex(utf8Encode(content)), 1000]);
    }
    const indexer = new EmbeddingIndexer({ db, engine: createTrigramEmbeddingEngine(64), readText: async (path) => notes[path] ?? null });
    await indexer.embed((await indexer.plan()).pending);
    const hits = await indexer.search("two blocks of two days", 3);
    expect(hits.map((hit) => hit.path).sort()).toEqual(["Garden.md", "Kickoff copy.md", "Kickoff.md"]);
    const distinct = await indexer.distinct(hits, 0.95);
    expect(distinct).toHaveLength(2);
    expect(distinct[0]!.path).toBe(hits[0]!.path);
    expect(distinct.map((hit) => hit.path)).toContain("Garden.md");
  });
});
