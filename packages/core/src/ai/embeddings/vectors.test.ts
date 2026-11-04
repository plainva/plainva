import { describe, expect, it } from "vitest";
import { decodeInt8, dequantizeInt8, dotInt8, encodeInt8, l2Normalize, quantizeInt8 } from "./vectors.js";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

const randomUnit = (dim: number, next: () => number) => l2Normalize(Float32Array.from({ length: dim }, next));

function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

describe("embedding vectors", () => {
  it("normalises to length one and leaves a zero vector alone", () => {
    const v = l2Normalize(Float32Array.of(3, 4));
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(Array.from(l2Normalize(new Float32Array(3)))).toEqual([0, 0, 0]);
  });

  it("quantises to int8 with the largest component at 127", () => {
    const vector = Float32Array.of(0.5, -0.25, 0.1, 0);
    const q = quantizeInt8(vector);
    expect(q.values[0]).toBe(127);
    expect(q.values[1]).toBe(-63); // -63.5 rounds towards +∞
    const back = dequantizeInt8(q);
    for (let i = 0; i < vector.length; i++) expect(Math.abs(back[i]! - vector[i]!)).toBeLessThanOrEqual(q.scale / 2 + 1e-7);
    expect(Array.from(quantizeInt8(new Float32Array(4)).values)).toEqual([0, 0, 0, 0]);
  });

  it("stores int8 components as base64 text and refuses a wrong length", () => {
    const values = Int8Array.of(-127, -1, 0, 1, 127);
    expect(Array.from(decodeInt8(encodeInt8(values), 5)!)).toEqual(Array.from(values));
    expect(decodeInt8(encodeInt8(values), 4)).toBeNull();
    expect(decodeInt8("not base64 at all!", 5)).toBeNull();
  });

  // Quality-neutral in the spike; here: the order of neighbours survives.
  it("keeps the ranking of cosine similarities", () => {
    const next = seeded(7);
    const dim = 384;
    const query = randomUnit(dim, next);
    const docs = Array.from({ length: 200 }, () => randomUnit(dim, next));
    const exact = docs.map((doc, i) => ({ i, score: cosine(query, doc) })).sort((a, b) => b.score - a.score);
    const quantised = docs.map((doc) => quantizeInt8(doc));
    const matrix = new Int8Array(docs.length * dim);
    quantised.forEach((q, row) => matrix.set(q.values, row * dim));
    const approx = quantised
      .map((q, i) => ({ i, score: dotInt8(query, matrix, i, q.scale) }))
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < docs.length; i++) expect(Math.abs(approx.find((x) => x.i === i)!.score - cosine(query, docs[i]!))).toBeLessThan(0.01);
    expect(approx.slice(0, 5).map((x) => x.i)).toEqual(exact.slice(0, 5).map((x) => x.i));
  });
});
