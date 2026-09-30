import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_MODELS,
  embeddingEngineId,
  embeddingFileUrl,
  embeddingModel,
  embeddingPackageBytes,
  embeddingPackageFiles,
} from "./catalog.js";

describe("embedding model catalog", () => {
  it("has unique ids and a default that exists", () => {
    const ids = EMBEDDING_MODELS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(embeddingModel(DEFAULT_EMBEDDING_MODEL_ID)?.hint).toBe("recommended");
    expect(embeddingModel("unknown")).toBeUndefined();
  });

  // A package is exactly what the spike measured: a fixed commit, sizes and
  // checksums, never a moving branch.
  it("pins every file by commit, size and SHA-256", () => {
    for (const spec of EMBEDDING_MODELS) {
      expect(spec.revision).toMatch(/^[0-9a-f]{40}$/);
      for (const file of embeddingPackageFiles(spec)) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        const url = embeddingFileUrl(spec, file);
        expect(url).toBe(`https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.name}`);
        expect(url).not.toMatch(/\/resolve\/main\//);
      }
    }
  });

  it("describes what a model needs to run", () => {
    for (const spec of EMBEDDING_MODELS) {
      expect(spec.dim).toBeGreaterThan(0);
      expect(["cls", "last", "mean"]).toContain(spec.pooling);
      expect(spec.maxTokens).toBeGreaterThan(8);
      expect(spec.licence.spdx).not.toBe("");
      expect(spec.licence.url).toMatch(/^https:\/\//);
      expect(spec.referenceChunksPerSecond).toBeGreaterThan(0);
    }
    expect(embeddingModel("qwen3-embedding-0.6b")?.queryPrefix).toMatch(/Query:$/);
  });

  it("downloads the model last and adds up the package", () => {
    const spec = embeddingModel(DEFAULT_EMBEDDING_MODEL_ID)!;
    const files = embeddingPackageFiles(spec);
    expect(files[files.length - 1]).toBe(spec.model);
    expect(embeddingPackageBytes(spec)).toBe(spec.model.bytes + spec.tokenizer.bytes + spec.tokenizerConfig.bytes);
  });

  // A new revision is a new vector space: its vectors never mix with the old ones.
  it("names the vector space by model and revision", () => {
    const spec = embeddingModel(DEFAULT_EMBEDDING_MODEL_ID)!;
    expect(embeddingEngineId(spec)).toBe(`plainva:${spec.id}@${spec.revision.slice(0, 12)}`);
    expect(embeddingEngineId({ ...spec, revision: "0".repeat(40) })).not.toBe(embeddingEngineId(spec));
  });
});
