/**
 * Authenticated encryption for the settings-sync + encryption feature (v3 §3.2).
 * XChaCha20-Poly1305 from `@noble/ciphers`: the 24-byte extended nonce is safe
 * to pick at random. The nonce is EXPLICIT here — the callers own nonce
 * generation because it is part of the sealed-blob header (and thus the AAD).
 *
 * `aeadDecrypt` throws when the Poly1305 tag does not verify (wrong key or
 * tampered ciphertext) — callers turn that into "wrong passphrase" / "cannot
 * decode".
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "./cryptoPrimitives.js";

/** XChaCha20-Poly1305 nonce length. */
export const AEAD_NONCE_LENGTH = 24;
/** XChaCha20-Poly1305 key length. */
export const AEAD_KEY_LENGTH = 32;

/** A fresh random 24-byte nonce. */
export function aeadNonce(): Uint8Array {
  return randomBytes(AEAD_NONCE_LENGTH);
}

/** Encrypts `plaintext` under `key` + `nonce`, binding optional `aad`. Returns ciphertext+tag. */
export function aeadEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== AEAD_KEY_LENGTH) throw new Error("aead key must be 32 bytes");
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new Error("aead nonce must be 24 bytes");
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

/** Decrypts under `key` + `nonce`, verifying the tag and `aad`. Throws on any mismatch. */
export function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== AEAD_KEY_LENGTH) throw new Error("aead key must be 32 bytes");
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new Error("aead nonce must be 24 bytes");
  return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
}
