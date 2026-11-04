/**
 * The device check of a model package (plan KI-Harness P2a-3/P2a-6): every
 * shell embeds one fixed text and compares the start of its vector with the
 * reference the catalog carries (onnxruntime-node 1.30 and the same
 * tokenizer on the embedding spike's machine, 2026-09-30). One number covers
 * the whole chain — tokenizer, native runtime, pooling — so a wrong input, a
 * wrong pooling or a broken library shows before a single note is embedded.
 */
import type { EmbeddingModelSpec } from "./catalog.js";

/**
 * Close enough for int8 models on other CPUs (other kernels round
 * differently), far from what a wrong chain gives (unrelated directions).
 */
const MIN_COSINE = 0.98;
const MAX_DELTA = 0.02;

export interface GoldenAgreement {
  ok: boolean;
  /** Cosine between the reference head and the same components of the vector. */
  cosine: number;
  /** The largest difference of one component. */
  maxDelta: number;
}

export function goldenAgreement(spec: EmbeddingModelSpec, vector: Float32Array): GoldenAgreement {
  const head = spec.golden.head;
  let dot = 0;
  let a = 0;
  let b = 0;
  let maxDelta = 0;
  for (let i = 0; i < head.length; i++) {
    const got = vector[i] ?? Number.NaN;
    dot += head[i]! * got;
    a += head[i]! * head[i]!;
    b += got * got;
    maxDelta = Math.max(maxDelta, Math.abs(got - head[i]!));
  }
  const cosine = a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
  const ok = vector.length === spec.dim && Number.isFinite(cosine) && cosine >= MIN_COSINE && maxDelta <= MAX_DELTA;
  return { ok, cosine: Number.isFinite(cosine) ? cosine : 0, maxDelta: Number.isFinite(maxDelta) ? maxDelta : Infinity };
}
