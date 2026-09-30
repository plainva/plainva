import { describe, expect, it } from "vitest";
import { chunkNote } from "./chunks.js";
import { createTrigramEmbeddingEngine } from "./engine.js";
import { fuseRankings, RRF_K, VectorIndex } from "./search.js";
import type { StoredChunkVector } from "./store.js";
import { l2Normalize, quantizeInt8 } from "./vectors.js";

const chunk = (ordinal: number, components: number[]): StoredChunkVector => ({
  ordinal,
  hash: `h${ordinal}-${components.join("")}`,
  vector: quantizeInt8(l2Normalize(Float32Array.from(components))),
});

describe("VectorIndex", () => {
  it("answers each note with its best chunk, best notes first", () => {
    const index = new VectorIndex("test", 2);
    index.setNote("a.md", "sa", [chunk(0, [0, 1]), chunk(1, [1, 0.1])]);
    index.setNote("b.md", "sb", [chunk(0, [1, 1])]);
    index.setNote("c.md", "sc", [chunk(0, [0, 1])]);
    const hits = index.search(Float32Array.of(1, 0), 2);
    expect(hits.map((hit) => [hit.path, hit.ordinal])).toEqual([["a.md", 1], ["b.md", 0]]);
    expect(hits[0]!.score).toBeGreaterThan(0.99);
    expect(index.noteCount).toBe(3);
    expect(index.chunkCount).toBe(4);
  });

  it("leaves out notes the caller does not accept, and forgets removed ones", () => {
    const index = new VectorIndex("test", 2);
    index.load([
      { path: "keep.md", sha256: "k", chunks: [chunk(0, [1, 0])] },
      { path: "skip.md", sha256: "s", chunks: [chunk(0, [1, 0])] },
    ]);
    expect(index.search(Float32Array.of(1, 0), 5, (path) => path !== "skip.md").map((hit) => hit.path)).toEqual(["keep.md"]);
    expect(index.sha256Of("keep.md")).toBe("k");
    index.removeNote("keep.md");
    expect(index.sha256Of("keep.md")).toBeUndefined();
    expect(index.search(Float32Array.of(1, 0), 5).map((hit) => hit.path)).toEqual(["skip.md"]);
  });

  it("refuses vectors and questions of another dimension", () => {
    const index = new VectorIndex("test", 2);
    expect(() => index.setNote("a.md", "s", [chunk(0, [1, 0, 0])])).toThrow(/3 components/);
    expect(() => index.search(Float32Array.of(1, 0, 0), 1)).toThrow(/3-dimensional/);
  });

  it("finds a note by its content through chunks and an engine", async () => {
    const engine = createTrigramEmbeddingEngine(128);
    const notes = {
      "Garden.md": "## Tomatoes\n\nWater the tomatoes every morning.",
      "Budget.md": "## Costs\n\nThe quarterly budget review is on Friday.",
      "Travel.md": "Train tickets to Lisbon are booked.",
    };
    const index = new VectorIndex(engine.id, engine.dim);
    for (const [path, content] of Object.entries(notes)) {
      const chunks = chunkNote(path.replace(/\.md$/, ""), content);
      const vectors = await engine.embed(chunks.map((c) => c.text), "document");
      index.setNote(path, "sha", chunks.map((c, i) => ({ ordinal: c.ordinal, hash: c.hash, vector: quantizeInt8(vectors[i]!) })));
    }
    const [question] = await engine.embed(["budget review"], "query");
    expect(index.search(question!, 1)[0]!.path).toBe("Budget.md");
  });
});

describe("fuseRankings", () => {
  it("adds 1 / (k + rank) per ranking and records who found a note", () => {
    const fused = fuseRankings({ words: ["a.md", "b.md"], meaning: ["b.md", "c.md"] });
    expect(fused.map((hit) => hit.path)).toEqual(["b.md", "a.md", "c.md"]);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    expect(fused[0]!.ranks).toEqual({ words: 2, meaning: 1 });
    expect(fused[2]!.ranks).toEqual({ meaning: 2 });
  });

  it("counts a note once per ranking and orders ties by path", () => {
    const fused = fuseRankings({ words: ["b.md", "b.md", "a.md"], meaning: ["a.md", "b.md"] });
    expect(fused.find((hit) => hit.path === "b.md")!.ranks).toEqual({ words: 1, meaning: 2 });
    expect(fuseRankings({ x: ["z.md"], y: ["a.md"] }).map((hit) => hit.path)).toEqual(["a.md", "z.md"]);
  });
});
