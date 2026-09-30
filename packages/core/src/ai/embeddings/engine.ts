/**
 * What turns text into vectors (plan KI-Harness §10.3, P2a): a local model
 * package run by the native ONNX Runtime of each shell, or — P2a-5 — an own
 * provider's embeddings route. Search, store and pipeline only know this seam.
 */
import type { EmbeddingModelSpec, EmbeddingPooling } from "./catalog.js";
import { embeddingEngineId } from "./catalog.js";
import type { EmbeddingTokenizer } from "./tokenizer.js";
import { l2Normalize } from "./vectors.js";

/** A search question gets the model's query prefix; a note's chunk goes in as it is. */
export type EmbeddingKind = "query" | "document";

export interface EmbeddingEngine {
  /** The vector space (`embeddingEngineId`): vectors of two engines never mix. */
  readonly id: string;
  readonly dim: number;
  /** One L2-normalised vector per text, in the order of `texts`. */
  embed(texts: readonly string[], kind: EmbeddingKind, signal?: AbortSignal): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

/** A padded batch of token ids, row-major, padded on the right. */
export interface TokenBatch {
  ids: Int32Array;
  /** 1 for a token, 0 for padding. */
  mask: Uint8Array;
  batch: number;
  seq: number;
  pooling: EmbeddingPooling;
}

/**
 * The native runtime of a shell: one interface, three implementations
 * (desktop Rust `ort`, Android and iOS ONNX Runtime 1.30). `run` returns the
 * pooled vectors, `batch × dim`: `cls` takes the first token, `last` the last
 * unmasked one, `mean` the masked mean. The model's other inputs are the
 * runtime's business — position ids 0…seq-1 and token type ids 0 where a
 * model asks for them.
 */
export interface OnnxEmbeddingRunner {
  /** Loads a model file; the handle names it in `run` and `unload`. */
  load(modelPath: string): Promise<string>;
  run(handle: string, batch: TokenBatch): Promise<Float32Array>;
  unload(handle: string): Promise<void>;
}

/** Tokens per batch (`batch × seq`): padding costs time, so texts of like length run together. */
const BATCH_TOKENS = 4096;
const BATCH_TEXTS = 16;

/** Texts in batches of like token length, as indices into `lengths`. */
export function tokenBatches(lengths: readonly number[], batchTokens = BATCH_TOKENS, batchTexts = BATCH_TEXTS): number[][] {
  const order = lengths.map((_, index) => index).sort((a, b) => lengths[a]! - lengths[b]! || a - b);
  const batches: number[][] = [];
  let current: number[] = [];
  for (const index of order) {
    // Sorted ascending, so the newest text is the longest: it sets the padded width.
    const width = lengths[index]!;
    if (current.length && ((current.length + 1) * width > batchTokens || current.length === batchTexts)) {
      batches.push(current);
      current = [];
    }
    current.push(index);
  }
  if (current.length) batches.push(current);
  return batches;
}

export function padBatch(rows: readonly number[][], padId: number, pooling: EmbeddingPooling): TokenBatch {
  const seq = Math.max(1, ...rows.map((row) => row.length));
  const ids = new Int32Array(rows.length * seq).fill(padId);
  const mask = new Uint8Array(rows.length * seq);
  rows.forEach((row, r) => {
    ids.set(row, r * seq);
    mask.fill(1, r * seq, r * seq + row.length);
  });
  return { ids, mask, batch: rows.length, seq, pooling };
}

export interface OnnxEngineOptions {
  spec: EmbeddingModelSpec;
  tokenizer: EmbeddingTokenizer;
  runner: OnnxEmbeddingRunner;
  /** The verified model file on this device. */
  modelPath: string;
}

/** A catalog package as an engine: tokenizer here, model in the native runtime. */
export async function createOnnxEmbeddingEngine({ spec, tokenizer, runner, modelPath }: OnnxEngineOptions): Promise<EmbeddingEngine> {
  const handle = await runner.load(modelPath);
  let disposed = false;
  return {
    id: embeddingEngineId(spec),
    dim: spec.dim,
    async embed(texts, kind, signal) {
      if (disposed) throw new Error("embedding engine: disposed");
      const rows = texts.map((text) => tokenizer.encode(kind === "query" ? `${spec.queryPrefix}${text}` : text));
      const out = new Array<Float32Array>(texts.length);
      for (const batch of tokenBatches(rows.map((row) => row.length))) {
        signal?.throwIfAborted();
        const pooled = await runner.run(handle, padBatch(batch.map((index) => rows[index]!), tokenizer.padId, spec.pooling));
        if (pooled.length !== batch.length * spec.dim) {
          throw new Error(`embedding engine: ${pooled.length} values for ${batch.length} × ${spec.dim}`);
        }
        batch.forEach((index, r) => {
          out[index] = l2Normalize(pooled.slice(r * spec.dim, (r + 1) * spec.dim));
        });
      }
      return out;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await runner.unload(handle);
    },
  };
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A stand-in engine for tests and end-to-end runs, where no model can be
 * downloaded: the lower-cased character trigrams of a text, hashed into `dim`
 * buckets. Texts sharing words land close together — enough to exercise
 * store, pipeline, search and fusion; it knows nothing of meaning.
 */
export function createTrigramEmbeddingEngine(dim = 64, id = `test:trigram-${dim}`): EmbeddingEngine {
  return {
    id,
    dim,
    async embed(texts, _kind, signal) {
      signal?.throwIfAborted();
      return texts.map((text) => {
        const vector = new Float32Array(dim);
        const padded = ` ${text.toLowerCase()} `;
        const chars = Array.from(padded);
        for (let i = 0; i + 3 <= chars.length; i++) {
          const bucket = fnv1a(chars.slice(i, i + 3).join("")) % dim;
          vector[bucket] = vector[bucket]! + 1;
        }
        return l2Normalize(vector);
      });
    },
    async dispose() {},
  };
}
