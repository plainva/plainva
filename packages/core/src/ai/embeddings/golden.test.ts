import { describe, expect, it } from "vitest";
import { EMBEDDING_MODELS } from "./catalog.js";
import { goldenAgreement } from "./golden.js";

/** A full vector whose head is the reference, the rest filled to its dimension. */
function withHead(head: readonly number[], dim: number, scale = 1): Float32Array {
  const vector = new Float32Array(dim);
  head.forEach((value, i) => (vector[i] = value * scale));
  return vector;
}

describe("the golden check of a model package", () => {
  it("carries a reference for every catalog model", () => {
    for (const spec of EMBEDDING_MODELS) {
      expect(spec.golden.text).not.toBe("");
      expect(spec.golden.head).toHaveLength(16);
      expect(spec.golden.head.some((value) => value !== 0)).toBe(true);
    }
  });

  it("accepts the reference and the rounding of another CPU", () => {
    for (const spec of EMBEDDING_MODELS) {
      expect(goldenAgreement(spec, withHead(spec.golden.head, spec.dim)).ok).toBe(true);
      const nudged = withHead(spec.golden.head.map((value, i) => value + (i % 2 ? 0.003 : -0.003)), spec.dim);
      expect(goldenAgreement(spec, nudged).ok).toBe(true);
    }
  });

  // What a wrong chain produces: another token pooled, another input, another model.
  it("refuses an unrelated direction, a wrong dimension and a broken vector", () => {
    const spec = EMBEDDING_MODELS[0]!;
    const shifted = withHead([...spec.golden.head.slice(1), spec.golden.head[0]!], spec.dim);
    expect(goldenAgreement(spec, shifted).ok).toBe(false);
    expect(goldenAgreement(spec, withHead(spec.golden.head, spec.dim + 1)).ok).toBe(false);
    const broken = withHead(spec.golden.head, spec.dim);
    broken[3] = Number.NaN;
    expect(goldenAgreement(spec, broken)).toMatchObject({ ok: false, maxDelta: Infinity });
  });
});
