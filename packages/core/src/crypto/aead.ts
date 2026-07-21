/**
 * Authenticated encryption for the settings-sync + encryption feature (P0).
 * XChaCha20-Poly1305 from `@noble/ciphers`: the 24-byte extended nonce is safe
 * to pick at random (no counter bookkeeping, negligible collision risk), which
 * fits a decorator that re-encrypts files independently without shared state.
 *
 * `decrypt` throws when the Poly1305 tag does not verify (wrong key or tampered
 * ciphertext) — callers turn that into "wrong passphrase" / "cannot decode".
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "./cryptoPrimitives.js";

/** XChaCha20-Poly1305 nonce length. */
export const AEAD_NONCE_LENGTH = 24;
/** XChaCha20-Poly1305 key length. */
export const AEAD_KEY_LENGTH = 32;

export interface AeadSealed {
  /** 24-byte random nonce. */
  nonce: Uint8Array;
  /** Ciphertext with the appended 16-byte Poly1305 tag. */
  ciphertext: Uint8Array;
}

/** Encrypts `plaintext` under `key`, binding optional `aad`. Fresh random nonce. */
export function aeadEncrypt(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): AeadSealed {
  if (key.length !== AEAD_KEY_LENGTH) throw new Error("aead key must be 32 bytes");
  const nonce = randomBytes(AEAD_NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return { nonce, ciphertext };
}

/** Decrypts under `key`, verifying the tag and `aad`. Throws on any mismatch. */
export function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== AEAD_KEY_LENGTH) throw new Error("aead key must be 32 bytes");
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new Error("aead nonce must be 24 bytes");
  return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
}
