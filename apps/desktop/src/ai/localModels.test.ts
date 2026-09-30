import { describe, expect, it, vi } from "vitest";
import { embeddingModel, fromBase64, toBase64, type EmbeddingModelSpec, type EmbeddingPackageFile } from "@plainva/core";
import { bridgeRunner, downloadPackage, openPackage, packageInstalled, type LocalModelBridge } from "@plainva/ui";

const spec = embeddingModel("granite-r2-97m")!;

const special = (id: number, content: string) => ({ id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true });
/** A word-level tokenizer with [CLS] … [SEP], enough to build an engine. */
const TOKENIZER = JSON.stringify({
  version: "1.0",
  truncation: null,
  padding: null,
  added_tokens: [special(0, "[PAD]"), special(1, "[CLS]"), special(2, "[SEP]")],
  normalizer: { type: "Lowercase" },
  pre_tokenizer: { type: "Whitespace" },
  post_processor: {
    type: "TemplateProcessing",
    single: [{ SpecialToken: { id: "[CLS]", type_id: 0 } }, { Sequence: { id: "A", type_id: 0 } }, { SpecialToken: { id: "[SEP]", type_id: 0 } }],
    pair: [],
    special_tokens: { "[CLS]": { id: "[CLS]", ids: [1], tokens: ["[CLS]"] }, "[SEP]": { id: "[SEP]", ids: [2], tokens: ["[SEP]"] } },
  },
  decoder: null,
  model: { type: "WordLevel", vocab: { "[PAD]": 0, "[CLS]": 1, "[SEP]": 2, "[UNK]": 3, plainva: 4, probe: 5 }, unk_token: "[UNK]" },
});

function fakeBridge(present: boolean[] = [false, false, false]) {
  const downloads: string[] = [];
  const runs: { ids: number[]; mask: number[]; batch: number; seq: number; pooling: string }[] = [];
  const bridge: LocalModelBridge = {
    status: vi.fn(async () => present),
    async download(_model, file: EmbeddingPackageFile, url, onProgress) {
      downloads.push(url);
      onProgress(file.bytes / 2);
      onProgress(file.bytes);
    },
    cancel: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    readText: async (_model, name) => (name === "tokenizer.json" ? TOKENIZER : JSON.stringify({ pad_token: "[PAD]" })),
    load: vi.fn(async (modelFile: string) => `h:${modelFile}`),
    async run(_handle, batch) {
      const ids = Array.from(new Int32Array(fromBase64(batch.ids).slice().buffer));
      runs.push({ ids, mask: Array.from(fromBase64(batch.mask)), batch: batch.batch, seq: batch.seq, pooling: batch.pooling });
      // dim 2: (token count, first id) per row.
      const out = new Float32Array(batch.batch * 2);
      for (let r = 0; r < batch.batch; r++) out.set([ids.slice(r * batch.seq, (r + 1) * batch.seq).filter((id) => id !== 0).length, ids[r * batch.seq]!], r * 2);
      return { vectors: toBase64(new Uint8Array(out.buffer)), dim: 2 };
    },
    unload: vi.fn(async () => undefined),
  };
  return { bridge, downloads, runs };
}

describe("local model packages", () => {
  it("downloads the missing files, the model last, with progress over the whole package", async () => {
    const { bridge, downloads } = fakeBridge([true, false, false]);
    const progress: number[] = [];
    await downloadPackage(bridge, spec, (p) => progress.push(p.received));
    expect(downloads).toEqual([
      `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/tokenizer.json`,
      `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/onnx/model_quantized.onnx`,
    ]);
    const total = spec.model.bytes + spec.tokenizer.bytes + spec.tokenizerConfig.bytes;
    expect(progress[0]).toBe(spec.tokenizerConfig.bytes);
    expect(progress[progress.length - 1]).toBe(total);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("knows an installed package by its checked files", async () => {
    expect(await packageInstalled(fakeBridge([true, true, true]).bridge, spec)).toBe(true);
    expect(await packageInstalled(fakeBridge([true, false, true]).bridge, spec)).toBe(false);
  });

  it("moves typed arrays over the bridge as base64", async () => {
    const { bridge, runs } = fakeBridge();
    const runner = bridgeRunner(bridge);
    const vectors = await runner.run("h", { ids: Int32Array.of(1, 250_000, -1, 0), mask: Uint8Array.of(1, 1, 1, 0), batch: 2, seq: 2, pooling: "cls" });
    expect(runs[0]).toEqual({ ids: [1, 250_000, -1, 0], mask: [1, 1, 1, 0], batch: 2, seq: 2, pooling: "cls" });
    expect(Array.from(vectors)).toEqual([2, 1, 1, -1]);
  });

  it("opens an installed package as an engine on the native runtime", async () => {
    const { bridge, runs } = fakeBridge();
    // The fake runtime answers in two dimensions.
    const engine = await openPackage(bridge, { ...spec, dim: 2 } as EmbeddingModelSpec);
    expect(bridge.load).toHaveBeenCalledWith(`${spec.id}/${spec.model.name}`);
    const [vector] = await engine.embed(["Plainva probe"], "document");
    expect(runs[0]!.ids).toEqual([1, 4, 5, 2]);
    expect(Math.hypot(...vector!)).toBeCloseTo(1, 5);
    await engine.dispose();
    expect(bridge.unload).toHaveBeenCalledWith(`h:${spec.id}/${spec.model.name}`);
  });
});
