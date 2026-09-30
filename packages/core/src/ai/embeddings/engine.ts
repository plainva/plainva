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
 * runtime's business, filled from the model's own description: position ids
 * 0…seq-1, token type ids 0, and an empty cache (past length 0) for decoder
 * exports that take one — Qwen3 Embedding asks for `past_key_values.*`.
 */
export interface OnnxEmbeddingRunner {
  /** Loads a model file; the handle names it in `run` and `unload`. */
  load(modelPath: string): Promise<string>;
  run(handle: string, batch: TokenBatch): Promise<Float32Array>;
  unload(handle: string): Promise<void>;
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

/**
 * A catalog package as an engine: tokenizer here, model in the native runtime.
 *
 * One text per run, never a padded batch (measured 2026-09-30, ONNX Runtime
 * 1.30 on the reference laptop): the int8 models quantise their activations
 * over the whole batch, so a neighbour or padding moves a vector — cosine to
 * the text alone 0.985 for Granite 97M, 0.995 for 311M, 0.89–0.93 for Qwen3 —
 * and a batch of eight was not even faster (13.2 against 13.9 chunks per
 * second for Granite 97M, 3.9 against 4.3 for 311M). Alone, a text always
 * gets the same vector: the chunk hash relies on it, and so does the device
 * check against the catalog's reference.
 */
export async function createOnnxEmbeddingEngine({ spec, tokenizer, runner, modelPath }: OnnxEngineOptions): Promise<EmbeddingEngine> {
  const handle = await runner.load(modelPath);
  let disposed = false;
  return {
    id: embeddingEngineId(spec),
    dim: spec.dim,
    async embed(texts, kind, signal) {
      if (disposed) throw new Error("embedding engine: disposed");
      const out: Float32Array[] = [];
      for (const text of texts) {
        signal?.throwIfAborted();
        const row = tokenizer.encode(kind === "query" ? `${spec.queryPrefix}${text}` : text);
        const pooled = await runner.run(handle, padBatch([row], tokenizer.padId, spec.pooling));
        if (pooled.length !== spec.dim) throw new Error(`embedding engine: ${pooled.length} values for ${spec.dim} dimensions`);
        out.push(l2Normalize(pooled));
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
