/**
 * Embedding vectors as the index keeps them (plan KI-Harness §10.6): int8 with
 * one scale per vector — a quarter of float32, and neutral for the ranking in
 * the embedding spike (hit@5 unchanged on all 90 questions) — written as
 * base64 TEXT, because neither SQL bridge binds a BLOB (the desktop plugin
 * returns BLOBs as number arrays and binds arrays as JSON text; the phone
 * bridges differ per OS).
 */
import { fromBase64, toBase64 } from "../../workspace/encoding.js";

export interface QuantizedVector {
  /** The value of one step: `values[i] * scale` is the original component. */
  scale: number;
  values: Int8Array;
}

/** Scales a vector to length 1 in place (a zero vector stays zero) and returns it. */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!;
  if (sum > 0) {
    const inverse = 1 / Math.sqrt(sum);
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! * inverse;
  }
  return vector;
}

/** int8 with the largest component at ±127. */
export function quantizeInt8(vector: Float32Array): QuantizedVector {
  let max = 0;
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]!));
  const scale = max > 0 ? max / 127 : 1;
  const values = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) values[i] = Math.max(-127, Math.min(127, Math.round(vector[i]! / scale)));
  return { scale, values };
}

export function dequantizeInt8({ scale, values }: QuantizedVector): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! * scale;
  return out;
}

export function encodeInt8(values: Int8Array): string {
  return toBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

/** The stored components, or null when the text does not hold exactly `dim` of them. */
export function decodeInt8(text: string, dim: number): Int8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    return null;
  }
  if (bytes.length !== dim) return null;
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The dot product of a float query and row `row` of an int8 matrix, scaled back. */
export function dotInt8(query: Float32Array, values: Int8Array, row: number, scale: number): number {
  const dim = query.length;
  const offset = row * dim;
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += query[i]! * values[offset + i]!;
  return sum * scale;
}
