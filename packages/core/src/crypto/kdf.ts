/**
 * Key-derivation for the settings-sync + encryption feature (v3 §3.2, E2).
 * scrypt (`@noble/hashes`) is the portable default KDF that runs acceptably on
 * Desktop/WebView2, Android and iOS; Argon2id is available as an optional
 * algorithm for new keyfiles once cross-platform benchmarks pass. PBKDF2 is not
 * an option. The header is algorithm-agile and carries the parameters so they
 * can be retuned without a format break; readers validate hard min/max bounds
 * BEFORE any allocation to reject DoS keyfiles.
 *
 * The passphrase is NFC-normalized before UTF-8 encoding so the same characters
 * derive the same key across platforms and input methods.
 */
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { utf8Encode } from "./cryptoPrimitives.js";

/** scrypt cost parameters (serialized into the keyfile header). */
export interface ScryptParams {
  algo: "scrypt";
  /** CPU/memory cost, MUST be a power of two. */
  N: number;
  /** Block size. */
  r: number;
  /** Parallelization. */
  p: number;
}

/** Argon2id cost parameters (optional algorithm). */
export interface Argon2Params {
  algo: "argon2id";
  /** Memory cost in kibibytes. */
  m: number;
  /** Time cost (iterations). */
  t: number;
  /** Parallelism. */
  p: number;
}

export type KdfParams = ScryptParams | Argon2Params;

/**
 * Default: scrypt N=2^16, r=8, p=1 ≈ 64 MiB — a strong desktop baseline that P1
 * benchmarks against real mobile WebViews before it is pinned. Retunable via the
 * header without breaking existing keyfiles.
 */
export const DEFAULT_KDF_PARAMS: ScryptParams = { algo: "scrypt", N: 1 << 16, r: 8, p: 1 };

const KEK_LENGTH = 32;

// Hard bounds validated before allocation (DoS keyfiles). scrypt memory is
// ~128*N*r bytes; cap it well under a gigabyte. Argon2 m is in KiB.
const SCRYPT_MAX_MEM = 512 * 1024 * 1024;
const ARGON2_MAX_M_KIB = 512 * 1024;

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

/** Validates KDF params against hard bounds before any derivation/allocation. */
export function validateKdfParams(params: KdfParams): void {
  if (params.algo === "scrypt") {
    if (!isPowerOfTwo(params.N)) throw new Error("scrypt N must be a power of two > 1");
    if (!Number.isInteger(params.r) || params.r < 1 || params.r > 32) throw new Error("scrypt r out of range");
    if (!Number.isInteger(params.p) || params.p < 1 || params.p > 16) throw new Error("scrypt p out of range");
    if (128 * params.N * params.r > SCRYPT_MAX_MEM) throw new Error("scrypt parameters exceed the memory budget");
  } else if (params.algo === "argon2id") {
    if (!Number.isInteger(params.m) || params.m < 8 || params.m > ARGON2_MAX_M_KIB) throw new Error("argon2 m out of range");
    if (!Number.isInteger(params.t) || params.t < 1 || params.t > 16) throw new Error("argon2 t out of range");
    if (!Number.isInteger(params.p) || params.p < 1 || params.p > 16) throw new Error("argon2 p out of range");
  } else {
    throw new Error(`unsupported kdf algo: ${(params as { algo: string }).algo}`);
  }
}

/**
 * Derives the 32-byte KEK from a passphrase and salt. Async so the WebView UI
 * stays responsive during the memory-hard derivation. Validates params first.
 */
export async function deriveKek(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  validateKdfParams(params);
  const normalized = utf8Encode(passphrase.normalize("NFC"));
  if (params.algo === "scrypt") {
    return scryptAsync(normalized, salt, {
      N: params.N,
      r: params.r,
      p: params.p,
      dkLen: KEK_LENGTH,
      maxmem: SCRYPT_MAX_MEM + 1024,
      asyncTick: 20,
    });
  }
  return argon2idAsync(normalized, salt, { m: params.m, t: params.t, p: params.p, dkLen: KEK_LENGTH, asyncTick: 20 });
}
