import { describe, expect, it, vi } from "vitest";
import { embeddingEngineId, embeddingModel, type EmbeddingModelSpec } from "./catalog.js";
import { createOnnxEmbeddingEngine, createTrigramEmbeddingEngine, padBatch, type OnnxEmbeddingRunner, type TokenBatch } from "./engine.js";
import type { EmbeddingTokenizer } from "./tokenizer.js";

const spec: EmbeddingModelSpec = { ...embeddingModel("qwen3-embedding-0.6b")!, dim: 3, queryPrefix: "Q:" };

/** One token per character; the runner turns a row into (length, first id, 1). */
const tokenizer: EmbeddingTokenizer = { padId: 0, encode: (text) => Array.from(text, (char) => char.codePointAt(0)!) };

function fakeRunner() {
  const batches: TokenBatch[] = [];
  const runner: OnnxEmbeddingRunner = {
    load: vi.fn(async () => "handle-1"),
    unload: vi.fn(async () => undefined),
    run: vi.fn(async (_handle: string, batch: TokenBatch) => {
      batches.push(batch);
      const out = new Float32Array(batch.batch * 3);
      for (let r = 0; r < batch.batch; r++) {
        let length = 0;
        for (let c = 0; c < batch.seq; c++) length += batch.mask[r * batch.seq + c]!;
        out.set([length, batch.ids[r * batch.seq]!, 1], r * 3);
      }
      return out;
    }),
  };
  return { runner, batches };
}

describe("token batches", () => {
  it("pads on the right and masks the padding", () => {
    const batch = padBatch([[5, 6, 7], [8]], 9, "cls");
    expect(Array.from(batch.ids)).toEqual([5, 6, 7, 8, 9, 9]);
    expect(Array.from(batch.mask)).toEqual([1, 1, 1, 1, 0, 0]);
    expect([batch.batch, batch.seq, batch.pooling]).toEqual([2, 3, "cls"]);
  });
});

describe("createOnnxEmbeddingEngine", () => {
  it("answers in input order with normalised vectors, prefixing only questions", async () => {
    const { runner, batches } = fakeRunner();
    const engine = await createOnnxEmbeddingEngine({ spec, tokenizer, runner, modelPath: "/models/q.onnx" });
    expect(runner.load).toHaveBeenCalledWith("/models/q.onnx");
    expect(engine.id).toBe(embeddingEngineId(spec));
    const docs = await engine.embed(["abcdef", "a", "abc"], "document");
    const lengths = docs.map((vector) => {
      const norm = Math.hypot(...vector);
      expect(norm).toBeCloseTo(1, 5);
      return vector[0]! / vector[2]!;
    });
    expect(lengths.map(Math.round)).toEqual([6, 1, 3]);
    // One text per run, never padded next to another (see createOnnxEmbeddingEngine).
    expect(batches.map((batch) => [batch.batch, batch.seq])).toEqual([[1, 6], [1, 1], [1, 3]]);
    expect(batches.every((batch) => batch.pooling === "last" && batch.mask.every((m) => m === 1))).toBe(true);
    const [question] = await engine.embed(["abc"], "query");
    expect(Math.round(question![0]! / question![2]!)).toBe(5); // "Q:abc"
    expect(Math.round(question![1]! / question![2]!)).toBe("Q".codePointAt(0));
  });

  it("stops between batches when aborted and refuses a wrong shape", async () => {
    const { runner } = fakeRunner();
    const engine = await createOnnxEmbeddingEngine({ spec, tokenizer, runner, modelPath: "m" });
    const controller = new AbortController();
    controller.abort();
    await expect(engine.embed(["a"], "document", controller.signal)).rejects.toThrow();
    const broken = await createOnnxEmbeddingEngine({ spec, tokenizer, runner: { ...runner, run: async () => new Float32Array(2) }, modelPath: "m" });
    await expect(broken.embed(["a"], "document")).rejects.toThrow(/2 values for 3 dimensions/);
  });

  it("unloads the model once", async () => {
    const { runner } = fakeRunner();
    const engine = await createOnnxEmbeddingEngine({ spec, tokenizer, runner, modelPath: "m" });
    await engine.dispose();
    await engine.dispose();
    expect(runner.unload).toHaveBeenCalledTimes(1);
    await expect(engine.embed(["a"], "document")).rejects.toThrow(/disposed/);
  });
});

describe("createTrigramEmbeddingEngine", () => {
  it("puts texts that share words closer than texts that do not", async () => {
    const engine = createTrigramEmbeddingEngine(64);
    const [a, b, c] = await engine.embed(["quarterly budget review", "the budget review", "garden tomatoes"], "document");
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((sum, v, i) => sum + v * y[i]!, 0);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!));
    expect(engine.dim).toBe(64);
  });
});
