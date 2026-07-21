/**
 * Key-derivation for the settings-sync + encryption feature (P0). Argon2id from
 * `@noble/hashes` (audited, dependency-free) turns a user passphrase into a
 * 32-byte key-encryption key (KEK). The cost parameters live in the keyfile
 * header so they can be retuned later (e.g. lowered for weak mobile devices)
 * without a format break.
 *
 * The passphrase is NFC-normalized before UTF-8 encoding so the same characters
 * derive the same key across platforms and input methods.
 */
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { utf8Encode } from "./cryptoPrimitives.js";

/** Argon2id cost parameters (serialized into the keyfile header). */
export interface Argon2Params {
  /** "argon2id" — reserved for a future algorithm switch. */
  algo: "argon2id";
  /** Memory cost in kibibytes. */
  m: number;
  /** Time cost (iterations). */
  t: number;
  /** Parallelism. */
  p: number;
}

/**
 * Default cost: 64 MiB / 3 passes / 1 lane. A sensible desktop baseline that P0
 * benchmarks against a real Android/iOS WebView; if a device is too slow the
 * setup can pin a lower `m` in the header without breaking existing keyfiles.
 */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { algo: "argon2id", m: 65536, t: 3, p: 1 };

const KEK_LENGTH = 32;

/**
 * Derives the 32-byte KEK from a passphrase and salt. Async so the WebView UI
 * stays responsive during the memory-hard derivation (noble yields via
 * `asyncTick`). Throws on unsupported params.
 */
export async function deriveKek(passphrase: string, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  if (params.algo !== "argon2id") throw new Error(`unsupported kdf algo: ${params.algo}`);
  const normalized = passphrase.normalize("NFC");
  const key = await argon2idAsync(utf8Encode(normalized), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: KEK_LENGTH,
    asyncTick: 20,
  });
  return key;
}
